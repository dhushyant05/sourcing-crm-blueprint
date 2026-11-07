import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-1';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SUP = { name: 'Ningbo Secret Factory', contact: 'Mr Wang', phone: '+86 138', wechat: 'wx_secret', city: 'Ningbo' };
function form(fields: Record<string, string>, files: { name: string; data: Buffer; type?: string }[] = []) {
  const B = '----se' + Math.random().toString(16).slice(2); const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`), f.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${B}` } };
}

async function setup() {
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
    const ok = (await call('ia', 'POST', `/api/portal-admin/login-requests/${req.id}/approve`, {})).json().data;
    const t0 = (await login(phone, ok.tempPassword)).json().token;
    const ch = (await as(t0, 'POST', '/api/portal/me/password', { currentPassword: ok.tempPassword, newPassword: `${company}-new-pass` })).json();
    return { token: ch.token as string, ref: e.reference as string, customerId: ok.login.customerId as string, password: `${company}-new-pass` };
  };
  return { app, call, as, ids, enquire, login, customer };
}

describe('customer portal: login requests and manual provisioning', () => {
  it('enquiry raises a request; only India admin / super admin approve; temp password must be changed; sessions revoke', async () => {
    const { call, as, enquire, login } = await setup();
    const e = await enquire('Asha', '9876543210', 'Asha Traders');
    expect(e.loginRequested).toBe(true);
    expect((await call('ia', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'LOGIN_REQUEST' && n.leadRef === e.reference)).toBe(true);
    for (const who of ['is', 'ca', 'cs']) expect((await call(who, 'GET', '/api/portal-admin/login-requests')).statusCode).toBe(403);
    const list = (await call('ia', 'GET', '/api/portal-admin/login-requests')).json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'PENDING', leadRef: e.reference, hasLogin: false });
    expect(list[0].customer?.id).toBeTruthy(); // linked to the auto-built directory customer
    // A repeat enquiry from the same phone does not create a second open request.
    await enquire('Asha', '9876543210', 'Asha Traders');
    expect((await call('sa', 'GET', '/api/portal-admin/login-requests?status=PENDING')).json().data).toHaveLength(1);
    // China can never approve, India staff neither.
    expect((await call('is', 'POST', `/api/portal-admin/login-requests/${list[0].id}/approve`, {})).statusCode).toBe(403);
    const ok = await call('ia', 'POST', `/api/portal-admin/login-requests/${list[0].id}/approve`, {});
    expect(ok.statusCode).toBe(200);
    const { tempPassword, login: lv } = ok.json().data;
    expect(tempPassword).toMatch(/^[A-Za-z2-9]{12}$/);
    expect(JSON.stringify(lv)).not.toMatch(/hash/i);
    expect((await call('ia', 'POST', `/api/portal-admin/login-requests/${list[0].id}/approve`, {})).statusCode).toBe(409);
    // Wrong password / unknown phone → 401; right one with +91 or spaces works (phone key).
    expect((await login('9876543210', 'nope-nope')).statusCode).toBe(401);
    const l = await login('+91 98765 43210', tempPassword);
    expect(l.statusCode).toBe(200);
    const t0 = l.json().token;
    expect(l.json().customer.mustChangePassword).toBe(true);
    // Until the temporary password is changed, only /me and /me/password work.
    expect((await as(t0, 'GET', '/api/portal/requests')).json().code).toBe('password_change');
    expect((await as(t0, 'GET', '/api/portal/me')).statusCode).toBe(200);
    expect((await as(t0, 'POST', '/api/portal/me/password', { currentPassword: 'wrong', newPassword: 'long-enough-1' })).statusCode).toBe(400);
    expect((await as(t0, 'POST', '/api/portal/me/password', { currentPassword: tempPassword, newPassword: 'short' })).statusCode).toBe(400);
    const ch = await as(t0, 'POST', '/api/portal/me/password', { currentPassword: tempPassword, newPassword: 'long-enough-1' });
    expect(ch.statusCode).toBe(200);
    const t1 = ch.json().token;
    expect((await as(t0, 'GET', '/api/portal/me')).statusCode).toBe(401); // old session revoked
    expect((await as(t1, 'GET', '/api/portal/requests')).statusCode).toBe(200);
    // Staff reset → new temporary password, all sessions revoked; disable → no access.
    const cid = lv.customerId;
    expect((await call('is', 'POST', `/api/customers/${cid}/portal-login/reset`)).statusCode).toBe(403);
    const rs = (await call('sa', 'POST', `/api/customers/${cid}/portal-login/reset`)).json().data;
    expect((await as(t1, 'GET', '/api/portal/me')).statusCode).toBe(401);
    const t2 = (await login('9876543210', rs.tempPassword)).json().token;
    expect((await call('ia', 'POST', `/api/customers/${cid}/portal-login/active`, { active: false })).statusCode).toBe(200);
    expect((await as(t2, 'GET', '/api/portal/me')).statusCode).toBe(401);
    expect((await login('9876543210', rs.tempPassword)).statusCode).toBe(401);
    // One login per customer, one per phone.
    expect((await call('ia', 'POST', `/api/customers/${cid}/portal-login`, {})).statusCode).toBe(409);
    const other = (await call('ia', 'POST', '/api/customers', { name: 'Other Co', phone: '+91 98765 43210' })).json().data;
    expect((await call('ia', 'POST', `/api/customers/${other.id}/portal-login`, {})).json().code).toBe('phone_taken');
    // Audit trail for staff (India admin / super admin).
    const audit = (await call('ia', 'GET', `/api/customers/${cid}/portal-login`)).json().data.audit.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['LOGIN_ISSUED', 'LOGIN', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'LOGIN_DISABLED']));
  });

  it('reject needs a reason; login brute force is rate limited', async () => {
    const { app, call, enquire } = await setup();
    await enquire('Ravi', '9123456789', 'Ravi Co');
    const r = (await call('ia', 'GET', '/api/portal-admin/login-requests')).json().data[0];
    expect((await call('ia', 'POST', `/api/portal-admin/login-requests/${r.id}/reject`, {})).statusCode).toBe(400);
    expect((await call('ia', 'POST', `/api/portal-admin/login-requests/${r.id}/reject`, { reason: 'Not a real buyer' })).json().data.status).toBe('REJECTED');
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await app.inject({ method: 'POST', url: '/api/portal/auth/login', remoteAddress: '10.9.9.9', payload: { phone: '9123456789', password: 'x' } })).statusCode);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[6]).toBe(429);
  });
});

