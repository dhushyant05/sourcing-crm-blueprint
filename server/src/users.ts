/** Source Easy logins live here (not in Twenty). Linked to Twenty Team Member records by email. */
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { isRole, type Role } from './roles.js';

export interface User { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string; language?: Language }
export const LANGUAGES = ['en', 'zh-CN'] as const;
export type Language = (typeof LANGUAGES)[number];
interface Row { id: string; email: string; name: string; role: string; password_hash: string; active: number; created_at: string; token_version: number; language: string | null }

const toUser = (r: Row): User => ({ id: r.id, email: r.email, name: r.name, role: r.role as Role, active: !!r.active, createdAt: r.created_at, ...(r.language ? { language: r.language as Language } : {}) });
export const MIN_PASSWORD = 10;
const DUMMY = bcrypt.hashSync('not-a-real-password', 12);

export class UserStore {
  private db: DatabaseSync;
  /** Same SQLite file is shared by lead assignments and notifications. */
  get database() { return this.db; }
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL,
      password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0)`);
    // Migration for DBs created before the language preference existed.
    const cols = (this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('language')) this.db.exec('ALTER TABLE users ADD COLUMN language TEXT');
  }
  private row(email: string) { return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as Row | undefined; }
  byId(id: string) { const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined; return r ? toUser(r) : null; }
  tokenVersion(id: string) { return (this.db.prepare('SELECT token_version FROM users WHERE id = ?').get(id) as { token_version: number } | undefined)?.token_version; }
  list(): User[] { return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as Row[]).map(toUser); }

  async create(email: string, name: string, role: Role, password: string): Promise<User> {
    if (!isRole(role)) throw new Error('Invalid role');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Invalid email');
    if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
    if (this.row(email)) throw new Error('A user with that email already exists');
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, email.trim().toLowerCase(), name || email, role, await bcrypt.hash(password, 12), new Date().toISOString());
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
    this.db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await bcrypt.hash(password, 12), id);
  }
  setLanguage(id: string, language: string) {
    if (!LANGUAGES.includes(language as Language)) throw new Error(`language must be one of ${LANGUAGES.join(', ')}`);
    this.db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, id);
    return this.byId(id)!;
  }
  update(id: string, patch: { name?: string; email?: string; role?: Role; active?: boolean }) {
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
    this.db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ?, token_version = token_version + ? WHERE id = ?')
      .run(name, email, role, active ? 1 : 0, revoke, id);
    return this.byId(id);
  }
  /** Active super admins (used to never lose the last one). */
  activeSuperAdmins() { return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'SUPER_ADMIN' AND active = 1").get() as { n: number }).n; }
  /** Hard delete. Sessions die immediately because the auth check looks the user up on every request. */
  remove(id: string) { return Number(this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes) > 0; }
  /** Create the super admin from env on first boot (never overwrites an existing password). */
  async bootstrap(email?: string, password?: string, name = 'Super Admin') {
    if (!email || !password || this.row(email)) return false;
    await this.create(email, name, 'SUPER_ADMIN', password);
    return true;
  }
}
