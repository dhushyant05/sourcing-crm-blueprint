/**
 * Customer portal: a login realm completely separate from staff `users`.
 * - `customer_users`: one login per customer (customers.id), phone + password, phone unique across all portal logins.
 * - `portal_login_requests`: raised from the public enquiry form; India admins / super admin approve (manual provisioning).
 * - `portal_audit`: every provisioning action, password change and sign-in.
 * Portal tokens are signed with a key derived from the staff secret, with their own audience, so a portal token never
 * verifies on staff routes and a staff token never verifies on portal routes.
 */
import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Db } from './db.js';
import { phoneKey } from './customers.js';

export interface CustomerUser {
  id: string; customerId: string; phone: string; phoneKey: string; name: string; email: string | null; active: boolean;
  mustChangePassword: boolean; tokenVersion: number; lastLoginAt: string | null; issuedBy: string | null; createdAt: string; updatedAt: string;
}
export interface LoginRequest {
  id: string; leadId: string | null; name: string; phone: string; email: string | null; company: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string | null; customerId: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string;
}
export class PortalError extends Error { constructor(msg: string, public status = 400, public code?: string) { super(msg); } }

const cu = (r: any): CustomerUser => ({ id: r.id, customerId: r.customer_id, phone: r.phone, phoneKey: r.phone_key, name: r.name, email: r.email, active: !!r.active,
  mustChangePassword: !!r.must_change_password, tokenVersion: Number(r.token_version ?? 0), lastLoginAt: r.last_login_at ?? null, issuedBy: r.issued_by ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at });
const lr = (r: any): LoginRequest => ({ id: r.id, leadId: r.lead_id, name: r.name, phone: r.phone, email: r.email, company: r.company, status: r.status, reason: r.reason,
  customerId: r.customer_id, decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at });
const DUMMY = bcrypt.hashSync('not-a-real-portal-password', 10);
export const PORTAL_MIN_PASSWORD = 8;
/** Readable temporary password (no 0/O/1/l), shown once to the issuing staff member. */
export const tempPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = randomBytes(12); return Array.from(b, (x) => a[x % a.length]).join(''); };

export class PortalStore {
  readonly key: string;
  constructor(private db: Db, staffSecret: string, private ttl = '12h') {
    this.key = createHmac('sha256', staffSecret).update('source-easy-customer-portal-v1').digest('base64url');
  }
  // ---- tokens ----
  sign(u: CustomerUser) { return jwt.sign({ sub: u.id, cid: u.customerId, v: u.tokenVersion }, this.key, { expiresIn: this.ttl as any, audience: 'portal', issuer: 'source-easy' }); }
  async verifyToken(token: string): Promise<CustomerUser | null> {
    try {
      const p = jwt.verify(token, this.key, { audience: 'portal', issuer: 'source-easy' }) as { sub: string; cid: string; v: number };
      const u = await this.byId(p.sub);
      return u && u.active && u.tokenVersion === p.v && u.customerId === p.cid ? u : null;
    } catch { return null; }
  }
  // ---- users ----
  async byId(id: string) { const r = await this.db.get('SELECT * FROM customer_users WHERE id = ?', id); return r ? cu(r) : null; }
  async byCustomer(customerId: string) { const r = await this.db.get('SELECT * FROM customer_users WHERE customer_id = ?', customerId); return r ? cu(r) : null; }
  async byPhone(phone: string) { const k = phoneKey(phone); if (!k) return null; const r = await this.db.get('SELECT * FROM customer_users WHERE phone_key = ?', k); return r ? cu(r) : null; }
  async create(customerId: string, b: { name: string; phone: string; email?: string | null }, password: string, by: string | null, db: Db = this.db) {
    const k = phoneKey(b.phone); if (!k) throw new PortalError('A valid mobile number is required', 400, 'phone');
    if (await db.get('SELECT 1 FROM customer_users WHERE customer_id = ?', customerId)) throw new PortalError('This customer already has a portal login', 409, 'exists');
    if (await db.get('SELECT 1 FROM customer_users WHERE phone_key = ?', k)) throw new PortalError('This mobile number already has a portal login', 409, 'phone_taken');
    const id = randomUUID();
    await db.run(`INSERT INTO customer_users (id, customer_id, phone, phone_key, name, email, password_hash, must_change_password, issued_by) VALUES (?,?,?,?,?,?,?,true,?)`,
      id, customerId, b.phone.trim().slice(0, 40), k, (b.name || b.phone).trim().slice(0, 120), b.email?.trim().slice(0, 160) || null, await bcrypt.hash(password, 12), by);
    return (await this.byId(id))!;
  }
  async verify(phone: string, password: string): Promise<CustomerUser | null> {
    const u = await this.byPhone(phone);
    const r = u ? await this.db.get('SELECT password_hash FROM customer_users WHERE id = ?', u.id) : null;
    const ok = await bcrypt.compare(password, r?.password_hash ?? DUMMY);
    if (!u || !ok || !u.active) return null;
    await this.db.run('UPDATE customer_users SET last_login_at = now() WHERE id = ?', u.id);
    return u;
  }
  async checkPassword(id: string, password: string) { const r = await this.db.get('SELECT password_hash FROM customer_users WHERE id = ?', id); return !!r && bcrypt.compare(password, r.password_hash); }
  /** Sets a password and revokes every session. `mustChange` is true when staff reset it (temporary password). */
  async setPassword(id: string, password: string, mustChange: boolean) {
    await this.db.run('UPDATE customer_users SET password_hash = ?, must_change_password = ?, token_version = token_version + 1, updated_at = now() WHERE id = ?', await bcrypt.hash(password, 12), mustChange, id);
    // Revoked sessions must not keep getting pushes: phones re-register after the next sign-in.
    await this.db.run('DELETE FROM customer_device_tokens WHERE customer_user_id = ?', id);
    return this.byId(id);
  }
  async setActive(id: string, active: boolean) {
    await this.db.run('UPDATE customer_users SET active = ?, token_version = token_version + 1, updated_at = now() WHERE id = ?', active, id);
    if (!active) await this.db.run('DELETE FROM customer_device_tokens WHERE customer_user_id = ?', id);
    return this.byId(id);
  }
  // ---- login requests ----
  async request(b: { leadId: string | null; name: string; phone: string; email?: string | null; company?: string | null }) {
    const k = phoneKey(b.phone); if (!k) return null;
    // One open request per phone: a repeat enquiry does not pile up duplicates.
    const open = await this.db.get("SELECT id FROM portal_login_requests WHERE phone_key = ? AND status = 'PENDING'", k);
    if (open) return this.requestById(open.id);
    const id = randomUUID();
    await this.db.run('INSERT INTO portal_login_requests (id, lead_id, name, phone, phone_key, email, company) VALUES (?,?,?,?,?,?,?)', id, b.leadId, b.name.slice(0, 120), b.phone.slice(0, 40), k, b.email || null, b.company || null);
    return this.requestById(id);
  }
  async requestById(id: string) { const r = await this.db.get('SELECT * FROM portal_login_requests WHERE id = ?', id); return r ? lr(r) : null; }
  async requests(status?: string) {
    return (await this.db.all(`SELECT * FROM portal_login_requests ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 500`, ...(status ? [status] : []))).map(lr);
  }
  async decide(id: string, status: 'APPROVED' | 'REJECTED', by: string, extra: { customerId?: string | null; reason?: string | null }, db: Db = this.db) {
    const n = await db.run("UPDATE portal_login_requests SET status = ?, decided_by = ?, decided_at = now(), customer_id = COALESCE(?, customer_id), reason = ? WHERE id = ? AND status = 'PENDING'",
      status, by, extra.customerId ?? null, extra.reason ?? null, id);
    if (!n) throw new PortalError('This request was already handled', 409, 'decided');
  }
  // ---- audit ----
  async audit(actor: { id: string | null; kind: 'STAFF' | 'CUSTOMER' | 'PUBLIC' }, action: string, subject: string | null, detail: Record<string, unknown> = {}, db: Db = this.db) {
    await db.run('INSERT INTO portal_audit (actor_id, actor_kind, action, subject, detail) VALUES (?,?,?,?,?)', actor.id, actor.kind, action, subject, JSON.stringify(detail));
  }
  async auditFor(subject: string) { return this.db.all('SELECT id, at, actor_id, actor_kind, action, detail FROM portal_audit WHERE subject = ? ORDER BY id DESC LIMIT 100', subject); }
}

