export type LeadStatus = 'NEW' | 'ASSIGNED' | 'SOURCING' | 'QUOTED' | 'APPROVED' | 'SHIPPING' | 'WON' | 'LOST' | 'CLOSED' | 'DELIVERED' | 'COMPLETED';
export type Currency = 'CNY' | 'USD' | 'INR';

export interface Rejection { id: string; quoteId: string; reasonCode: string; reasonText: string | null; byName: string | null; at: string; resolution: 'REVISE' | 'CLOSED' | null;
  targetPrice: number | null; targetCurrency: string | null; notes: string | null; resolvedByName: string | null; resolvedAt: string | null }
export interface RejectionSummary { count: number; actionNeeded: boolean; revising: boolean; last: Rejection; history: Rejection[] }
export const REJECT_REASONS = ['PRICE', 'LEAD_TIME', 'MOQ', 'QUALITY', 'SHIPPING', 'OTHER_SUPPLIER', 'NO_RESPONSE', 'OTHER'];
export interface Lead {
  rejection?: RejectionSummary | null;
  /** Open send-back request: `side` is the office that has to act (INDIA = China asked for details; CHINA = India asked for a quote revision). */
  sendBack?: { side: Office; note: string; at: string; byName: string | null; quoteId: string | null } | null;
  id: string; name: string; clientName?: string; contactPhone?: string; contactEmail?: string;
  productInterest?: string; quantity?: number; targetPrice?: number; targetCurrency?: Currency;
  status: LeadStatus; assignedOffice?: string; assignedChinaAgent?: string; sourceChannel?: string; createdAt: string; updatedAt?: string;
  unit?: string; deliveryCity?: string; referenceUrl?: string; enquiryMessage?: string; leadRef?: string; contactName?: string; attachmentCount?: number;
  /** Product requirement summary (India writes, China reads). */
  summary?: string;
  /** Staff user who raised the lead (null for public enquiries) and the current owner (null = office queue). */
  raisedBy?: string | null; raisedByName?: string | null; assignedTo?: string | null; assignedToName?: string | null; ownerOffice?: Office; unassignedIndia?: boolean;
  /** Priority lead (2 h SLA) and the running SLA clock of the office that holds it. */
  priority?: boolean; sla?: Sla | null; followUp?: string | null; createdFromRef?: string | null; createdFromId?: string | null; closedAt?: string; closedByName?: string | null;
}
export interface Sla { office: Office; startedAt: string; dueAt: string; breached: boolean; assignee?: string | null; assigneeName?: string | null }
export interface SlaSettings { normalMinutes: number; priorityMinutes: number; warnMinutes?: number }
export interface LeadEvent { id: string; at: string; kind: string; actorName: string | null; actorOffice: Office | 'ADMIN' | null; data: Record<string, any> }
export const STAGES = ['NEW', 'CHINA', 'SOURCING', 'QUOTED', 'CQ_SENT', 'DECIDED', 'ORDER', 'SHIPPED', 'DELIVERED'] as const;
export interface Timeline { events: LeadEvent[]; progress: { stage: (typeof STAGES)[number]; index: number; won: boolean; lost: boolean }; priority: boolean; sla: Sla | null; settings: SlaSettings }
export interface SlaReport { days: number; office: { office: Office; total: number; onTime: number; breached: number; running: number; onTimePct: number | null }[];
  members: { id: string | null; name: string | null; office: Office; total: number; breached: number }[]; settings: SlaSettings }
