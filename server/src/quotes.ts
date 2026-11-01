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
  // China-side shipping (supplier quote), in its own currency
  shipCost: number | null; shipCurrency: Currency | null; shipTerm: string | null; shipMode: string | null; shipPort: string | null; shipTransit: string | null;
  // India-side customer quote
  cq: CustomerQuote | null; status: QuoteStatus; sentAt: string | null; decidedAt: string | null; rejectReason: string | null; pdfToken: string | null;
}
export const INCOTERMS = ['EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'] as const;
export const SHIP_MODES = ['AIR', 'SEA', 'EXPRESS', 'ROAD'] as const;
export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
/** What India sends the customer. All money in INR. */
export interface CustomerQuote {
  qty: number; unitPrice: number; gstPct: number; shipCost: number; shipTerm: string | null; shipMode: string | null; port: string | null; transit: string | null;
  otherCharges: number; otherLabel: string | null; validity: string | null; terms: string | null;
}
export const cqTotals = (c: CustomerQuote) => {
  const subtotal = c.qty * c.unitPrice, taxable = subtotal + c.shipCost + c.otherCharges, gst = taxable * c.gstPct / 100;
  return { subtotal, taxable, gst, total: taxable + gst };
};
const num = (v: unknown, what: string, def: number | null = null): number | null => {
  if (v === undefined || v === null || v === '') return def;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadQuote(`${what} must be a number`);
  return n;
};
const oneOf = (v: unknown, list: readonly string[], what: string) => {
  if (v === undefined || v === null || v === '') return null;
  const t = String(v).toUpperCase(); if (!list.includes(t)) throw new BadQuote(`${what} must be one of ${list.join(', ')}`); return t;
};
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
    const have = new Set((db.prepare('PRAGMA table_info(lead_quotes)').all() as any[]).map((c) => c.name));
    for (const [c, t] of [['ship_cost', 'REAL'], ['ship_currency', 'TEXT'], ['ship_term', 'TEXT'], ['ship_mode', 'TEXT'], ['ship_port', 'TEXT'], ['ship_transit', 'TEXT'],
      ['cq', 'TEXT'], ['status', "TEXT NOT NULL DEFAULT 'DRAFT'"], ['sent_at', 'TEXT'], ['decided_at', 'TEXT'], ['reject_reason', 'TEXT'], ['pdf_token', 'TEXT']])
      if (!have.has(c)) db.exec(`ALTER TABLE lead_quotes ADD COLUMN ${c} ${t}`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS lq_token ON lead_quotes(pdf_token)');
  }
  private sup = (r: any): Supplier => ({ id: r.id, name: r.name, contact: r.contact, phone: r.phone, wechat: r.wechat, city: r.city, createdBy: r.created_by, createdAt: r.created_at });
  private q = (r: any): Quote => ({ id: r.id, leadId: r.lead_id, supplierId: r.supplier_id, product: r.product, unitPrice: r.unit_price, currency: r.currency,
    moq: r.moq, leadTime: r.lead_time, validity: r.validity, notes: r.notes, clientPrice: r.client_price, clientCurrency: r.client_currency,
    clientNotes: r.client_notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    shipCost: r.ship_cost, shipCurrency: r.ship_currency, shipTerm: r.ship_term, shipMode: r.ship_mode, shipPort: r.ship_port, shipTransit: r.ship_transit,
    cq: r.cq ? JSON.parse(r.cq) : null, status: r.status ?? 'DRAFT', sentAt: r.sent_at, decidedAt: r.decided_at, rejectReason: r.reject_reason, pdfToken: r.pdf_token });
  all(): Quote[] { return (this.db.prepare('SELECT * FROM lead_quotes ORDER BY created_at DESC, rowid DESC').all() as any[]).map(this.q); }
  byToken(t: string): Quote | null { if (!/^[A-Za-z0-9_-]{30,}$/.test(t)) return null; const r = this.db.prepare('SELECT * FROM lead_quotes WHERE pdf_token = ?').get(t); return r ? this.q(r) : null; }
  setToken(id: string, t: string) { this.db.prepare('UPDATE lead_quotes SET pdf_token = ? WHERE id = ?').run(t, id); }
  setCustomer(id: string, b: Record<string, unknown>): Quote {
    const cur = this.get(id)!, p = cur.cq;
    const g = (k: keyof CustomerQuote) => (k in b ? b[k] : p?.[k]);
    const qty = num(g('qty'), 'Quantity'); if (!qty) throw new BadQuote('Quantity is required');
    const unitPrice = num(g('unitPrice') ?? cur.clientPrice, 'Selling price'); if (unitPrice == null) throw new BadQuote('Selling price per unit is required');
    const gstPct = num(g('gstPct'), 'GST %', 0)!; if (gstPct > 100) throw new BadQuote('GST % must be 0-100');
    const cq: CustomerQuote = { qty, unitPrice, gstPct, shipCost: num(g('shipCost'), 'Shipping cost', 0)!, shipTerm: oneOf(g('shipTerm'), INCOTERMS, 'Shipping term'),
      shipMode: oneOf(g('shipMode'), SHIP_MODES, 'Shipping mode'), port: s(g('port'), 120), transit: s(g('transit'), 60),
      otherCharges: num(g('otherCharges'), 'Other charges', 0)!, otherLabel: s(g('otherLabel'), 80), validity: s(g('validity'), 60), terms: s(g('terms'), 3000) };
    this.db.prepare("UPDATE lead_quotes SET cq=?, client_price=?, client_currency='INR', updated_at=? WHERE id=?").run(JSON.stringify(cq), unitPrice, new Date().toISOString(), id);
    return this.get(id)!;
  }
  setStatus(id: string, status: QuoteStatus, reason?: string | null): Quote {
    const at = new Date().toISOString();
    if (status === 'SENT') this.db.prepare("UPDATE lead_quotes SET status='SENT', sent_at=?, updated_at=? WHERE id=?").run(at, at, id);
    else if (status === 'DRAFT') this.db.prepare("UPDATE lead_quotes SET status='DRAFT', decided_at=NULL, reject_reason=NULL, updated_at=? WHERE id=?").run(at, id);
    else this.db.prepare('UPDATE lead_quotes SET status=?, decided_at=?, reject_reason=?, updated_at=? WHERE id=?').run(status, at, status === 'REJECTED' ? s(reason, 500) : null, at, id);
    return this.get(id)!;
  }

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
    const shipCost = has('shipCost') ? num(b.shipCost, 'Shipping cost') : cur?.shipCost ?? null;
    let shipCurrency = has('shipCurrency') ? (b.shipCurrency ? String(b.shipCurrency).toUpperCase().replace('RMB', 'CNY') : null) : cur?.shipCurrency ?? null;
    if (shipCurrency && !CURRENCIES.includes(shipCurrency as Currency)) throw new BadQuote('Shipping currency must be USD, RMB or INR');
    if (shipCost != null && !shipCurrency) shipCurrency = currency;
    const ship = { shipCost, shipCurrency: shipCurrency as Currency | null,
      shipTerm: has('shipTerm') ? oneOf(b.shipTerm, INCOTERMS, 'Shipping term') : cur?.shipTerm ?? null,
      shipMode: has('shipMode') ? oneOf(b.shipMode, SHIP_MODES, 'Shipping mode') : cur?.shipMode ?? null,
      shipPort: has('shipPort') ? s(b.shipPort, 120) : cur?.shipPort ?? null, shipTransit: has('shipTransit') ? s(b.shipTransit, 60) : cur?.shipTransit ?? null };
    return { product, unitPrice, currency, supplierId, moq: pick('moq', 60), leadTime: pick('leadTime', 60), validity: pick('validity', 60), notes: pick('notes', 2000), ...ship };
  }
  create(leadId: string, b: Record<string, unknown>, by: string): Quote {
    const c = this.china(b); const id = randomUUID(), at = new Date().toISOString();
    this.db.prepare(`INSERT INTO lead_quotes (id, lead_id, supplier_id, product, unit_price, currency, moq, lead_time, validity, notes, created_by, created_at, updated_at,
      ship_cost, ship_currency, ship_term, ship_mode, ship_port, ship_transit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, leadId, c.supplierId, c.product, c.unitPrice, c.currency, c.moq, c.leadTime, c.validity, c.notes, by, at, at, c.shipCost, c.shipCurrency, c.shipTerm, c.shipMode, c.shipPort, c.shipTransit);
    return this.get(id)!;
  }
  update(id: string, b: Record<string, unknown>): Quote {
    const cur = this.get(id)!; const c = this.china(b, cur);
    this.db.prepare(`UPDATE lead_quotes SET supplier_id=?, product=?, unit_price=?, currency=?, moq=?, lead_time=?, validity=?, notes=?, updated_at=?,
      ship_cost=?, ship_currency=?, ship_term=?, ship_mode=?, ship_port=?, ship_transit=? WHERE id=?`)
      .run(c.supplierId, c.product, c.unitPrice, c.currency, c.moq, c.leadTime, c.validity, c.notes, new Date().toISOString(), c.shipCost, c.shipCurrency, c.shipTerm, c.shipMode, c.shipPort, c.shipTransit, id);
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
