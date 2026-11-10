import { describe, expect, it } from 'vitest';
import { setup, acceptFq } from './portal-helpers.js';

// China office view of shipping requests: booking details only (allowlist), BOOKED/IN_TRANSIT only, after the customer's freight-quote acceptance.
describe('China shipping-request booking view', () => {
  it('is gated by acceptance, hides customer identity/prices/notes, and hands over to India at IN_TRANSIT', async () => {
    const { call, as, customer } = await setup();
    const A = await customer('Asha Secretname', '9876543210', 'Asha Hidden Traders');
    const cr = await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'FREIGHT_ONLY', goods: 'Brass lamps', quantity: '400', unit: 'pcs', packages: '20', weightKg: '350', cbm: '2.5',
      shipperName: 'Mr Li', shipperPhone: '+86 139 0000', pickupAddress: 'No 5 Market Rd', pickupCity: 'Yiwu', readyDate: '2026-11-25', destCity: 'Chennai',
      destAddress: '12 Secret Street', destPincode: '600099', customerNote: 'call Asha on 9876543210' });
    expect(cr.statusCode).toBe(201);
    const id = cr.json().data.id;

    // Before acceptance China sees nothing, and cannot book.
    expect((await call('cs', 'GET', '/api/china/shipping-requests')).json().data).toHaveLength(0);
    expect((await call('cs', 'GET', `/api/china/shipping-requests/${id}`)).statusCode).toBe(404);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED' })).statusCode).toBe(404);
    // The shared staff list is open to China (redacted); customer directory, portal-admin and freight quotes stay closed.
    expect((await call('cs', 'GET', '/api/shipping-requests')).statusCode).toBe(200);
    expect((await call('cs', 'GET', `/api/shipping-requests/${id}`)).statusCode).toBe(200);
    expect((await call('cs', 'GET', '/api/customers')).statusCode).toBe(403);
    expect((await call('cs', 'GET', '/api/portal-admin/login-requests')).statusCode).toBe(403);
    expect((await call('ca', 'POST', `/api/shipping-requests/${id}/freight-quotes`, { amount: 1 })).statusCode).toBe(403);
    expect((await call('cs', 'GET', '/api/portal/shipping-requests')).statusCode).toBe(401); // staff token never works in the portal realm

    await call('is', 'POST', `/api/shipping-requests/${id}/freight-quotes`, { amount: 65000, internalCost: 51000 });
    const fq = (await as(A.token, 'GET', `/api/portal/shipping-requests/${id}`)).json().data.freightQuotes[0].id;
    expect((await call('cs', 'GET', '/api/china/shipping-requests')).json().data).toHaveLength(0); // quoted, not accepted
    expect((await acceptFq(as, A.token, fq)).statusCode).toBe(200);

    // China gets an in-app "ready to book" (SR ref + goods only); India-only roles do not.
    const nCs = (await call('cs', 'GET', '/api/notifications')).json().data;
    const ready = nCs.find((n: any) => n.kind === 'SHIP_READY');
    expect(ready).toMatchObject({ leadId: id, leadRef: expect.stringMatching(/^SH-/), product: 'Brass lamps', office: 'CHINA', byName: null });
    expect(JSON.stringify(nCs)).not.toMatch(/Secretname|Hidden Traders|9876543210|Secret Street|65000/);
    expect((await call('ca', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'SHIP_READY')).toBe(true);
    expect((await call('is', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'SHIP_READY')).toBe(false);

    // After acceptance: allowlisted booking details only.
    const list = (await call('cs', 'GET', '/api/china/shipping-requests')).json().data;
    expect(list).toHaveLength(1);
    const v = list[0];
    expect(v).toMatchObject({ ref: expect.stringMatching(/^SH-/), status: 'ACCEPTED', goods: 'Brass lamps', quantity: 400, packages: 20, weightKg: 350, cbm: 2.5,
      pickupContact: 'Mr Li', pickupPhone: '+86 139 0000', pickupAddress: 'No 5 Market Rd', pickupCity: 'Yiwu', readyDate: '2026-11-25', destCity: 'Chennai', canUpdate: true });
    expect(Object.keys(v).sort()).toEqual(['canUpdate', 'carrier', 'cbm', 'container', 'destCity', 'eta', 'etd', 'goods', 'id', 'incoterm', 'kind', 'mode', 'packages', 'pickupAddress',
      'pickupCity', 'pickupContact', 'pickupPhone', 'quantity', 'readyDate', 'ref', 'shipmentRef', 'stage', 'status', 'tracking', 'unit', 'updatedAt', 'weightKg'].sort());
    const raw = JSON.stringify((await call('ca', 'GET', `/api/china/shipping-requests/${id}`)).json());
    for (const secret of ['Secretname', 'Hidden Traders', '9876543210', 'Secret Street', '600099', '65000', '51000', 'customerId', 'internal', 'assigned', 'sla'])
      expect(raw).not.toContain(secret);

    // China books and ships; cannot move India's stages, cannot go backwards, no unknown fields.
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'ARRIVED' })).statusCode).toBe(400);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED', destAddress: 'x' })).statusCode).toBe(400);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED', carrier: 'COSCO', etd: 'soon' })).statusCode).toBe(400);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED', carrier: 'COSCO', container: 'CSNU1234567', etd: '2026-11-28', eta: '2026-12-20' })).json().data)
      .toMatchObject({ status: 'BOOKED', carrier: 'COSCO', container: 'CSNU1234567', etd: '2026-11-28' });
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { tracking: 'TRK1' })).json().data.tracking).toBe('TRK1');
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'IN_TRANSIT' })).json().data.canUpdate).toBe(true);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED' })).statusCode).toBe(409);

    // The legacy China booking route still stops at in-transit; both offices continue later stages on the shared staff route.
    expect((await call('is', 'POST', `/api/shipping-requests/${id}/stage`, { status: 'ARRIVED' })).json().data.status).toBe('ARRIVED');
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { tracking: 'TRK2' })).json().code).toBe('india_owns');
    expect((await call('cs', 'GET', `/api/china/shipping-requests/${id}`)).json().data).toMatchObject({ status: 'ARRIVED', canUpdate: false, tracking: 'TRK1' });
    expect((await call('cs', 'POST', `/api/shipping-requests/${id}/stage`, { status: 'CUSTOMS' })).json().data.status).toBe('CUSTOMS');
    // Customer sees the China booking in its own fixed-text timeline.
    expect((await as(A.token, 'GET', `/api/portal/shipping-requests/${id}`)).json().data.tracking).toMatchObject({ stage: 'CUSTOMS', carrier: 'COSCO', tracking: 'TRK1' });
  });

  it('India staff and customers cannot use the China booking routes', async () => {
    const { call, as, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const id = (await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'FREIGHT_ONLY', goods: 'Lamps', pickupCity: 'Yiwu', destCity: 'Chennai' })).json().data.id;
    expect((await call('is', 'GET', '/api/china/shipping-requests')).statusCode).toBe(403);
    expect((await call('ia', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED' })).statusCode).toBe(403);
    expect((await as(A.token, 'GET', '/api/china/shipping-requests')).statusCode).toBe(401);
  });
});
