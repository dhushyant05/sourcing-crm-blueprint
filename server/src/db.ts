/**
 * Source Easy's own PostgreSQL database. `Db` is a tiny wrapper (all / get / run / tx) over node-postgres in production
 * and PGlite (in-process Postgres) in tests. SQL uses `?` placeholders, converted to $1..$n.
 * Rows come back with timestamptz as ISO strings, date as 'YYYY-MM-DD', numeric/bigint as numbers.
 */
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

export interface Queryable { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null; affectedRows?: number }> }
const conv = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const fixRow = (r: Record<string, unknown>) => { for (const k in r) { const v = r[k]; if (v instanceof Date) r[k] = v.toISOString(); } return r; };

export class Db {
  constructor(private q: Queryable, private pool?: pg.Pool, private release?: () => Promise<void>) {}
  async all<T = any>(sql: string, ...p: unknown[]): Promise<T[]> { return (await this.q.query(conv(sql), p)).rows.map(fixRow) as T[]; }
  async get<T = any>(sql: string, ...p: unknown[]): Promise<T | undefined> { return (await this.all<T>(sql, ...p))[0]; }
  async run(sql: string, ...p: unknown[]): Promise<number> { const r = await this.q.query(conv(sql), p); return Number(r.rowCount ?? r.affectedRows ?? 0); }
  /** Runs `fn` in one transaction (dedicated connection in production; PGlite is single-connection). */
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.pool) { await this.q.query('BEGIN'); try { const r = await fn(this); await this.q.query('COMMIT'); return r; } catch (e) { await this.q.query('ROLLBACK'); throw e; } }
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const r = await fn(new Db(c as unknown as Queryable)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  async close() { await this.release?.(); }
  get raw() { return this.q; }
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
/** Applies pending migrations (node-pg-migrate, plain .sql files). */
export async function migrate(q: Queryable, log: (m: string) => void = () => undefined) {
  const dbClient = { query: (t: any, v?: unknown[]) => (typeof t === 'string' ? q.query(t, v) : q.query(t.text, t.values)), connect: async () => undefined, end: async () => undefined };
  await runner({ dbClient: dbClient as any, dir: MIGRATIONS_DIR, direction: 'up', migrationsTable: 'pgmigrations', noLock: true, log, checkOrder: true } as any);
}

/** Production: a small pool (the VPS has ~2 GB RAM shared with Postgres). */
export async function openPg(url: string, max = 6): Promise<Db> {
  pg.types.setTypeParser(1082, (v) => v); // date stays 'YYYY-MM-DD'
  pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
  pg.types.setTypeParser(20, (v) => Number(v)); // bigint (counts, seq)
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30000, options: '-c timezone=UTC' });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  await migrate(pool as unknown as Queryable, (m) => console.log(m));
  return new Db(pool as unknown as Queryable, pool, () => pool.end());
}

/** Tests: in-process Postgres with the same migrations. */
export async function openMemoryDb(): Promise<Db> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const db = new PGlite({ parsers: { [types.DATE]: (v: string) => v, [types.NUMERIC]: (v: string) => Number(v), [types.INT8]: (v: string) => Number(v) } });
  await db.exec("SET timezone = 'UTC'");
  const q: Queryable = { query: async (t, p) => (p?.length ? db.query(t, p as any[]) : (await db.exec(t)).at(-1) ?? { rows: [], affectedRows: 0 }) as any };
  await migrate(q);
  return new Db(q, undefined, () => db.close());
}
