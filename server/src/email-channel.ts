/**
 * Email channel for team inboxes.
 *
 * Inbound mail arrives from a mail provider's inbound webhook (Postmark format, or a small generic JSON format any relay
 * can post). Customer mail becomes a CUSTOMER_SUPPORT conversation in "Customer support" (India / Marketplace /
 * super admin); supplier mail becomes a SUPPLIER_EMAIL conversation in "Supplier email" (China / super admin).
 * Staff replies go out by email with proper threading headers; attachments go through the normal upload pipeline.
 *
 * Everything is DISABLED unless EMAIL_CHANNEL_ENABLED=true and a provider + addresses are configured. Secrets are
 * read from the environment only and never returned by any endpoint.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { Db } from './db.js';
import type { User } from './users.js';
import type { UploadStore, Staged } from './uploads.js';
import { MAX_FILE_BYTES } from './uploads.js';
import {
  chatFileKey, SUPPORT_INBOX, SUPPLIER_EMAIL_INBOX, canAccessSupportInbox, canAccessSupplierEmail,
} from './chat.js';

export type Side = 'CUSTOMER' | 'SUPPLIER';

export interface EmailConfig {
  enabled: boolean;
  provider: 'postmark' | 'generic' | 'none';
  apiUrl: string | null;
  apiToken: string | null;
  inboundSecret: string | null;
  customerAddress: string | null;
  supplierAddress: string | null;
  notifyFrom: string | null;
  fromName: string;
  domain: string;
  appUrl: string;
}

const addr = (v?: string | null) => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s) ? s : null;
};

export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const provider = (['postmark', 'generic'].includes(String(env.EMAIL_PROVIDER ?? '').toLowerCase())
    ? String(env.EMAIL_PROVIDER).toLowerCase() : 'none') as EmailConfig['provider'];
  const customerAddress = addr(env.EMAIL_CUSTOMER_ADDRESS);
  const supplierAddress = addr(env.EMAIL_SUPPLIER_ADDRESS);
  const domain = (customerAddress ?? supplierAddress ?? 'sourceeasy.in').split('@')[1]!;
  const apiUrl = env.EMAIL_API_URL && /^https:\/\//.test(env.EMAIL_API_URL) ? env.EMAIL_API_URL : null;
  return {
    enabled: String(env.EMAIL_CHANNEL_ENABLED ?? '').toLowerCase() === 'true',
    provider,
    apiUrl: provider === 'postmark' ? (apiUrl ?? 'https://api.postmarkapp.com/email') : apiUrl,
    apiToken: env.EMAIL_API_TOKEN || null,
    inboundSecret: env.EMAIL_INBOUND_SECRET && env.EMAIL_INBOUND_SECRET.length >= 24 ? env.EMAIL_INBOUND_SECRET : null,
    customerAddress,
    supplierAddress,
    notifyFrom: addr(env.EMAIL_NOTIFY_FROM) ?? customerAddress,
    fromName: String(env.EMAIL_FROM_NAME ?? 'Source Easy').replace(/[\r\n"<>]/g, '').slice(0, 60) || 'Source Easy',
    domain,
    appUrl: String(env.APP_URL ?? 'https://sourceeasy.in').replace(/\/$/, ''),
  };
}

/** Readiness without secrets. */
export function emailStatus(c: EmailConfig) {
  const missing: string[] = [];
  if (!c.enabled) missing.push('EMAIL_CHANNEL_ENABLED=true');
  if (c.provider === 'none') missing.push('EMAIL_PROVIDER (postmark or generic)');
  if (c.provider === 'generic' && !c.apiUrl) missing.push('EMAIL_API_URL (https)');
  if (!c.apiToken) missing.push('EMAIL_API_TOKEN');
  if (!c.inboundSecret) missing.push('EMAIL_INBOUND_SECRET (24+ characters)');
  if (!c.customerAddress) missing.push('EMAIL_CUSTOMER_ADDRESS');
  if (!c.supplierAddress) missing.push('EMAIL_SUPPLIER_ADDRESS');
  const outboundReady = c.enabled && c.provider !== 'none' && !!c.apiUrl && !!c.apiToken;
  const inboundReady = c.enabled && !!c.inboundSecret && !!(c.customerAddress || c.supplierAddress);
  return {
    enabled: c.enabled, provider: c.provider, outboundReady, inboundReady,
    customerAddress: c.customerAddress, supplierAddress: c.supplierAddress, notifyFrom: c.notifyFrom,
    inboundPath: '/api/email/inbound', missing,
  };
}

