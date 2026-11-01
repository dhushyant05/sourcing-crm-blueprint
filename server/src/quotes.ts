/**
 * China-side supplier quotes on a lead (PostgreSQL `quotes`; India's customer quote in `customer_quotes`).
 * Suppliers (identity + contact) are China-only; India gets a redacted view (see QuoteStore.view).
 * Prices are stored exactly as entered, in their own currency: no conversion.
 */
import type { Db } from './db.js';
import { randomUUID } from 'node:crypto';

export const CURRENCIES = ['USD', 'CNY', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];
export interface Supplier { id: string; name: string; contact: string | null; phone: string | null; wechat: string | null; city: string | null; notes: string | null; createdBy: string | null; createdAt: string }
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
  constructor(private db: Db) {}
  private sup = (r: any): Supplier => ({ id: r.id, name: r.name, contact: r.contact, phone: r.phone, wechat: r.wechat, city: r.city, notes: r.notes ?? null, createdBy: r.created_by, createdAt: r.created_at });
  private cqOf = (r: any): CustomerQuote | null => (r.cq_qty == null ? null : { qty: r.cq_qty, unitPrice: r.cq_unit_price, gstPct: r.cq_gst_pct, shipCost: r.cq_ship_cost, shipTerm: r.cq_ship_term,
    shipMode: r.cq_ship_mode, port: r.cq_port, transit: r.cq_transit, otherCharges: r.cq_other_charges, otherLabel: r.cq_other_label, validity: r.cq_validity, terms: r.cq_terms });
  private q = (r: any): Quote => ({ id: r.id, leadId: r.lead_id, supplierId: r.supplier_id, product: r.product, unitPrice: r.unit_price, currency: r.currency,
    moq: r.moq, leadTime: r.lead_time, validity: r.validity, notes: r.notes, clientPrice: r.client_price, clientCurrency: r.client_currency,
    clientNotes: r.client_notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    shipCost: r.ship_cost, shipCurrency: r.ship_currency, shipTerm: r.ship_term, shipMode: r.ship_mode, shipPort: r.ship_port, shipTransit: r.ship_transit,
    cq: this.cqOf(r), status: r.status ?? 'DRAFT', sentAt: r.sent_at, decidedAt: r.decided_at, rejectReason: r.reject_reason, pdfToken: r.pdf_token });
  private static SEL = `SELECT q.*, c.qty cq_qty, c.unit_price cq_unit_price, c.gst_pct cq_gst_pct, c.ship_cost cq_ship_cost, c.ship_term cq_ship_term, c.ship_mode cq_ship_mode,
    c.port cq_port, c.transit cq_transit, c.other_charges cq_other_charges, c.other_label cq_other_label, c.validity cq_validity, c.terms cq_terms
    FROM quotes q LEFT JOIN customer_quotes c ON c.quote_id = q.id`;
  async all(): Promise<Quote[]> { return (await this.db.all(`${QuoteStore.SEL} ORDER BY q.created_at DESC, q.seq DESC`)).map(this.q); }
  async byToken(t: string): Promise<Quote | null> { if (!/^[A-Za-z0-9_-]{30,}$/.test(t)) return null; const r = await this.db.get(`${QuoteStore.SEL} WHERE q.pdf_token = ?`, t); return r ? this.q(r) : null; }
  async setToken(id: string, t: string) { await this.db.run('UPDATE quotes SET pdf_token = ? WHERE id = ?', t, id); }
  async setCustomer(id: string, b: Record<string, unknown>): Promise<Quote> {
    const cur = (await this.get(id))!, p = cur.cq;
    const g = (k: keyof CustomerQuote) => (k in b ? b[k] : p?.[k]);
    const qty = num(g('qty'), 'Quantity'); if (!qty) throw new BadQuote('Quantity is required');
    const unitPrice = num(g('unitPrice') ?? cur.clientPrice, 'Selling price'); if (unitPrice == null) throw new BadQuote('Selling price per unit is required');
    const gstPct = num(g('gstPct'), 'GST %', 0)!; if (gstPct > 100) throw new BadQuote('GST % must be 0-100');
    const cq: CustomerQuote = { qty, unitPrice, gstPct, shipCost: num(g('shipCost'), 'Shipping cost', 0)!, shipTerm: oneOf(g('shipTerm'), INCOTERMS, 'Shipping term'),
      shipMode: oneOf(g('shipMode'), SHIP_MODES, 'Shipping mode'), port: s(g('port'), 120), transit: s(g('transit'), 60),
      otherCharges: num(g('otherCharges'), 'Other charges', 0)!, otherLabel: s(g('otherLabel'), 80), validity: s(g('validity'), 60), terms: s(g('terms'), 3000) };
    const at = new Date().toISOString();
    await this.db.tx(async (db) => {
      await db.run(`INSERT INTO customer_quotes (quote_id, qty, unit_price, gst_pct, ship_cost, ship_term, ship_mode, port, transit, other_charges, other_label, validity, terms, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (quote_id) DO UPDATE SET qty=excluded.qty, unit_price=excluded.unit_price, gst_pct=excluded.gst_pct, ship_cost=excluded.ship_cost,
        ship_term=excluded.ship_term, ship_mode=excluded.ship_mode, port=excluded.port, transit=excluded.transit, other_charges=excluded.other_charges, other_label=excluded.other_label,
        validity=excluded.validity, terms=excluded.terms, updated_at=excluded.updated_at`,
        id, cq.qty, cq.unitPrice, cq.gstPct, cq.shipCost, cq.shipTerm, cq.shipMode, cq.port, cq.transit, cq.otherCharges, cq.otherLabel, cq.validity, cq.terms, at);
      await db.run("UPDATE quotes SET client_price=?, client_currency='INR', updated_at=? WHERE id=?", unitPrice, at, id);
    });
    return (await this.get(id))!;
  }
  async setStatus(id: string, status: QuoteStatus, reason?: string | null): Promise<Quote> {
    const at = new Date().toISOString();
    if (status === 'SENT') await this.db.run("UPDATE quotes SET status='SENT', sent_at=?, updated_at=? WHERE id=?", at, at, id);
    else if (status === 'DRAFT') await this.db.run("UPDATE quotes SET status='DRAFT', decided_at=NULL, reject_reason=NULL, updated_at=? WHERE id=?", at, id);
    else await this.db.run('UPDATE quotes SET status=?, decided_at=?, reject_reason=?, updated_at=? WHERE id=?', status, at, status === 'REJECTED' ? s(reason, 500) : null, at, id);
    return (await this.get(id))!;
  }

  async suppliers(): Promise<Supplier[]> { return (await this.db.all('SELECT * FROM suppliers ORDER BY lower(name), id')).map(this.sup); }
  async supplier(id: string): Promise<Supplier | null> { const r = await this.db.get('SELECT * FROM suppliers WHERE id = ?', id); return r ? this.sup(r) : null; }
  async addSupplier(b: Record<string, unknown>, by: string): Promise<Supplier> {
    const name = s(b.name, 120); if (!name) throw new BadQuote('Supplier name is required');
    const id = randomUUID();
    await this.db.run('INSERT INTO suppliers (id, name, contact, phone, wechat, city, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, name, s(b.contact, 120), s(b.phone, 60), s(b.wechat, 60), s(b.city, 80), s(b.notes, 2000), by, new Date().toISOString());
    return (await this.supplier(id))!;
  }
  async updateSupplier(id: string, b: Record<string, unknown>): Promise<Supplier | null> {
    const cur = await this.supplier(id); if (!cur) return null;
    const n = { ...cur, ...Object.fromEntries(['name', 'contact', 'phone', 'wechat', 'city', 'notes'].filter((k) => k in b).map((k) => [k, s(b[k], k === 'notes' ? 2000 : 120)])) };
    if (!n.name) throw new BadQuote('Supplier name is required');
    await this.db.run('UPDATE suppliers SET name=?, contact=?, phone=?, wechat=?, city=?, notes=? WHERE id=?', n.name, n.contact, n.phone, n.wechat, n.city, n.notes, id);
    return this.supplier(id);
  }

  async list(leadId: string): Promise<Quote[]> { return (await this.db.all(`${QuoteStore.SEL} WHERE q.lead_id = ? ORDER BY q.created_at, q.seq`, leadId)).map(this.q); }
  async bySupplier(supplierId: string): Promise<Quote[]> { return (await this.db.all(`${QuoteStore.SEL} WHERE q.supplier_id = ? ORDER BY q.created_at DESC, q.seq DESC`, supplierId)).map(this.q); }
  async get(id: string): Promise<Quote | null> { const r = await this.db.get(`${QuoteStore.SEL} WHERE q.id = ?`, id); return r ? this.q(r) : null; }
  async count(leadId: string): Promise<number> { return (await this.db.get('SELECT COUNT(*)::int c FROM quotes WHERE lead_id = ?', leadId))!.c; }

  private async china(b: Record<string, unknown>, cur?: Quote) {
    const has = (k: string) => k in b;
    const product = has('product') ? s(b.product, 200) : cur?.product ?? null;
    if (!product) throw new BadQuote('Product / model is required');
    const priceRaw = has('unitPrice') ? b.unitPrice : cur?.unitPrice;
    const unitPrice = typeof priceRaw === 'string' ? Number(priceRaw.replace(/,/g, '')) : Number(priceRaw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || priceRaw === '' || priceRaw == null) throw new BadQuote('Unit price must be a number');
    const currency = String(has('currency') ? b.currency : cur?.currency ?? '').toUpperCase().replace('RMB', 'CNY') as Currency;
    if (!CURRENCIES.includes(currency)) throw new BadQuote('Currency must be USD, RMB or INR');
    const supplierId = has('supplierId') ? s(b.supplierId, 64) : cur?.supplierId ?? null;
    if (supplierId && !(await this.supplier(supplierId))) throw new BadQuote('Unknown supplier');
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
  async create(leadId: string, b: Record<string, unknown>, by: string): Promise<Quote> {
    const c = await this.china(b); const id = randomUUID(), at = new Date().toISOString();
    await this.db.run(`INSERT INTO quotes (id, lead_id, supplier_id, product, unit_price, currency, moq, lead_time, validity, notes, created_by, created_at, updated_at,
      ship_cost, ship_currency, ship_term, ship_mode, ship_port, ship_transit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, leadId, c.supplierId, c.product, c.unitPrice, c.currency, c.moq, c.leadTime, c.validity, c.notes, by, at, at, c.shipCost, c.shipCurrency, c.shipTerm, c.shipMode, c.shipPort, c.shipTransit);
    return (await this.get(id))!;
  }
  async update(id: string, b: Record<string, unknown>): Promise<Quote> {
    const cur = (await this.get(id))!; const c = await this.china(b, cur);
    await this.db.run(`UPDATE quotes SET supplier_id=?, product=?, unit_price=?, currency=?, moq=?, lead_time=?, validity=?, notes=?, updated_at=?,
      ship_cost=?, ship_currency=?, ship_term=?, ship_mode=?, ship_port=?, ship_transit=? WHERE id=?`,
      c.supplierId, c.product, c.unitPrice, c.currency, c.moq, c.leadTime, c.validity, c.notes, new Date().toISOString(), c.shipCost, c.shipCurrency, c.shipTerm, c.shipMode, c.shipPort, c.shipTransit, id);
    return (await this.get(id))!;
  }
  /** India's customer-facing selling price on a quote (INR by default). */
  async setClient(id: string, b: Record<string, unknown>): Promise<Quote> {
    const cur = (await this.get(id))!;
    const raw = 'clientPrice' in b ? b.clientPrice : cur.clientPrice;
    let price: number | null = null;
    if (raw !== null && raw !== '' && raw !== undefined) {
      price = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw);
      if (!Number.isFinite(price) || price < 0) throw new BadQuote('Selling price must be a number');
    }
    const ccy = String(('clientCurrency' in b ? b.clientCurrency : cur.clientCurrency) ?? 'INR').toUpperCase().replace('RMB', 'CNY');
    if (!CURRENCIES.includes(ccy as Currency)) throw new BadQuote('Currency must be USD, RMB or INR');
    const notes = 'clientNotes' in b ? s(b.clientNotes, 2000) : cur.clientNotes;
    await this.db.run('UPDATE quotes SET client_price=?, client_currency=?, client_notes=?, updated_at=? WHERE id=?', price, price == null ? null : ccy, notes, new Date().toISOString(), id);
    return (await this.get(id))!;
  }
  async remove(id: string) { await this.db.run('DELETE FROM quotes WHERE id = ?', id); }
  async removeLead(leadId: string) { await this.db.run('DELETE FROM quotes WHERE lead_id = ?', leadId); }
  async deleteSupplier(id: string) { await this.db.run('DELETE FROM suppliers WHERE id = ?', id); } // quotes.supplier_id → NULL (FK)
}
