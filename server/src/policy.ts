/**
 * Server-side data separation between the India (customer) and China (supplier) offices.
 * Every record coming out of Twenty passes through `readFilter` and every write through `writeCheck`.
 * Field names follow twenty-setup/schema.json (+ Twenty standard fields id/name/createdAt/updatedAt
 * and relation foreign keys `<relation>Id`).
 */
import { sides, type Role } from './roles.js';

export type Rec = Record<string, unknown>;
export const OBJECTS = {
  lead: 'leads', sourcingRequest: 'sourcingRequests', supplier: 'suppliers', quotation: 'quotations',
  clientApproval: 'clientApprovals', shippingOrder: 'shippingOrders', exchangeRate: 'exchangeRates', teamMember: 'teamMembers',
} as const;
export type ObjectName = keyof typeof OBJECTS;
export const PLURAL_TO_OBJECT = Object.fromEntries(Object.entries(OBJECTS).map(([k, v]) => [v, k])) as Record<string, ObjectName>;

const STD = ['id', 'name', 'createdAt', 'updatedAt', 'office', 'clientRef'];

/** Every custom field per object (schema.json) + relation ids. Anything not listed is never returned. */
export const FIELDS: Record<ObjectName, string[]> = {
  lead: [...STD, 'clientName', 'contactPhone', 'contactEmail', 'productInterest', 'quantity', 'targetPrice', 'sourceChannel',
    'status', 'assignedOffice', 'assignedChinaAgent', 'chatwootConversationUrl', 'winLossReason'],
  sourcingRequest: [...STD, 'productDescription', 'quantity', 'targetPrice', 'deadline', 'assignedChinaAgent', 'sampleStatus',
    'status', 'chatwootThreadUrl', 'chatwootConversationId', 'leadId'],
  supplier: [...STD, 'phone', 'wechatId', 'notes', 'sourcingRequestId'],
  quotation: [...STD, 'unitCost', 'totalCost', 'currency', 'exchangeRateUsed', 'inrEquivalent', 'clientUnitPriceInr',
    'validityDate', 'pdfAttachment', 'sourcingRequestId', 'supplierId'],
  clientApproval: [...STD, 'status', 'approver', 'decidedAt', 'notes', 'quotationId'],
  shippingOrder: [...STD, 'forwarder', 'trackingNumber', 'containerType', 'etd', 'eta', 'customsStatus', 'shipmentStatus',
    'currentLocation', 'latitude', 'longitude', 'leadId', 'quotationId'],
  exchangeRate: [...STD, 'currencyPair', 'rate', 'source', 'isManualOverride', 'setBy', 'effectiveDate'],
  teamMember: [...STD, 'email', 'role', 'chatwootAgentId'],
};

/** Customer-identifying lead fields. China never sees them. */
const LEAD_CHINA = ['id', 'createdAt', 'updatedAt', 'office', 'productInterest', 'quantity', 'status', 'assignedOffice', 'assignedChinaAgent'];
/** Supplier identity / raw cost on a quotation. India never sees them. */
const QUOTE_INDIA = ['id', 'name', 'createdAt', 'updatedAt', 'office', 'inrEquivalent', 'clientUnitPriceInr', 'validityDate', 'pdfAttachment', 'sourcingRequestId'];
const QUOTE_CHINA = FIELDS.quotation.filter((f) => f !== 'clientUnitPriceInr' && f !== 'pdfAttachment');
const APPROVAL_CHINA = ['id', 'createdAt', 'updatedAt', 'status', 'decidedAt', 'quotationId'];

export interface Rates { CNY_INR: number; USD_INR: number; USD_CNY?: number }
export interface Ctx { role: Role; rates: Rates }

const pick = (r: Rec, keys: string[]) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
export class Forbidden extends Error { status = 403; }

/** Latest effective date wins; manual override wins on the same day (same rule as web + mobile). */
export function ratesFrom(list: Rec[]): Rates {
  const best = (pair: string) => list.filter((r) => r.currencyPair === pair)
    .sort((a, b) => String(b.effectiveDate ?? '').localeCompare(String(a.effectiveDate ?? '')) || Number(!!b.isManualOverride) - Number(!!a.isManualOverride))[0]?.rate as number | undefined;
  return { CNY_INR: best('CNY_INR') ?? 11.8, USD_INR: best('USD_INR') ?? 84, USD_CNY: best('USD_CNY') };
}
export const toInr = (currency: unknown, r: Rates) => (currency === 'USD' ? r.USD_INR : r.CNY_INR);

/** Which objects a role may read at all. */
export function canRead(role: Role, obj: ObjectName): boolean {
  const s = sides(role);
  switch (obj) {
    case 'supplier': return s.china;
    case 'teamMember': return s.admin;
    default: return true;
  }
}

