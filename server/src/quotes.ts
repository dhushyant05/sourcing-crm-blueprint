/**
 * China-side supplier quotes on a lead. Stored in the server's SQLite DB (same file as users/assignments).
 * Twenty's `quotation` object only has unitCost/totalCost/currency/clientUnitPrice/clientCurrency/validityDate and
 * hangs off a sourcingRequest; it has no product/model, MOQ, lead time or notes, so quotes on a lead live here.
 * Suppliers (identity + contact) are China-only; India gets a redacted view (see QuoteStore.view).
 * Prices are stored exactly as entered, in their own currency: no conversion.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const CURRENCIES = ['USD', 'CNY', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];
export interface Supplier { id: string; name: string; contact: string | null; phone: string | null; wechat: string | null; city: string | null; createdBy: string | null; createdAt: string }
export interface Quote {
  id: string; leadId: string; supplierId: string | null; product: string; unitPrice: number; currency: Currency;
  moq: string | null; leadTime: string | null; validity: string | null; notes: string | null;
  clientPrice: number | null; clientCurrency: string | null; clientNotes: string | null;
  createdBy: string; createdAt: string; updatedAt: string;
}
const s = (v: unknown, max = 500) => { const t = typeof v === 'string' ? v.trim() : v == null ? '' : String(v); return t ? t.slice(0, max) : null; };
export class BadQuote extends Error { status = 400; }

export class QuoteStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, phone TEXT, wechat TEXT, city TEXT, created_by TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lead_quotes (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, supplier_id TEXT, product TEXT NOT NULL, unit_price REAL NOT NULL, currency TEXT NOT NULL,
      moq TEXT, lead_time TEXT, validity TEXT, notes TEXT, client_price REAL, client_currency TEXT, client_notes TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS lq_lead ON lead_quotes(lead_id, created_at);`);
  }
  private sup = (r: any): Supplier => ({ id: r.id, name: r.name, contact: r.contact, phone: r.phone, wechat: r.wechat, city: r.city, createdBy: r.created_by, createdAt: r.created_at });
  private q = (r: any): Quote => ({ id: r.id, leadId: r.lead_id, supplierId: r.supplier_id, product: r.product, unitPrice: r.unit_price, currency: r.currency,
    moq: r.moq, leadTime: r.lead_time, validity: r.validity, notes: r.notes, clientPrice: r.client_price, clientCurrency: r.client_currency,
    clientNotes: r.client_notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

  suppliers(): Supplier[] { return (this.db.prepare('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE').all() as any[]).map(this.sup); }
  supplier(id: string): Supplier | null { const r = this.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id); return r ? this.sup(r) : null; }
  addSupplier(b: Record<string, unknown>, by: string): Supplier {
    const name = s(b.name, 120); if (!name) throw new BadQuote('Supplier name is required');
    const id = randomUUID();
    this.db.prepare('INSERT INTO suppliers VALUES (?,?,?,?,?,?,?,?)').run(id, name, s(b.contact, 120), s(b.phone, 60), s(b.wechat, 60), s(b.city, 80), by, new Date().toISOString());
    return this.supplier(id)!;
  }
  updateSupplier(id: string, b: Record<string, unknown>): Supplier | null {
    const cur = this.supplier(id); if (!cur) return null;
    const n = { ...cur, ...Object.fromEntries(['name', 'contact', 'phone', 'wechat', 'city'].filter((k) => k in b).map((k) => [k, s(b[k], 120)])) };
    if (!n.name) throw new BadQuote('Supplier name is required');
    this.db.prepare('UPDATE suppliers SET name=?, contact=?, phone=?, wechat=?, city=? WHERE id=?').run(n.name, n.contact, n.phone, n.wechat, n.city, id);
    return this.supplier(id);
  }

  list(leadId: string): Quote[] { return (this.db.prepare('SELECT * FROM lead_quotes WHERE lead_id = ? ORDER BY created_at, rowid').all(leadId) as any[]).map(this.q); }
  get(id: string): Quote | null { const r = this.db.prepare('SELECT * FROM lead_quotes WHERE id = ?').get(id); return r ? this.q(r) : null; }
  count(leadId: string): number { return (this.db.prepare('SELECT COUNT(*) c FROM lead_quotes WHERE lead_id = ?').get(leadId) as any).c; }

  private china(b: Record<string, unknown>, cur?: Quote) {
    const has = (k: string) => k in b;
    const product = has('product') ? s(b.product, 200) : cur?.product ?? null;
    if (!product) throw new BadQuote('Product / model is required');
    const priceRaw = has('unitPrice') ? b.unitPrice : cur?.unitPrice;
    const unitPrice = typeof priceRaw === 'string' ? Number(priceRaw.replace(/,/g, '')) : Number(priceRaw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || priceRaw === '' || priceRaw == null) throw new BadQuote('Unit price must be a number');
    const currency = String(has('currency') ? b.currency : cur?.currency ?? '').toUpperCase().replace('RMB', 'CNY') as Currency;
    if (!CURRENCIES.includes(currency)) throw new BadQuote('Currency must be USD, RMB or INR');
    const supplierId = has('supplierId') ? s(b.supplierId, 64) : cur?.supplierId ?? null;
    if (supplierId && !this.supplier(supplierId)) throw new BadQuote('Unknown supplier');
    const pick = (k: 'moq' | 'leadTime' | 'validity' | 'notes', max: number) => (has(k) ? s(b[k], max) : cur?.[k] ?? null);
    return { product, unitPrice, currency, supplierId, moq: pick('moq', 60), leadTime: pick('leadTime', 60), validity: pick('validity', 60), notes: pick('notes', 2000) };
  }
  create(leadId: string, b: Record<string, unknown>, by: string): Quote {
    const c = this.china(b); const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare(`INSERT INTO lead_quotes (id, lead_id, supplier_id, product, unit_price, currency, moq, lead_time, validity, notes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, leadId, c.supplierId, c.product, c.unitPrice, c.currency, c.moq, c.leadTime, c.validity, c.notes, by, at, at);
    return this.get(id)!;
  }
  update(id: string, b: Record<string, unknown>): Quote {
    const cur = this.get(id)!; const c = this.china(b, cur);
    this.db.prepare(`UPDATE lead_quotes SET supplier_id=?, product=?, unit_price=?, currency=?, moq=?, lead_time=?, validity=?, notes=?, updated_at=? WHERE id=?`)
      .run(c.supplierId, c.product, c.unitPrice, c.currency, c.moq, c.leadTime, c.validity, c.notes, new Date().toISOString(), id);
    return this.get(id)!;
  }
  /** India's customer-facing selling price on a quote (INR by default). */
  setClient(id: string, b: Record<string, unknown>): Quote {
    const cur = this.get(id)!;
    const raw = 'clientPrice' in b ? b.clientPrice : cur.clientPrice;
    let price: number | null = null;
    if (raw !== null && raw !== '' && raw !== undefined) {
      price = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw);
      if (!Number.isFinite(price) || price < 0) throw new BadQuote('Selling price must be a number');
    }
    const ccy = String(('clientCurrency' in b ? b.clientCurrency : cur.clientCurrency) ?? 'INR').toUpperCase().replace('RMB', 'CNY');
    if (!CURRENCIES.includes(ccy as Currency)) throw new BadQuote('Currency must be USD, RMB or INR');
    const notes = 'clientNotes' in b ? s(b.clientNotes, 2000) : cur.clientNotes;
    this.db.prepare('UPDATE lead_quotes SET client_price=?, client_currency=?, client_notes=?, updated_at=? WHERE id=?')
      .run(price, price == null ? null : ccy, notes, new Date().toISOString(), id);
    return this.get(id)!;
  }
  remove(id: string) { this.db.prepare('DELETE FROM lead_quotes WHERE id = ?').run(id); }
  removeLead(leadId: string) { this.db.prepare('DELETE FROM lead_quotes WHERE lead_id = ?').run(leadId); }
  deleteSupplier(id: string) { this.db.prepare('UPDATE lead_quotes SET supplier_id = NULL WHERE supplier_id = ?').run(id); this.db.prepare('DELETE FROM suppliers WHERE id = ?').run(id); }
}
