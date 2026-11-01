import type { BackupLink, Currency, ExchangeRate, Lead, LeadStatus, Quotation, Shipment, Supplier, User } from './types';
import type { Role } from './roles';
import { demo } from './demo';

export interface Me { id: string; email: string; name: string; role: Role }
export interface Api {
  leads(): Promise<Lead[]>;
  updateLeadStatus(id: string, status: LeadStatus): Promise<void>;
  quotations(): Promise<Quotation[]>;
  shipments(): Promise<Shipment[]>;
  suppliers(): Promise<Supplier[]>;
  rates(): Promise<ExchangeRate[]>;
  setRate(pair: string, rate: number, by: string): Promise<void>;
  users(): Promise<User[]>;
  createUser(u: { email: string; name: string; role: Role; password: string }): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;
  setUserActive(id: string, active: boolean): Promise<void>;
  backups(): Promise<BackupLink[]>;
}

type Raw = Record<string, any>;
const amount = (c?: { amountMicros?: number }) => (c?.amountMicros != null ? c.amountMicros / 1e6 : undefined);
const today = () => new Date().toISOString().slice(0, 10);

export class HttpError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }

/** Sign in against the Source Easy server (same origin). Returns a JWT; no Twenty key ever reaches the browser. */
export async function login(email: string, password: string): Promise<{ token: string; user: Me }> {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(j.error ?? 'Sign-in failed', res.status);
  return j;
}

/**
 * Client for the Source Easy server's REST API. The server already removed every record/field the
 * signed-in role may not see; this class only reshapes Twenty field names into the dashboard's view models.
 */
export class ServerApi implements Api {
  private token: string; private role: Role; private onAuthError: () => void;
  constructor(token: string, role: Role, onAuthError: () => void) { this.token = token; this.role = role; this.onAuthError = onAuthError; }
  private async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) this.onAuthError();
    if (!res.ok) throw new HttpError(j.error ?? `HTTP ${res.status}`, res.status);
    return j.data as T;
  }
  private list = (plural: string) => this.req<Raw[]>('GET', `/records/${plural}`);
  private get india() { return this.role === 'SUPER_ADMIN' || this.role.startsWith('INDIA'); }
  private get china() { return this.role === 'SUPER_ADMIN' || this.role.startsWith('CHINA'); }

  async leads() {
    return (await this.list('leads')).map((n) => ({
      ...n, contactPhone: n.contactPhone?.primaryPhoneNumber, contactEmail: n.contactEmail?.primaryEmail,
      targetPrice: amount(n.targetPrice), targetCurrency: n.targetPrice?.currencyCode,
    })) as Lead[];
  }
  async updateLeadStatus(id: string, status: LeadStatus) { await this.req('PATCH', `/records/leads/${id}`, { status }); }
  async quotations() {
    const [qs, srs, aps, sups] = await Promise.all([this.list('quotations'), this.list('sourcingRequests'), this.list('clientApprovals'),
      this.china ? this.list('suppliers') : Promise.resolve([] as Raw[])]);
    const sr = new Map(srs.map((s) => [s.id, s])), sup = new Map(sups.map((s) => [s.id, s.name]));
    return qs.map((q): Quotation => {
      const s = sr.get(q.sourcingRequestId);
      const ap = aps.filter((a) => a.quotationId === q.id).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0];
      const quantity = s?.quantity ?? (q.unitCost ? Math.round(q.totalCost / q.unitCost) : 1);
      return {
        id: q.id, name: q.name, leadId: s?.leadId, productName: s?.productDescription ?? s?.name, supplierName: sup.get(q.supplierId),
        unitCost: q.unitCost, unitCostInr: q.unitCostInr, currency: (q.currency ?? 'INR') as Currency, quantity,
        exchangeRateUsed: q.exchangeRateUsed, clientUnitPriceInr: q.clientUnitPriceInr ?? undefined,
        status: ap?.status ?? (q.clientUnitPriceInr ? 'SENT' : 'DRAFT'), validityDate: q.validityDate, createdAt: q.createdAt,
      };
    });
  }
  async shipments() {
    const [ss, leads] = await Promise.all([this.list('shippingOrders'), this.india ? this.list('leads') : Promise.resolve([] as Raw[])]);
    const client = new Map(leads.map((l) => [l.id, l.clientName]));
    return ss.map((s): Shipment => ({
      id: s.id, name: s.name, clientName: client.get(s.leadId), stage: s.shipmentStatus ?? 'BOOKED', carrier: s.forwarder,
      trackingNumber: s.trackingNumber, origin: s.currentLocation ?? 'China', destination: 'India', eta: s.eta, updatedAt: s.updatedAt ?? s.createdAt,
    }));
  }
  async suppliers() {
    return (await this.list('suppliers')).map((s): Supplier => ({ id: s.id, name: s.name, phone: s.phone?.primaryPhoneNumber, wechat: s.wechatId, notes: s.notes }));
  }
  async rates() {
    return (await this.list('exchangeRates')).map((r): ExchangeRate => ({
      id: r.id, pair: r.currencyPair, rate: r.rate, manual: !!r.isManualOverride, setBy: r.setBy, effectiveDate: r.effectiveDate ?? r.createdAt?.slice(0, 10),
    }));
  }
  async setRate(pair: string, rate: number) {
    await this.req('POST', '/records/exchangeRates', { name: `${pair} ${rate}`, currencyPair: pair, rate, isManualOverride: true, source: 'MANUAL', effectiveDate: today() });
  }
  users() { return this.req<User[]>('GET', '/users'); }
  async createUser(u: { email: string; name: string; role: Role; password: string }) { await this.req('POST', '/users', u); }
  async resetPassword(id: string, password: string) { await this.req('POST', `/users/${id}/password`, { password }); }
  async setUserActive(id: string, active: boolean) { await this.req('PATCH', `/users/${id}`, { active }); }
  backups() { return this.req<BackupLink[]>('GET', '/backups'); }
}

/** In-browser demo data (used for screenshots and the "Explore with demo data" button). No server needed. */
export class DemoApi implements Api {
  private wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 450));
  leads() { return this.wait(demo.leads); }
  async updateLeadStatus(id: string, status: LeadStatus) { const l = demo.leads.find((x) => x.id === id); if (l) l.status = status; }
  quotations() { return this.wait(demo.quotations); }
  shipments() { return this.wait(demo.shipments); }
  suppliers() { return this.wait(demo.suppliers); }
  rates() { return this.wait(demo.rates); }
  async setRate(pair: string, rate: number, setBy: string) {
    demo.rates.unshift({ id: crypto.randomUUID(), pair, rate, manual: true, setBy, effectiveDate: today() });
  }
  users() { return this.wait(demo.users); }
  async createUser(u: { email: string; name: string; role: Role }) {
    demo.users.push({ id: crypto.randomUUID(), email: u.email, name: u.name, role: u.role, active: true, createdAt: new Date().toISOString() });
  }
  async resetPassword() {}
  async setUserActive(id: string, active: boolean) { const u = demo.users.find((x) => x.id === id); if (u) u.active = active; }
  backups() { return this.wait([{ label: 'Backup browser (demo)', url: 'https://backups.example.com' }]); }
}
