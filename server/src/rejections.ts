/**
 * Customer rejections. A rejection no longer closes the lead: it goes back to the India owner
 * ("Rejected – action needed"), who either asks China for a revised quote or closes the lead as LOST.
 * Nothing here identifies the customer, so China may read it (reason, India's optional target price/notes).
 */
import type { Db } from './db.js';
import { randomUUID } from 'node:crypto';
import { BadQuote } from './quotes.js';

export const REJECT_REASONS = ['PRICE', 'LEAD_TIME', 'MOQ', 'QUALITY', 'SHIPPING', 'OTHER_SUPPLIER', 'NO_RESPONSE', 'OTHER'] as const;
export interface Rejection {
  id: string; leadId: string; quoteId: string; reasonCode: string; reasonText: string | null; by: string; at: string;
  resolution: 'REVISE' | 'CLOSED' | null; targetPrice: number | null; targetCurrency: string | null; notes: string | null; resolvedBy: string | null; resolvedAt: string | null;
}
const s = (v: unknown, max = 500) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };

export class RejectStore {
  constructor(private db: Db) {}
  private m = (r: any): Rejection => ({ id: r.id, leadId: r.lead_id, quoteId: r.quote_id, reasonCode: r.reason_code, reasonText: r.reason_text, by: r.by_user, at: r.at,
    resolution: r.resolution, targetPrice: r.target_price, targetCurrency: r.target_currency, notes: r.notes, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at });
  async list(leadId: string): Promise<Rejection[]> { return (await this.db.all('SELECT * FROM quote_rejections WHERE lead_id = ? ORDER BY at, id', leadId)).map(this.m); }
  async pending(leadId: string) { return (await this.list(leadId)).find((r) => !r.resolution) ?? null; }
  /** Validates the reason (OTHER needs text) and records an open rejection. */
  async add(leadId: string, quoteId: string, code: unknown, text: unknown, by: string): Promise<Rejection> {
    const c = String(code ?? '').toUpperCase(), t = s(text);
    if (!REJECT_REASONS.includes(c as any)) throw new BadQuote(`Pick a rejection reason: ${REJECT_REASONS.join(', ')}`);
    if (c === 'OTHER' && !t) throw new BadQuote('Describe the reason');
    const open = await this.pending(leadId); if (open) await this.resolve(open.id, 'REVISE', by, {}); // superseded
    const id = randomUUID();
    await this.db.run('INSERT INTO quote_rejections (id, lead_id, quote_id, reason_code, reason_text, by_user, at) VALUES (?,?,?,?,?,?,?)', id, leadId, quoteId, c, t, by, new Date().toISOString());
    return (await this.list(leadId)).find((r) => r.id === id)!;
  }
  async resolve(id: string, how: 'REVISE' | 'CLOSED', by: string, b: { targetPrice?: unknown; targetCurrency?: unknown; notes?: unknown }) {
    let tp: number | null = null;
    if (b.targetPrice != null && b.targetPrice !== '') { tp = Number(String(b.targetPrice).replace(/,/g, '')); if (!Number.isFinite(tp) || tp <= 0) throw new BadQuote('Target price must be a positive number'); }
    const cur = tp == null ? null : (s(b.targetCurrency, 3)?.toUpperCase().replace('RMB', 'CNY') ?? 'INR');
    if (cur && !['USD', 'CNY', 'INR'].includes(cur)) throw new BadQuote('Target currency must be USD, RMB or INR');
    await this.db.run('UPDATE quote_rejections SET resolution=?, target_price=?, target_currency=?, notes=?, resolved_by=?, resolved_at=? WHERE id=?',
      how, tp, cur, s(b.notes), by, new Date().toISOString(), id);
  }
  /** Lead-level summary (safe for both offices). */
  async summary(leadId: string, names: Map<string, string>) {
    const all = await this.list(leadId); if (!all.length) return null;
    const p = all.find((r) => !r.resolution) ?? null, last = all[all.length - 1];
    const v = (r: Rejection) => ({ ...r, byName: names.get(r.by) ?? null, resolvedByName: r.resolvedBy ? names.get(r.resolvedBy) ?? null : null });
    return { count: all.length, actionNeeded: !!p, revising: !p && last.resolution === 'REVISE', last: v(last), history: all.map(v) };
  }
  async forgetLead(leadId: string) { await this.db.run('DELETE FROM quote_rejections WHERE lead_id = ?', leadId); }
}
