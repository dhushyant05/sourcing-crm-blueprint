/**
 * Shipping Requests (SH-YYMM-NNNN): a first-class object owned by exactly one customer (`customer_id`, never inferred from contact details).
 *  - SOURCED: continues one of our orders (lead + order of the same customer); tracking comes from that order's Shipment.
 *  - FREIGHT_ONLY: the customer's own goods. India reviews, sends a freight quote; the customer must ACCEPT it before India can book.
 * Events are internal unless the kind is in SR_CUSTOMER_TEXT (fixed text; the only free text a customer sees is the
 * "more info needed" question, which staff write for the customer on purpose).
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { yymmOf } from './refs.js';
import { INCOTERMS, SHIP_MODES } from './quotes.js';

export const SR_KINDS = ['SOURCED', 'FREIGHT_ONLY'] as const;
export const SR_OPEN = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED'] as const; // before acceptance
export const SR_STAGES = ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const; // freight-only tracking (India)
export const SR_STATUS = [...SR_OPEN, 'ACCEPTED', ...SR_STAGES, 'REJECTED', 'CANCELLED'] as const;
export const SR_REF_RE = /^SH-(\d{4})-(\d{4,})$/;
export const STAGE_LABEL: Record<string, string> = { PENDING: 'Awaiting booking', BOOKED: 'Booked', IN_TRANSIT: 'In transit', ARRIVED: 'Arrived', CUSTOMS: 'In customs',
  CLEARED: 'Customs cleared', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered' };

export class SrError extends Error { constructor(msg: string, public status = 400, public code?: string) { super(msg); } }

/** Customer-visible kinds and their only text. */
export const SR_CUSTOMER_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  SR_CREATED: () => 'Shipping request received',
  SR_REVIEW: () => 'Being reviewed by Source Easy',
  SR_NEEDS_INFO: () => 'More information needed',
  SR_REPLIED: () => 'You sent more information',
  FQ_SENT: (d) => `Freight quote F${d.n} ready for you`,
  FQ_ACCEPTED: (d) => `Freight quote F${d.n} accepted`,
  FQ_REJECTED: (d) => `Freight quote F${d.n} declined`,
  FQ_WITHDRAWN: (d) => `Freight quote F${d.n} withdrawn`,
  FQ_DELETED: (d) => `Freight quote F${d.n} withdrawn`,
  FQ_REVISED: (d) => `Freight quote F${d.n} updated`,
  FQ_REVERTED: (d) => `Freight quote F${d.n} reopened for your decision`,
  SR_ACCEPTED: () => 'Accepted, booking next',
  SR_STAGE: (d) => `Shipment ${STAGE_LABEL[String(d.status)] ?? 'updated'}`,
  SR_REJECTED: () => 'Request declined by Source Easy',
  SR_CANCELLED: () => 'Request cancelled',
};
const srText = (kind: string, d: Record<string, unknown>) => {
  const f = SR_CUSTOMER_TEXT[kind]; if (!f) return null;
  const n = Number(d.n), safe: Record<string, unknown> = {};
  if (Number.isInteger(n) && n > 0 && n < 1000) safe.n = n;
  if (STAGE_LABEL[String(d.status)]) safe.status = d.status;
  return f(safe);
};