// ---------------------------------------------------------------- outbound

export interface OutboundMail {
  from: string; fromName: string; to: string; subject: string; text: string;
  messageId: string; inReplyTo?: string | null; references?: string[];
  attachments?: { name: string; mime: string; data: Buffer }[];
}
export interface MailSender { readonly enabled: boolean; send(m: OutboundMail): Promise<void> }
export const disabledSender: MailSender = { enabled: false, async send() { throw new Error('email not configured'); } };

const fmtFrom = (name: string, a: string) => `"${name.replace(/["\\\r\n]/g, '')}" <${a}>`;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function senderFromConfig(c: EmailConfig, http: typeof fetch = fetch): MailSender {
  if (!c.enabled || c.provider === 'none' || !c.apiUrl || !c.apiToken) return disabledSender;
  const url = c.apiUrl, token = c.apiToken;
  if (c.provider === 'postmark') {
    return { enabled: true, async send(m) {
      const headers = [{ Name: 'Message-ID', Value: m.messageId }];
      if (m.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: m.inReplyTo });
      if (m.references?.length) headers.push({ Name: 'References', Value: m.references.join(' ') });
      const r = await http(url, {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': token, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          From: fmtFrom(m.fromName, m.from), To: m.to, Subject: oneLine(m.subject), TextBody: m.text,
          Headers: headers, MessageStream: 'outbound',
          Attachments: (m.attachments ?? []).map((a) => ({ Name: a.name, Content: a.data.toString('base64'), ContentType: a.mime })),
        }),
      });
      if (!r.ok) throw new Error(`email provider ${r.status}`);
    } };
  }
  return { enabled: true, async send(m) {
    const r = await http(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: m.from, fromName: m.fromName, to: m.to, subject: oneLine(m.subject), text: m.text,
        headers: { 'Message-ID': m.messageId, ...(m.inReplyTo ? { 'In-Reply-To': m.inReplyTo } : {}), ...(m.references?.length ? { References: m.references.join(' ') } : {}) },
        attachments: (m.attachments ?? []).map((a) => ({ filename: a.name, contentType: a.mime, contentBase64: a.data.toString('base64') })),
      }),
    });
    if (!r.ok) throw new Error(`email provider ${r.status}`);
  } };
}

// ---------------------------------------------------------------- inbound parsing

export interface InboundAttachment { name: string; mime: string; data: Buffer }
export interface InboundMail {
  fromEmail: string; fromName: string | null; to: string[]; subject: string; text: string;
  messageId: string; inReplyTo: string | null; references: string[];
  autoSubmitted: boolean; attachments: InboundAttachment[];
}

