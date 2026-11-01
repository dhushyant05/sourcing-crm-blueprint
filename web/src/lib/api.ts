import type { Attachment, BackupLink, Currency, Lead, LeadStatus, Quotation, Shipment, Supplier, User , AppNotification, StaffLite, Office, LeadQuote, QuoteInput, QuoteSupplier, Order, CustomerQuote, Timeline, Sla, SlaSettings, SlaReport } from './types';
import type { Role } from './roles';
import { demo } from './demo';

export interface Me { id: string; email: string; name: string; role: Role; language?: string | null; avatarUrl?: string | null }
export interface QuotePrice { unitCost?: number; totalCost?: number; currency?: Currency; clientUnitPrice?: number; clientCurrency?: Currency }
export interface NewLead { clientName: string; productInterest: string; quantity: number; targetPrice?: number; targetCurrency: Currency; summary?: string }
export interface Api {
  leads(): Promise<Lead[]>;
  updateLeadStatus(id: string, status: LeadStatus): Promise<void>;
  deleteLead(id: string): Promise<void>;
  quotations(): Promise<Quotation[]>;
  shipments(): Promise<Shipment[]>;
  updateShipment?(id: string, b: Record<string, unknown>): Promise<Shipment>;
  suppliers(): Promise<Supplier[]>;
  updateQuotePrice(id: string, p: QuotePrice): Promise<void>;
  /** Returns the new lead id. */
  createLead(l: NewLead): Promise<string>;
  /** India side: edit lead fields (e.g. summary). */
  updateLead(id: string, data: Partial<Pick<Lead, 'summary' | 'assignedChinaAgent' | 'status' | 'assignedOffice'>>): Promise<void>;
  /** Hand the lead to the China office (assignedOffice=CHINA, status ASSIGNED). */
  assignToChina(id: string, agent?: string): Promise<void>;
  /** Leads; mine=true → only leads currently assigned to me. */
  leads(mine?: boolean): Promise<Lead[]>;
  lead(id: string): Promise<Lead | null>;
  /** Send / return / reassign a lead. assignedTo null = office queue, undefined = server default (China: queue, India: raiser). */
  assignLead(id: string, office: Office, assignedTo?: string | null): Promise<Lead>;
  staff(office: Office): Promise<StaffLite[]>;
  notifications(): Promise<{ data: AppNotification[]; unread: number }>;
  markNotificationRead(id?: string): Promise<void>;
  streamNotifications?(onEvent: (ev: string, data: any) => void, signal: AbortSignal): Promise<void>;
  /** India side: upload product photos / videos / documents to a lead. */
  uploadAttachments(leadId: string, files: File[], onProgress?: (pct: number) => void): Promise<Attachment[]>;
  deleteAttachment(leadId: string, id: string): Promise<void>;
  setLanguage(lang: string): Promise<void>;
  /** Upload (already cropped) or remove my picture; super admin can do it for any user via userId. */
  setAvatar(file: Blob, userId?: string): Promise<string | null>;
  removeAvatar(userId?: string): Promise<void>;
  /** Returns a fresh token for this device; every other session is signed out. */
  changePassword(current: string, next: string): Promise<string>;
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
  /** Supplier quotes on a lead (China adds; India sees them without supplier identity). */
  quotes(leadId: string): Promise<LeadQuote[]>;
  createQuote(leadId: string, q: QuoteInput): Promise<LeadQuote>;
  updateQuote(id: string, q: QuoteInput | { clientPrice?: number | string | null; clientCurrency?: string; clientNotes?: string }): Promise<LeadQuote>;
  deleteQuote(id: string): Promise<void>;
  uploadQuoteFiles(id: string, files: File[], onProgress?: (pct: number) => void): Promise<LeadQuote>;
  quoteFileUrl(id: string, a: Attachment): Promise<string>;
  deleteQuoteFile(id: string, fid: string): Promise<void>;
  quoteSuppliers(): Promise<QuoteSupplier[]>;
  /** Every quote across the leads this user can read (role-filtered on the server). */
  allQuotes(f?: { status?: string; office?: string; mine?: boolean }): Promise<LeadQuote[]>;
  saveCustomerQuote(id: string, c: Partial<Record<keyof CustomerQuote, string | number | null>>): Promise<LeadQuote>;
  quotePdf(id: string): Promise<LeadQuote>;
  setQuoteStatus(id: string, status: string, reason?: string, reasonCode?: string): Promise<LeadQuote>;
  reviseRejected?(leadId: string, b: { targetPrice?: number | null; targetCurrency?: string; notes?: string }): Promise<Lead>;
  closeRejected?(leadId: string): Promise<Lead>;
  createOrder(quoteId: string, b: Record<string, unknown>): Promise<Order>;
  orders(): Promise<Order[]>;
  updateOrder(id: string, b: Record<string, unknown>): Promise<Order>;
  setRaiser(leadId: string, userId: string | null): Promise<Lead>;
  /** Downloads one file with the staff token (never a public URL) and returns a blob: URL. */
  attachmentUrl(leadId: string, a: Attachment): Promise<string>;
  /** Workflow timeline (role-filtered on the server), progress stage and SLA clock. */
  timeline?(leadId: string): Promise<Timeline>;
  setPriority?(leadId: string, priority: boolean): Promise<{ priority: boolean; sla: Sla | null }>;
  slaSettings?(): Promise<SlaSettings>;
  saveSlaSettings?(s: SlaSettings): Promise<SlaSettings>;
  slaReport?(days?: number): Promise<SlaReport>;
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
  private get china() { return this.role === 'SUPER_ADMIN' || this.role.startsWith('CHINA'); }