/** Staff-safe view of a portal login (never the hash). */
export const loginView = (u: CustomerUser | null) => u && { id: u.id, customerId: u.customerId, phone: u.phone, name: u.name, email: u.email, active: u.active,
  mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };

/** Customer-facing stage of a sourcing request (from the staff workflow stage; no internal steps such as China/sourcing split). */
export const CUSTOMER_STAGES = ['RECEIVED', 'SOURCING', 'QUOTE_READY', 'DECIDED', 'ORDER', 'SHIPPED', 'DELIVERED'] as const;
export function customerStage(staffStage: string, lost: boolean): { stage: string; index: number; closed: boolean } {
  const m: Record<string, (typeof CUSTOMER_STAGES)[number]> = { NEW: 'RECEIVED', CHINA: 'SOURCING', SOURCING: 'SOURCING', QUOTED: 'SOURCING', CQ_SENT: 'QUOTE_READY',
    DECIDED: 'DECIDED', ORDER: 'ORDER', SHIPPED: 'SHIPPED', DELIVERED: 'DELIVERED' };
  const stage = m[staffStage] ?? 'RECEIVED';
  return { stage, index: CUSTOMER_STAGES.indexOf(stage), closed: lost };
}

/**
 * Event kinds a customer may ever see, with the only text they get (built from the kind + a quote number, never from internal data).
 * Everything else (assignment, China, suppliers, send-back notes, SLA, prices between offices, internal notes) stays internal.
 */
export const CUSTOMER_EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  CREATED: () => 'Request received',
  CQ_SENT: (d) => `Quote${d.n ? ` Q${d.n}` : ''} ready for you`,
  CQ_ACCEPTED: (d) => `Quote${d.n ? ` Q${d.n}` : ''} accepted`,
  CQ_REJECTED: (d) => `Quote${d.n ? ` Q${d.n}` : ''} declined`,
  CQ_REVERTED: (d) => `Quote${d.n ? ` Q${d.n}` : ''} reopened by Source Easy`,
  ORDER_CREATED: () => 'Order confirmed',
  ORDER_CANCELLED: () => 'Order cancelled',
  SHIPPED: () => 'Shipped',
  COMPLETED: () => 'Delivered and completed',
  LEAD_CLOSED: () => 'Request closed',
  CLOSED_PERMANENT: () => 'Request closed',
};
export const customerText = (kind: string, data: Record<string, unknown>) => {
  const f = CUSTOMER_EVENT_TEXT[kind]; if (!f) return null;
  const n = Number(data.n); return f(Number.isInteger(n) && n > 0 && n < 1000 ? { n } : {});
};