const ids = (v: unknown) => String(v ?? '').match(/<[^<>\s]+>/g) ?? [];
const angle = (v: unknown) => { const s = String(v ?? '').trim(); if (!s) return null; return s.startsWith('<') ? s : `<${s}>`; };
const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x?.Email ?? x?.email ?? x?.address ?? '')).flatMap(list);
  return String(v ?? '').split(',').map((x) => { const m = /<([^>]+)>/.exec(x); return addr(m ? m[1] : x); }).filter((x): x is string => !!x);
};
export function htmlToText(h: string) {
  return h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
/** Drop quoted history from a reply ("On … wrote:", "-----Original Message-----", "> " lines). */
export function stripQuoted(t: string) {
  const lines = t.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*On .{3,200}wrote:\s*$/.test(l) || /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^\s*在.{2,120}写道[:：]\s*$/.test(l)) break;
    if (/^\s*From:\s.+/.test(l) && /^\s*(Sent|Date):\s/.test(lines[i + 1] ?? '')) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Normalises a Postmark inbound webhook or the generic JSON format. Returns null when it is not usable. */
export function parseInbound(body: any): InboundMail | null {
  if (!body || typeof body !== 'object') return null;
  const postmark = 'FromFull' in body || 'TextBody' in body || 'MessageID' in body;
  const headerList: { Name?: string; Value?: string }[] = Array.isArray(body.Headers) ? body.Headers : [];
  const hdr = (n: string) => {
    if (postmark) return headerList.find((h) => String(h?.Name ?? '').toLowerCase() === n.toLowerCase())?.Value ?? null;
    const h = body.headers && typeof body.headers === 'object' ? body.headers : {};
    const k = Object.keys(h).find((x) => x.toLowerCase() === n.toLowerCase());
    return k ? String(h[k]) : null;
  };
  const fromRaw = postmark ? (body.FromFull?.Email ?? body.From) : (typeof body.from === 'object' ? body.from?.email : body.from);
  const fromEmail = list(fromRaw)[0] ?? null;
  if (!fromEmail) return null;
  const fromName = (postmark ? body.FromFull?.Name : (typeof body.from === 'object' ? body.from?.name : null)) || null;
  const to = postmark
    ? [...list(body.ToFull ?? body.To), ...list(body.CcFull ?? body.Cc), ...list(body.OriginalRecipient)]
    : [...list(body.to), ...list(body.cc)];
  const subject = oneLine(String(postmark ? body.Subject ?? '' : body.subject ?? '')).slice(0, 300);
  const rawText = postmark
    ? String(body.StrippedTextReply || body.TextBody || (body.HtmlBody ? htmlToText(String(body.HtmlBody)) : ''))
    : String(body.text || (body.html ? htmlToText(String(body.html)) : ''));
  const messageId = angle(postmark ? (hdr('Message-ID') ?? body.MessageID) : (body.messageId ?? hdr('Message-ID')));
  if (!messageId) return null;
  const inReplyTo = angle(postmark ? hdr('In-Reply-To') : (body.inReplyTo ?? hdr('In-Reply-To')));
  const references = [...ids(postmark ? hdr('References') : (Array.isArray(body.references) ? body.references.join(' ') : body.references ?? hdr('References')))];
  const auto = String(hdr('Auto-Submitted') ?? '').toLowerCase();
  const prec = String(hdr('Precedence') ?? '').toLowerCase();
  const autoSubmitted = (auto !== '' && auto !== 'no') || ['bulk', 'list', 'junk', 'auto_reply'].includes(prec) || !!hdr('X-Autoreply') || !!hdr('X-Autorespond');
  const atts: InboundAttachment[] = [];
  for (const a of (postmark ? body.Attachments : body.attachments) ?? []) {
    const name = String(postmark ? a?.Name : a?.filename ?? a?.name ?? 'attachment').slice(0, 120) || 'attachment';
    const mime = String(postmark ? a?.ContentType : a?.contentType ?? 'application/octet-stream').slice(0, 100);
    const b64 = String(postmark ? a?.Content ?? '' : a?.contentBase64 ?? a?.content ?? '');
    if (!b64) continue;
    atts.push({ name, mime, data: Buffer.from(b64, 'base64') });
  }
  return { fromEmail, fromName: fromName ? oneLine(String(fromName)).slice(0, 120) : null, to: [...new Set(to)], subject, text: rawText, messageId, inReplyTo, references, autoSubmitted, attachments: atts };
}

export function secretMatches(expected: string | null, headers: Record<string, unknown>) {
  if (!expected) return false;
  const auth = String(headers.authorization ?? '');
  let given = '';
  if (/^bearer /i.test(auth)) given = auth.slice(7).trim();
  else if (/^basic /i.test(auth)) { const dec = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8'); given = dec.slice(dec.indexOf(':') + 1); }
  else if (headers['x-inbound-secret']) given = String(headers['x-inbound-secret']);
  const a = createHash('sha256').update(given).digest(), b = createHash('sha256').update(expected).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

const normSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|wg|回复|答复|转发)\s*[:：]\s*)+/i, '').trim().toLowerCase();
export const LEAD_REF_RE = /\bSE-\d{4}-\d{3,5}\b/i;

// ---------------------------------------------------------------- channel

export interface EmailChannelDeps {
  db: Db;
  uploads: UploadStore;
  sender: MailSender;
  config: EmailConfig;
  notify: (side: Side, conversationId: string, recipients: string[], byName: string, preview: string) => Promise<void>;
  live: (d: Record<string, unknown>) => void;
  userById: (id: string) => User | undefined;
  staffUsers: () => User[];
  now?: () => number;
}

export const MAX_INBOUND_TEXT = 3900;
export const INBOUND_PER_SENDER_HOUR = 30;
export const MAX_INBOUND_ATTACHMENTS = 5;

export class EmailChannel {
  constructor(private d: EmailChannelDeps) {}
  get config() { return this.d.config; }
  get status() { return emailStatus(this.d.config); }

  private now() { return this.d.now ? this.d.now() : Date.now(); }