export type Office = 'INDIA' | 'CHINA';
export interface StaffLite { id: string; name: string; role: import('./roles').Role; avatarUrl?: string | null }
/** In-app notification. Only SE reference + product summary, never customer details. */
export interface AppNotification { detail?: string | null; id: string; leadId: string; leadRef: string | null; product: string | null; kind: 'ASSIGNED' | 'RETURNED' | 'QUEUE' | 'QUOTE_ACCEPTED' | 'QUOTE_REJECTED' | 'QUOTE_REVERTED' | 'ORDER_NEW' | 'ORDER_UPDATE' | 'SHIPMENT_UPDATE' | 'ORDER_SHIPPED' | 'REVISE_REQUESTED' | 'LEAD_CLOSED' | 'SLA_WARN' | 'SLA_BREACH' | 'PRIORITY' | 'LEAD_COMPLETED' | 'SENT_BACK' | 'INFO_PROVIDED' | 'QUOTE_REVISED' | 'LOGIN_REQUEST' | 'PORTAL_REQUEST' | 'SHIP_REQUEST' | 'SHIP_REQUEST_UPDATE' | 'SHIP_SLA_WARN' | 'SHIP_SLA_BREACH' | 'SHIP_READY'; office: Office; byName: string | null; createdAt: string; read: boolean }
export interface Attachment { id: string; name: string; mime: string; size: number; createdAt: string; uploadedBy?: string | null; kind?: string | null }
export interface Quotation {
  id: string; name: string; leadRef?: string; leadId?: string; productName?: string; supplierName?: string;
  /** Supplier cost (China side) in its own currency. */
  unitCost?: number; totalCost?: number; currency?: Currency; quantity: number;
  /** Client price (India side) in its own currency. Never converted from the supplier cost. */
  clientUnitPrice?: number; clientCurrency?: Currency; status: string; validityDate?: string; createdAt: string;
}
export interface Shipment {
  id: string; orderId: string; leadId: string; ref: string; leadRef: string | null; product: string | null; qty: number | null; leadStatus: string | null;
  mode: string | null; incoterm: string | null; port: string | null; transit: string | null; carrier: string | null; tracking: string | null; container: string | null;
  etd: string | null; eta: string | null; status: string; customsNote?: string | null; deliveredAt: string | null; production: string | null; expectedShip: string | null; closed?: boolean; closedAt?: string | null; paymentPending?: boolean;
  customer?: string | null; deliveryCity?: string | null; supplier?: string | null; createdAt: string; updatedAt: string;
}
/** India-side customer directory row (PostgreSQL `customers`) with activity stats. Never sent to China. INR totals are null without prices.inr. */
export interface Customer {
  id: string; name: string; company?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; city?: string | null; state?: string | null;
  country?: string | null; gst?: string | null; address?: string | null; notes?: string | null; tags: string[]; createdByName?: string | null; createdAt?: string;
  leads: number; quotes: number; orders: number; shipments: number; paymentPending: number; orderTotal: number | null; paid: number | null; due: number | null; lastLeadAt: string | null;
}
export interface CustomerDetail extends Customer {
  leadRows: { id: string; leadRef: string | null; product: string | null; quantity: number | null; unit: string | null; status: string; createdAt: string; ownerName: string | null }[];
  quoteRows: { id: string; leadId: string; leadRef: string | null; product: string; status: string; updatedAt: string; qty?: number; unitPrice?: number; total?: number }[];
  orderRows: { id: string; leadId: string; leadRef: string | null; product: string; qty: number; paymentStatus: string; production: string; indiaStatus: string; createdAt: string; agreedPrice?: number; advance?: number; total?: number }[];
  shipmentRows: { id: string; leadId: string; leadRef: string | null; ref: string; status: string; mode: string | null; etd: string | null; eta: string | null; deliveredAt: string | null }[];
}
/** China-side supplier directory row (PostgreSQL `suppliers`) with activity stats. Never sent to India. */
export interface Supplier {
  id: string; name: string; contact?: string | null; phone?: string | null; wechat?: string | null; city?: string | null; notes?: string | null;
  createdBy?: string | null; createdByName?: string | null; createdAt?: string;
  quotes: number; accepted: number; leads: number; orders: number; lastQuoteAt: string | null;
}
export interface SupplierQuoteRow {
  id: string; leadId: string; leadRef: string | null; leadStatus: string | null; product: string; unitPrice: number; currency: QuoteCurrency;
  moq?: string | null; leadTime?: string | null; status: QuoteStatus; createdAt: string; createdByName: string | null;
  order: { id: string; qty: number; production: string; indiaStatus: string; createdAt: string } | null;
}
export type SupplierDetail = Omit<Supplier, 'quotes'> & { quotes: SupplierQuoteRow[]; quoteCount: number };
export type QuoteCurrency = 'USD' | 'CNY' | 'INR';
/** China-side supplier record (never sent to India). */
export interface QuoteSupplier { id: string; name: string; contact?: string | null; phone?: string | null; wechat?: string | null; city?: string | null }
/** A supplier quote on a lead. India receives it without supplier/createdBy fields and with neutral file names. */
export interface LeadQuote {
  id: string; leadId: string; label?: string; product: string; unitPrice: number; currency: QuoteCurrency;
  moq?: string | null; leadTime?: string | null; validity?: string | null; notes?: string | null;
  clientPrice?: number | null; clientCurrency?: string | null; clientNotes?: string | null;
  supplierId?: string | null; supplier?: QuoteSupplier | null; canEdit?: boolean; createdBy?: string; createdByName?: string | null;
  files: Attachment[]; createdAt: string; updatedAt?: string;
  revision?: number; revRequest?: { note: string; at: string; byName: string | null } | null;
  shipCost?: number | null; shipCurrency?: QuoteCurrency | null; shipTerm?: string | null; shipMode?: string | null; shipPort?: string | null; shipTransit?: string | null;
  status?: QuoteStatus; sentAt?: string | null; decidedAt?: string | null; rejectReason?: string | null; orderId?: string | null;
  cq?: CustomerQuote | null; cqTotals?: { subtotal: number; taxable: number; gst: number; total: number } | null; pdfUrl?: string | null;
  // only on the all-quotes list
  leadRef?: string | null; leadStatus?: string | null; ownerOffice?: Office; assignedTo?: string | null; assignedToName?: string | null;
}
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
export const INCOTERMS = ['EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'] as const;
export const SHIP_MODES = ['AIR', 'SEA', 'EXPRESS', 'ROAD'] as const;
export interface CustomerQuote {
  qty: number; unitPrice: number; gstPct: number; shipCost: number; shipTerm: string | null; shipMode: string | null; port: string | null; transit: string | null;
  otherCharges: number; otherLabel: string | null; validity: string | null; terms: string | null;
}
export interface Order {
  shipmentId?: string | null; shipmentRef?: string | null; closed?: boolean; closedAt?: string | null; paymentPending?: boolean;
  id: string; leadId: string; quoteId: string; leadRef: string | null; product: string; qty: number; expectedShip: string | null;
  production: string; tracking: string | null; container: string | null; etd: string | null; eta: string | null; indiaStatus: string;
  createdAt: string; updatedAt: string; leadStatus: string | null;
  agreedPrice?: number; advance?: number; paymentStatus?: string; total?: number; customer?: string | null; assignedToName?: string | null;
  supplier?: QuoteSupplier | null; unitPrice?: number | null; currency?: string | null; shipCost?: number | null; shipCurrency?: string | null;
}
export type QuoteInput = Partial<Pick<LeadQuote, 'product' | 'moq' | 'leadTime' | 'validity' | 'notes' | 'supplierId' | 'shipTerm' | 'shipMode' | 'shipPort' | 'shipTransit' | 'shipCurrency'>> & { shipCost?: number | string | null } & { unitPrice?: number | string; currency?: QuoteCurrency; newSupplier?: Omit<QuoteSupplier, 'id'> };
export interface User { id: string; email: string; name: string; role: import('./roles').Role; active: boolean; createdAt: string; avatarUrl?: string | null }
export interface BackupLink { label: string; url: string }

