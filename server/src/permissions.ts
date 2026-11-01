/**
 * Per-user feature permissions. The role gives the defaults; the super admin grants or revokes single
 * permissions per staff member (stored in `user_permissions`, every change written to `permission_audit`).
 * Hard data-separation rules are NOT permissions: a China user can never get a customer-side permission and an
 * India user can never get a supplier-side one (`side`). Only the super admin role spans both sides.
 */
import type { Db } from './db.js';
import type { Bus } from './bus.js';
import { sides, type Role } from './roles.js';

export type PermSide = 'INDIA' | 'CHINA' | 'ANY';
export interface PermDef { key: string; group: string; side: PermSide }
export const PERMISSIONS: PermDef[] = [
  { key: 'suppliers.view', group: 'suppliers', side: 'CHINA' },
  { key: 'suppliers.edit', group: 'suppliers', side: 'CHINA' },
  { key: 'quotes.view', group: 'quotes', side: 'ANY' },
  { key: 'quotes.create', group: 'quotes', side: 'CHINA' },
  { key: 'quotes.customer', group: 'quotes', side: 'INDIA' },
  { key: 'prices.inr', group: 'quotes', side: 'INDIA' },
  { key: 'orders.create', group: 'orders', side: 'INDIA' },
  { key: 'orders.production', group: 'orders', side: 'ANY' },
  { key: 'orders.payment', group: 'orders', side: 'INDIA' },
  { key: 'reports.view', group: 'reports', side: 'ANY' },
  { key: 'data.export', group: 'reports', side: 'ANY' },
  { key: 'leads.all', group: 'leads', side: 'ANY' },
  { key: 'leads.delete', group: 'leads', side: 'ANY' },
  { key: 'staff.manage', group: 'admin', side: 'ANY' },
  { key: 'settings.sla', group: 'admin', side: 'ANY' },
];
export type Perm = (typeof PERMISSIONS)[number]['key'];
export const PERM_KEYS = PERMISSIONS.map((p) => p.key);
const DEF = new Map(PERMISSIONS.map((p) => [p.key, p]));

const INDIA_STAFF = ['quotes.view', 'quotes.customer', 'prices.inr', 'orders.create', 'orders.production', 'orders.payment', 'leads.all'];
const CHINA_STAFF = ['suppliers.view', 'suppliers.edit', 'quotes.view', 'quotes.create', 'orders.production', 'leads.all'];
const ADMIN_EXTRA = ['reports.view', 'staff.manage', 'data.export'];
export const ROLE_DEFAULTS: Record<Role, string[]> = {
  INDIA_STAFF, CHINA_STAFF,
  INDIA_ADMIN: [...INDIA_STAFF, ...ADMIN_EXTRA],
  CHINA_ADMIN: [...CHINA_STAFF, ...ADMIN_EXTRA],
  SUPER_ADMIN: [...PERM_KEYS],
};

/** Hard rule: may this role hold this permission at all? (China never gets customer-side, India never supplier-side.) */
export function allowedFor(role: Role, key: string): boolean {
  const d = DEF.get(key); if (!d) return false;
  const s = sides(role);
  if (s.superAdmin || d.side === 'ANY') return true;
  return d.side === 'INDIA' ? s.india : s.china;
}

export interface PermRow { key: string; group: string; side: PermSide; default: boolean; override: boolean | null; effective: boolean; locked: boolean }
export interface AuditRow { id: number; userId: string; perm: string; before: boolean | null; after: boolean | null; changedBy: string | null; changedAt: string }

