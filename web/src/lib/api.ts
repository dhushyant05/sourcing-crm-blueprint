import type { Attachment, BackupLink, Currency, Lead, LeadStatus, Quotation, Shipment, Supplier, User } from './types';
import type { Role } from './roles';
import { demo } from './demo';

export interface Me { id: string; email: string; name: string; role: Role; language?: string | null }
export interface QuotePrice { unitCost?: number; totalCost?: number; currency?: Currency; clientUnitPrice?: number; clientCurrency?: Currency }
export interface NewLead { clientName: string; productInterest: string; quantity: number; targetPrice?: number; targetCurrency: Currency; summary?: string }
export interface Api {
  leads(): Promise<Lead[]>;
  updateLeadStatus(id: string, status: LeadStatus): Promise<void>;
  quotations(): Promise<Quotation[]>;
  shipments(): Promise<Shipment[]>;
  suppliers(): Promise<Supplier[]>;
  updateQuotePrice(id: string, p: QuotePrice): Promise<void>;
  /** Returns the new lead id. */
  createLead(l: NewLead): Promise<string>;
  /** India side: edit lead fields (e.g. summary). */
  updateLead(id: string, data: Partial<Pick<Lead, 'summary' | 'assignedChinaAgent' | 'status' | 'assignedOffice'>>): Promise<void>;
  /** Hand the lead to the China office (assignedOffice=CHINA, status ASSIGNED). */
  assignToChina(id: string, agent?: string): Promise<void>;
  /** India side: upload product photos / videos / documents to a lead. */
  uploadAttachments(leadId: string, files: File[], onProgress?: (pct: number) => void): Promise<Attachment[]>;
  deleteAttachment(leadId: string, id: string): Promise<void>;
  setLanguage(lang: string): Promise<void>;
  users(): Promise<User[]>;
  createUser(u: { email: string; name: string; role: Role; password: string }): Promise<void>;
  resetPassword(id: string, password: string): Promise<void>;
  setUserActive(id: string, active: boolean): Promise<void>;
  updateUser(id: string, patch: { name?: string; email?: string; role?: Role; active?: boolean }): Promise<void>;
  /** Super admin only: hard delete (leads keep their references). */
  deleteUser(id: string): Promise<void>;
  backups(): Promise<BackupLink[]>;
  /** Enquiry photos/documents of a lead (India side + super admin). */
  attachments(leadId: string): Promise<Attachment[]>;
  /** Downloads one file with the staff token (never a public URL) and returns a blob: URL. */
  attachmentUrl(leadId: string, a: Attachment): Promise<string>;
}

