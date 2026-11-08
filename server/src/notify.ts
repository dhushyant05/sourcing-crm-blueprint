/**
 * Customer notifications (email first, plus customer-app push). Events enqueue rows in `notification_outbox` with ONLY
 * allowlisted, customer-safe variables (name, reference, label, portal link); templates are fixed English text.
 * Delivery goes through adapters that stay DISABLED unless configured; disabled / opted-out rows end as SKIPPED with a
 * reason. Nothing here ever sends without explicit configuration, and tests use mock adapters.
 */
import { randomUUID, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Db } from './db.js';

export const TEMPLATES = {
  QUOTE_READY: { subject: (v: V) => `Your quote ${v.label} is ready`, body: (v: V) => `Hello ${v.name},\n\nYour quote ${v.label} for request ${v.reference} is ready. Open the customer portal to view the PDF and accept or decline it.\n\n${v.link}` },
  FREIGHT_QUOTE_READY: { subject: (v: V) => `Freight quote ${v.label} is ready`, body: (v: V) => `Hello ${v.name},\n\nYour freight quote ${v.label} for shipping request ${v.reference} is ready. Please accept it in the customer portal so we can book your shipment.\n\n${v.link}` },
  NEEDS_INFO: { subject: (v: V) => `More information needed for ${v.reference}`, body: (v: V) => `Hello ${v.name},\n\nWe need a little more information about ${v.reference}. Please open the customer portal to reply.\n\n${v.link}` },
  ORDER_CONFIRMED: { subject: (v: V) => `Order confirmed for ${v.reference}`, body: (v: V) => `Hello ${v.name},\n\nYour order for request ${v.reference} is confirmed. You can follow it in the customer portal.\n\n${v.link}` },
  SHIPPED: { subject: (v: V) => `${v.reference} has shipped`, body: (v: V) => `Hello ${v.name},\n\n${v.reference} is on its way. Tracking details are in the customer portal.\n\n${v.link}` },
  DELIVERED: { subject: (v: V) => `${v.reference} was delivered`, body: (v: V) => `Hello ${v.name},\n\n${v.reference} has been delivered. Thank you for choosing Source Easy.\n\n${v.link}` },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
type V = { name: string; reference: string; label: string; link: string };
const VAR_KEYS = ['name', 'reference', 'label', 'link'] as const;
/** Only these variables, as short plain strings, ever enter the outbox. */
export function safeVars(x: Partial<Record<string, unknown>>): V {
  const s = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return { name: s(x.name, 80) || 'there', reference: s(x.reference, 40), label: s(x.label, 60) || s(x.reference, 40), link: s(x.link, 200) };
}
export function render(t: TemplateKey, vars: V) { const T = TEMPLATES[t]; return { subject: T.subject(vars), body: T.body(vars) }; }

export interface EmailMsg { to: string; subject: string; text: string }
export interface EmailAdapter { readonly enabled: boolean; send(m: EmailMsg): Promise<void> }
export interface PushAdapter { readonly enabled: boolean; send(token: string, m: { title: string; body: string; data: Record<string, string> }): Promise<'ok' | 'gone'> }
export const disabledEmail: EmailAdapter = { enabled: false, async send() { throw new Error('email not configured'); } };
export const disabledPush: PushAdapter = { enabled: false, async send() { throw new Error('push not configured'); } };

/**
 * Generic HTTP email API adapter (JSON POST). Enabled only when NOTIFY_EMAIL_API_URL, NOTIFY_EMAIL_API_KEY and NOTIFY_EMAIL_FROM
 * are all set; no provider is configured in this build.
 */
export function httpEmailFromEnv(env = process.env, http: typeof fetch = fetch): EmailAdapter {
  const url = env.NOTIFY_EMAIL_API_URL, key = env.NOTIFY_EMAIL_API_KEY, from = env.NOTIFY_EMAIL_FROM;
  if (!url || !key || !from || !/^https:\/\//.test(url)) return disabledEmail;
  return { enabled: true, async send(m) {
    const r = await http(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text }) });
    if (!r.ok) throw new Error(`email api ${r.status}`);
  } };
}
/** Customer-app FCM (HTTP v1) with its OWN service account (CUSTOMER_FCM_SERVICE_ACCOUNT_JSON), separate from the staff app. */
export function customerFcmFromEnv(env = process.env, http: typeof fetch = fetch): PushAdapter {
  let sa: { client_email: string; private_key: string; project_id: string } | null = null;
  try { sa = env.CUSTOMER_FCM_SERVICE_ACCOUNT_JSON ? JSON.parse(readFileSync(env.CUSTOMER_FCM_SERVICE_ACCOUNT_JSON, 'utf8')) : null; } catch { sa = null; }
  if (!sa) return disabledPush;
  const a = sa; let tok: { v: string; exp: number } | null = null;
  const access = async () => {
    if (tok && tok.exp > Date.now() + 60_000) return tok.v;
    const now = Math.floor(Date.now() / 1000), b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const u = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(u).sign(a.private_key).toString('base64url');
    const r = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${u}.${sig}` });
    if (!r.ok) throw new Error(`fcm auth ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number }; tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return tok.v;
  };
  return { enabled: true, async send(token, m) {
    const r = await http(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, { method: 'POST', headers: { authorization: `Bearer ${await access()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: m.title, body: m.body }, data: m.data, android: { notification: { channel_id: 'customer_updates' } } } }) });
    if (r.status === 404 || r.status === 400) return 'gone';
    if (!r.ok) throw new Error(`fcm ${r.status}`);
    return 'ok';
  } };
}

export interface OutboxRow { id: string; channel: 'EMAIL' | 'PUSH'; customerUserId: string; template: TemplateKey; vars: V; dedupeKey: string; status: string; reason: string | null; attempts: number; createdAt: string; processedAt: string | null }
const orow = (r: any): OutboxRow => ({ id: r.id, channel: r.channel, customerUserId: r.customer_user_id, template: r.template, vars: r.vars, dedupeKey: r.dedupe_key, status: r.status, reason: r.reason,
  attempts: Number(r.attempts), createdAt: r.created_at, processedAt: r.processed_at });

export class Notifier {
  constructor(private db: Db, public email: EmailAdapter = disabledEmail, public push: PushAdapter = disabledPush, private portalUrl = process.env.PORTAL_URL ?? 'https://sourceeasy.in/portal') {}
  /** Enqueue one customer event on both channels (idempotent per dedupe key). Never throws into the business flow. */
  async enqueue(customerUserId: string, template: TemplateKey, vars: Partial<Record<string, unknown>>, dedupe: string) {
    try {
      const v = safeVars({ ...vars, link: this.portalUrl });
      for (const ch of ['EMAIL', 'PUSH'] as const)
        await this.db.run('INSERT INTO notification_outbox (id, channel, customer_user_id, template, vars, dedupe_key) VALUES (?,?,?,?,?,?) ON CONFLICT (dedupe_key) DO NOTHING',
          randomUUID(), ch, customerUserId, template, JSON.stringify(v), `${ch}:${dedupe}`);
    } catch { /* best effort */ }
  }
  async prefs(customerUserId: string) {
    const r = await this.db.get('SELECT email, push FROM customer_notification_prefs WHERE customer_user_id = ?', customerUserId);
    return { email: r ? !!r.email : true, push: r ? !!r.push : true };
  }
  async setPrefs(customerUserId: string, p: { email?: boolean; push?: boolean }) {
    const cur = await this.prefs(customerUserId), n = { email: p.email ?? cur.email, push: p.push ?? cur.push };
    await this.db.run('INSERT INTO customer_notification_prefs (customer_user_id, email, push, updated_at) VALUES (?,?,?,now()) ON CONFLICT (customer_user_id) DO UPDATE SET email = EXCLUDED.email, push = EXCLUDED.push, updated_at = now()', customerUserId, n.email, n.push);
    return n;
  }
  async registerDevice(customerUserId: string, token: string, platform = 'android') {
    if (!token || token.length > 4096 || /\s/.test(token)) throw new Error('Invalid token');
    await this.db.run('INSERT INTO customer_device_tokens (token, customer_user_id, platform, updated_at) VALUES (?,?,?,now()) ON CONFLICT (token) DO UPDATE SET customer_user_id = EXCLUDED.customer_user_id, platform = EXCLUDED.platform, updated_at = now()',
      token, customerUserId, String(platform).slice(0, 20));
  }
  async unregisterDevice(customerUserId: string, token?: string) {
    if (token) await this.db.run('DELETE FROM customer_device_tokens WHERE token = ? AND customer_user_id = ?', token, customerUserId);
    else await this.db.run('DELETE FROM customer_device_tokens WHERE customer_user_id = ?', customerUserId);
  }
  private async done(id: string, status: string, reason: string | null) { await this.db.run('UPDATE notification_outbox SET status = ?, reason = ?, attempts = attempts + 1, processed_at = now() WHERE id = ?', status, reason, id); }
  /** Process pending rows. Disabled channel → SKIPPED not_configured; opted out → SKIPPED opted_out; inactive login → SKIPPED inactive. */
  async dispatch(limit = 50) {
    const rows = (await this.db.all("SELECT * FROM notification_outbox WHERE status = 'PENDING' OR (status = 'FAILED' AND attempts < 3) ORDER BY created_at LIMIT ?", limit)).map(orow);
    for (const r of rows) {
      try {
        const u = await this.db.get('SELECT email, active FROM customer_users WHERE id = ?', r.customerUserId);
        if (!u || !u.active) { await this.done(r.id, 'SKIPPED', 'inactive'); continue; }
        const p = await this.prefs(r.customerUserId), msg = render(r.template, safeVars(r.vars));
        if (r.channel === 'EMAIL') {
          if (!this.email.enabled) { await this.done(r.id, 'SKIPPED', 'not_configured'); continue; }
          if (!p.email) { await this.done(r.id, 'SKIPPED', 'opted_out'); continue; }
          if (!u.email) { await this.done(r.id, 'SKIPPED', 'no_address'); continue; }
          await this.email.send({ to: u.email, subject: msg.subject, text: msg.body }); await this.done(r.id, 'SENT', null);
        } else {
          if (!this.push.enabled) { await this.done(r.id, 'SKIPPED', 'not_configured'); continue; }
          if (!p.push) { await this.done(r.id, 'SKIPPED', 'opted_out'); continue; }
          const toks = (await this.db.all('SELECT token FROM customer_device_tokens WHERE customer_user_id = ?', r.customerUserId)).map((x: any) => x.token as string);
          if (!toks.length) { await this.done(r.id, 'SKIPPED', 'no_device'); continue; }
          for (const t of toks) if ((await this.push.send(t, { title: msg.subject, body: msg.body.split('\n\n')[1] ?? msg.subject, data: { template: r.template, reference: r.vars.reference } })) === 'gone')
            await this.db.run('DELETE FROM customer_device_tokens WHERE token = ?', t);
          await this.done(r.id, 'SENT', null);
        }
      } catch (e) { await this.done(r.id, 'FAILED', String((e as Error).message).slice(0, 200)); }
    }
    return rows.length;
  }
  async list(limit = 200) { return (await this.db.all('SELECT * FROM notification_outbox ORDER BY created_at DESC LIMIT ?', limit)).map(orow); }
}
void VAR_KEYS;
