/**
 * Orders (v1): created by India from an accepted quote, linked to the lead's SE reference.
 * India fields: qty, agreed INR price, advance received, payment status, expected ship date, India-side shipment status (customs / delivered).
 * China fields: production status, tracking / container no, ETD / ETA. Stored in the server's SQLite DB.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { BadQuote } from './quotes.js';

export const PAYMENT = ['PENDING', 'PARTIAL', 'PAID'] as const;
export const PRODUCTION = ['NEW', 'DEPOSIT_PAID', 'IN_PRODUCTION', 'READY', 'SHIPPED'] as const;
export const INDIA_SHIP = ['NONE', 'IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export interface Order {
  id: string; leadId: string; quoteId: string; leadRef: string | null; product: string; qty: number; agreedPrice: number; advance: number;
  paymentStatus: string; expectedShip: string | null; production: string; tracking: string | null; container: string | null;
  etd: string | null; eta: string | null; indiaStatus: string; createdBy: string; createdAt: string; updatedAt: string;
}
const s = (v: unknown, max = 120) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };
const n = (v: unknown, what: string, req = false) => {
  if (v === undefined || v === null || v === '') { if (req) throw new BadQuote(`${what} is required`); return 0; }
  const x = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(x) || x < 0) throw new BadQuote(`${what} must be a number`); return x;
};
const date = (v: unknown, what: string) => { const t = s(v, 10); if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new BadQuote(`${what} must be YYYY-MM-DD`); return t; };
const one = (v: unknown, list: readonly string[], what: string) => { const t = String(v).toUpperCase(); if (!list.includes(t)) throw new BadQuote(`${what} must be one of ${list.join(', ')}`); return t; };
export const INDIA_KEYS = ['qty', 'agreedPrice', 'advance', 'paymentStatus', 'expectedShip', 'indiaStatus'];
export const CHINA_KEYS = ['production', 'tracking', 'container', 'etd', 'eta'];

export class OrderStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, quote_id TEXT NOT NULL UNIQUE, lead_ref TEXT, product TEXT NOT NULL, qty REAL NOT NULL, agreed_price REAL NOT NULL,
      advance REAL NOT NULL DEFAULT 0, payment_status TEXT NOT NULL, expected_ship TEXT, production TEXT NOT NULL, tracking TEXT, container TEXT, etd TEXT, eta TEXT,
      india_status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS o_lead ON orders(lead_id);`);
  }
  private o = (r: any): Order => ({ id: r.id, leadId: r.lead_id, quoteId: r.quote_id, leadRef: r.lead_ref, product: r.product, qty: r.qty, agreedPrice: r.agreed_price,
    advance: r.advance, paymentStatus: r.payment_status, expectedShip: r.expected_ship, production: r.production, tracking: r.tracking, container: r.container,
    etd: r.etd, eta: r.eta, indiaStatus: r.india_status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  all(): Order[] { return (this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all() as any[]).map(this.o); }
  get(id: string): Order | null { const r = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id); return r ? this.o(r) : null; }
  byQuote(qid: string): Order | null { const r = this.db.prepare('SELECT * FROM orders WHERE quote_id = ?').get(qid); return r ? this.o(r) : null; }
  create(x: { leadId: string; quoteId: string; leadRef: string | null; product: string }, b: Record<string, unknown>, by: string): Order {
    const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare(`INSERT INTO orders (id, lead_id, quote_id, lead_ref, product, qty, agreed_price, advance, payment_status, expected_ship, production, india_status, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, x.leadId, x.quoteId, x.leadRef, x.product, n(b.qty, 'Quantity', true), n(b.agreedPrice, 'Agreed price', true), n(b.advance, 'Advance'),
      one(b.paymentStatus ?? 'PENDING', PAYMENT, 'Payment status'), date(b.expectedShip, 'Expected ship date'), 'NEW', 'NONE', by, at, at);
    return this.get(id)!;
  }
  update(id: string, b: Record<string, unknown>): Order {
    const c = this.get(id)!, h = (k: string) => k in b;
    const v = {
      qty: h('qty') ? n(b.qty, 'Quantity', true) : c.qty, agreedPrice: h('agreedPrice') ? n(b.agreedPrice, 'Agreed price', true) : c.agreedPrice,
      advance: h('advance') ? n(b.advance, 'Advance') : c.advance, paymentStatus: h('paymentStatus') ? one(b.paymentStatus, PAYMENT, 'Payment status') : c.paymentStatus,
      expectedShip: h('expectedShip') ? date(b.expectedShip, 'Expected ship date') : c.expectedShip, indiaStatus: h('indiaStatus') ? one(b.indiaStatus, INDIA_SHIP, 'Shipment status') : c.indiaStatus,
      production: h('production') ? one(b.production, PRODUCTION, 'Production status') : c.production, tracking: h('tracking') ? s(b.tracking) : c.tracking,
      container: h('container') ? s(b.container) : c.container, etd: h('etd') ? date(b.etd, 'ETD') : c.etd, eta: h('eta') ? date(b.eta, 'ETA') : c.eta,
    };
    this.db.prepare(`UPDATE orders SET qty=?, agreed_price=?, advance=?, payment_status=?, expected_ship=?, india_status=?, production=?, tracking=?, container=?, etd=?, eta=?, updated_at=? WHERE id=?`)
      .run(v.qty, v.agreedPrice, v.advance, v.paymentStatus, v.expectedShip, v.indiaStatus, v.production, v.tracking, v.container, v.etd, v.eta, new Date().toISOString(), id);
    return this.get(id)!;
  }
  removeLead(leadId: string) { this.db.prepare('DELETE FROM orders WHERE lead_id = ?').run(leadId); }
  removeQuote(qid: string) { this.db.prepare('DELETE FROM orders WHERE quote_id = ?').run(qid); }
}