  /** Which desk does this mail belong to? A known sender wins over the address it was sent to (privacy first). */
  async classify(m: InboundMail): Promise<{ side: Side; supplierId: string | null; supplierName: string | null; reason: string }> {
    const e = m.fromEmail;
    const sup = await this.d.db.get(
      `SELECT s.id, s.name FROM suppliers s WHERE position(? in lower(COALESCE(s.contact, ''))) > 0
       UNION ALL SELECT NULL AS id, u.name FROM users u WHERE u.role = 'SUPPLIER' AND lower(u.email) = ? LIMIT 1`, e, e,
    );
    const cust = await this.d.db.get(
      `SELECT 1 AS x FROM customers WHERE email_key = ? OR lower(COALESCE(email, '')) = ?
       UNION ALL SELECT 1 FROM customer_users WHERE lower(COALESCE(email, '')) = ?
       UNION ALL SELECT 1 FROM leads WHERE lower(COALESCE(contact_email, '')) = ? LIMIT 1`, e, e, e, e,
    );
    if (sup && !cust) return { side: 'SUPPLIER', supplierId: sup.id ?? null, supplierName: sup.name ?? null, reason: 'known_supplier' };
    if (cust && !sup) return { side: 'CUSTOMER', supplierId: null, supplierName: null, reason: 'known_customer' };
    const c = this.d.config;
    if (c.supplierAddress && m.to.includes(c.supplierAddress) && !(c.customerAddress && m.to.includes(c.customerAddress))) {
      return { side: 'SUPPLIER', supplierId: sup?.id ?? null, supplierName: sup?.name ?? null, reason: 'supplier_address' };
    }
    return { side: 'CUSTOMER', supplierId: null, supplierName: null, reason: 'customer_address' };
  }

  private async log(messageId: string, status: string, side: Side | null, conversationId: string | null, reason: string | null) {
    await this.d.db.run(
      'INSERT INTO email_inbound_log (id, message_id, status, side, conversation_id, reason) VALUES (?,?,?,?,?,?) ON CONFLICT (message_id) DO NOTHING',
      randomUUID(), messageId.slice(0, 500), status, side, conversationId, reason,
    );
  }

  private async rate(fromEmail: string) {
    const r = await this.d.db.get<{ c: number }>(
      `SELECT COUNT(*)::int c FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE c.email_address = ? AND m.email_message_id IS NOT NULL AND m.author_kind IN ('customer', 'supplier') AND m.created_at > now() - interval '1 hour'`, fromEmail,
    );
    return (r?.c ?? 0) < INBOUND_PER_SENDER_HOUR;
  }

  /** Finds the thread this mail replies to. The sender must match the thread's address, so a forged header cannot join another thread. */
  private async findThread(m: InboundMail, kind: string) {
    const refs = [m.inReplyTo, ...m.references].filter((x): x is string => !!x).slice(-20);
    for (const ref of refs.reverse()) {
      const row = await this.d.db.get(
        `SELECT c.id FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE m.email_message_id = ? AND c.kind = ? AND c.email_address = ? LIMIT 1`, ref, kind, m.fromEmail,
      );
      if (row) return String(row.id);
    }
    const subj = normSubject(m.subject);
    if (!subj) return null;
    const rows = await this.d.db.all(
      `SELECT id, email_subject FROM chat_conversations WHERE kind = ? AND channel = 'EMAIL' AND email_address = ?
       AND COALESCE(last_message_at, created_at) > now() - interval '60 days' ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 10`, kind, m.fromEmail,
    );
    const hit = rows.find((r: any) => normSubject(String(r.email_subject ?? '')) === subj);
    return hit ? String(hit.id) : null;
  }

  private async autoLead(side: Side, m: InboundMail): Promise<string | null> {
    const ref = (LEAD_REF_RE.exec(m.subject) ?? LEAD_REF_RE.exec(m.text))?.[0]?.toUpperCase();
    if (!ref) return null;
    const lead = await this.d.db.get('SELECT id, contact_email, customer_id, portal_customer_id FROM leads WHERE upper(lead_ref) = ?', ref);
    if (!lead) return null;
    if (side === 'SUPPLIER') return String(lead.id);
    // Customer side: only when the sender is that lead's own contact, so nobody can attach themselves to another customer's lead.
    const own = String(lead.contact_email ?? '').toLowerCase() === m.fromEmail
      || !!(await this.d.db.get(
        `SELECT 1 FROM customers c WHERE c.id IN (?, ?) AND (c.email_key = ? OR lower(COALESCE(c.email, '')) = ?)`,
        lead.customer_id ?? '', lead.portal_customer_id ?? '', m.fromEmail, m.fromEmail,
      ));
    return own ? String(lead.id) : null;
  }

