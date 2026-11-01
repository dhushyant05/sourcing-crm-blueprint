export type LeadStatus = 'NEW' | 'ASSIGNED' | 'SOURCING' | 'QUOTED' | 'APPROVED' | 'SHIPPING' | 'WON' | 'LOST';
export type Currency = 'CNY' | 'USD' | 'INR';

export interface Lead {
  id: string; name: string; clientName?: string; contactPhone?: string; contactEmail?: string;
  productInterest?: string; quantity?: number; targetPrice?: number; targetCurrency?: Currency;
  status: LeadStatus; assignedOffice?: string; assignedChinaAgent?: string; sourceChannel?: string; createdAt: string; updatedAt?: string;
  unit?: string; deliveryCity?: string; referenceUrl?: string; enquiryMessage?: string; leadRef?: string; contactName?: string; attachmentCount?: number;
  /** Product requirement summary (India writes, China reads). */
  summary?: string;
}
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
export interface User { id: string; email: string; name: string; role: import('./roles').Role; active: boolean; createdAt: string }
export interface BackupLink { label: string; url: string }

export const PIPELINE: LeadStatus[] = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'WON'];
// shippingOrder.shipmentStatus options in twenty-setup/schema.json
export const SHIP_STAGES = ['BOOKED', 'IN_TRANSIT', 'AT_PORT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
