/** Source Easy logins (PostgreSQL `users`). */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { isRole, type Role } from './roles.js';
import type { Db } from './db.js';

export interface User { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string; language?: Language }
export const LANGUAGES = ['en', 'zh-CN'] as const;
export type Language = (typeof LANGUAGES)[number];
interface Row { id: string; email: string; name: string; role: string; password_hash: string; active: boolean; created_at: string; token_version: number; language: string | null }

const toUser = (r: Row): User => ({ id: r.id, email: r.email, name: r.name, role: r.role as Role, active: !!r.active, createdAt: r.created_at, ...(r.language ? { language: r.language as Language } : {}) });
export const MIN_PASSWORD = 10;
const DUMMY = bcrypt.hashSync('not-a-real-password', 12);

/**
 * Users are read on every request (auth) and for names everywhere, so the whole (small) table is kept in memory:
 * loaded once by `load()` and reloaded after every write (and when another process announces a change, see `reload`).
 * Reads are therefore synchronous.
 */
export class UserStore {
  private cache = new Map<string, Row>();
  /** Called after any write with the changed user id (the app publishes it on Redis). */
  onChange: (id: string) => void = () => undefined;
  constructor(readonly db: Db) {}
  async load() { const rs = await this.db.all<Row>('SELECT * FROM users ORDER BY created_at, id'); this.cache = new Map(rs.map((r) => [r.id, r])); return this; }
  reload() { return this.load(); }
  private async changed(id: string) { await this.load(); this.onChange(id); }
  private row(email: string) { const e = email.trim().toLowerCase(); for (const r of this.cache.values()) if (r.email.toLowerCase() === e) return r; return undefined; }
  byId(id: string) { const r = this.cache.get(id); return r ? toUser(r) : null; }
  tokenVersion(id: string) { return this.cache.get(id)?.token_version; }
  list(): User[] { return [...this.cache.values()].map(toUser); }

  async create(email: string, name: string, role: Role, password: string): Promise<User> {
    if (!isRole(role)) throw new Error('Invalid role');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Invalid email');
    if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
    if (this.row(email)) throw new Error('A user with that email already exists');
    const id = randomUUID();
    await this.db.run('INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)',
      id, email.trim().toLowerCase(), name || email, role, await bcrypt.hash(password, 12), new Date().toISOString());
    await this.changed(id);
    return this.byId(id)!;
  }
  async verify(email: string, password: string): Promise<User | null> {
    const r = this.row(email);
    // Compare against a dummy hash when the user is missing to keep timing similar.
    const ok = await bcrypt.compare(password, r?.password_hash ?? DUMMY);
    return r && ok && r.active ? toUser(r) : null;
  }
  async setPassword(id: string, password: string) {
    if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
    await this.db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', await bcrypt.hash(password, 12), id);
    await this.changed(id);
  }
  async setLanguage(id: string, language: string) {
    if (!LANGUAGES.includes(language as Language)) throw new Error(`language must be one of ${LANGUAGES.join(', ')}`);
    await this.db.run('UPDATE users SET language = ? WHERE id = ?', language, id);
    await this.changed(id);
    return this.byId(id)!;
  }
  async update(id: string, patch: { name?: string; email?: string; role?: Role; active?: boolean }) {
    const u = this.byId(id); if (!u) return null;
    if (patch.role && !isRole(patch.role)) throw new Error('Invalid role');
    const name = patch.name === undefined ? u.name : patch.name.trim().slice(0, 120);
    if (!name) throw new Error('Name is required');
    let email = u.email;
    if (patch.email !== undefined) {
      email = patch.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Invalid email');
      const other = this.row(email);
      if (other && other.id !== id) throw new Error('A user with that email already exists');
    }
    const role = patch.role ?? u.role, active = patch.active ?? u.active;
    // Any change to who/what this login is revokes its existing sessions.
    const revoke = role !== u.role || (!active && u.active) || email !== u.email ? 1 : 0;
    await this.db.run('UPDATE users SET name = ?, email = ?, role = ?, active = ?, token_version = token_version + ? WHERE id = ?', name, email, role, active, revoke, id);
    await this.changed(id);
    return this.byId(id);
  }
  /** Active super admins (used to never lose the last one). */
  activeSuperAdmins() { return this.list().filter((u) => u.role === 'SUPER_ADMIN' && u.active).length; }
  /** Hard delete. Sessions die immediately because the auth check looks the user up on every request. */
  async remove(id: string) { const n = await this.db.run('DELETE FROM users WHERE id = ?', id); await this.changed(id); return n > 0; }
  /** Create the super admin from env on first boot (never overwrites an existing password). */
  async bootstrap(email?: string, password?: string, name = 'Super Admin') {
    if (!email || !password || this.row(email)) return false;
    await this.create(email, name, 'SUPER_ADMIN', password);
    return true;
  }
}
