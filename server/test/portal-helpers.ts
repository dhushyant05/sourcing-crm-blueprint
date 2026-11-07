import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

export const PW = 'correct-horse-1';
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
export const SUP = { name: 'Ningbo Secret Factory', contact: 'Mr Wang', phone: '+86 138', wechat: 'wx_secret', city: 'Ningbo' };
export function form(fields: Record<string, string>, files: { name: string; data: Buffer; type?: string }[] = []) {
  const B = '----se' + Math.random().toString(16).slice(2); const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`), f.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${B}` } };
}

export async function setup() {
  const { db, bus, users } = await testEnv(false);
  const app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'portal-')) });
  const ids: Record<string, string> = {};
  for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['ia', 'INDIA_ADMIN'], ['is', 'INDIA_STAFF'], ['ca', 'CHINA_ADMIN'], ['cs', 'CHINA_STAFF']] as const) ids[e] = (await users.create(`${e}@x.in`, `Staff ${e}`, r, PW)).id;
  const tok: Record<string, string> = {};
  for (const e of Object.keys(ids)) tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: any) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
  const as = (token: string, method: any, url: string, payload?: any, headers: Record<string, string> = {}) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}`, ...headers } });
  let ip = 10;
  /** Public enquiry with "request a login" ticked (each from its own IP so the enquiry rate limit does not interfere). */
  const enquire = async (name: string, phone: string, company: string, extra: Record<string, string> = {}) => (await app.inject({ method: 'POST', url: '/api/public/enquiry',
    remoteAddress: `10.0.0.${ip++}`, payload: { name, phone, product: `${company} widgets`, company, requestLogin: '1', ...extra } })).json();
  const login = async (phone: string, password: string) => app.inject({ method: 'POST', url: '/api/portal/auth/login', remoteAddress: `10.1.0.${ip++}`, payload: { phone, password } });
  /** Enquiry → approve → first login → change password; returns a ready portal token. */
  const customer = async (name: string, phone: string, company: string) => {
    const e = await enquire(name, phone, company);
    const req = (await call('ia', 'GET', '/api/portal-admin/login-requests?status=PENDING')).json().data.find((r: any) => r.leadRef === e.reference);
    const ok = (await call('ia', 'POST', `/api/portal-admin/login-requests/${req.id}/approve`, { customerId: req.customer.id, shareEnquiry: true })).json().data;
    const t0 = (await login(phone, ok.tempPassword)).json().token;
    const ch = (await as(t0, 'POST', '/api/portal/me/password', { currentPassword: ok.tempPassword, newPassword: `${company}-new-pass` })).json();
    return { token: ch.token as string, ref: e.reference as string, customerId: ok.login.customerId as string, password: `${company}-new-pass` };
  };
  /** India staff take a portal-owned lead to an order: China quote → customer quote SENT → customer accepts → India creates the order. */
  const orderFor = async (token: string, leadId: string, qty = 100, price = 50) => {
    await call('ia', 'POST', `/api/leads/${leadId}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${leadId}/quotes`, { newSupplier: { ...SUP, name: `${SUP.name} ${leadId.slice(0, 4)}` }, product: 'Thing', unitPrice: '3', currency: 'CNY' })).json().data;
    await call('cs', 'POST', `/api/leads/${leadId}/assign`, { office: 'INDIA' });
    await call('ia', 'PUT', `/api/quotes/${q.id}/customer`, { qty, unitPrice: price });
    await call('ia', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' });
    if (token) await as(token, 'POST', `/api/portal/quotes/${q.id}/accept`); else await call('ia', 'POST', `/api/quotes/${q.id}/status`, { status: 'ACCEPTED' });
    const o = await call('ia', 'POST', `/api/quotes/${q.id}/order`, {});
    return { quote: q, order: o.json().data };
  };
  /** Opens the portal SSE stream on a real socket and collects what arrives while `during` runs. */
  const sse = async (token: string, during: () => Promise<void>, settleMs = 400) => {
    const addr = await app.listen({ port: 0, host: '127.0.0.1' }).catch(() => `http://127.0.0.1:${(app.server.address() as any).port}`);
    const ac = new AbortController(); let text = '';
    const res = await fetch(`${addr}/api/portal/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
    const rd = res.body!.getReader(), dec = new TextDecoder();
    const pump = (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; text += dec.decode(value); } } catch { /* aborted */ } })();
    await new Promise((r) => setTimeout(r, 150));
    await during(); await new Promise((r) => setTimeout(r, settleMs)); ac.abort(); await pump;
    return { status: res.status, text };
  };
  return { app, call, as, ids, tok, enquire, login, customer, orderFor, sse };
}

