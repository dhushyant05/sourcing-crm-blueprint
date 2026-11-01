/**
 * Shipments: one per order, created automatically with the order (and backfilled for older orders).
 * Reference = lead SE ref + "-S<n>". Mode / Incoterm / port / transit come from the customer quote.
 * China updates booking & transit (carrier, tracking, container, ETD/ETA, status up to ARRIVED);
 * India updates customs and delivery (CUSTOMS, CLEARED, DELIVERED + customs note).
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { BadQuote, SHIP_MODES, INCOTERMS } from './quotes.js';

/** Gated: China books and marks it shipped (→ IN_TRANSIT); only then may India move it through transit to DELIVERED. */
export const SHIP_STATUS = ['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
export const CHINA_SHIP_STATUS = ['PENDING', 'BOOKED', 'IN_TRANSIT'];
export const INDIA_SHIP_STATUS = ['IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const shipRank = (s: string) => SHIP_STATUS.indexOf(s as never);
export const SHIP_CHINA_KEYS = ['mode', 'incoterm', 'port', 'transit', 'carrier', 'tracking', 'container', 'etd', 'eta'];
export const SHIP_INDIA_KEYS = ['customsNote', 'deliveredAt'];
export interface Shipment {
  id: string; orderId: string; leadId: string; ref: string; mode: string | null; incoterm: string | null; port: string | null; transit: string | null;
  carrier: string | null; tracking: string | null; container: string | null; etd: string | null; eta: string | null; status: string;
  customsNote: string | null; deliveredAt: string | null; createdAt: string; updatedAt: string;
}
const str = (v: unknown, max = 120) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };
const date = (v: unknown, what: string) => { const t = str(v, 10); if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new BadQuote(`${what} must be YYYY-MM-DD`); return t; };
const oneOf = (v: unknown, list: readonly string[], what: string) => { const t = str(v, 20)?.toUpperCase() ?? null; if (t && !list.includes(t)) throw new BadQuote(`${what} must be one of ${list.join(', ')}`); return t; };
const COLS: Record<string, string> = { mode: 'mode', incoterm: 'incoterm', port: 'port', transit: 'transit', carrier: 'carrier', tracking: 'tracking', container: 'container',
  etd: 'etd', eta: 'eta', status: 'status', customsNote: 'customs_note', deliveredAt: 'delivered_at' };

export class ShipmentStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, lead_id TEXT NOT NULL, ref TEXT NOT NULL, mode TEXT, incoterm TEXT, port TEXT, transit TEXT,
      carrier TEXT, tracking TEXT, container TEXT, etd TEXT, eta TEXT, status TEXT NOT NULL, customs_note TEXT, delivered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sh_lead ON shipments(lead_id);`);
    db.exec("UPDATE shipments SET status = 'IN_TRANSIT' WHERE status = 'SHIPPED'"); // pre-gating rows
  }
  private m = (r: any): Shipment => ({ id: r.id, orderId: r.order_id, leadId: r.lead_id, ref: r.ref, mode: r.mode, incoterm: r.incoterm, port: r.port, transit: r.transit,
    carrier: r.carrier, tracking: r.tracking, container: r.container, etd: r.etd, eta: r.eta, status: r.status, customsNote: r.customs_note, deliveredAt: r.delivered_at,
    createdAt: r.created_at, updatedAt: r.updated_at });
  all(): Shipment[] { return (this.db.prepare('SELECT * FROM shipments ORDER BY created_at DESC').all() as any[]).map(this.m); }
  get(id: string) { const r = this.db.prepare('SELECT * FROM shipments WHERE id = ?').get(id); return r ? this.m(r) : null; }
  byOrder(orderId: string) { const r = this.db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(orderId); return r ? this.m(r) : null; }
  create(x: { orderId: string; leadId: string; leadRef: string | null; mode?: string | null; incoterm?: string | null; port?: string | null; transit?: string | null;
    tracking?: string | null; container?: string | null; etd?: string | null; eta?: string | null; status?: string; createdAt?: string }): Shipment {
    const ex = this.byOrder(x.orderId); if (ex) return ex;
    const n = (this.db.prepare('SELECT COUNT(*) c FROM shipments WHERE lead_id = ?').get(x.leadId) as any).c + 1;
    const id = randomUUID(), at = new Date().toISOString(), ok = (v: unknown, l: readonly string[]) => (v && l.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : null);
    this.db.prepare(`INSERT INTO shipments (id, order_id, lead_id, ref, mode, incoterm, port, transit, tracking, container, etd, eta, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, x.orderId, x.leadId, `${x.leadRef ?? 'SE'}-S${n}`, ok(x.mode, SHIP_MODES), ok(x.incoterm, INCOTERMS),
      x.port ?? null, x.transit ?? null, x.tracking ?? null, x.container ?? null, x.etd ?? null, x.eta ?? null, x.status ?? 'PENDING', x.createdAt ?? at, at);
    return this.get(id)!;
  }
  /** Validated patch (permission checks are done by the caller). */
  update(id: string, b: Record<string, unknown>): Shipment {
    const v: Record<string, unknown> = {};
    for (const k of Object.keys(b)) {
      if (!(k in COLS)) throw new BadQuote(`Unknown field ${k}`);
      v[k] = k === 'mode' ? oneOf(b[k], SHIP_MODES, 'Mode') : k === 'incoterm' ? oneOf(b[k], INCOTERMS, 'Incoterm') : k === 'status' ? oneOf(b[k], SHIP_STATUS, 'Status') ?? 'PENDING'
        : ['etd', 'eta', 'deliveredAt'].includes(k) ? date(b[k], k.toUpperCase()) : str(b[k], k === 'customsNote' ? 500 : 120);
    }
    if (v.status === 'DELIVERED' && !('deliveredAt' in v) && !this.get(id)?.deliveredAt) v.deliveredAt = new Date().toISOString().slice(0, 10);
    const ks = Object.keys(v); if (!ks.length) return this.get(id)!;
    this.db.prepare(`UPDATE shipments SET ${ks.map((k) => `${COLS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...(ks.map((k) => v[k]) as any[]), new Date().toISOString(), id);
    return this.get(id)!;
  }
  removeLead(leadId: string) { this.db.prepare('DELETE FROM shipments WHERE lead_id = ?').run(leadId); }
  removeOrder(orderId: string) { this.db.prepare('DELETE FROM shipments WHERE order_id = ?').run(orderId); }
}
