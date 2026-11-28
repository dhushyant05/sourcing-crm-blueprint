/**
 * Customer-facing support chat. Guests are identified only by a random
 * httpOnly visitor cookie (the hash is stored, never the raw token). Logged-in
 * portal customers are identified by their account. Conversations live in the
 * "Customer support" team inbox and are never visible to China staff.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
import type { Bus } from './bus.js';
import type { User } from './users.js';
import type { Role } from './roles.js';
import { ChatError, ChatStore } from './chat.js';

export const SUPPORT_INBOX = 'inbox-customer-support';
export const SUPPORT_COOKIE = 'se_support_vid';
export const MAX_MESSAGE = 4000;
export const STARTS_PER_HOUR = 5;
export const MESSAGES_PER_WINDOW = 20;
export const MESSAGE_WINDOW_SEC = 600;

export type AuthorKind = 'staff' | 'guest' | 'customer' | 'system';
export type Visibility = 'customer' | 'staff_only';

export function hashToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

export function newVisitorToken() {
  return randomBytes(32).toString('base64url');
}

export function issueSupportChallenge(secret: string, at = Date.now()) {
  const ts = String(at);
  const sig = createHmac('sha256', secret).update(`support:${ts}`).digest('hex').slice(0, 32);
  return `${ts}.${sig}`;
}

export function checkSupportChallenge(secret: string, token: string | undefined, minMs = 2000, maxMs = 2 * 3600_000) {
  if (!token || !secret) return false;
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  const expect = createHmac('sha256', secret).update(`support:${ts}`).digest('hex').slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = Date.now() - Number(ts);
  return age >= minMs && age <= maxMs;
}

export function parseCookies(header?: string | string[]) {
  const raw = Array.isArray(header) ? header.join('; ') : (header ?? '');
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function visitorCookieHeader(token: string, secure: boolean) {
  return `${SUPPORT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`;
}

export function isChinaRole(role: Role | string) {
  return String(role).startsWith('CHINA');
}

/** India team, Marketplace Team and super admin only. Never China or suppliers. */
export function canAccessSupportInbox(u: User) {
  if (!u || isChinaRole(u.role) || u.role === 'SUPPLIER') return false;
  return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM' || String(u.role).startsWith('INDIA');
}

/** Desk hours: Mon–Sat 09:30–18:30 Asia/Calcutta. */
export function supportDeskStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = pick('weekday');
  const hour = Number(pick('hour'));
  const minute = Number(pick('minute'));
  const mins = hour * 60 + minute;
  const open = weekday !== 'Sun' && mins >= 9 * 60 + 30 && mins < 18 * 60 + 30;
  return {
    online: open,
    usualReply: open ? '2 hours' : '1 business day',
    message: open
      ? 'We usually reply within 2 hours.'
      : "We're away right now. Leave a message and we'll reply within 1 business day.",
    timezone: 'Asia/Calcutta',
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function cleanEmail(v?: string | null) {
  const s = String(v ?? '').trim().slice(0, 200);
  return s && EMAIL_RE.test(s) ? s : null;
}
export function cleanPhone(v?: string | null) {
  const s = String(v ?? '').trim().slice(0, 40);
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  return s;
}
export function cleanName(v?: string | null) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return s.length >= 2 ? s : null;
}

export type SourceSite = 'sourceeasy' | 'fortune_engineering';
export const SOURCE_SITES: readonly SourceSite[] = ['sourceeasy', 'fortune_engineering'];
export const SITE_BRAND: Record<SourceSite, string> = { sourceeasy: 'Source Easy', fortune_engineering: 'Fortune Engineering' };
export const siteOf = (v: unknown): SourceSite => (v === 'fortune_engineering' ? 'fortune_engineering' : 'sourceeasy');
export const brandOf = (site?: string | null) => SITE_BRAND[siteOf(site)];

export function publicStaffName(name?: string | null, site?: string | null) {
  const n = String(name ?? '').trim();
  const team = `${brandOf(site)} team`;
  if (!n) return team;
  const first = n.split(/\s+/)[0]!;
  return first || team;
}

export type SupportConversation = {
  id: string;
  kind: 'CUSTOMER_SUPPORT';
  leadId: null;
  assignedTo: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  visitorId: string | null;
  customerId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  productId: string | null;
  productTitle: string | null;
  productSlug: string | null;
  source: string | null;
  sourceSite: SourceSite;
  convertedLeadId: string | null;
  linkedLeadId: string | null;
  linkedOrderId: string | null;
};

