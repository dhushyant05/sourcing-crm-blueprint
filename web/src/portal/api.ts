/** Customer portal client. Its own token (separate from the staff session) and only /api/portal/* endpoints. */
export interface PortalMe { name: string; phone: string; email: string | null; mustChangePassword: boolean; company: string | null; city: string | null }
export interface PortalFile { id: string; name: string; mime: string; size: number; createdAt: string }
export interface PortalQuote { id: string; label: string; product: string; status: 'SENT' | 'ACCEPTED' | 'REJECTED'; sentAt: string | null; decidedAt: string | null;
  qty: number | null; unitPrice: number | null; currency: string; total: number; moq: string | null; leadTime: string | null; validity: string | null; pdfUrl: string; canDecide: boolean }
export interface PortalOrder { id: string; product: string; qty: number; value: number; currency: string; paymentStatus: string; createdAt: string;
  shipment: { reference: string; status: string; mode: string | null; etd: string | null; eta: string | null; tracking: string | null; container: string | null; deliveredAt: string | null } | null }
export interface PortalRequest { id: string; type: 'SOURCING'; reference: string | null; product: string | null; quantity: number | null; unit: string | null; createdAt: string;
  stage: string; stageIndex: number; closed: boolean; quotesWaiting: number;
  deliveryCity?: string | null; message?: string | null; targetPrice?: { amount: number; currency: string } | null;
  files?: PortalFile[]; quotes?: PortalQuote[]; orders?: PortalOrder[]; timeline?: { at: string; kind: string; text: string }[] }
export class PortalHttpError extends Error { status: number; code?: string; constructor(msg: string, status: number, code?: string) { super(msg); this.status = status; this.code = code; } }

const KEY = 'se.portal.token';
export const portalToken = { get: () => localStorage.getItem(KEY), set: (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY)) };

export class PortalApi {
  onAuthError: () => void = () => {};
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const t = portalToken.get();
    const isForm = body instanceof FormData;
    const res = await fetch(`/api/portal${path}`, { method, cache: 'no-store',
      headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { this.onAuthError(); throw new PortalHttpError(j.error ?? 'Please sign in again', 401); }
    if (!res.ok) throw new PortalHttpError(j.error ?? `Something went wrong (${res.status})`, res.status, j.code);
    return j as T;
  }
  async login(phone: string, password: string) {
    const res = await fetch('/api/portal/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new PortalHttpError(j.error ?? 'Sign-in failed', res.status);
    portalToken.set(j.token); return j as { token: string; customer: { name: string; mustChangePassword: boolean } };
  }
  logout() { portalToken.set(null); }
  me() { return this.call<{ data: PortalMe }>('GET', '/me').then((r) => r.data); }
  async changePassword(currentPassword: string, newPassword: string) {
    const r = await this.call<{ token: string; data: PortalMe }>('POST', '/me/password', { currentPassword, newPassword }); portalToken.set(r.token); return r.data;
  }
  requests() { return this.call<{ data: PortalRequest[] }>('GET', '/requests').then((r) => r.data); }
  request(id: string) { return this.call<{ data: PortalRequest }>('GET', `/requests/${encodeURIComponent(id)}`).then((r) => r.data); }
  create(fd: FormData) { return this.call<{ data: PortalRequest }>('POST', '/requests', fd).then((r) => r.data); }
  accept(qid: string) { return this.call<{ data: PortalRequest }>('POST', `/quotes/${encodeURIComponent(qid)}/accept`, {}).then((r) => r.data); }
  reject(qid: string, reasonCode: string, reason: string) { return this.call<{ data: PortalRequest }>('POST', `/quotes/${encodeURIComponent(qid)}/reject`, { reasonCode, reason }).then((r) => r.data); }
  reasons() { return this.call<{ data: string[] }>('GET', '/reject-reasons').then((r) => r.data); }
  /** Opens one of the customer's own uploads (fetched with the token, shown as a blob URL). */
  async openFile(requestId: string, f: PortalFile) {
    const res = await fetch(`/api/portal/requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(f.id)}`, { headers: { authorization: `Bearer ${portalToken.get()}` } });
    if (!res.ok) throw new PortalHttpError('Could not open the file', res.status);
    const url = URL.createObjectURL(await res.blob()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  /** Live "request changed" events for this customer's own requests (SSE over fetch, token in the header). */
  async stream(onChange: (id: string) => void, signal: AbortSignal) {
    const res = await fetch('/api/portal/stream', { headers: { authorization: `Bearer ${portalToken.get()}`, accept: 'text/event-stream' }, signal, cache: 'no-store' });
    if (res.status === 401) { this.onAuthError(); return; }
    if (!res.ok || !res.body) return;
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) return;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2); let ev = '', data = '';
        for (const line of block.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
        if (ev === 'revoked') { this.onAuthError(); return; }
        if (ev === 'change' && data) { try { onChange(JSON.parse(data).id); } catch { /* ignore */ } }
      }
    }
  }
}
