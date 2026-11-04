/**
 * India-side customer directory (PostgreSQL `customers`), the mirror of the China supplier directory.
 * Leads are linked automatically (dedupe by phone → email → company) by `sync()`, which also back-fills old leads.
 * China never reaches this store (routes are India + super admin only, gated by customers.view / customers.edit).
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export interface Customer {
  id: string; name: string; company: string | null; phone: string | null; whatsapp: string | null; email: string | null;
  city: string | null; state: string | null; country: string | null; gst: string | null; address: string | null; notes: string | null;
  tags: string[]; createdBy: string | null; createdAt: string; updatedAt: string;
}
export class BadCustomer extends Error { status = 400; }
const TEXT = ['name', 'company', 'phone', 'whatsapp', 'email', 'city', 'state', 'country', 'gst', 'address', 'notes'] as const;
const s = (v: unknown, max = 200) => { if (v == null) return null; const t = String(v).trim().slice(0, max); return t || null; };
export const phoneKey = (p?: string | null) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 6 ? d.slice(-10) : null; };
export const emailKey = (e?: string | null) => { const t = String(e ?? '').trim().toLowerCase(); return t.includes('@') ? t : null; };
export const companyKey = (c?: string | null) => { const t = String(c ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').replace(/\b(pvt|private|ltd|limited|llp|inc|co|company)\b/g, '').trim(); return t.length >= 2 ? t : null; };
const tagsOf = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean).map((x) => x.slice(0, 40)))].slice(0, 20);
const row = (r: any): Customer => ({ id: r.id, name: r.name, company: r.company, phone: r.phone, whatsapp: r.whatsapp, email: r.email, city: r.city, state: r.state,
  country: r.country, gst: r.gst, address: r.address, notes: r.notes, tags: r.tags ?? [], createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

export class CustomerStore {
  constructor(private db: Db) {}
  async list(): Promise<Customer[]> { return (await this.db.all('SELECT * FROM customers ORDER BY lower(name), id')).map(row); }
  async get(id: string): Promise<Customer | null> { const r = await this.db.get('SELECT * FROM customers WHERE id = ?', id); return r ? row(r) : null; }
  private clean(b: Record<string, unknown>, cur?: Customer) {
    const has = (k: string) => k in b;
    const v: Record<string, unknown> = {};
    for (const k of TEXT) v[k] = has(k) ? s(b[k], k === 'notes' || k === 'address' ? 2000 : 200) : cur ? (cur as any)[k] : null;
    v.tags = has('tags') ? tagsOf(b.tags) : cur?.tags ?? [];
    if (!v.name) v.name = v.company;
    if (!v.name) throw new BadCustomer('Customer name is required');
    if (v.email && !emailKey(v.email as string)) throw new BadCustomer('Email looks wrong');
    return v as Record<string, any>;
  }
  async add(b: Record<string, unknown>, by: string | null, db: Db = this.db): Promise<Customer> {
    const v = this.clean(b), id = randomUUID();
    await db.run(`INSERT INTO customers (id, name, company, phone, whatsapp, email, city, state, country, gst, address, notes, tags, phone_key, email_key, company_key, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, v.name, v.company, v.phone, v.whatsapp, v.email, v.city, v.state, v.country, v.gst, v.address, v.notes, v.tags,
      phoneKey(v.phone), emailKey(v.email), companyKey(v.company), by);
    return (await this.getIn(db, id))!;
  }
  private async getIn(db: Db, id: string) { const r = await db.get('SELECT * FROM customers WHERE id = ?', id); return r ? row(r) : null; }
  async update(id: string, b: Record<string, unknown>): Promise<Customer | null> {
    const cur = await this.get(id); if (!cur) return null;
    const v = this.clean(b, cur);
    await this.db.run(`UPDATE customers SET name=?, company=?, phone=?, whatsapp=?, email=?, city=?, state=?, country=?, gst=?, address=?, notes=?, tags=?,
      phone_key=?, email_key=?, company_key=?, updated_at=now() WHERE id=?`, v.name, v.company, v.phone, v.whatsapp, v.email, v.city, v.state, v.country, v.gst, v.address, v.notes, v.tags,
      phoneKey(v.phone), emailKey(v.email), companyKey(v.company), id);
    return this.get(id);
  }
  /** Merges `sources` into `target`: leads move over, empty fields are filled, tags united, notes appended; sources are deleted. */
  async merge(targetId: string, sources: string[]): Promise<Customer | null> {
    const ids = [...new Set(sources)].filter((x) => x && x !== targetId);
    return this.db.tx(async (t) => {
      const tg = await this.getIn(t, targetId); if (!tg) return null;
      const v: any = { ...tg };
      for (const sid of ids) {
        const sc = await this.getIn(t, sid); if (!sc) throw new BadCustomer('Unknown customer to merge');
        for (const k of TEXT) if (k !== 'notes' && !v[k] && (sc as any)[k]) v[k] = (sc as any)[k];
        if (sc.notes && sc.notes !== v.notes) v.notes = [v.notes, sc.notes].filter(Boolean).join('\n');
        v.tags = [...new Set([...v.tags, ...sc.tags])];
        await t.run('UPDATE leads SET customer_id = ? WHERE customer_id = ?', targetId, sid);
        await t.run('DELETE FROM customers WHERE id = ?', sid);
      }
      await t.run(`UPDATE customers SET name=?, company=?, phone=?, whatsapp=?, email=?, city=?, state=?, country=?, gst=?, address=?, notes=?, tags=?,
        phone_key=?, email_key=?, company_key=?, updated_at=now() WHERE id=?`, v.name, v.company, v.phone, v.whatsapp, v.email, v.city, v.state, v.country, v.gst, v.address, v.notes, v.tags,
        phoneKey(v.phone), emailKey(v.email), companyKey(v.company), targetId);
      return this.getIn(t, targetId);
    });
  }
  async leadCount(id: string) { return Number((await this.db.get('SELECT COUNT(*)::int AS n FROM leads WHERE customer_id = ?', id))?.n ?? 0); }
  async remove(id: string) { return this.db.run('DELETE FROM customers WHERE id = ?', id); }
  async link(leadId: string, customerId: string) { await this.db.run('UPDATE leads SET customer_id = ? WHERE id = ?', customerId, leadId); }
  async customerOf(leadId: string) { return (await this.db.get('SELECT customer_id FROM leads WHERE id = ?', leadId))?.customer_id ?? null; }
  /** Best existing match for contact details (phone, then email, then company). */
  async match(phone?: string | null, email?: string | null, company?: string | null, db: Db = this.db): Promise<string | null> {
    const pk = phoneKey(phone), ek = emailKey(email), ck = companyKey(company);
    for (const [col, k] of [['phone_key', pk], ['email_key', ek], ['company_key', ck]] as const) {
      if (!k) continue;
      const r = await db.get(`SELECT id FROM customers WHERE ${col} = ? ORDER BY created_at LIMIT 1`, k);
      if (r) return r.id;
    }
    return null;
  }
  /** Links every unlinked lead that has any contact detail to a matching customer, creating one when there is none. Returns how many leads were linked. */
  async sync(): Promise<number> {
    const rs = await this.db.all(`SELECT id, client_name, contact_name, contact_phone, contact_phone_code, contact_email, delivery_city FROM leads
      WHERE customer_id IS NULL AND (coalesce(contact_phone,'') <> '' OR coalesce(contact_email,'') <> '' OR coalesce(client_name,'') <> '' OR coalesce(contact_name,'') <> '')
      ORDER BY created_at, id`);
    let n = 0;
    for (const l of rs) {
      const phone = l.contact_phone ? `${l.contact_phone_code && !String(l.contact_phone).startsWith('+') ? l.contact_phone_code + ' ' : ''}${l.contact_phone}` : null;
      const company = l.client_name && l.client_name !== l.contact_name ? l.client_name : null;
      let cid = await this.match(phone, l.contact_email, company);
      if (!cid && !phoneKey(phone) && !emailKey(l.contact_email) && !companyKey(company)) {
        // Name only: reuse a same-name customer that also has no contact details, else create.
        const nm = l.contact_name || l.client_name;
        cid = (await this.db.get('SELECT id FROM customers WHERE lower(name) = lower(?) AND phone_key IS NULL AND email_key IS NULL LIMIT 1', nm))?.id ?? null;
      }
      if (!cid) cid = (await this.add({ name: l.contact_name || l.client_name || company || phone || l.contact_email, company, phone, email: l.contact_email, city: l.delivery_city,
        country: l.contact_phone_code === '+91' || /^\+?91/.test(String(phone ?? '')) ? 'India' : null }, null)).id;
      await this.link(l.id, cid); n++;
    }
    return n;
  }
  /** Activity per customer: leads, quotes sent, orders, INR totals, payment pending, shipments. */
  async stats(id?: string) {
    const rs = await this.db.all(`SELECT l.customer_id AS id, COUNT(DISTINCT l.id)::int AS leads, COUNT(DISTINCT cq.quote_id)::int AS quotes, COUNT(DISTINCT o.id)::int AS orders,
        COUNT(DISTINCT o.id) FILTER (WHERE o.payment_status <> 'PAID')::int AS payment_pending, COUNT(DISTINCT sh.id)::int AS shipments, MAX(l.created_at) AS last_lead_at
      FROM leads l LEFT JOIN quotes q ON q.lead_id = l.id LEFT JOIN customer_quotes cq ON cq.quote_id = q.id LEFT JOIN orders o ON o.lead_id = l.id
        LEFT JOIN shipments sh ON sh.lead_id = l.id
      WHERE l.customer_id IS NOT NULL ${id ? 'AND l.customer_id = ?' : ''} GROUP BY l.customer_id`, ...(id ? [id] : []));
    // Money summed separately (joins above would double count).
    const ms = await this.db.all(`SELECT l.customer_id AS id, COALESCE(SUM(o.qty * o.agreed_price),0)::float AS total,
        COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.qty * o.agreed_price ELSE o.advance END),0)::float AS paid
      FROM orders o JOIN leads l ON l.id = o.lead_id WHERE l.customer_id IS NOT NULL ${id ? 'AND l.customer_id = ?' : ''} GROUP BY l.customer_id`, ...(id ? [id] : []));
    const money = new Map(ms.map((m) => [m.id, m]));
    return new Map(rs.map((r) => { const m = money.get(r.id); const total = Number(m?.total ?? 0), paid = Number(m?.paid ?? 0);
      return [r.id as string, { leads: r.leads, quotes: r.quotes, orders: r.orders, orderTotal: total, paid, due: Math.max(0, total - paid), paymentPending: r.payment_pending, shipments: r.shipments, lastLeadAt: r.last_lead_at ?? null }]; }));
  }
}
export const NO_STATS = { leads: 0, quotes: 0, orders: 0, orderTotal: 0, paid: 0, due: 0, paymentPending: 0, shipments: 0, lastLeadAt: null };
