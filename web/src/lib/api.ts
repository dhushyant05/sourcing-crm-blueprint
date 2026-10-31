import type { ExchangeRate, Lead, LeadStatus, Quotation, Shipment, Supplier } from './types';
import { demo } from './demo';

export interface Api {
  leads(): Promise<Lead[]>;
  updateLeadStatus(id: string, status: LeadStatus): Promise<void>;
  quotations(): Promise<Quotation[]>;
  shipments(): Promise<Shipment[]>;
  suppliers(): Promise<Supplier[]>;
  rates(): Promise<ExchangeRate[]>;
  setRate(pair: string, rate: number, by: string): Promise<void>;
}

const nodes = <T>(d: Record<string, { edges: { node: T }[] }>, k: string) => d[k].edges.map((e) => e.node);
const amount = (c?: { amountMicros?: number }) => (c?.amountMicros ?? 0) / 1e6;

/** Thin client for Twenty's /graphql data API (same field names as twenty-setup/schema.json). */
export class TwentyApi implements Api {
  private url: string;
  private token: string;
  constructor(url: string, token: string) { this.url = url; this.token = token; }

  private async q<T = Record<string, never>>(query: string, variables?: object): Promise<T> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors?.length) throw new Error(j.errors[0].message);
    return j.data;
  }

  async leads() {
    const d = await this.q<never>(`{ leads(first: 200, orderBy: {createdAt: DescNullsLast}) { edges { node {
      id name createdAt clientName productInterest quantity status assignedOffice assignedChinaAgent sourceChannel
      contactPhone { primaryPhoneNumber } contactEmail { primaryEmail } targetPrice { amountMicros currencyCode } } } } }`);
    return nodes<Record<string, any>>(d, 'leads').map((n) => ({
      ...n, contactPhone: n.contactPhone?.primaryPhoneNumber, contactEmail: n.contactEmail?.primaryEmail,
      targetPrice: amount(n.targetPrice), targetCurrency: n.targetPrice?.currencyCode,
    })) as Lead[];
  }
  async updateLeadStatus(id: string, status: LeadStatus) {
    await this.q(`mutation($id: ID!, $data: LeadUpdateInput!) { updateLead(id: $id, data: $data) { id } }`, { id, data: { status } });
  }
  async quotations() {
    const d = await this.q<never>(`{ quotations(first: 200) { edges { node { id name createdAt status currency quantity
      exchangeRateUsed validityDate unitCost { amountMicros } clientUnitPriceInr { amountMicros }
      supplier { name } sourcingRequest { leadId productName } } } } }`);
    return nodes<Record<string, any>>(d, 'quotations').map((n) => ({
      ...n, unitCost: amount(n.unitCost), clientUnitPriceInr: amount(n.clientUnitPriceInr) || undefined,
      supplierName: n.supplier?.name, leadId: n.sourcingRequest?.leadId, productName: n.sourcingRequest?.productName,
    })) as Quotation[];
  }
  async shipments() {
    const d = await this.q<never>(`{ shippingOrders(first: 200) { edges { node { id name stage carrier trackingNumber
      origin destination eta updatedAt clientName } } } }`);
    return nodes<Shipment>(d, 'shippingOrders');
  }
  async suppliers() {
    const d = await this.q<never>(`{ suppliers(first: 200) { edges { node { id name city category rating contactName wechat } } } }`);
    return nodes<Supplier>(d, 'suppliers');
  }
  async rates() {
    const d = await this.q<never>(`{ exchangeRates(first: 100, orderBy: {effectiveDate: DescNullsLast}) { edges { node {
      id pair rate manual setBy effectiveDate } } } }`);
    return nodes<ExchangeRate>(d, 'exchangeRates');
  }
  async setRate(pair: string, rate: number, setBy: string) {
    await this.q(`mutation($data: ExchangeRateCreateInput!) { createExchangeRate(data: $data) { id } }`, {
      data: { name: `${pair} ${rate}`, pair, rate, manual: true, setBy, source: 'MANUAL', effectiveDate: new Date().toISOString().slice(0, 10) },
    });
  }
}

/** In-browser demo data (used for screenshots and when no server is configured). */
export class DemoApi implements Api {
  private wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 450));
  leads() { return this.wait(demo.leads); }
  async updateLeadStatus(id: string, status: LeadStatus) { const l = demo.leads.find((x) => x.id === id); if (l) l.status = status; }
  quotations() { return this.wait(demo.quotations); }
  shipments() { return this.wait(demo.shipments); }
  suppliers() { return this.wait(demo.suppliers); }
  rates() { return this.wait(demo.rates); }
  async setRate(pair: string, rate: number, setBy: string) {
    demo.rates.unshift({ id: crypto.randomUUID(), pair, rate, manual: true, setBy, effectiveDate: new Date().toISOString().slice(0, 10) });
  }
}