type Raw = Record<string, any>;
const amount = (c?: { amountMicros?: number }) => (c?.amountMicros != null ? c.amountMicros / 1e6 : undefined);
const micros = (v: number, c: Currency) => ({ amountMicros: Math.round(v * 1e6), currencyCode: c });

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
      ...n, contactPhone: n.contactPhone?.primaryPhoneNumber && [n.contactPhone.primaryPhoneCallingCode, n.contactPhone.primaryPhoneNumber].filter(Boolean).join(' '),
      contactEmail: n.contactEmail?.primaryEmail, referenceUrl: n.referenceUrl?.primaryLinkUrl,
      targetPrice: amount(n.targetPrice), targetCurrency: n.targetPrice?.currencyCode,
    })) as Lead[];
  }
  async attachments(leadId: string) { return this.req<Attachment[]>('GET', `/leads/${encodeURIComponent(leadId)}/attachments`); }
  async attachmentUrl(leadId: string, a: Attachment) {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/attachments/${encodeURIComponent(a.id)}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (res.status === 401) this.onAuthError();
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    return URL.createObjectURL(await res.blob());
  }
  async updateLeadStatus(id: string, status: LeadStatus) { await this.req('PATCH', `/records/leads/${id}`, { status }); } // server sets assignedOffice=CHINA for China stages
  async quotations() {
    const [qs, srs, aps, sups] = await Promise.all([this.list('quotations'), this.list('sourcingRequests'), this.list('clientApprovals'),
      this.china ? this.list('suppliers') : Promise.resolve([] as Raw[])]);
    const sr = new Map(srs.map((s) => [s.id, s])), sup = new Map(sups.map((s) => [s.id, s.name]));
    return qs.map((q): Quotation => {
      const s = sr.get(q.sourcingRequestId);
      const ap = aps.filter((a) => a.quotationId === q.id).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0];
      const quantity = s?.quantity ?? (q.unitCost ? Math.round(q.totalCost / q.unitCost) : 1);
      return {
        id: q.id, name: q.name, leadRef: q.leadRef ?? s?.leadRef, leadId: s?.leadId, productName: s?.productDescription ?? s?.name, supplierName: sup.get(q.supplierId),
        unitCost: q.unitCost ?? undefined, totalCost: q.totalCost ?? undefined, currency: q.currency ?? undefined, quantity,
        clientUnitPrice: q.clientUnitPrice ?? undefined, clientCurrency: q.clientCurrency ?? undefined,
        status: ap?.status ?? (q.clientUnitPrice ? 'SENT' : 'DRAFT'), validityDate: q.validityDate, createdAt: q.createdAt,
      };
    });
  }
  async shipments() {
    const [ss, leads] = await Promise.all([this.list('shippingOrders'), this.india ? this.list('leads') : Promise.resolve([] as Raw[])]);
    const client = new Map(leads.map((l) => [l.id, l.clientName]));
    return ss.map((s): Shipment => ({
      id: s.id, name: s.name, leadRef: s.leadRef, clientName: client.get(s.leadId), stage: s.shipmentStatus ?? 'BOOKED', carrier: s.forwarder,
      trackingNumber: s.trackingNumber, origin: s.currentLocation ?? 'China', destination: 'India', eta: s.eta, updatedAt: s.updatedAt ?? s.createdAt,
    }));
  }
  async suppliers() {
    return (await this.list('suppliers')).map((s): Supplier => ({ id: s.id, name: s.name, phone: s.phone?.primaryPhoneNumber, wechat: s.wechatId, notes: s.notes }));
  }
  async updateQuotePrice(id: string, p: QuotePrice) { await this.req('PATCH', `/records/quotations/${id}`, p); }
  async createLead(l: NewLead) {
    const r = await this.req<{ id: string }>('POST', '/records/leads', {
      name: `${l.clientName} – ${l.productInterest}`, clientName: l.clientName, productInterest: l.productInterest, quantity: l.quantity, status: 'NEW',
      assignedOffice: 'INDIA', office: 'INDIA', ...(l.summary ? { summary: l.summary } : {}),
      ...(l.targetPrice ? { targetPrice: micros(l.targetPrice, l.targetCurrency) } : {}),
    });
    return r.id;
  }
  async updateLead(id: string, data: Record<string, unknown>) { await this.req('PATCH', `/records/leads/${id}`, data); }
  async assignToChina(id: string, agent?: string) {
    await this.req('PATCH', `/records/leads/${id}`, { assignedOffice: 'CHINA', status: 'ASSIGNED', ...(agent ? { assignedChinaAgent: agent } : {}) });
  }
  /** XHR (not fetch) so large videos show upload progress. */
  uploadAttachments(leadId: string, files: File[], onProgress?: (pct: number) => void) {
    return new Promise<Attachment[]>((resolve, reject) => {
      const fd = new FormData(); files.forEach((f) => fd.append('files', f, f.name));
      const x = new XMLHttpRequest();
      x.open('POST', `/api/leads/${encodeURIComponent(leadId)}/attachments`);
      x.setRequestHeader('authorization', `Bearer ${this.token}`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      x.onload = () => {
        let j: any = {}; try { j = JSON.parse(x.responseText); } catch { /* empty */ }
        if (x.status === 401) this.onAuthError();
        if (x.status >= 400) reject(new HttpError(j.error ?? `HTTP ${x.status}`, x.status)); else resolve(j.data as Attachment[]);
      };
      x.onerror = () => reject(new HttpError('Network error', 0));
      x.send(fd);
    });
  }
  async deleteAttachment(leadId: string, id: string) { await this.req('DELETE', `/leads/${encodeURIComponent(leadId)}/attachments/${encodeURIComponent(id)}`); }
  async setLanguage(language: string) { await this.req('PATCH', '/me', { language }); }
  users() { return this.req<User[]>('GET', '/users'); }
  async createUser(u: { email: string; name: string; role: Role; password: string }) { await this.req('POST', '/users', u); }
  async resetPassword(id: string, password: string) { await this.req('POST', `/users/${id}/password`, { password }); }
  async setUserActive(id: string, active: boolean) { await this.req('PATCH', `/users/${id}`, { active }); }
  async updateUser(id: string, patch: { name?: string; email?: string; role?: Role; active?: boolean }) { await this.req('PATCH', `/users/${id}`, patch); }
  async deleteUser(id: string) { await this.req('DELETE', `/users/${id}`); }
  backups() { return this.req<BackupLink[]>('GET', '/backups'); }
}