export function mapSupport(r: any): SupportConversation {
  return {
    id: String(r.id),
    kind: 'CUSTOMER_SUPPORT',
    leadId: null,
    assignedTo: r.assigned_to ?? null,
    lastMessageAt: r.last_message_at ?? null,
    createdAt: r.created_at,
    visitorId: r.visitor_id ?? null,
    customerId: r.customer_id ?? null,
    guestName: r.guest_name ?? null,
    guestEmail: r.guest_email ?? null,
    guestPhone: r.guest_phone ?? null,
    productId: r.product_id ?? null,
    productTitle: r.product_title ?? null,
    productSlug: r.product_slug ?? null,
    source: r.source ?? null,
    sourceSite: siteOf(r.source_site),
    convertedLeadId: r.converted_lead_id ?? null,
    linkedLeadId: r.linked_lead_id ?? null,
    linkedOrderId: r.linked_order_id ?? null,
  };
}

export class SupportStore {
  constructor(private db: Db, private bus: Bus, private chat: ChatStore) {}

  async ensureInbox() {
    await this.db.run(
      "INSERT INTO chat_inboxes (id, slug, name, kind) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING",
      SUPPORT_INBOX, 'customer-support', 'Customer support', 'TEAM',
    );
  }

  async ensureMembership(u: User) {
    if (!canAccessSupportInbox(u)) return;
    await this.ensureInbox();
    await this.db.run(
      'INSERT INTO chat_inbox_members (inbox_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING',
      SUPPORT_INBOX, u.id, null,
    );
  }

  /** Visitor for a raw token, only if it was issued for `site` (a Source Easy cookie never opens a Fortune Engineering chat and vice versa). */
  async visitorFromToken(raw?: string | null, site: SourceSite = 'sourceeasy') {
    if (!raw) return null;
    const hash = hashToken(raw);
    const row = await this.db.get('SELECT * FROM chat_visitors WHERE token_hash = ? AND source_site = ?', hash, site);
    if (!row) return null;
    await this.db.run('UPDATE chat_visitors SET last_seen_at = now() WHERE id = ?', row.id);
    return { id: String(row.id), tokenHash: String(row.token_hash) };
  }

  async createVisitor(raw: string, site: SourceSite = 'sourceeasy') {
    const id = randomUUID();
    await this.db.run(
      'INSERT INTO chat_visitors (id, token_hash, source_site, created_at, last_seen_at) VALUES (?,?,?,now(),now())',
      id, hashToken(raw), site,
    );
    return { id, tokenHash: hashToken(raw) };
  }

  async get(id: string) {
    const r = await this.db.get("SELECT * FROM chat_conversations WHERE id = ? AND kind = 'CUSTOMER_SUPPORT'", id);
    return r ? mapSupport(r) : null;
  }

  async byVisitor(visitorId: string) {
    const rows = await this.db.all(
      "SELECT * FROM chat_conversations WHERE kind = 'CUSTOMER_SUPPORT' AND visitor_id = ? ORDER BY COALESCE(last_message_at, created_at) DESC",
      visitorId,
    );
    return rows.map(mapSupport);
  }

  async byCustomer(customerId: string) {
    const rows = await this.db.all(
      "SELECT * FROM chat_conversations WHERE kind = 'CUSTOMER_SUPPORT' AND customer_id = ? ORDER BY COALESCE(last_message_at, created_at) DESC",
      customerId,
    );
    return rows.map(mapSupport);
  }