export interface ShippingRequest {
  id: string; ref: string; kind: string; customerId: string; createdByKind: string; createdBy: string | null; leadId: string | null; orderId: string | null;
  goods: string; quantity: number | null; unit: string | null; packages: number | null; weightKg: number | null; cbm: number | null;
  shipperName: string | null; shipperPhone: string | null; pickupAddress: string | null; pickupCity: string | null;
  destCity: string | null; destAddress: string | null; destPincode: string | null; mode: string | null; incoterm: string | null; readyDate: string | null;
  customerNote: string | null; status: string; question: string | null; carrier: string | null; tracking: string | null; container: string | null;
  etd: string | null; eta: string | null; deliveredAt: string | null; ownerOffice: string; assignedTo: string | null; internalNote: string | null; rejectReason: string | null;
  createdAt: string; updatedAt: string;
}
export interface FreightQuote { id: string; requestId: string; n: number; amount: number; currency: string; mode: string | null; incoterm: string | null; transit: string | null;
  validUntil: string | null; customerNote: string | null; internalCost: number | null; status: string; reasonCode: string | null; reason: string | null; createdBy: string | null; createdAt: string; decidedAt: string | null; revision: number; customerRev: number }

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const d10 = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const row = (r: any): ShippingRequest => ({ id: r.id, ref: r.ref, kind: r.kind, customerId: r.customer_id, createdByKind: r.created_by_kind, createdBy: r.created_by, leadId: r.lead_id, orderId: r.order_id,
  goods: r.goods, quantity: num(r.quantity), unit: r.unit, packages: num(r.packages), weightKg: num(r.weight_kg), cbm: num(r.cbm),
  shipperName: r.shipper_name, shipperPhone: r.shipper_phone, pickupAddress: r.pickup_address, pickupCity: r.pickup_city, destCity: r.dest_city, destAddress: r.dest_address, destPincode: r.dest_pincode,
  mode: r.mode, incoterm: r.incoterm, readyDate: d10(r.ready_date), customerNote: r.customer_note, status: r.status, question: r.question, carrier: r.carrier, tracking: r.tracking, container: r.container,
  etd: d10(r.etd), eta: d10(r.eta), deliveredAt: d10(r.delivered_at), ownerOffice: r.owner_office, assignedTo: r.assigned_to, internalNote: r.internal_note, rejectReason: r.reject_reason,
  createdAt: r.created_at, updatedAt: r.updated_at });
const fq = (r: any): FreightQuote => ({ id: r.id, requestId: r.request_id, n: Number(r.n), amount: Number(r.amount), currency: r.currency, mode: r.mode, incoterm: r.incoterm, transit: r.transit,
  validUntil: d10(r.valid_until), customerNote: r.customer_note, internalCost: num(r.internal_cost), status: r.status, reasonCode: r.reason_code, reason: r.reason, createdBy: r.created_by,
  createdAt: r.created_at, decidedAt: r.decided_at , revision: Number(r.revision ?? 1), customerRev: Number(r.customer_rev ?? 1) });

const str = (v: unknown, max = 200) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };
const pos = (v: unknown, what: string, int = false) => {
  if (v == null || v === '') return null; const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9 || (int && !Number.isInteger(n))) throw new SrError(`${what} must be a positive ${int ? 'whole ' : ''}number`, 400, 'invalid');
  return n;
};
const date = (v: unknown, what: string) => { const t = str(v, 10); if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new SrError(`${what} must be YYYY-MM-DD`, 400, 'invalid'); return t; };
const oneOf = (v: unknown, list: readonly string[], what: string) => { const t = str(v, 20)?.toUpperCase() ?? null; if (t && !list.includes(t)) throw new SrError(`${what} must be one of ${list.join(', ')}`, 400, 'invalid'); return t; };

/** Fields a customer may set (create / reply); staff may also set mode/incoterm etc. via `edit`. */
export const CUSTOMER_FIELDS = ['goods', 'quantity', 'unit', 'packages', 'weightKg', 'cbm', 'shipperName', 'shipperPhone', 'pickupAddress', 'pickupCity',
  'destCity', 'destAddress', 'destPincode', 'mode', 'incoterm', 'readyDate', 'customerNote'] as const;
const COL: Record<string, string> = { goods: 'goods', quantity: 'quantity', unit: 'unit', packages: 'packages', weightKg: 'weight_kg', cbm: 'cbm', shipperName: 'shipper_name',
  shipperPhone: 'shipper_phone', pickupAddress: 'pickup_address', pickupCity: 'pickup_city', destCity: 'dest_city', destAddress: 'dest_address', destPincode: 'dest_pincode',
  mode: 'mode', incoterm: 'incoterm', readyDate: 'ready_date', customerNote: 'customer_note', internalNote: 'internal_note' };