  private mapLead = (n: Raw): Lead => ({
      ...n, contactPhone: n.contactPhone?.primaryPhoneNumber && [n.contactPhone.primaryPhoneCallingCode, n.contactPhone.primaryPhoneNumber].filter(Boolean).join(' '),
      contactEmail: n.contactEmail?.primaryEmail, referenceUrl: n.referenceUrl?.primaryLinkUrl,
      targetPrice: amount(n.targetPrice), targetCurrency: n.targetPrice?.currencyCode,
    }) as Lead;
  async leads(mine?: boolean) { return (await this.req<Raw[]>('GET', `/records/leads${mine ? '?assignedTo=me' : ''}`)).map(this.mapLead); }
  async lead(id: string) { try { return this.mapLead(await this.req<Raw>('GET', `/records/leads/${encodeURIComponent(id)}`)); } catch { return null; } }
  async assignLead(id: string, office: Office, assignedTo?: string | null) {
    return this.mapLead(await this.req<Raw>('POST', `/leads/${encodeURIComponent(id)}/assign`, { office, ...(assignedTo !== undefined ? { assignedTo } : {}) }));
  }
  async setAvatar(file: Blob, userId?: string) {
    const fd = new FormData(); fd.append('file', file, 'avatar.jpg');
    const res = await fetch(userId ? `/api/users/${encodeURIComponent(userId)}/avatar` : '/api/me/avatar', { method: 'POST', body: fd, headers: { authorization: `Bearer ${this.token}` } });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) this.onAuthError();
    if (!res.ok) throw new HttpError(j.error ?? `HTTP ${res.status}`, res.status);
    return (userId ? j.data?.avatarUrl : j.avatarUrl) ?? null;
  }
  async removeAvatar(userId?: string) {
    const res = await fetch(userId ? `/api/users/${encodeURIComponent(userId)}/avatar` : '/api/me/avatar', { method: 'DELETE', headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
  }
  async changePassword(current: string, next: string) {
    const res = await fetch('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }), headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(j.error ?? `HTTP ${res.status}`, res.status);
    return j.token as string;
  }
  staff(office: Office) { return this.req<StaffLite[]>('GET', `/staff?office=${office}`); }
  timeline(id: string) { return this.req<Timeline>('GET', `/leads/${encodeURIComponent(id)}/timeline`); }
  setPriority(id: string, priority: boolean) { return this.req<{ priority: boolean; sla: Sla | null }>('POST', `/leads/${encodeURIComponent(id)}/priority`, { priority }); }
  slaSettings() { return this.req<SlaSettings>('GET', '/settings/sla'); }
  saveSlaSettings(s: SlaSettings) { return this.req<SlaSettings>('PUT', '/settings/sla', s); }
  slaReport(days = 30) { return this.req<SlaReport>('GET', `/sla/report?days=${days}`); }
  async notifications() {
    const res = await fetch('/api/notifications', { headers: { authorization: `Bearer ${this.token}` } });
    if (res.status === 401) this.onAuthError();
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    return res.json() as Promise<{ data: AppNotification[]; unread: number }>;
  }
  /** Opens the real-time notification stream (SSE over fetch so the JWT stays in the Authorization header). Resolves when it ends. */
  async streamNotifications(onEvent: (ev: string, data: any) => void, signal: AbortSignal) {
    const res = await fetch('/api/notifications/stream', { headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' }, signal, cache: 'no-store' });
    if (res.status === 401) { this.onAuthError(); return; }
    if (!res.ok || !res.body) throw new HttpError(`HTTP ${res.status}`, res.status);
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) return;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
        if (data) { try { onEvent(ev, JSON.parse(data)); } catch { /* ignore */ } }
      }
    }
  }
  async markNotificationRead(id?: string) { await this.req('POST', id ? `/notifications/${encodeURIComponent(id)}/read` : '/notifications/read-all', {}); }
  async attachments(leadId: string) { return this.req<Attachment[]>('GET', `/leads/${encodeURIComponent(leadId)}/attachments`); }
  async attachmentUrl(leadId: string, a: Attachment) {
    const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/attachments/${encodeURIComponent(a.id)}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (res.status === 401) this.onAuthError();
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    return URL.createObjectURL(await res.blob());
  }
  async deleteLead(id: string) { await this.req('DELETE', `/records/leads/${encodeURIComponent(id)}`); }
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
  shipments() { return this.req<Shipment[]>('GET', '/shipments'); }
  updateShipment(id: string, b: Record<string, unknown>) { return this.req<Shipment>('PATCH', `/shipments/${id}`, b); }
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
  quotes(leadId: string) { return this.req<LeadQuote[]>('GET', `/leads/${encodeURIComponent(leadId)}/quotes`); }
  createQuote(leadId: string, q: QuoteInput) { return this.req<LeadQuote>('POST', `/leads/${encodeURIComponent(leadId)}/quotes`, q); }
  updateQuote(id: string, q: object) { return this.req<LeadQuote>('PATCH', `/quotes/${encodeURIComponent(id)}`, q); }
  async deleteQuote(id: string) { await this.req('DELETE', `/quotes/${encodeURIComponent(id)}`); }
  uploadQuoteFiles(id: string, files: File[], onProgress?: (pct: number) => void) { return this.xhrUpload<LeadQuote>(`/api/quotes/${encodeURIComponent(id)}/files`, files, onProgress); }
  async quoteFileUrl(id: string, a: Attachment) {
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}/files/${encodeURIComponent(a.id)}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (res.status === 401) this.onAuthError();
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    return URL.createObjectURL(await res.blob());
  }
  async deleteQuoteFile(id: string, fid: string) { await this.req('DELETE', `/quotes/${encodeURIComponent(id)}/files/${encodeURIComponent(fid)}`); }
  quoteSuppliers() { return this.req<QuoteSupplier[]>('GET', '/suppliers'); }
  allQuotes(f: { status?: string; office?: string; mine?: boolean } = {}) {
    const p = new URLSearchParams(); if (f.status) p.set('status', f.status); if (f.office) p.set('office', f.office); if (f.mine) p.set('mine', '1');
    return this.req<LeadQuote[]>('GET', `/quotes${p.size ? `?${p}` : ''}`);
  }
  saveCustomerQuote(id: string, c: object) { return this.req<LeadQuote>('PUT', `/quotes/${encodeURIComponent(id)}/customer`, c); }
  quotePdf(id: string) { return this.req<LeadQuote>('POST', `/quotes/${encodeURIComponent(id)}/pdf`); }
  setQuoteStatus(id: string, status: string, reason?: string, reasonCode?: string) { return this.req<LeadQuote>('POST', `/quotes/${encodeURIComponent(id)}/status`, { status, reason, reasonCode }); }
  async reviseRejected(leadId: string, b: Record<string, unknown>) { return this.mapLead(await this.req<Raw>('POST', `/leads/${encodeURIComponent(leadId)}/rejection/revise`, b)); }
  async closeRejected(leadId: string) { return this.mapLead(await this.req<Raw>('POST', `/leads/${encodeURIComponent(leadId)}/rejection/close`, {})); }
  createOrder(quoteId: string, b: Record<string, unknown>) { return this.req<Order>('POST', `/quotes/${encodeURIComponent(quoteId)}/order`, b); }
  orders() { return this.req<Order[]>('GET', '/orders'); }
  updateOrder(id: string, b: Record<string, unknown>) { return this.req<Order>('PATCH', `/orders/${encodeURIComponent(id)}`, b); }
  setRaiser(leadId: string, userId: string | null) { return this.req<Lead>('POST', `/leads/${encodeURIComponent(leadId)}/assign`, { raisedBy: userId }); }
  uploadAttachments(leadId: string, files: File[], onProgress?: (pct: number) => void) { return this.xhrUpload<Attachment[]>(`/api/leads/${encodeURIComponent(leadId)}/attachments`, files, onProgress); }
  /** XHR (not fetch) so large videos show upload progress. */
  private xhrUpload<T>(url: string, files: File[], onProgress?: (pct: number) => void) {
    return new Promise<T>((resolve, reject) => {
      const fd = new FormData(); files.forEach((f) => fd.append('files', f, f.name));
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('authorization', `Bearer ${this.token}`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      x.onload = () => {
        let j: any = {}; try { j = JSON.parse(x.responseText); } catch { /* empty */ }
        if (x.status === 401) this.onAuthError();
        if (x.status >= 400) reject(new HttpError(j.error ?? `HTTP ${x.status}`, x.status)); else resolve(j.data as T);
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
  leads(mine?: boolean) { return this.wait(mine ? demo.leads.filter((l) => l.assignedTo === 'demo-me') : demo.leads); }
  async lead(id: string) { return structuredClone(demo.leads.find((l) => l.id === id) ?? null); }
  async assignLead(id: string, office: Office, assignedTo?: string | null) {
    const l = demo.leads.find((x) => x.id === id)!;
    const to = assignedTo === undefined ? (office === 'INDIA' ? l.raisedBy ?? null : null) : assignedTo;
    Object.assign(l, { ownerOffice: office, assignedTo: to, assignedToName: demoStaff.find((s) => s.id === to)?.name ?? null, ...(office === 'CHINA' ? { assignedOffice: 'CHINA', status: l.status === 'NEW' ? 'ASSIGNED' : l.status } : {}) });
    return structuredClone(l);
  }
  async setAvatar() { return null; }
  async removeAvatar() {}
  async changePassword(): Promise<string> { throw new Error('Not available in demo'); }
  async staff(office: Office) { return demoStaff.filter((s) => s.role.startsWith(office)); }
  async notifications() { return structuredClone({ data: demoNotes, unread: demoNotes.filter((n) => !n.read).length }); }
  async markNotificationRead(id?: string) { demoNotes.forEach((n) => { if (!id || n.id === id) n.read = true; }); }
  async attachments(leadId: string) { return structuredClone(demo.attachments[leadId] ?? []); }
  private dq: LeadQuote[] = []; private ds: QuoteSupplier[] = [{ id: 'ds1', name: 'Yiwu Hardware Co.', contact: 'Ms Li', phone: '+86 139 0000 0000', wechat: 'yiwu_hw', city: 'Yiwu' }];
  async quotes(leadId: string) { return structuredClone(this.dq.filter((q) => q.leadId === leadId)); }
  async allQuotes() { return structuredClone(this.dq.map((q) => ({ ...q, status: q.status ?? 'DRAFT', leadRef: demo.leads.find((l) => l.id === q.leadId)?.leadRef ?? null }))); }
  async saveCustomerQuote(id: string, c: any) { const q = this.dq.find((x) => x.id === id)!; const n = (k: string) => Number(c[k] ?? 0); q.cq = { qty: n('qty'), unitPrice: n('unitPrice'), gstPct: n('gstPct'), shipCost: n('shipCost'), otherCharges: n('otherCharges'), shipTerm: c.shipTerm ?? null, shipMode: c.shipMode ?? null, port: c.port ?? null, transit: c.transit ?? null, otherLabel: c.otherLabel ?? null, validity: c.validity ?? null, terms: c.terms ?? null };
    const sub = q.cq.qty * q.cq.unitPrice, tx = sub + q.cq.shipCost + q.cq.otherCharges; q.cqTotals = { subtotal: sub, taxable: tx, gst: tx * q.cq.gstPct / 100, total: tx * (1 + q.cq.gstPct / 100) }; q.clientPrice = q.cq.unitPrice; return structuredClone(q); }
  async quotePdf(id: string) { const q = this.dq.find((x) => x.id === id)!; q.pdfUrl = '#demo'; return structuredClone(q); }
  async setQuoteStatus(id: string, status: string, reason?: string) { const q = this.dq.find((x) => x.id === id)!; Object.assign(q, { status, rejectReason: reason ?? null, ...(status === 'SENT' ? { sentAt: new Date().toISOString() } : {}) }); return structuredClone(q); }
  private dor: Order[] = [];
  async createOrder(quoteId: string, b: any) { const q = this.dq.find((x) => x.id === quoteId)!; const o: Order = { id: `do${Date.now()}`, leadId: q.leadId, quoteId, leadRef: null, product: q.product, qty: Number(b.qty ?? q.cq?.qty ?? 0), agreedPrice: Number(b.agreedPrice ?? q.cq?.unitPrice ?? 0), advance: Number(b.advance ?? 0), paymentStatus: b.paymentStatus ?? 'PENDING', expectedShip: b.expectedShip ?? null, production: 'NEW', tracking: null, container: null, etd: null, eta: null, indiaStatus: 'NONE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), leadStatus: 'WON' }; this.dor.push(o); q.orderId = o.id; return structuredClone(o); }
  async orders() { return structuredClone(this.dor); }
  async updateOrder(id: string, b: any) { const o = this.dor.find((x) => x.id === id)!; Object.assign(o, b); return structuredClone(o); }
  async setRaiser(leadId: string, userId: string | null) { const l = demo.leads.find((x) => x.id === leadId)!; Object.assign(l, { raisedBy: userId, raisedByName: demoStaff.find((s) => s.id === userId)?.name ?? null }); return structuredClone(l); }
  async createQuote(leadId: string, q: QuoteInput) {
    let supplierId = q.supplierId ?? null;
    if (q.newSupplier) { const s = { id: `ds${Date.now()}`, ...q.newSupplier }; this.ds.push(s); supplierId = s.id; }
    const nq: LeadQuote = { id: `dq${Date.now()}`, leadId, product: q.product ?? '', unitPrice: Number(q.unitPrice ?? 0), currency: q.currency ?? 'USD', moq: q.moq, leadTime: q.leadTime, validity: q.validity, notes: q.notes,
      supplierId, supplier: this.ds.find((s) => s.id === supplierId) ?? null, createdBy: 'demo-me', createdByName: 'Demo', canEdit: true, files: [], createdAt: new Date().toISOString() };
    this.dq.push(nq); return structuredClone(nq);
  }
  async updateQuote(id: string, p: any) {
    const q = this.dq.find((x) => x.id === id)!; Object.assign(q, p, p.unitPrice != null ? { unitPrice: Number(p.unitPrice) } : {}, p.clientPrice != null ? { clientPrice: Number(p.clientPrice), clientCurrency: 'INR' } : {});
    if (p.supplierId) q.supplier = this.ds.find((s) => s.id === p.supplierId) ?? null; return structuredClone(q);
  }
  async deleteQuote(id: string) { this.dq = this.dq.filter((q) => q.id !== id); }
  async uploadQuoteFiles(id: string, files: File[]) {
    const q = this.dq.find((x) => x.id === id)!; q.files.push(...files.map((f, i) => ({ id: `df${Date.now()}${i}`, name: f.name, mime: f.type, size: f.size, createdAt: new Date().toISOString() }))); return structuredClone(q);
  }
  async quoteFileUrl() { return ''; }
  async deleteQuoteFile(id: string, fid: string) { const q = this.dq.find((x) => x.id === id); if (q) q.files = q.files.filter((f) => f.id !== fid); }
  async quoteSuppliers() { return structuredClone(this.ds); }
  async attachmentUrl(_leadId: string, a: Attachment) { return demo.files[a.id] ?? ''; }
  async deleteLead(id: string) { demo.leads = demo.leads.filter((x) => x.id !== id); }
  async updateLeadStatus(id: string, status: LeadStatus) { const l = demo.leads.find((x) => x.id === id); if (l) l.status = status; }
  quotations() { return this.wait(demo.quotations); }
  async shipments(): Promise<Shipment[]> { return []; }
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

const demoStaff: StaffLite[] = [
  { id: 'demo-me', name: 'Dhushyanth Kumar', role: 'INDIA_STAFF' }, { id: 'demo-asha', name: 'Asha', role: 'INDIA_STAFF' },
  { id: 'demo-li', name: 'Li Wei', role: 'CHINA_STAFF' }, { id: 'demo-chen', name: 'Chen Jing', role: 'CHINA_ADMIN' },
];
const demoNotes: AppNotification[] = [
  { id: 'n1', leadId: 'L2', leadRef: 'SE-2611-0002', product: 'Bamboo cutting boards', kind: 'RETURNED', office: 'INDIA', byName: 'Li Wei', createdAt: new Date(Date.now() - 12 * 60e3).toISOString(), read: false },
  { id: 'n2', leadId: 'L1', leadRef: 'SE-2611-0001', product: 'Steel water bottles', kind: 'ASSIGNED', office: 'INDIA', byName: 'Chen Jing', createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(), read: true },
];