export class PermStore {
  private cache = new Map<string, Map<string, boolean>>();
  onChange: (userId: string) => void = () => {};
  constructor(private db: Db, private bus?: Bus) {}
  async load() {
    const rs = await this.db.all<{ user_id: string; perm: string; granted: boolean }>('SELECT user_id, perm, granted FROM user_permissions');
    const m = new Map<string, Map<string, boolean>>();
    for (const r of rs) { let x = m.get(r.user_id); if (!x) m.set(r.user_id, (x = new Map())); x.set(r.perm, !!r.granted); }
    this.cache = m; return this;
  }
  /** Effective permission. The super admin always has everything; side rules are never overridable. */
  can(u: { id: string; role: Role }, key: string): boolean {
    if (u.role === 'SUPER_ADMIN') return true;
    if (!allowedFor(u.role, key)) return false;
    const o = this.cache.get(u.id)?.get(key);
    return o ?? ROLE_DEFAULTS[u.role].includes(key);
  }
  effective(u: { id: string; role: Role }) { return PERM_KEYS.filter((k) => this.can(u, k)); }
  matrix(u: { id: string; role: Role }): PermRow[] {
    const ov = this.cache.get(u.id);
    return PERMISSIONS.map((p) => {
      const locked = u.role === 'SUPER_ADMIN' || !allowedFor(u.role, p.key);
      return { key: p.key, group: p.group, side: p.side, default: allowedFor(u.role, p.key) && ROLE_DEFAULTS[u.role].includes(p.key),
        override: locked ? null : ov?.get(p.key) ?? null, effective: this.can(u, p.key), locked };
    });
  }
  /** Applies changes (true/false = override, null = back to role default) and writes one audit row per real change. */
  async set(target: { id: string; role: Role }, changes: Record<string, boolean | null>, by: string) {
    if (target.role === 'SUPER_ADMIN') throw Object.assign(new Error('The super admin always has every permission'), { status: 400 });
    for (const [k, v] of Object.entries(changes)) {
      if (!DEF.has(k)) throw Object.assign(new Error(`Unknown permission ${k}`), { status: 400 });
      if (v !== null && typeof v !== 'boolean') throw Object.assign(new Error(`${k} must be true, false or null`), { status: 400 });
      if (v === true && !allowedFor(target.role, k)) throw Object.assign(new Error(`${k} cannot be given to ${target.role} (data separation)`), { status: 403 });
    }
    const n = await this.db.tx(async (t) => {
      let n = 0; const cur = this.cache.get(target.id);
      for (const [k, v] of Object.entries(changes)) {
        const before = cur?.get(k) ?? null;
        // Same as the role default → store as "default" so a later role change re-derives it.
        const after = v === null || v === ROLE_DEFAULTS[target.role].includes(k) ? null : v;
        if (before === after) continue;
        if (after === null) await t.run('DELETE FROM user_permissions WHERE user_id = ? AND perm = ?', target.id, k);
        else await t.run(`INSERT INTO user_permissions (user_id, perm, granted, updated_by, updated_at) VALUES (?,?,?,?,now())
          ON CONFLICT (user_id, perm) DO UPDATE SET granted = EXCLUDED.granted, updated_by = EXCLUDED.updated_by, updated_at = now()`, target.id, k, after, by);
        await t.run('INSERT INTO permission_audit (user_id, perm, before, after, changed_by) VALUES (?,?,?,?,?)', target.id, k, before, after, by);
        n++;
      }
      return n;
    });
    await this.load();
    if (n) { this.onChange(target.id); await this.bus?.publish('se:perms', { id: target.id, pid: process.pid }).catch(() => undefined); }
    return n;
  }
  async audit(userId?: string, limit = 100): Promise<AuditRow[]> {
    const rs = userId
      ? await this.db.all('SELECT * FROM permission_audit WHERE user_id = ? ORDER BY changed_at DESC, id DESC LIMIT ?', userId, limit)
      : await this.db.all('SELECT * FROM permission_audit ORDER BY changed_at DESC, id DESC LIMIT ?', limit);
    return rs.map((r: any) => ({ id: Number(r.id), userId: r.user_id, perm: r.perm, before: r.before, after: r.after, changedBy: r.changed_by,
      changedAt: r.changed_at instanceof Date ? r.changed_at.toISOString() : String(r.changed_at) }));
  }
  async forgetUser(id: string) { await this.db.run('DELETE FROM user_permissions WHERE user_id = ?', id); await this.load(); }
}
