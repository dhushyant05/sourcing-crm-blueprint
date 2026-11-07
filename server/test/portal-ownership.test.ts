import { describe, expect, it } from 'vitest';
import { PNG, form, setup } from './portal-helpers.js';

/** Adversarial: contact details on public / staff leads are spoofable and must never grant portal visibility. */
describe('portal ownership: only explicit, verified links are visible', () => {
  it('a spoofed public enquiry with a portal customer\'s company, phone and email never reaches their portal (list, detail, files, quotes, PDF, SSE)', async () => {
    const { app, call, as, customer, sse, orderFor } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const aCust = (await call('ia', 'GET', `/api/customers/${A.customerId}`)).json().data;
    // Attacker copies everything, attaches a file, and tries to pass ownership fields.
    const f = form({ name: 'Asha', phone: '9876543210', email: aCust.email ?? 'asha@x.in', company: 'Asha Traders', product: 'spoofed widgets',
      customerId: A.customerId, portal_customer_id: A.customerId, portalCustomerId: A.customerId }, [{ name: 'spoof.png', data: PNG, type: 'image/png' }]);
    const e = (await app.inject({ method: 'POST', url: '/api/public/enquiry', remoteAddress: '10.7.7.7', payload: f.payload, headers: f.headers })).json();
    expect(e.reference).toMatch(/^SE-/);
    await call('ia', 'GET', '/api/customers'); // runs the internal customer sync
    const spoof = (await call('ia', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === e.reference);
    // Internally it may be linked to Asha's directory entry (CRM convenience) ...
    expect((await call('ia', 'GET', `/api/leads/${spoof.id}/customer`)).json().data?.id).toBe(A.customerId);
    // ... but it is not shared to her portal.
    const shares = (await call('ia', 'GET', `/api/customers/${A.customerId}/portal-leads`)).json().data;
    expect(shares.find((x: any) => x.id === spoof.id)).toMatchObject({ shared: false });
    const list = (await as(A.token, 'GET', '/api/portal/requests')).json().data.map((x: any) => x.reference);
    expect(list).toEqual([A.ref]);
    expect((await as(A.token, 'GET', `/api/portal/requests/${spoof.id}`)).statusCode).toBe(404);
    const fid = (await call('ia', 'GET', `/api/leads/${spoof.id}/attachments`)).json().data[0].id;
    expect(fid).toBeTruthy();
    expect((await as(A.token, 'GET', `/api/portal/requests/${spoof.id}/files/${fid}`)).statusCode).toBe(404);
    // Staff even quote and order it: still invisible, and its quote cannot be opened or decided by Asha.
    const { quote } = await orderFor('', spoof.id);
    for (const [m, u] of [['GET', `/api/portal/quotes/${quote.id}/pdf`], ['POST', `/api/portal/quotes/${quote.id}/accept`], ['POST', `/api/portal/quotes/${quote.id}/reject`]] as const)
      expect((await as(A.token, m, u, m === 'POST' ? { reasonCode: 'PRICE' } : undefined)).statusCode).toBe(404);
    expect((await as(A.token, 'GET', '/api/portal/shippable-orders')).json().data).toHaveLength(0);
    // SSE: changes on the spoofed lead are not announced; changes on her own lead are.
    const own = (await as(A.token, 'GET', '/api/portal/requests')).json().data[0];
    const s = await sse(A.token, async () => {
      await call('ia', 'PATCH', `/api/records/leads/${spoof.id}`, { enquiryMessage: 'internal edit' });
      await call('ia', 'PATCH', `/api/records/leads/${own.id}`, { enquiryMessage: 'edit on own' });
    });
    expect(s.status).toBe(200);
    expect(s.text).not.toContain(spoof.id);
    expect(s.text).toContain(own.id);
    await app.close();
  });

  it('login requests never inherit a customer from typed details; legacy leads are not exposed retroactively; sharing is explicit and admin-only', async () => {
    const { app, call, as, enquire, login, ids } = await setup();
    // Victim: an existing (legacy, staff-entered) customer with a sent quote, no portal login.
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'Vel Steel — rods', clientName: 'Vel Steel', contactName: 'Vel', productInterest: 'rods',
      contactPhone: { primaryPhoneNumber: '9000000001' }, contactEmail: { primaryEmail: 'vel@vel.in' } })).json().data;
    await call('ia', 'GET', '/api/customers');
    const vel = (await call('ia', 'GET', `/api/leads/${lead.id}/customer`)).json().data;
    expect(vel?.company ?? vel?.name).toMatch(/Vel/);
    // Attacker: same company + email, own phone, asks for a login.
    await enquire('Not Vel', '9111111111', 'Vel Steel', { email: 'vel@vel.in' });
    const r = (await call('ia', 'GET', '/api/portal-admin/login-requests?status=PENDING')).json().data[0];
    expect(r.customer?.id).toBe(vel.id);            // only a suggestion ...
    expect(r.match).toMatchObject({ verified: false, phoneMatches: false }); // ... flagged as unverified, phone differs
    expect(r.match.otherLeads).toBeGreaterThanOrEqual(1);
    expect((await call('ia', 'POST', `/api/portal-admin/login-requests/${r.id}/approve`, {})).json().code).toBe('customer_required');
    expect((await call('ia', 'POST', `/api/portal-admin/login-requests/${r.id}/approve`, { customerId: vel.id })).json().code).toBe('phone_mismatch');
    // Even if an admin is fooled and confirms, nothing old becomes visible.
    const ok = (await call('ia', 'POST', `/api/portal-admin/login-requests/${r.id}/approve`, { customerId: vel.id, confirmMismatch: true })).json().data;
    const t0 = (await login('9111111111', ok.tempPassword)).json().token;
    const t = (await as(t0, 'POST', '/api/portal/me/password', { currentPassword: ok.tempPassword, newPassword: 'attacker-pass-1' })).json().token;
    expect((await as(t, 'GET', '/api/portal/requests')).json().data).toHaveLength(0);
    expect((await as(t, 'GET', `/api/portal/requests/${lead.id}`)).statusCode).toBe(404);
    // Sharing needs an India admin / super admin with the permission.
    for (const who of ['is', 'ca', 'cs']) expect((await call(who, 'POST', `/api/leads/${lead.id}/portal-share`, { shared: true })).statusCode).toBe(403);
    expect((await as(t, 'POST', `/api/leads/${lead.id}/portal-share`, { shared: true })).statusCode).toBe(401);
    expect((await call('ia', 'POST', `/api/leads/${lead.id}/portal-share`, { shared: true })).json().data.shared).toBe(true);
    expect((await as(t, 'GET', '/api/portal/requests')).json().data.map((x: any) => x.id)).toEqual([lead.id]);
    // Re-linking the lead to another customer revokes visibility; it is not carried over.
    const other = (await call('ia', 'POST', '/api/customers', { name: 'Other Buyer', phone: '9222222222' })).json().data;
    await call('ia', 'POST', `/api/leads/${lead.id}/customer`, { customerId: other.id });
    expect((await as(t, 'GET', `/api/portal/requests/${lead.id}`)).statusCode).toBe(404);
    await call('ia', 'POST', `/api/leads/${lead.id}/customer`, { customerId: vel.id });
    expect((await as(t, 'GET', `/api/portal/requests/${lead.id}`)).statusCode).toBe(404); // re-share required
    expect((await call('ia', 'GET', `/api/customers/${vel.id}/portal-login`)).json().data.audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['LEAD_SHARED']));
    void ids; await app.close();
  });

  it('the approved enquiry is shared only when the admin says so; merges keep visibility only with the login', async () => {
    const { app, call, as, enquire, login } = await setup();
    const e = await enquire('Kiran', '9333333333', 'Kiran Co');
    const r = (await call('ia', 'GET', '/api/portal-admin/login-requests?status=PENDING')).json().data[0];
    const ok = (await call('ia', 'POST', `/api/portal-admin/login-requests/${r.id}/approve`, { customerId: r.customer.id })).json().data; // no shareEnquiry
    const t0 = (await login('9333333333', ok.tempPassword)).json().token;
    const t = (await as(t0, 'POST', '/api/portal/me/password', { currentPassword: ok.tempPassword, newPassword: 'kiran-pass-1' })).json().token;
    expect((await as(t, 'GET', '/api/portal/requests')).json().data).toHaveLength(0);
    const lid = (await call('ia', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === e.reference).id;
    await call('ia', 'POST', `/api/leads/${lid}/portal-share`, { shared: true });
    expect((await as(t, 'GET', '/api/portal/requests')).json().data).toHaveLength(1);
    // Merge a login-less duplicate (with its own lead) INTO Kiran: the duplicate's lead stays internal.
    const dup = (await call('ia', 'POST', '/api/customers', { name: 'Kiran dup', company: 'Kiran Company Pvt' })).json().data;
    const dl = (await call('is', 'POST', '/api/records/leads', { name: 'dup lead', clientName: 'Kiran Company Pvt', productInterest: 'x' })).json().data;
    await call('ia', 'POST', `/api/leads/${dl.id}/customer`, { customerId: dup.id });
    await call('ia', 'POST', `/api/customers/${ok.login.customerId}/merge`, { from: [dup.id] });
    expect((await as(t, 'GET', '/api/portal/requests')).json().data.map((x: any) => x.id)).toEqual([lid]);
    // Merge Kiran (with login) into another customer: the login and its shared lead move together.
    const tgt = (await call('ia', 'POST', '/api/customers', { name: 'Kiran Group' })).json().data;
    expect((await call('ia', 'POST', `/api/customers/${tgt.id}/merge`, { from: [ok.login.customerId] })).statusCode).toBe(200);
    expect((await as(t, 'GET', '/api/portal/requests')).statusCode).toBe(401); // sessions end with the merge
    const t2 = (await login('9333333333', 'kiran-pass-1')).json().token;
    expect((await as(t2, 'GET', '/api/portal/requests')).json().data.map((x: any) => x.id)).toEqual([lid]);
    await app.close();
  });

  it('portal submissions take ownership from the token only', async () => {
    const { app, as, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const B = await customer('Bala', '9988776655', 'Bala Exports');
    const r = await as(A.token, 'POST', '/api/portal/requests', { product: 'Mugs', customerId: B.customerId, customer_id: B.customerId });
    expect(r.statusCode).toBe(201);
    expect((await as(B.token, 'GET', `/api/portal/requests/${r.json().data.id}`)).statusCode).toBe(404);
    expect((await as(A.token, 'GET', `/api/portal/requests/${r.json().data.id}`)).statusCode).toBe(200);
    await app.close();
  });
});