  async open(opts: {
    visitorId?: string | null;
    customerId?: string | null;
    guestName: string;
    guestEmail?: string | null;
    guestPhone?: string | null;
    productId?: string | null;
    productTitle?: string | null;
    productSlug?: string | null;
    source?: string | null;
    sourceSite?: SourceSite;
    linkedLeadId?: string | null;
    linkedOrderId?: string | null;
    reuse?: boolean;
  }) {
    const site: SourceSite = siteOf(opts.sourceSite);
    await this.ensureInbox();
    if (opts.reuse && opts.customerId) {
      const existing = (await this.byCustomer(opts.customerId))[0];
      if (existing) return { conv: existing, created: false };
    }
    if (opts.reuse && opts.visitorId && !opts.customerId) {
      const existing = (await this.byVisitor(opts.visitorId)).find((c) => c.sourceSite === site);
      if (existing) return { conv: existing, created: false };
    }
    const id = randomUUID();
    const at = new Date().toISOString();
    await this.db.run(
      `INSERT INTO chat_conversations (
         id, lead_id, kind, visitor_id, customer_id, guest_name, guest_email, guest_phone,
         product_id, product_title, product_slug, source, source_site, linked_lead_id, linked_order_id, consent_at, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, null, 'CUSTOMER_SUPPORT', opts.visitorId ?? null, opts.customerId ?? null,
      opts.guestName, opts.guestEmail ?? null, opts.guestPhone ?? null,
      opts.productId ?? null, opts.productTitle ?? null, opts.productSlug ?? null,
      opts.source ?? null, site, opts.linkedLeadId ?? null, opts.linkedOrderId ?? null, at, at,
    );
    await this.db.run(
      'INSERT INTO chat_conversation_inboxes (conversation_id, inbox_id) VALUES (?,?) ON CONFLICT DO NOTHING',
      id, SUPPORT_INBOX,
    );
    await this.addInboxMembersAsParticipants(id);
    if (opts.productTitle) {
      await this.post(id, null, `Asking about: ${opts.productTitle}`, 'system', { authorKind: 'system', visibility: 'customer' });
    }
    return { conv: (await this.get(id))!, created: true };
  }

  async claimVisitor(visitorId: string, customerId: string, name?: string | null, email?: string | null, phone?: string | null) {
    const rows = await this.byVisitor(visitorId);
    for (const c of rows) {
      if (c.customerId && c.customerId !== customerId) continue;
      await this.db.run(
        `UPDATE chat_conversations SET customer_id = ?,
           guest_name = COALESCE(?, guest_name),
           guest_email = COALESCE(?, guest_email),
           guest_phone = COALESCE(?, guest_phone)
         WHERE id = ? AND (customer_id IS NULL OR customer_id = ?)`,
        customerId, name ?? null, email ?? null, phone ?? null, c.id, customerId,
      );
    }
  }

  async post(
    conversationId: string,
    senderId: string | null,
    body: string,
    kind: 'text' | 'system' = 'text',
    opts: { authorKind?: AuthorKind; visibility?: Visibility } = {},
  ) {
    const text = body.trim();
    if (kind === 'text' && !text) throw new ChatError('Message cannot be empty', 400);
    if (text.length > MAX_MESSAGE) throw new ChatError('Message is too long', 400);
    const id = randomUUID();
    const at = new Date().toISOString();
    const authorKind = opts.authorKind ?? (senderId ? 'staff' : 'guest');
    const visibility = opts.visibility ?? 'customer';
    await this.db.run(
      `INSERT INTO chat_messages (id, conversation_id, sender_id, kind, body, quote_id, created_at, author_kind, visibility)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, conversationId, senderId, kind, text, null, at, authorKind, visibility,
    );
    await this.db.run('UPDATE chat_conversations SET last_message_at = ? WHERE id = ?', at, conversationId);
    return { id, conversationId, senderId, kind, body: text, createdAt: at, authorKind, visibility, quoteId: null };
  }

  async messages(conversationId: string, forCustomer = false) {
    const vis = forCustomer ? "AND visibility = 'customer'" : '';
    return this.db.all(
      `SELECT * FROM chat_messages WHERE conversation_id = ? ${vis} ORDER BY created_at, id`,
      conversationId,
    );
  }

  async setConverted(conversationId: string, leadId: string) {
    await this.db.run('UPDATE chat_conversations SET converted_lead_id = ? WHERE id = ?', leadId, conversationId);
  }

  async setLinked(conversationId: string, leadId?: string | null, orderId?: string | null) {
    if (leadId !== undefined) await this.db.run('UPDATE chat_conversations SET linked_lead_id = ? WHERE id = ?', leadId, conversationId);
    if (orderId !== undefined) await this.db.run('UPDATE chat_conversations SET linked_order_id = ? WHERE id = ?', orderId, conversationId);
  }

  async rateLimit(key: string, limit: number, ttlSec: number) {
    const n = Number((await this.bus.get(key)) ?? 0);
    if (n >= limit) return false;
    await this.bus.incr(key, ttlSec);
    return true;
  }

  async messageById(id: string) {
    return this.db.get('SELECT * FROM chat_messages WHERE id = ?', id);
  }

  async addInboxMembersAsParticipants(conversationId: string) {
    const members = await this.db.all('SELECT user_id FROM chat_inbox_members WHERE inbox_id = ?', SUPPORT_INBOX);
    for (const m of members) {
      await this.db.run(
        'INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING',
        conversationId, m.user_id, null,
      );
    }
  }
}