  private deskRecipients(side: Side, inbox: string) {
    return this.d.db.all('SELECT user_id FROM chat_inbox_members WHERE inbox_id = ?', inbox).then((rows) => rows
      .map((r: any) => String(r.user_id))
      .filter((id) => { const u = this.d.userById(id); return !!u && u.active && (side === 'SUPPLIER' ? canAccessSupplierEmail(u) : canAccessSupportInbox(u)); }));
  }

  private async stageAttachments(atts: InboundAttachment[]) {
    const staged: Staged[] = []; const skipped: string[] = [];
    for (const a of atts.slice(0, MAX_INBOUND_ATTACHMENTS)) {
      if (a.data.length > MAX_FILE_BYTES) { skipped.push(`${a.name} (too large)`); continue; }
      const f = await this.d.uploads.stage(a.name, Readable.from(a.data));
      if (f.error) { if (f.error !== 'empty') skipped.push(`${a.name} (${f.error === 'type' ? 'type not allowed' : 'too large'})`); continue; }
      staged.push(f);
    }
    if (atts.length > MAX_INBOUND_ATTACHMENTS) skipped.push(`${atts.length - MAX_INBOUND_ATTACHMENTS} more (limit ${MAX_INBOUND_ATTACHMENTS})`);
    return { staged, skipped };
  }

