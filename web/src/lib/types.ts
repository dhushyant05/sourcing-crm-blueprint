export type LeadStatus = 'NEW' | 'ASSIGNED' | 'SOURCING' | 'QUOTED' | 'APPROVED' | 'SHIPPING' | 'WON' | 'LOST';
export type Currency = 'CNY' | 'USD' | 'INR';

export interface Lead {
  id: string; name: string; clientName?: string; contactPhone?: string; contactEmail?: string;
  productInterest?: string; quantity?: number; targetPrice?: number; targetCurrency?: Currency;
  status: LeadStatus; assignedOffice?: string; assignedChinaAgent?: string; sourceChannel?: string; createdAt: string;
}
export interface Quotation {
  id: string; name: string; leadId?: string; productName?: string; supplierName?: string;
  unitCost: number; currency: Currency; quantity: number; exchangeRateUsed?: number;
  clientUnitPriceInr?: number; status: string; validityDate?: string; createdAt: string;
}
export interface Shipment {
  id: string; name: string; clientName?: string; stage: string; carrier?: string; trackingNumber?: string;
  origin?: string; destination?: string; eta?: string; updatedAt: string;
}
export interface Supplier { id: string; name: string; city?: string; category?: string; rating?: number; contactName?: string; wechat?: string; }
export interface ExchangeRate { id: string; pair: string; rate: number; manual: boolean; setBy?: string; effectiveDate: string; }

export const PIPELINE: LeadStatus[] = ['NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED', 'SHIPPING', 'WON'];
export const SHIP_STAGES = ['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED'];
