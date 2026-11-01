export type LeadStatus = 'NEW' | 'ASSIGNED' | 'SOURCING' | 'QUOTED' | 'APPROVED' | 'SHIPPING' | 'WON' | 'LOST' | 'CLOSED';
export type Currency = 'CNY' | 'USD' | 'INR';

export interface Rejection { id: string; quoteId: string; reasonCode: string; reasonText: string | null; byName: string | null; at: string; resolution: 'REVISE' | 'CLOSED' | null;
  targetPrice: number | null; targetCurrency: string | null; notes: string | null; resolvedByName: string | null; resolvedAt: string | null }
export interface RejectionSummary { count: number; actionNeeded: boolean; revising: boolean; last: Rejection; history: Rejection[] }
export const REJECT_REASONS = ['PRICE', 'LEAD_TIME', 'MOQ', 'QUALITY', 'SHIPPING', 'OTHER_SUPPLIER', 'NO_RESPONSE', 'OTHER'];
export interface Lead {
  rejection?: RejectionSummary | null;
  id: string; name: string; clientName?: string; contactPhone?: string; contactEmail?: string;
  productInterest?: string; quantity?: number; targetPrice?: number; targetCurrency?: Currency;
  status: LeadStatus; assignedOffice?: string; assignedChinaAgent?: string; sourceChannel?: string; createdAt: string; updatedAt?: string;
  unit?: string; deliveryCity?: string; referenceUrl?: string; enquiryMessage?: string; leadRef?: string; contactName?: string; attachmentCount?: number;
  /** Product requirement summary (India writes, China reads). */
  summary?: string;
  /** Staff user who raised the lead (null for public enquiries) and the current owner (null = office queue). */
  raisedBy?: string | null; raisedByName?: string | null; assignedTo?: string | null; assignedToName?: string | null; ownerOffice?: Office;
  /** Priority lead (2 h SLA) and the running SLA clock of the office that holds it. */
  priority?: boolean; sla?: Sla | null; followUp?: string | null; createdFromRef?: string | null; createdFromId?: string | null; closedAt?: string; closedByName?: string | null;
}
export interface Sla { office: Office; startedAt: string; dueAt: string; breached: boolean; assignee?: string | null; assigneeName?: string | null }
export interface SlaSettings { normalMinutes: number; priorityMinutes: number }
export interface LeadEvent { id: string; at: string; kind: string; actorName: string | null; actorOffice: Office | 'ADMIN' | null; data: Record<string, any> }
export const STAGES = ['NEW', 'CHINA', 'SOURCING', 'QUOTED', 'CQ_SENT', 'DECIDED', 'ORDER', 'SHIPPED', 'DELIVERED'] as const;
export interface Timeline { events: LeadEvent[]; progress: { stage: (typeof STAGES)[number]; index: number; won: boolean; lost: boolean }; priority: boolean; sla: Sla | null; settings: SlaSettings }
export interface SlaReport { days: number; office: { office: Office; total: number; onTime: number; breached: number; running: number; onTimePct: number | null }[];
  members: { id: string | null; name: string | null; office: Office; total: number; breached: number }[]; settings: SlaSettings }
export type Office = 'INDIA' | 'CHINA';
export interface StaffLite { id: string; name: string; role: import('./roles').Role; avatarUrl?: string | null }
/** In-app notification. Only SE reference + product summary, never customer details. */
export interface AppNotification { detail?: string | null; id: string; leadId: string; leadRef: string | null; product: string | null; kind: 'ASSIGNED' | 'RETURNED' | 'QUEUE' | 'QUOTE_ACCEPTED' | 'QUOTE_REJECTED' | 'ORDER_NEW' | 'ORDER_UPDATE' | 'SHIPMENT_UPDATE' | 'ORDER_SHIPPED' | 'REVISE_REQUESTED' | 'LEAD_CLOSED' | 'SLA_WARN' | 'SLA_BREACH' | 'PRIORITY'; office: Office; byName: string | null; createdAt: string; read: boolean }
export interface Attachment { id: string; name: string; mime: string; size: number; createdAt: string }
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
  etd: string | null; eta: string | null; status: string; customsNote?: string | null; deliveredAt: string | null; production: string | null; expectedShip: string | null;
  customer?: string | null; deliveryCity?: string | null; supplier?: string | null; createdAt: string; updatedAt: string;
}
export interface Supplier { id: string; name: string; phone?: string; wechat?: string; notes?: string; city?: string; category?: string; rating?: number; contactName?: string; }
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
  shipmentId?: string | null; shipmentRef?: string | null;
  id: string; leadId: string; quoteId: string; leadRef: string | null; product: string; qty: number; expectedShip: string | null;
  production: string; tracking: string | null; container: string | null; etd: string | null; eta: string | null; indiaStatus: string;
  createdAt: string; updatedAt: string; leadStatus: string | null;
  agreedPrice?: number; advance?: number; paymentStatus?: string; total?: number; customer?: string | null; assignedToName?: string | null;
  supplier?: QuoteSupplier | null; unitPrice?: number | null; currency?: string | null; shipCost?: number | null; shipCurrency?: string | null;
}
export type QuoteInput = Partial<Pick<LeadQuote, 'product' | 'moq' | 'leadTime' | 'validity' | 'notes' | 'supplierId' | 'shipTerm' | 'shipMode' | 'shipPort' | 'shipTransit' | 'shipCurrency'>> & { shipCost?: number | string | null } & { unitPrice?: number | string; currency?: QuoteCurrency; newSupplier?: Omit<QuoteSupplier, 'id'> };
export interface User { id: string; email: string; name: string; role: import('./roles').Role; active: boolean; createdAt: string; avatarUrl?: string | null }
export interface BackupLink { label: string; url: string }

export const PIPELINE: LeadStatus[] = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'WON'];
// shippingOrder.shipmentStatus options in twenty-setup/schema.json
/** Gated: China books, then "Mark shipped" (→ IN_TRANSIT, needs tracking/container + ETD); only then India moves it on to DELIVERED. */
export const SHIP_STAGES = ['PENDING', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const CHINA_SHIP = ['PENDING', 'BOOKED'], INDIA_SHIP = ['IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