/** Closed = completed (delivered), lost, or closed permanently — never counted as open. WON = customer accepted, order still running. */
export const CLOSED_ST = ['COMPLETED', 'LOST', 'CLOSED', 'DELIVERED'];
export const isOpenLead = (l: { status: string }) => !CLOSED_ST.includes(l.status);
export const PIPELINE: LeadStatus[] = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'WON'];
// shippingOrder.shipmentStatus options in twenty-setup/schema.json
/** Gated: China books, then "Mark shipped" (→ IN_TRANSIT, needs tracking/container + ETD); only then India moves it on to DELIVERED. */
export const SHIP_STAGES = ['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const CHINA_SHIP = ['PENDING', 'BOOKED'], INDIA_SHIP = ['IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export interface PermRow { key: string; group: string; side: 'INDIA' | 'CHINA' | 'ANY'; default: boolean; override: boolean | null; effective: boolean; locked: boolean }
export interface PermAudit { id: number; perm: string; before: boolean | null; after: boolean | null; changedBy: string | null; changedByName: string | null; changedAt: string }
export interface PermMatrix { userId: string; role: import('./roles').Role; editable: boolean; permissions: PermRow[]; audit: PermAudit[] }

/** Customer portal login (staff view; never a password). */
export interface PortalLogin { id: string; customerId: string; phone: string; name: string; email: string | null; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null; createdAt: string }
export interface PortalLoginRequest { id: string; leadId: string | null; leadRef: string | null; product: string | null; name: string; phone: string; email: string | null; company: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string | null; customerId: string | null; decidedByName: string | null; decidedAt: string | null; createdAt: string;
  customer: { id: string; name: string; company: string | null; phone: string | null } | null; hasLogin: boolean; match: { verified: false; phoneMatches: boolean; otherLeads: number } | null }
export interface PortalLeadShare { id: string; leadRef: string | null; product: string | null; sourceChannel: string | null; createdAt: string; shared: boolean; sharedAt: string | null }
/** Shipping Request (SH-YYMM-NNNN), India office view. */
export interface FreightQuoteStaff { id: string; n: number; label: string; amount: number; currency: string; mode: string | null; incoterm: string | null; transit: string | null; validUntil: string | null;
  customerNote: string | null; internalCost: number | null; status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN'; reasonCode: string | null; reason: string | null; createdAt: string; decidedAt: string | null; createdByName: string | null; revision: number }
/** China office view of an accepted shipping request: booking details only (server allowlist; no customer identity, destination contact or prices). */
export interface ShippingRequestChina {
  id: string; ref: string; kind: 'SOURCED' | 'FREIGHT_ONLY'; status: string; goods: string; quantity: number | null; unit: string | null; packages: number | null;
  weightKg: number | null; cbm: number | null; pickupContact: string | null; pickupPhone: string | null; pickupAddress: string | null; pickupCity: string | null;
  readyDate: string | null; mode: string | null; incoterm: string | null; destCity: string | null; carrier: string | null; tracking: string | null; container: string | null;
  etd: string | null; eta: string | null; stage: string; shipmentRef: string | null; updatedAt: string; canUpdate: boolean;
}
export interface ShippingRequestStaff {
  id: string; ref: string; kind: 'SOURCED' | 'FREIGHT_ONLY'; customerId: string; customer: { id: string; name: string; company: string | null; phone: string | null } | null;
  createdByKind: 'CUSTOMER' | 'STAFF'; leadId: string | null; leadRef: string | null; orderId: string | null; goods: string; quantity: number | null; unit: string | null; packages: number | null;
  weightKg: number | null; cbm: number | null; shipperName: string | null; shipperPhone: string | null; pickupAddress: string | null; pickupCity: string | null;
  destCity: string | null; destAddress: string | null; destPincode: string | null; mode: string | null; incoterm: string | null; readyDate: string | null; customerNote: string | null;
  status: string; question: string | null; carrier: string | null; tracking: string | null; container: string | null; etd: string | null; eta: string | null; deliveredAt: string | null;
  assignedTo: string | null; assignedToName: string | null; internalNote: string | null; rejectReason: string | null; createdAt: string; updatedAt: string;
  sla?: { startedAt: string; dueAt: string; warned: boolean; breached: boolean } | null;
  progress: { stage: string; carrier: string | null; tracking: string | null; container: string | null; etd: string | null; eta: string | null; deliveredAt: string | null; shipmentRef: string | null } | null;
  freightQuotes?: FreightQuoteStaff[]; files?: (Attachment & { customerVisible: boolean })[];
  events?: { at: string; kind: string; by: string | null; data: Record<string, unknown>; customerVisible: boolean; customerText: string | null }[];
  canPrice?: boolean; canMessage?: boolean; canEdit?: boolean;
}

/** Staff view of a greeting banner (GET /api/greetings). `preview` is the customer-safe DTO with staff image URLs. */
export interface GreetingStaff {
  id: string; name: string; status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'; layout: 'IMAGE' | 'CLASSIC' | 'FESTIVE' | 'MINIMAL'; theme: 'BRAND' | 'GOLD' | 'NIGHT' | 'ROSE';
  heading: string | null; message: string | null; altText: string | null; linkPath: string | null; linkLabel: string | null; imageDesktop: string | null; imageMobile: string | null;
  surfaces: ('PUBLIC' | 'PORTAL' | 'APP')[]; startsAt: string; endsAt: string; priority: number; dismissible: boolean; version: number;
  createdByName: string | null; updatedByName: string | null; publishedByName: string | null; publishedAt: string | null; createdAt: string; updatedAt: string;
  preview: import('../greetings/Banner').Greeting; problems: string[]; problemCodes?: string[]; audit?: { at: string; action: string; by: string | null; detail: unknown }[];
}