/** In-browser demo data (used for screenshots and the "Explore with demo data" button). No server needed. */
export class DemoApi implements Api {
  private wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 450));
  leads() { return this.wait(demo.leads); }
  async attachments(leadId: string) { return structuredClone(demo.attachments[leadId] ?? []); }
  async attachmentUrl(_leadId: string, a: Attachment) { return demo.files[a.id] ?? ''; }
  async updateLeadStatus(id: string, status: LeadStatus) { const l = demo.leads.find((x) => x.id === id); if (l) l.status = status; }
  quotations() { return this.wait(demo.quotations); }
  shipments() { return this.wait(demo.shipments); }
  suppliers() { return this.wait(demo.suppliers); }
  async updateQuotePrice(id: string, p: QuotePrice) { const q = demo.quotations.find((x) => x.id === id); if (q) Object.assign(q, p); }
  async createLead(l: NewLead) {
    const id = `L${demo.leads.length + 1}`;
    demo.leads.unshift({ id, name: l.clientName, clientName: l.clientName, productInterest: l.productInterest, quantity: l.quantity, summary: l.summary,
      targetPrice: l.targetPrice, targetCurrency: l.targetCurrency, status: 'NEW', createdAt: new Date().toISOString() });
    return id;
  }
  async updateLead(id: string, data: Partial<Lead>) { const l = demo.leads.find((x) => x.id === id); if (l) Object.assign(l, data); }
  async assignToChina(id: string, agent?: string) { await this.updateLead(id, { assignedOffice: 'CHINA', status: 'ASSIGNED', ...(agent ? { assignedChinaAgent: agent } : {}) }); }
  async uploadAttachments(leadId: string, files: File[]) {
    const list = (demo.attachments[leadId] ??= []);
    for (const f of files) { const id = crypto.randomUUID(); demo.files[id] = URL.createObjectURL(f); list.push({ id, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, createdAt: new Date().toISOString() }); }
    return structuredClone(list);
  }
  async deleteAttachment(leadId: string, id: string) { demo.attachments[leadId] = (demo.attachments[leadId] ?? []).filter((a) => a.id !== id); }
  async setLanguage() {}
  users() { return this.wait(demo.users); }
  async createUser(u: { email: string; name: string; role: Role }) {
    demo.users.push({ id: crypto.randomUUID(), email: u.email, name: u.name, role: u.role, active: true, createdAt: new Date().toISOString() });
  }
  async resetPassword() {}
  async setUserActive(id: string, active: boolean) { const u = demo.users.find((x) => x.id === id); if (u) u.active = active; }
  async updateUser(id: string, patch: { name?: string; email?: string; role?: Role; active?: boolean }) { const u = demo.users.find((x) => x.id === id); if (u) Object.assign(u, patch); }
  async deleteUser(id: string) { const i = demo.users.findIndex((x) => x.id === id); if (i >= 0) demo.users.splice(i, 1); }
  backups() { return this.wait([{ label: 'Backup browser (demo)', url: 'https://backups.example.com' }]); }
}
