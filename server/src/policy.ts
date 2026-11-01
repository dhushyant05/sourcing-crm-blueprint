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
  clientApproval: 'clientApprovals', shippingOrder: 'shippingOrders', teamMember: 'teamMembers',
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
  quotation: [...STD, 'unitCost', 'totalCost', 'currency', 'clientUnitPrice', 'clientCurrency',
    'validityDate', 'pdfAttachment', 'sourcingRequestId', 'supplierId'],
  clientApproval: [...STD, 'status', 'approver', 'decidedAt', 'notes', 'quotationId'],
  shippingOrder: [...STD, 'forwarder', 'trackingNumber', 'containerType', 'etd', 'eta', 'customsStatus', 'shipmentStatus',
    'currentLocation', 'latitude', 'longitude', 'leadId', 'quotationId'],
  teamMember: [...STD, 'email', 'role', 'chatwootAgentId'],
};

/** Customer-identifying lead fields. China never sees them. */
const LEAD_CHINA = ['id', 'createdAt', 'updatedAt', 'office', 'productInterest', 'quantity', 'status', 'assignedOffice', 'assignedChinaAgent'];
/** Supplier identity / raw cost on a quotation. India never sees them. */
const QUOTE_INDIA = ['id', 'name', 'createdAt', 'updatedAt', 'office', 'clientUnitPrice', 'clientCurrency', 'validityDate', 'pdfAttachment', 'sourcingRequestId'];
const QUOTE_CHINA = FIELDS.quotation.filter((f) => !['clientUnitPrice', 'clientCurrency', 'pdfAttachment'].includes(f));
const APPROVAL_CHINA = ['id', 'createdAt', 'updatedAt', 'status', 'decidedAt', 'quotationId'];

/** Amounts are stored and shown in the currency they were entered in. There is no conversion anywhere. */
export const CURRENCIES = ['USD', 'CNY', 'INR'] as const;
export interface Ctx { role: Role }

const pick = (r: Rec, keys: string[]) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
export class Forbidden extends Error { status = 403; }
export class BadRequest extends Error { status = 400; }

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
  if (s.superAdmin) return base;
  switch (obj) {
    case 'lead':
      if (s.india) return base;
      // China works only on leads handed to China, and never sees the client.
      if (rec.assignedOffice !== 'CHINA') return null;
      return { ...pick(base, LEAD_CHINA), name: `Lead ${String(rec.id).slice(0, 8)}` };
    case 'quotation':
      // India: client price only (in its own currency). Supplier cost/currency and supplier id are removed.
      return s.india ? pick(base, QUOTE_INDIA) : pick(base, QUOTE_CHINA);
    case 'clientApproval':
      return s.india ? base : pick(base, APPROVAL_CHINA);
    case 'teamMember': {
      const role = String(rec.role ?? '');
      const mine = s.india ? role.startsWith('INDIA') : role.startsWith('CHINA');
      return mine ? base : null;
    }
    default:
      return base;
  }
}

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
      if (china) return [...META, 'unitCost', 'totalCost', 'currency', 'validityDate', 'sourcingRequestId', 'supplierId'];
      return op === 'update' ? ['clientUnitPrice', 'clientCurrency', 'pdfAttachment'] : null;
    case 'clientApproval':
      return india ? [...META, 'status', 'approver', 'decidedAt', 'notes', 'quotationId'] : null;
    case 'shippingOrder':
      if (china) return FIELDS.shippingOrder.filter((f) => !['id', 'createdAt', 'updatedAt'].includes(f));
      return op === 'create' ? [...META, 'leadId', 'quotationId', 'shipmentStatus', 'customsStatus'] : null;
    default:
      return null; // teamMember: via /api/users
  }
}

export const CHINA_LEAD_STATUSES = ['ASSIGNED', 'SOURCING', 'QUOTED'];

/** Throws Forbidden when the write is not allowed; returns the payload otherwise. `existing` is the current record on update. */
export function writeCheck(role: Role, obj: ObjectName, op: 'create' | 'update', data: Rec, existing?: Rec): Rec {
  const allowed = writable(role, obj, op);
  if (!allowed) throw new Forbidden(`${role} may not ${op} ${obj}`);
  const bad = Object.keys(data).filter((k) => !allowed.includes(k));
  if (bad.length) throw new Forbidden(`${role} may not write ${obj}.${bad.join(', ')}`);
  for (const k of ['currency', 'clientCurrency']) {
    if (k in data && data[k] != null && !CURRENCIES.includes(data[k] as never)) throw new BadRequest(`${k} must be one of ${CURRENCIES.join(', ')}`);
  }
  for (const k of ['targetPrice']) {
    const m = data[k] as { currencyCode?: unknown } | null | undefined;
    if (m && m.currencyCode != null && !CURRENCIES.includes(m.currencyCode as never)) throw new BadRequest(`${k}.currencyCode must be one of ${CURRENCIES.join(', ')}`);
  }
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
  teamMember: ['email'],
};
