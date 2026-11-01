import type { Rec, TwentyLike } from '../src/twenty.js';

/** Raw records shaped like Twenty REST responses (field names from twenty-setup/schema.json). */
export function fixtures(): Record<string, Rec[]> {
  return {
    leads: [
      { id: 'lead-india-1', name: 'Arora Home Store — Steel bottles', createdAt: '2026-10-01', clientName: 'Arora Home Store',
        contactPhone: { primaryPhoneNumber: '+919800000001' }, contactEmail: { primaryEmail: 'buyer@arora.in' },
        productInterest: 'Steel bottles', quantity: 500, targetPrice: { amountMicros: 220e6, currencyCode: 'INR' },
        sourceChannel: 'WHATSAPP', status: 'NEW', assignedOffice: 'INDIA', winLossReason: null, office: 'BOTH' },
      { id: 'lead-china-1', name: 'Mehta Kitchenware — Bamboo boards', createdAt: '2026-10-02', clientName: 'Mehta Kitchenware',
        contactPhone: { primaryPhoneNumber: '+919800000002' }, contactEmail: { primaryEmail: 'buyer@mehta.in' },
        productInterest: 'Bamboo boards', quantity: 1200, targetPrice: { amountMicros: 180e6, currencyCode: 'INR' },
        sourceChannel: 'REFERRAL', status: 'SOURCING', assignedOffice: 'CHINA', assignedChinaAgent: 'Li Wei',
        chatwootConversationUrl: { primaryLinkUrl: 'https://chat/1' }, office: 'BOTH', secretInternal: 'x' },
    ],
    sourcingRequests: [
      { id: 'sr-1', name: 'Bamboo boards', productDescription: 'Bamboo boards', quantity: 1200, leadId: 'lead-china-1',
        targetPrice: { amountMicros: 10e6, currencyCode: 'CNY' }, status: 'IN_PROGRESS', assignedChinaAgent: 'Li Wei' },
    ],
    suppliers: [
      { id: 'sup-1', name: 'Ningbo Brightway', phone: { primaryPhoneNumber: '+8613800000000' }, wechatId: 'brightway_ly',
        notes: 'MOQ 500', sourcingRequestId: 'sr-1' },
    ],
    quotations: [
      { id: 'q-1', name: 'QT-1', unitCost: 10, totalCost: 12000, currency: 'CNY', exchangeRateUsed: 12, inrEquivalent: 144000,
        clientUnitPriceInr: 150, validityDate: '2026-11-30', sourcingRequestId: 'sr-1', supplierId: 'sup-1',
        pdfAttachment: { primaryLinkUrl: 'https://x/q.pdf' }, createdAt: '2026-10-05' },
      { id: 'q-2', name: 'QT-2', unitCost: 2, totalCost: 200, currency: 'USD', sourcingRequestId: 'sr-1', supplierId: 'sup-1', createdAt: '2026-10-06' },
    ],
    clientApprovals: [
      { id: 'ap-1', name: 'Approved', status: 'APPROVED', approver: 'Mr Mehta', notes: 'ok via phone', decidedAt: '2026-10-07', quotationId: 'q-1' },
    ],
    shippingOrders: [
      { id: 'so-1', name: 'SO-1', forwarder: 'Maersk', trackingNumber: 'MAEU1', shipmentStatus: 'IN_TRANSIT', leadId: 'lead-china-1', quotationId: 'q-1' },
    ],
    exchangeRates: [
      { id: 'r-1', name: 'CNY_INR', currencyPair: 'CNY_INR', rate: 11.9, isManualOverride: true, effectiveDate: '2026-10-30', setBy: 'Dhushyanth' },
      { id: 'r-2', name: 'USD_INR', currencyPair: 'USD_INR', rate: 84, isManualOverride: true, effectiveDate: '2026-10-30' },
    ],
    teamMembers: [
      { id: 'tm-1', name: 'Asha', email: 'asha@se.in', role: 'INDIA_STAFF', chatwootAgentId: 3 },
      { id: 'tm-2', name: 'Li Wei', email: 'li@se.cn', role: 'CHINA_STAFF', chatwootAgentId: 4 },
    ],
  };
}

export class MockTwenty implements TwentyLike {
  db = fixtures();
  writes: { op: string; plural: string; id?: string; data: Rec }[] = [];
  async list(plural: string, filter?: Record<string, string>) {
    return (this.db[plural] ?? []).filter((r) => Object.entries(filter ?? {}).every(([k, v]) => String(r[k]) === v)).map((r) => structuredClone(r));
  }
  async get(plural: string, id: string) { const r = this.db[plural]?.find((x) => x.id === id); return r ? structuredClone(r) : null; }
  async create(plural: string, data: Rec) { const r = { id: `new-${this.writes.length}`, ...data }; this.db[plural].push(r); this.writes.push({ op: 'create', plural, data }); return r; }
  async update(plural: string, id: string, data: Rec) { const r = this.db[plural].find((x) => x.id === id)!; Object.assign(r, data); this.writes.push({ op: 'update', plural, id, data }); return r; }
}