export function cleanFields(b: Record<string, unknown>, allowed: readonly string[]) {
  const v: Record<string, unknown> = {};
  for (const k of allowed) {
    if (!(k in b)) continue; const x = b[k];
    v[k] = k === 'quantity' || k === 'weightKg' || k === 'cbm' ? pos(x, k) : k === 'packages' ? pos(x, 'Packages', true)
      : k === 'mode' ? oneOf(x, SHIP_MODES, 'Mode') : k === 'incoterm' ? oneOf(x, INCOTERMS, 'Incoterm') : k === 'readyDate' ? date(x, 'Ready date')
      : k === 'destPincode' ? (() => { const t = str(x, 12); if (t && !/^[0-9A-Za-z -]{3,12}$/.test(t)) throw new SrError('Pincode looks wrong', 400, 'invalid'); return t; })()
      : str(x, k === 'goods' || k === 'customerNote' || k === 'internalNote' || k === 'pickupAddress' || k === 'destAddress' ? 1000 : 120);
  }
  return v;
}

export class ShippingStore {
  constructor(private db: Db) {}
  async nextRef(at = new Date(), db: Db = this.db) {
    const k = yymmOf(at);
    const r = await db.get<{ n: number }>('INSERT INTO ref_counters (yymm, n) VALUES (?, 1) ON CONFLICT (yymm) DO UPDATE SET n = ref_counters.n + 1 RETURNING n', `SH${k}`);
    return `SH-${k}-${String(r!.n).padStart(4, '0')}`;
  }
  async get(id: string) { const r = await this.db.get('SELECT * FROM shipping_requests WHERE id = ?', id); return r ? row(r) : null; }
  /** Strict ownership lookup for the portal. */
  async getOwned(id: string, customerId: string) { const r = await this.db.get('SELECT * FROM shipping_requests WHERE id = ? AND customer_id = ?', id, customerId); return r ? row(r) : null; }
  async list(f: { customerId?: string; status?: string } = {}) {
    const w: string[] = [], p: unknown[] = [];
    if (f.customerId) { w.push('customer_id = ?'); p.push(f.customerId); }
    if (f.status) { w.push('status = ?'); p.push(f.status); }
    return (await this.db.all(`SELECT * FROM shipping_requests ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC, id LIMIT 500`, ...p)).map(row);
  }
  async activeForOrder(orderId: string) { const r = await this.db.get("SELECT * FROM shipping_requests WHERE order_id = ? AND status NOT IN ('REJECTED','CANCELLED')", orderId); return r ? row(r) : null; }
  async create(x: { kind: string; customerId: string; createdByKind: 'CUSTOMER' | 'STAFF'; createdBy: string | null; leadId?: string | null; orderId?: string | null; fields: Record<string, unknown> }, db: Db = this.db) {
    if (!SR_KINDS.includes(x.kind as never)) throw new SrError('Kind must be SOURCED or FREIGHT_ONLY', 400, 'invalid');
    const f = x.fields; if (!f.goods) throw new SrError('Describe the goods to ship', 400, 'required');
    if (x.kind === 'FREIGHT_ONLY' && (x.leadId || x.orderId)) throw new SrError('A freight-only request has no sourcing lead or order', 400, 'invalid');
    if (x.kind === 'SOURCED' && !x.orderId) throw new SrError('Choose the order to ship', 400, 'required');
    if (!f.destCity) throw new SrError('Destination city is required', 400, 'required');
    if (x.kind === 'FREIGHT_ONLY' && !f.pickupCity && !f.pickupAddress) throw new SrError('Pickup city or address is required', 400, 'required');
    const id = randomUUID(), ref = await this.nextRef(new Date(), db);
    const ks = Object.keys(f);
    await db.run(`INSERT INTO shipping_requests (id, ref, kind, customer_id, created_by_kind, created_by, lead_id, order_id${ks.map((k) => ', ' + COL[k]).join('')})
      VALUES (?,?,?,?,?,?,?,?${ks.map(() => ',?').join('')})`, id, ref, x.kind, x.customerId, x.createdByKind, x.createdBy, x.leadId ?? null, x.orderId ?? null, ...ks.map((k) => f[k]));
    return (await this.getIn(db, id))!;
  }
  private async getIn(db: Db, id: string) { const r = await db.get('SELECT * FROM shipping_requests WHERE id = ?', id); return r ? row(r) : null; }
  async edit(id: string, f: Record<string, unknown>, db: Db = this.db) {
    const ks = Object.keys(f).filter((k) => COL[k]); if (!ks.length) return this.getIn(db, id);
    await db.run(`UPDATE shipping_requests SET ${ks.map((k) => `${COL[k]} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, ...ks.map((k) => f[k]), id);
    return this.getIn(db, id);
  }
  /** Compare-and-set status change: fails (409) when the request moved meanwhile. */
  async setStatus(id: string, from: readonly string[], to: string, extra: Record<string, unknown> = {}, db: Db = this.db) {
    const cols: Record<string, string> = { question: 'question', assignedTo: 'assigned_to', rejectReason: 'reject_reason', carrier: 'carrier', tracking: 'tracking', container: 'container', etd: 'etd', eta: 'eta', deliveredAt: 'delivered_at' };
    const ks = Object.keys(extra).filter((k) => cols[k]);
    const n = await db.run(`UPDATE shipping_requests SET status = ?${ks.map((k) => `, ${cols[k]} = ?`).join('')}, updated_at = now() WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
      to, ...ks.map((k) => extra[k]), id, ...from);
    if (!n) throw new SrError('This request has changed, refresh and try again', 409, 'state');
    return (await this.getIn(db, id))!;
  }
  async assign(id: string, userId: string | null, db: Db = this.db) { await db.run('UPDATE shipping_requests SET assigned_to = ?, updated_at = now() WHERE id = ?', userId, id); return this.getIn(db, id); }
  async log(id: string, kind: string, actor: { kind: 'CUSTOMER' | 'STAFF' | 'SYSTEM'; id: string | null; name: string | null }, data: Record<string, unknown> = {}, db: Db = this.db, customerText?: string | null) {
    const text = customerText !== undefined ? customerText : srText(kind, data);
    await db.run('INSERT INTO shipping_request_events (request_id, kind, actor_kind, actor_id, actor_name, data, customer_visible, customer_text) VALUES (?,?,?,?,?,?,?,?)',
      id, kind, actor.kind, actor.id, actor.name, JSON.stringify(data), !!text, text ?? null);
  }
  async events(id: string) { return this.db.all('SELECT at, kind, actor_kind, actor_name, data, customer_visible, customer_text FROM shipping_request_events WHERE request_id = ? ORDER BY id', id); }
  async customerEvents(id: string): Promise<{ at: string; kind: string; text: string }[]> {
    return (await this.db.all('SELECT at, kind, customer_text FROM shipping_request_events WHERE request_id = ? AND customer_visible ORDER BY id', id))
      .filter((r: any) => r.customer_text).map((r: any) => ({ at: r.at, kind: r.kind, text: r.customer_text }));
  }
  // ---- freight quotes ----
  /** Visible quotes only: soft-deleted ones stay in the table (audit, numbering) but never reach lists, PDFs or decisions. */
  async quotes(requestId: string) { return (await this.db.all('SELECT * FROM freight_quotes WHERE request_id = ? AND deleted_at IS NULL ORDER BY n', requestId)).map(fq); }
  async quote(id: string) { const r = await this.db.get('SELECT * FROM freight_quotes WHERE id = ? AND deleted_at IS NULL', id); return r ? fq(r) : null; }
  private async snapshot(db: Db, id: string, action: string, reason: string, by: string) {
    const r: any = await db.get('SELECT * FROM freight_quotes WHERE id = ?', id);
    await db.run('INSERT INTO freight_quote_revisions (quote_id, revision, snapshot, action, reason, by_user) VALUES (?,?,?,?,?,?)', id, Number(r.revision ?? 1), JSON.stringify(fq(r)), action, reason, by);
  }
  /** Super admin: edit an outstanding (SENT) quote in place, keeping an immutable copy of the previous revision. */
  async editQuote(id: string, b: Record<string, unknown>, reason: string, by: string, db: Db = this.db) {
    const v: Record<string, unknown> = {};
    if ('amount' in b) { const a = pos(b.amount, 'Amount'); if (!a) throw new SrError('Amount is required', 400, 'required'); v.amount = a; }
    if ('mode' in b) v.mode = oneOf(b.mode, SHIP_MODES, 'Mode');
    if ('incoterm' in b) v.incoterm = oneOf(b.incoterm, INCOTERMS, 'Incoterm');
    if ('transit' in b) v.transit = str(b.transit, 60);
    if ('validUntil' in b) v.valid_until = date(b.validUntil, 'Valid until');
    if ('customerNote' in b) v.customer_note = str(b.customerNote, 1000);
    if ('internalCost' in b) v.internal_cost = pos(b.internalCost, 'Internal cost');
    // Row lock first: a concurrent customer accept either commits before us (then status is no longer SENT and we refuse)
    // or waits and then fails its version check because customer_rev moved.
    const cur: any = await db.get("SELECT * FROM freight_quotes WHERE id = ? AND status = 'SENT' AND deleted_at IS NULL FOR UPDATE", id);
    if (!cur) throw new SrError('Only an outstanding (sent) freight quote can be edited; revert an accepted one first', 409, 'state');
    const same = (a: unknown, b: unknown) => (a == null ? null : String(Number.isFinite(Number(a)) && a !== '' ? Number(a) : a)) === (b == null ? null : String(Number.isFinite(Number(b)) && b !== '' ? Number(b) : b));
    const ks = Object.keys(v).filter((k) => !same(cur[k], v[k])); if (!ks.length) throw new SrError('Nothing to change', 400, 'required');
    const customerFacing = ks.some((k) => k !== 'internal_cost');
    await this.snapshot(db, id, 'EDIT', reason, by);
    const n = await db.run(`UPDATE freight_quotes SET ${ks.map((k) => `${k} = ?`).join(', ')}, revision = revision + 1${customerFacing ? ', customer_rev = customer_rev + 1' : ''} WHERE id = ? AND status = 'SENT' AND deleted_at IS NULL`, ...ks.map((k) => v[k]), id);
    if (!n) throw new SrError('Only an outstanding (sent) freight quote can be edited; revert an accepted one first', 409, 'state');
    return { quote: fq(await db.get('SELECT * FROM freight_quotes WHERE id = ?', id)), fields: ks };
  }
  /** Super admin: accepted → SENT again (customer decides again). Atomic with the caller's request-status change. */
  async revertQuote(id: string, reason: string, by: string, db: Db = this.db) {
    await this.snapshot(db, id, 'REVERT', reason, by);
    const n = await db.run("UPDATE freight_quotes SET status = 'SENT', decided_at = NULL, reason_code = NULL, reason = NULL, revision = revision + 1 WHERE id = ? AND status = 'ACCEPTED' AND deleted_at IS NULL", id);
    if (!n) throw new SrError('This freight quote is no longer accepted', 409, 'state');
  }
  /** Super admin: soft delete (never an accepted quote — revert it first). */
  async deleteQuote(id: string, reason: string, by: string, db: Db = this.db) {
    await this.snapshot(db, id, 'DELETE', reason, by);
    const n = await db.run("UPDATE freight_quotes SET deleted_at = now(), deleted_by = ?, delete_reason = ? WHERE id = ? AND status <> 'ACCEPTED' AND deleted_at IS NULL", by, reason, id);
    if (!n) throw new SrError('An accepted freight quote cannot be deleted; revert it first', 409, 'state');
  }
  async revisions(id: string) { return this.db.all('SELECT revision, snapshot, action, reason, by_user, at FROM freight_quote_revisions WHERE quote_id = ? ORDER BY id', id); }
  async addQuote(requestId: string, b: Record<string, unknown>, by: string, db: Db = this.db) {
    const amount = pos(b.amount, 'Amount'); if (!amount) throw new SrError('Amount is required', 400, 'required');
    const v = { mode: oneOf(b.mode, SHIP_MODES, 'Mode'), incoterm: oneOf(b.incoterm, INCOTERMS, 'Incoterm'), transit: str(b.transit, 60), validUntil: date(b.validUntil, 'Valid until'),
      customerNote: str(b.customerNote, 1000), internalCost: pos(b.internalCost, 'Internal cost') };
    await db.run("UPDATE freight_quotes SET status = 'WITHDRAWN', decided_at = now() WHERE request_id = ? AND status = 'SENT'", requestId);
    const n = Number((await db.get('SELECT COALESCE(MAX(n),0)::int AS n FROM freight_quotes WHERE request_id = ?', requestId))!.n) + 1, id = randomUUID();
    await db.run(`INSERT INTO freight_quotes (id, request_id, n, amount, currency, mode, incoterm, transit, valid_until, customer_note, internal_cost, created_by) VALUES (?,?,?,?,'INR',?,?,?,?,?,?,?)`,
      id, requestId, n, amount, v.mode, v.incoterm, v.transit, v.validUntil, v.customerNote, v.internalCost, by);
    return fq(await db.get('SELECT * FROM freight_quotes WHERE id = ?', id));
  }
  /** `seen` (required for ACCEPTED): the customer-visible version, amount and currency the customer was shown. Compare-and-set in one UPDATE. */
  async decideQuote(id: string, status: 'ACCEPTED' | 'REJECTED', why: { code?: string | null; reason?: string | null } = {}, db: Db = this.db, seen?: { version: number; amount: number; currency: string }) {
    if (status === 'ACCEPTED' && !seen) throw new SrError('Please refresh and review the latest quote', 409, 'update_required');
    const extra = seen ? ' AND customer_rev = ? AND amount = ? AND currency = ?' : '';
    const n = await db.run(`UPDATE freight_quotes SET status = ?, reason_code = ?, reason = ?, decided_at = now() WHERE id = ? AND status = 'SENT' AND deleted_at IS NULL${extra}`, status, why.code ?? null, why.reason ?? null, id, ...(seen ? [seen.version, seen.amount, seen.currency] : []));
    if (!n) {
      if (seen && await db.get("SELECT 1 FROM freight_quotes WHERE id = ? AND status = 'SENT' AND deleted_at IS NULL", id)) throw new SrError('This quote was updated. Please review the new amount and terms before accepting.', 409, 'stale');
      throw new SrError('This freight quote was already decided or withdrawn', 409, 'decided');
    }
  }
  async hasAccepted(requestId: string) { return !!(await this.db.get("SELECT 1 FROM freight_quotes WHERE request_id = ? AND status = 'ACCEPTED'", requestId)); }
  // ---- files ----
  async addFiles(requestId: string, fileIds: string[], byKind: 'CUSTOMER' | 'STAFF') {
    for (const f of fileIds) await this.db.run('INSERT INTO shipping_request_files (request_id, file_id, uploaded_by_kind, customer_visible) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', requestId, f, byKind, byKind === 'CUSTOMER');
  }
  async customerFileIds(requestId: string) { return new Set((await this.db.all('SELECT file_id FROM shipping_request_files WHERE request_id = ? AND customer_visible', requestId)).map((r: any) => r.file_id as string)); }
}
export const srKey = (id: string) => `sr_${id}`;