  /** Handles one inbound mail. Idempotent per Message-ID. */
  async receive(m: InboundMail): Promise<{ status: string; conversationId?: string; side?: Side }> {
    const c = this.d.config;
    const dup = await this.d.db.get('SELECT status, conversation_id FROM email_inbound_log WHERE message_id = ?', m.messageId);
    if (dup) return { status: 'duplicate', conversationId: dup.conversation_id ?? undefined };
    const own = [c.customerAddress, c.supplierAddress, c.notifyFrom].filter(Boolean);
    if (own.includes(m.fromEmail) || m.fromEmail.endsWith(`@${c.domain}`) && /^(mailer-daemon|postmaster|no-?reply)@/.test(m.fromEmail)) {
      await this.log(m.messageId, 'ignored', null, null, 'loop'); return { status: 'ignored' };
    }
    if (m.autoSubmitted) { await this.log(m.messageId, 'ignored', null, null, 'auto_submitted'); return { status: 'ignored' }; }
    if (!(await this.rate(m.fromEmail))) { await this.log(m.messageId, 'rejected', null, null, 'rate'); return { status: 'rate_limited' }; }

    const cls = await this.classify(m);
    const kind = cls.side === 'SUPPLIER' ? 'SUPPLIER_EMAIL' : 'CUSTOMER_SUPPORT';
    const inbox = cls.side === 'SUPPLIER' ? SUPPLIER_EMAIL_INBOX : SUPPORT_INBOX;
    const mailbox = cls.side === 'SUPPLIER' ? (c.supplierAddress ?? c.customerAddress) : (c.customerAddress ?? c.supplierAddress);
    let text = stripQuoted(m.text) || (m.attachments.length ? '(attachment)' : '(no text)');
    if (text.length > MAX_INBOUND_TEXT) text = `${text.slice(0, MAX_INBOUND_TEXT)}\n… (email shortened)`;
    const at = new Date(this.now()).toISOString();
    let convId = await this.findThread(m, kind);
    let created = false;
    if (!convId) {
      convId = randomUUID(); created = true;
      const leadId = await this.autoLead(cls.side, m);
      const name = (cls.side === 'SUPPLIER' ? cls.supplierName : null) || m.fromName || m.fromEmail;
      await this.d.db.run(
        `INSERT INTO chat_conversations (id, lead_id, kind, guest_name, guest_email, source, linked_lead_id, created_at,
           channel, email_address, email_subject, email_mailbox, supplier_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        convId, null, kind, name.slice(0, 120), m.fromEmail, 'email', leadId, at,
        'EMAIL', m.fromEmail, m.subject || '(no subject)', mailbox, cls.supplierId,
      );
      await this.d.db.run('INSERT INTO chat_conversation_inboxes (conversation_id, inbox_id) VALUES (?,?) ON CONFLICT DO NOTHING', convId, inbox);
    }
    const recipients = await this.deskRecipients(cls.side, inbox);
    for (const uid of recipients) {
      await this.d.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', convId, uid, null);
    }
    const msgId = randomUUID();
    await this.d.db.run(
      `INSERT INTO chat_messages (id, conversation_id, sender_id, kind, body, quote_id, created_at, author_kind, visibility, email_message_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      msgId, convId, null, 'text', text, null, at, cls.side === 'SUPPLIER' ? 'supplier' : 'customer', 'customer', m.messageId.slice(0, 500),
    );
    await this.d.db.run('UPDATE chat_conversations SET last_message_at = ? WHERE id = ?', at, convId);
    const { staged, skipped } = await this.stageAttachments(m.attachments);
    if (staged.length) this.d.uploads.commit(chatFileKey(msgId), staged, null);
    if (skipped.length) {
      await this.d.db.run(
        `INSERT INTO chat_messages (id, conversation_id, sender_id, kind, body, quote_id, created_at, author_kind, visibility)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        randomUUID(), convId, null, 'system', `Email attachments not imported: ${skipped.join(', ')}`.slice(0, 900), null,
        new Date(this.now() + 1).toISOString(), 'system', 'staff_only',
      );
    }
    await this.log(m.messageId, 'accepted', cls.side, convId, cls.reason);
    const preview = (m.subject ? `${m.subject}: ` : '') + text.slice(0, 120);
    this.d.live({ type: 'chat', sub: 'message', conversationId: convId, kind, preview: preview.slice(0, 140), leadId: null, created });
    await this.d.notify(cls.side, convId, recipients, cls.side === 'SUPPLIER' ? 'Supplier email' : 'Customer email', preview);
    return { status: 'accepted', conversationId: convId, side: cls.side };
  }

  /** Sends a staff reply on an EMAIL conversation. Records SENT / FAILED / NOT_CONFIGURED on the message. */
  async sendReply(conv: { id: string; kind: string; channel?: string; emailAddress?: string | null; emailSubject?: string | null; emailMailbox?: string | null },
    message: { id: string; body: string }, by: User): Promise<{ status: string; error?: string }> {
    if (conv.channel !== 'EMAIL' || !conv.emailAddress) return { status: 'NOT_EMAIL' };
    const set = (status: string, error: string | null, mid: string | null) => this.d.db.run(
      'UPDATE chat_messages SET email_status = ?, email_error = ?, email_message_id = COALESCE(?, email_message_id) WHERE id = ?', status, error, mid, message.id,
    );
    if (!this.d.sender.enabled) { await set('NOT_CONFIGURED', 'Email sending is not set up', null); return { status: 'NOT_CONFIGURED' }; }
    const c = this.d.config;
    const side: Side = conv.kind === 'SUPPLIER_EMAIL' ? 'SUPPLIER' : 'CUSTOMER';
    const from = conv.emailMailbox ?? (side === 'SUPPLIER' ? c.supplierAddress : c.customerAddress) ?? c.customerAddress;
    if (!from) { await set('NOT_CONFIGURED', 'No sending address', null); return { status: 'NOT_CONFIGURED' }; }
    const prior = await this.d.db.all(
      'SELECT email_message_id, author_kind FROM chat_messages WHERE conversation_id = ? AND email_message_id IS NOT NULL ORDER BY created_at, id', conv.id,
    );
    const lastIn = [...prior].reverse().find((r: any) => r.author_kind === 'customer' || r.author_kind === 'supplier');
    const references = prior.map((r: any) => String(r.email_message_id)).slice(-10);
    const first = by.name.trim().split(/\s+/)[0] || 'Source Easy';
    const subj = conv.emailSubject || 'Your message to Source Easy';
    const attachments: OutboundMail['attachments'] = [];
    let total = 0; const skipped: string[] = [];
    for (const f of this.d.uploads.list(chatFileKey(message.id))) {
      const file = this.d.uploads.file(chatFileKey(message.id), f.id);
      if (!file) continue;
      if (total + file.size > 10 * 1024 * 1024) { skipped.push(f.name); continue; }
      total += file.size;
      attachments.push({ name: f.name, mime: f.mime, data: readFileSync(file.path) });
    }
    const messageId = `<se.${message.id}@${c.domain}>`;
    const text = `${message.body.trim()}\n\n${first}\n${c.fromName}${skipped.length ? `\n\n(Some files were too large to attach: ${skipped.join(', ')})` : ''}`;
    try {
      await this.d.sender.send({
        from, fromName: `${first} · ${c.fromName}`, to: conv.emailAddress,
        subject: /^\s*re\s*:/i.test(subj) ? subj : `Re: ${subj}`, text, messageId,
        inReplyTo: lastIn ? String(lastIn.email_message_id) : null, references, attachments,
      });
      await set('SENT', null, messageId);
      return { status: 'SENT' };
    } catch (e) {
      const err = String((e as Error).message).slice(0, 200);
      await set('FAILED', err, null);
      return { status: 'FAILED', error: err };
    }
  }

  // ------------------------------------------------------------ staff unread-chat email

  async prefs(userId: string) {
    const r = await this.d.db.get('SELECT chat_email FROM staff_notification_prefs WHERE user_id = ?', userId);
    return { chatEmail: r ? !!r.chat_email : true };
  }
  async setPrefs(userId: string, p: { chatEmail?: boolean }) {
    const cur = await this.prefs(userId);
    const v = typeof p.chatEmail === 'boolean' ? p.chatEmail : cur.chatEmail;
    await this.d.db.run(
      `INSERT INTO staff_notification_prefs (user_id, chat_email, updated_at) VALUES (?,?,now())
       ON CONFLICT (user_id) DO UPDATE SET chat_email = EXCLUDED.chat_email, updated_at = now()`, userId, v,
    );
    return { chatEmail: v };
  }

  /**
   * Emails each opted-in staff member a short "you have N unread chat messages" note: only counts and a link,
   * never names, previews, prices or supplier details. At most once per hour, for messages older than 10 minutes.
   */
  async unreadDigest(opts: { minAgeMin?: number; everyMin?: number } = {}) {
    if (!this.d.sender.enabled || !this.d.config.notifyFrom) return 0;
    const minAge = opts.minAgeMin ?? 10, every = opts.everyMin ?? 60;
    let sent = 0;
    for (const u of this.d.staffUsers()) {
      if (!u.active || !u.email || u.role === 'SUPPLIER' || !addr(u.email)) continue;
      const p = await this.d.db.get('SELECT chat_email, last_chat_email_at FROM staff_notification_prefs WHERE user_id = ?', u.id);
      if (p && !p.chat_email) continue;
      const last = p?.last_chat_email_at ? new Date(p.last_chat_email_at).getTime() : 0;
      if (last && this.now() - last < every * 60_000) continue;
      const r = await this.d.db.get<{ n: number; convs: number }>(
        `SELECT COUNT(*)::int n, COUNT(DISTINCT m.conversation_id)::int convs FROM chat_messages m
         JOIN chat_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
         JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
           AND (m.sender_id IS NULL OR m.sender_id <> ?)
           AND m.created_at < ? AND m.created_at > ?
           AND m.kind <> 'system'`,
        u.id, u.id, new Date(this.now() - minAge * 60_000).toISOString(), new Date(Math.max(last, this.now() - 7 * 86400_000)).toISOString(),
      );
      if (!r || r.n <= 0) continue;
      const msg = `Hello ${u.name.split(/\s+/)[0] || ''},\n\nYou have ${r.n} unread chat message${r.n === 1 ? '' : 's'} in ${r.convs} conversation${r.convs === 1 ? '' : 's'} on Source Easy.\n\nOpen your inbox: ${this.d.config.appUrl}/app#/chat\n\nYou can turn these emails off in Settings → Notifications.`;
      try {
        await this.d.sender.send({
          from: this.d.config.notifyFrom, fromName: this.d.config.fromName, to: u.email,
          subject: `You have ${r.n} unread message${r.n === 1 ? '' : 's'} on Source Easy`, text: msg,
          messageId: `<se.digest.${randomUUID()}@${this.d.config.domain}>`,
        });
        sent++;
      } catch { /* try again next tick */ continue; }
      await this.d.db.run(
        `INSERT INTO staff_notification_prefs (user_id, chat_email, last_chat_email_at, updated_at) VALUES (?, true, ?, now())
         ON CONFLICT (user_id) DO UPDATE SET last_chat_email_at = EXCLUDED.last_chat_email_at`, u.id, new Date(this.now()).toISOString(),
      );
    }
    return sent;
  }
}