describe('customer portal: realm separation and per-customer isolation', () => {
  it('staff and portal tokens never cross; customers only see their own requests, files and published quotes', async () => {
    const { app, call, as, ids, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const B = await customer('Bala', '9988776655', 'Bala Exports');
    // Realms
    for (const u of ['/api/records/leads', '/api/me', '/api/customers', '/api/notifications']) expect((await as(A.token, 'GET', u)).statusCode).toBe(401);
    expect((await call('sa', 'GET', '/api/portal/requests')).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/portal/requests' })).statusCode).toBe(401);
    // Each customer sees exactly their own enquiry.
    const la = (await as(A.token, 'GET', '/api/portal/requests')).json().data, lb = (await as(B.token, 'GET', '/api/portal/requests')).json().data;
    expect(la.map((x: any) => x.reference)).toEqual([A.ref]); expect(lb.map((x: any) => x.reference)).toEqual([B.ref]);
    expect((await as(B.token, 'GET', `/api/portal/requests/${la[0].id}`)).statusCode).toBe(404);

    // A raises a sourcing request with a photo from the portal → India queue.
    const up = form({ product: 'Steel water bottles 750ml', quantity: '500', unit: 'pcs', deliveryCity: 'Chennai' }, [{ name: 'bottle.png', data: PNG, type: 'image/png' }]);
    const cr = await app.inject({ method: 'POST', url: '/api/portal/requests', payload: up.payload, headers: { ...up.headers, authorization: `Bearer ${A.token}` } });
    expect(cr.statusCode).toBe(201);
    const req = cr.json().data;
    expect(req).toMatchObject({ type: 'SOURCING', stage: 'RECEIVED', product: 'Steel water bottles 750ml', quantity: 500 });
    expect(req.reference).toMatch(/^SE-\d{4}-\d{4}$/);
    expect(req.files).toHaveLength(1);
    expect(req.timeline.map((e: any) => e.text)).toEqual(['Request received']);
    const staffLead = (await call('is', 'GET', `/api/records/leads/${req.id}`)).json().data;
    expect(staffLead).toMatchObject({ sourceChannel: 'PORTAL', clientName: 'Asha Traders', ownerOffice: 'INDIA' });
    expect((await call('is', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'PORTAL_REQUEST' && n.leadRef === req.reference)).toBe(true);
    // B cannot read A's request or file; A can.
    const fu = `/api/portal/requests/${req.id}/files/${req.files[0].id}`;
    expect((await as(A.token, 'GET', fu)).statusCode).toBe(200);
    expect((await as(B.token, 'GET', fu)).statusCode).toBe(404);
    expect((await as(B.token, 'GET', `/api/portal/requests/${req.id}`)).statusCode).toBe(404);

    // Staff work on it: an internal file, China with a supplier, an internal send-back note, a customer quote.
    const sf = form({}, [{ name: 'internal-costing.png', data: PNG, type: 'image/png' }]);
    await app.inject({ method: 'POST', url: `/api/leads/${req.id}/attachments`, payload: sf.payload, headers: { ...sf.headers, authorization: `Bearer ${(await (async () => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'is@x.in', password: PW } })).json().token)())}` } });
    await call('is', 'POST', `/api/leads/${req.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    await call('cs', 'POST', `/api/leads/${req.id}/send-back`, { note: 'internal-note-xyz need drawing' });
    await call('is', 'POST', `/api/leads/${req.id}/resend`, { note: 'drawing attached' });
    const q = (await call('cs', 'POST', `/api/leads/${req.id}/quotes`, { newSupplier: SUP, product: 'Bottle 750', unitPrice: '7.77', currency: 'CNY', moq: '500 pcs' })).json().data;
    await call('cs', 'POST', `/api/leads/${req.id}/assign`, { office: 'INDIA' });
    // Draft customer quote: not visible to the customer yet.
    await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 500, unitPrice: 240 });
    let d = (await as(A.token, 'GET', `/api/portal/requests/${req.id}`)).json().data;
    expect(d.quotes).toHaveLength(0);
    expect((await as(A.token, 'POST', `/api/portal/quotes/${q.id}/accept`)).statusCode).toBe(404);
    await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' });
    d = (await as(A.token, 'GET', `/api/portal/requests/${req.id}`)).json().data;
    expect(d.stage).toBe('QUOTE_READY');
    expect(d.quotes).toHaveLength(1);
    expect(d.quotes[0]).toMatchObject({ label: `${req.reference}-Q1`, status: 'SENT', qty: 500, unitPrice: 240, currency: 'INR', canDecide: true });
    expect(d.quotes[0].pdfUrl).toMatch(/^\/api\/public\/cq\/[\w-]+\.pdf$/);
    expect(d.files.map((f: any) => f.name)).toEqual(['bottle.png']); // staff's internal file is not listed
    const txt = JSON.stringify(d);
    for (const secret of ['Ningbo', 'Mr Wang', 'wx_secret', '7.77', 'CNY', 'internal-note', 'drawing attached', 'Staff cs', 'Staff is', 'internal-costing', 'supplier', 'sla', 'assignedTo'])
      expect(txt).not.toContain(secret);
    expect(d.timeline.map((e: any) => e.text)).toEqual(['Request received', 'Quote Q1 ready for you']);
    // B cannot decide A's quote.
    expect((await as(B.token, 'POST', `/api/portal/quotes/${q.id}/accept`)).statusCode).toBe(404);
    expect((await as(B.token, 'POST', `/api/portal/quotes/${q.id}/reject`, { reasonCode: 'PRICE' })).statusCode).toBe(404);

    // A accepts in the portal: existing accept flow, India notified, NO order created automatically.
    const acc = await as(A.token, 'POST', `/api/portal/quotes/${q.id}/accept`);
    expect(acc.statusCode).toBe(200);
    expect(acc.json().data.quotes[0]).toMatchObject({ status: 'ACCEPTED', canDecide: false });
    expect(acc.json().data.orders).toHaveLength(0);
    expect((await as(A.token, 'POST', `/api/portal/quotes/${q.id}/accept`)).statusCode).toBe(409);
    expect((await call('is', 'GET', `/api/records/leads/${req.id}`)).json().data.status).toBe('WON');
    expect((await call('is', 'GET', '/api/orders')).json().data.filter((o: any) => o.leadId === req.id)).toHaveLength(0);
    expect((await call('is', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'QUOTE_ACCEPTED' && n.leadRef === req.reference && n.byName === 'Asha')).toBe(true);
    const stEv = (await call('is', 'GET', `/api/leads/${req.id}/timeline`)).json().data.events.find((e: any) => e.kind === 'CQ_ACCEPTED');
    expect(stEv.data.byCustomer).toBe(true);
    // Super admin revert still applies; the customer sees it.
    expect((await call('sa', 'POST', `/api/quotes/${q.id}/revert-acceptance`, { reason: 'customer called, wants to wait' })).statusCode).toBe(200);
    d = (await as(A.token, 'GET', `/api/portal/requests/${req.id}`)).json().data;
    expect(d.quotes[0].status).toBe('SENT');
    expect(d.timeline.map((e: any) => e.text)).toContain('Quote Q1 reopened by Source Easy');
    expect(JSON.stringify(d)).not.toContain('customer called'); // revert reason stays internal
    // Accept again; India reviews and creates the order; the customer sees order value + payment status only.
    await as(A.token, 'POST', `/api/portal/quotes/${q.id}/accept`);
    expect((await call('is', 'POST', `/api/quotes/${q.id}/order`, {})).statusCode).toBe(201);
    d = (await as(A.token, 'GET', `/api/portal/requests/${req.id}`)).json().data;
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]).toMatchObject({ qty: 500, value: 120000, currency: 'INR', paymentStatus: 'PENDING' });
    expect(Object.keys(d.orders[0]).sort()).toEqual(['createdAt', 'currency', 'id', 'paymentStatus', 'product', 'qty', 'shipment', 'value']);
    expect(d.timeline.map((e: any) => e.text)).toContain('Order confirmed');
    // B still sees only its own.
    expect((await as(B.token, 'GET', '/api/portal/requests')).json().data.map((x: any) => x.reference)).toEqual([B.ref]);
  });

  it('customer rejection runs the existing rejection flow and returns the lead to India', async () => {
    const { call, as, ids, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const lead = (await as(A.token, 'GET', '/api/portal/requests')).json().data[0];
    await call('ia', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'USD' })).json().data;
    await call('ia', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 10, unitPrice: 200 });
    await call('ia', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' });
    expect((await as(A.token, 'POST', `/api/portal/quotes/${q.id}/reject`, { reasonCode: 'NOPE' })).statusCode).toBe(400);
    const r = await as(A.token, 'POST', `/api/portal/quotes/${q.id}/reject`, { reasonCode: 'PRICE', reason: 'Too high' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.quotes[0].status).toBe('REJECTED');
    const l = (await call('ia', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l.ownerOffice).toBe('INDIA');
    expect(l.rejection.actionNeeded).toBe(true);
  });

  it('merging two customers that both have logins is refused', async () => {
    const { call, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const B = await customer('Bala', '9988776655', 'Bala Exports');
    expect((await call('ia', 'POST', `/api/customers/${A.customerId}/merge`, { from: [B.customerId] })).statusCode).toBe(400);
  });
});
