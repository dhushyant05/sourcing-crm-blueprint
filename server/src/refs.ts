/**
 * One shared lead reference, SE-YYMM-NNNN. Generated only on the server, sequential per month, never reused:
 * the counter lives in PostgreSQL (`ref_counters`) and is incremented atomically, so concurrent creations
 * (even from several API processes) can never get the same number.
 */
import type { Db } from './db.js';

export const REF_RE = /^SE-(\d{4})-(\d{4,})$/;
export const formatRef = (yymm: string, n: number) => `SE-${yymm}-${String(n).padStart(4, '0')}`;
export const yymmOf = (d: Date) => `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export class RefCounter {
  constructor(private db: Db) {}
  /** Never go below a number already in use. */
  async seen(ref: unknown) {
    const m = REF_RE.exec(String(ref ?? ''));
    if (m) await this.db.run('INSERT INTO ref_counters (yymm, n) VALUES (?, ?) ON CONFLICT (yymm) DO UPDATE SET n = GREATEST(ref_counters.n, excluded.n)', m[1], Number(m[2]));
  }
  async next(at = new Date()): Promise<string> {
    const k = yymmOf(at);
    const r = await this.db.get<{ n: number }>('INSERT INTO ref_counters (yymm, n) VALUES (?, 1) ON CONFLICT (yymm) DO UPDATE SET n = ref_counters.n + 1 RETURNING n', k);
    return formatRef(k, r!.n);
  }
}