/** Strip fields and drop records the role must not see. Returns null when the record is hidden. */
export function readFilter(obj: ObjectName, rec: Rec, ctx: Ctx): Rec | null {
  const s = sides(ctx.role);
  if (!canRead(ctx.role, obj)) return null;
  const base = pick(rec, FIELDS[obj]);
  if (s.superAdmin) return obj === 'quotation' ? withInr(base, ctx.rates) : base;
  switch (obj) {
    case 'lead':
      if (s.india) return base;
      // China works only on leads handed to China, and never sees the client.
      if (rec.assignedOffice !== 'CHINA') return null;
      return { ...pick(base, LEAD_CHINA), name: `Lead ${String(rec.id).slice(0, 8)}` };
    case 'quotation':
      if (s.india) {
        const q = withInr(base, ctx.rates);
        return { ...pick(q, QUOTE_INDIA), unitCostInr: q.unitCostInr, currency: 'INR' };
      }
      return pick(base, QUOTE_CHINA);
    case 'clientApproval':
      return s.india ? base : pick(base, APPROVAL_CHINA);
    case 'sourcingRequest':
      // targetPrice on a sourcing request is the China-side target (RMB/USD); India sees it converted.
      if (s.india) return { ...base, targetPrice: inrMoney(base.targetPrice, ctx.rates) };
      return base;
    case 'teamMember': {
      const role = String(rec.role ?? '');
      const mine = s.india ? role.startsWith('INDIA') : role.startsWith('CHINA');
      return mine ? base : null;
    }
    default:
      return base;
  }
}

function withInr(q: Rec, r: Rates): Rec {
  const rate = (q.exchangeRateUsed as number) || toInr(q.currency, r);
  const unit = typeof q.unitCost === 'number' ? round(q.unitCost * rate) : undefined;
  const total = typeof q.totalCost === 'number' ? round(q.totalCost * rate) : (q.inrEquivalent as number | undefined);
  return { ...q, unitCostInr: unit, inrEquivalent: q.inrEquivalent ?? total };
}
function inrMoney(m: unknown, r: Rates) {
  const v = m as { amountMicros?: number; currencyCode?: string } | undefined;
  if (!v || v.amountMicros == null) return v;
  if (v.currencyCode === 'INR') return v;
  return { amountMicros: Math.round(v.amountMicros * toInr(v.currencyCode === 'USD' ? 'USD' : 'CNY', r)), currencyCode: 'INR' };
}
const round = (n: number) => Math.round(n * 100) / 100;

const META = ['name', 'office', 'clientRef'];
/** Fields each side may write, per object. `null` = not allowed. */
function writable(role: Role, obj: ObjectName, op: 'create' | 'update'): string[] | null {
  const s = sides(role);
  if (s.superAdmin) return obj === 'teamMember' ? null : FIELDS[obj].filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f));
  const india = s.india, china = s.china;
  switch (obj) {
    case 'lead':
      if (india) return FIELDS.lead.filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f));
      return op === 'update' ? ['status'] : null; // China can move a China-assigned lead through sourcing stages
    case 'sourcingRequest':
      return china ? FIELDS.sourcingRequest.filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f)) : null;
    case 'supplier':
      return china ? [...META, 'phone', 'wechatId', 'notes', 'sourcingRequestId'] : null;
    case 'quotation':
      if (china) return [...META, 'unitCost', 'totalCost', 'currency', 'exchangeRateUsed', 'inrEquivalent', 'validityDate', 'sourcingRequestId', 'supplierId'];
      return op === 'update' ? ['clientUnitPriceInr', 'pdfAttachment'] : null;
    case 'clientApproval':
      return india ? [...META, 'status', 'approver', 'decidedAt', 'notes', 'quotationId'] : null;
    case 'shippingOrder':
      if (china) return FIELDS.shippingOrder.filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f));
      return op === 'create' ? [...META, 'leadId', 'quotationId', 'shipmentStatus', 'customsStatus'] : null;
    default:
      return null; // exchangeRate: super admin only; teamMember: via /api/users
  }
}

export const CHINA_LEAD_STATUSES = ['ASSIGNED', 'SOURCING', 'QUOTED'];

/** Throws Forbidden when the write is not allowed; returns the payload otherwise. `existing` is the current record on update. */
export function writeCheck(role: Role, obj: ObjectName, op: 'create' | 'update', data: Rec, existing?: Rec): Rec {
  const allowed = writable(role, obj, op);
  if (!allowed) throw new Forbidden(`${role} may not ${op} ${obj}`);
  const bad = Object.keys(data).filter((k) => !allowed.includes(k));
  if (bad.length) throw new Forbidden(`${role} may not write ${obj}.${bad.join(', ')}`);
  const s = sides(role);
  if (!s.superAdmin && !s.india && obj === 'lead') {
    if (existing?.assignedOffice !== 'CHINA') throw new Forbidden('Lead is not assigned to China');
    if (!CHINA_LEAD_STATUSES.includes(String(data.status))) throw new Forbidden('China can only set ASSIGNED/SOURCING/QUOTED');
  }
  return data;
}

/** Query-string filters the client may use (simple equality). */
export const FILTERABLE: Partial<Record<ObjectName, string[]>> = {
  lead: ['status', 'assignedOffice', 'clientRef'],
  sourcingRequest: ['leadId', 'status', 'clientRef'],
  supplier: ['sourcingRequestId', 'clientRef'],
  quotation: ['sourcingRequestId', 'clientRef'],
  clientApproval: ['quotationId', 'clientRef'],
  shippingOrder: ['leadId', 'quotationId', 'clientRef'],
  exchangeRate: ['currencyPair', 'clientRef'],
  teamMember: ['email'],
};
