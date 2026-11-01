export type LeadStatus = 'NEW' | 'ASSIGNED' | 'SOURCING' | 'QUOTED' | 'APPROVED' | 'SHIPPING' | 'WON' | 'LOST';
export type Currency = 'CNY' | 'USD' | 'INR';

export interface Lead {
  id: string; name: string; clientName?: string; contactPhone?: string; contactEmail?: string;
  productInterest?: string; quantity?: number; targetPrice?: number; targetCurrency?: Currency;
  status: LeadStatus; assignedOffice?: string; assignedChinaAgent?: string; sourceChannel?: string; createdAt: string; updatedAt?: string;
  unit?: string; deliveryCity?: string; referenceUrl?: string; enquiryMessage?: string; leadRef?: string; contactName?: string; attachmentCount?: number;
  /** Product requirement summary (India writes, China reads). */
  summary?: string;
  /** Staff user who raised the lead (null for public enquiries) and the current owner (null = office queue). */
  raisedBy?: string | null; raisedByName?: string | null; assignedTo?: string | null; assignedToName?: string | null; ownerOffice?: Office;
}
export type Office = 'INDIA' | 'CHINA';
export interface StaffLite { id: string; name: string; role: import('./roles').Role }
/** In-app notification. Only SE reference + product summary, never customer details. */
export interface AppNotification { id: string; leadId: string; leadRef: string | null; product: string | null; kind: 'ASSIGNED' | 'RETURNED' | 'QUEUE'; office: Office; byName: string | null; createdAt: string; read: boolean }
export interface Attachment { id: string; name: string; mime: string; size: number; createdAt: string }
export interface Quotation {
  id: string; name: string; leadRef?: string; leadId?: string; productName?: string; supplierName?: string;
  /** Supplier cost (China side) in its own currency. */
  unitCost?: number; totalCost?: number; currency?: Currency; quantity: number;
  /** Client price (India side) in its own currency. Never converted from the supplier cost. */
  clientUnitPrice?: number; clientCurrency?: Currency; status: string; validityDate?: string; createdAt: string;
}
export interface Shipment {
  id: string; name: string; leadRef?: string; clientName?: string; stage: string; carrier?: string; trackingNumber?: string;
  origin?: string; destination?: string; eta?: string; updatedAt: string;
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
}
export type QuoteInput = Partial<Pick<LeadQuote, 'product' | 'moq' | 'leadTime' | 'validity' | 'notes' | 'supplierId'>> & { unitPrice?: number | string; currency?: QuoteCurrency; newSupplier?: Omit<QuoteSupplier, 'id'> };
export interface User { id: string; email: string; name: string; role: import('./roles').Role; active: boolean; createdAt: string }
export interface BackupLink { label: string; url: string }

export const PIPELINE: LeadStatus[] = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'WON'];
// shippingOrder.shipmentStatus options in twenty-setup/schema.json
export const SHIP_STAGES = ['BOOKED', 'IN_TRANSIT', 'AT_PORT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
