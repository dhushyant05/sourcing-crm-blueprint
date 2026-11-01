/**
 * Leads (PostgreSQL `leads`). Records keep the field names and composite shapes the web and mobile apps
 * already use (contactPhone {primaryPhoneNumber…}, contactEmail {primaryEmail}, targetPrice {amountMicros, currencyCode},
 * referenceUrl / chatwootConversationUrl {primaryLinkUrl}), so the API contract did not change when Twenty was removed.
 * Ownership/priority columns on the same row are handled by AssignStore / WorkflowStore, never returned here.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export type Rec = Record<string, unknown>;

/** Plain text/number fields: API name → column. */
const SIMPLE: Record<string, string> = {
  leadRef: 'lead_ref', name: 'name', clientName: 'client_name', contactName: 'contact_name', productInterest: 'product_interest',
  quantity: 'quantity', unit: 'unit', deliveryCity: 'delivery_city', enquiryMessage: 'enquiry_message', summary: 'summary',
  attachmentCount: 'attachment_count', sourceChannel: 'source_channel', status: 'status', assignedOffice: 'assigned_office',
  assignedChinaAgent: 'assigned_china_agent', winLossReason: 'win_loss_reason', office: 'office', clientRef: 'client_ref',
};
const NUMERIC = new Set(['quantity', 'attachmentCount']);
export const LEAD_FIELDS = [...Object.keys(SIMPLE), 'contactPhone', 'contactEmail', 'targetPrice', 'referenceUrl', 'chatwootConversationUrl'];

const str = (v: unknown) => (v == null || v === '' ? null : String(v));
const toNum = (v: unknown) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export function toRecord(r: any): Rec {
  const o: Rec = { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at };
  for (const [k, c] of Object.entries(SIMPLE)) o[k] = r[c] ?? null;
  o.attachmentCount = r.attachment_count ?? 0;
  o.contactPhone = { primaryPhoneNumber: r.contact_phone ?? '', primaryPhoneCountryCode: r.contact_phone_country ?? '', primaryPhoneCallingCode: r.contact_phone_code ?? '', additionalPhones: null };
  o.contactEmail = { primaryEmail: r.contact_email ?? '', additionalEmails: null };
  o.targetPrice = { amountMicros: r.target_price == null ? null : Math.round(Number(r.target_price) * 1e6), currencyCode: r.target_currency ?? '' };
  o.referenceUrl = { primaryLinkUrl: r.reference_url ?? '', primaryLinkLabel: '', secondaryLinks: null };
  o.chatwootConversationUrl = { primaryLinkUrl: r.chatwoot_url ?? '', primaryLinkLabel: '', secondaryLinks: null };
  return o;
}

/** API patch → column values. Composite fields accept the object shape (partial) or a plain string. */
function toColumns(d: Rec): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k in SIMPLE) c[SIMPLE[k]] = NUMERIC.has(k) ? (k === 'attachmentCount' ? toNum(v) ?? 0 : toNum(v)) : str(v);
    else if (k === 'contactPhone') {
      if (v && typeof v === 'object') { const p = v as Rec;
        if ('primaryPhoneNumber' in p) c.contact_phone = str(p.primaryPhoneNumber);
        if ('primaryPhoneCallingCode' in p) c.contact_phone_code = str(p.primaryPhoneCallingCode);
        if ('primaryPhoneCountryCode' in p) c.contact_phone_country = str(p.primaryPhoneCountryCode);
      } else c.contact_phone = str(v);
    } else if (k === 'contactEmail') c.contact_email = str(v && typeof v === 'object' ? (v as Rec).primaryEmail : v);
    else if (k === 'targetPrice') {
      if (v && typeof v === 'object') { const p = v as Rec;
        if ('amountMicros' in p) { const n = toNum(p.amountMicros); c.target_price = n == null ? null : n / 1e6; }
        if ('currencyCode' in p) c.target_currency = str(p.currencyCode);
      } else if (v == null) { c.target_price = null; c.target_currency = null; }
    } else if (k === 'referenceUrl') c.reference_url = str(v && typeof v === 'object' ? (v as Rec).primaryLinkUrl : v);
    else if (k === 'chatwootConversationUrl') c.chatwoot_url = str(v && typeof v === 'object' ? (v as Rec).primaryLinkUrl : v);
  }
  return c;
}
const FILTER_COLS: Record<string, string> = { ...SIMPLE, id: 'id' };

export class LeadStore {
  constructor(private db: Db) {}
  /** Equality filters on API field names (unknown keys match nothing). Newest first. */
  async list(filter: Record<string, string> = {}): Promise<Rec[]> {
    const where: string[] = [], args: unknown[] = [];
    for (const [k, v] of Object.entries(filter)) {
      const c = FILTER_COLS[k]; if (!c) return [];
      where.push(`${c}::text = ?`); args.push(String(v));
    }
    return (await this.db.all(`SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id`, ...args)).map(toRecord);
  }
  async get(id: string): Promise<Rec | null> { const r = await this.db.get('SELECT * FROM leads WHERE id = ?', id); return r ? toRecord(r) : null; }
  async create(data: Rec): Promise<Rec> {
    const id = typeof data.id === 'string' && data.id ? data.id : randomUUID();
    const c = toColumns(data);
    if (typeof data.createdAt === 'string') c.created_at = data.createdAt;
    const ks = Object.keys(c);
    await this.db.run(`INSERT INTO leads (id${ks.map((k) => ', ' + k).join('')}) VALUES (?${', ?'.repeat(ks.length)})`, id, ...ks.map((k) => c[k]));
    return (await this.get(id))!;
  }
  async update(id: string, data: Rec): Promise<Rec> {
    const c = toColumns(data), ks = Object.keys(c);
    if (ks.length) await this.db.run(`UPDATE leads SET ${ks.map((k) => `${k} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, ...ks.map((k) => c[k]), id);
    const r = await this.get(id);
    if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
    return r;
  }
  async remove(id: string) { await this.db.run('DELETE FROM leads WHERE id = ?', id); }
  async refs(): Promise<string[]> { return (await this.db.all('SELECT lead_ref FROM leads WHERE lead_ref IS NOT NULL')).map((r) => r.lead_ref); }
}
