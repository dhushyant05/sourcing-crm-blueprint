import { describe, expect, it } from 'vitest';
import { setup, acceptFq } from './portal-helpers.js';

const secrets = ['Asha', 'Asha Traders', '9876543210', 'Secret Street', '600099'];

describe('China staff handle shipping requests with a redacted view', () => {
  it('China can claim and progress every stage; identity and prices stay hidden; freight quotes stay India/SA', async () => {
    const { call, as, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const id = (await as(A.token, 'POST', '/api/portal/shipping-requests', {
      kind: 'FREIGHT_ONLY', goods: 'Brass lamps', quantity: '40', unit: 'ctn', packages: '40', weightKg: '200', cbm: '1.2',
      shipperName: 'Mr Li', shipperPhone: '+86 139', pickupCity: 'Yiwu', pickupAddress: 'No 5 Market Rd',
      destCity: 'Chennai', destAddress: 'Secret Street', destPincode: '600099',
    })).json().data.id;

    expect((await call('cs', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'SHIP_REQUEST' && n.leadId === id)).toBe(true);
    const listed = (await call('cs', 'GET', '/api/shipping-requests')).json().data;
    const row = listed.find((x: any) => x.id === id);
    expect(row).toMatchObject({ status: 'SUBMITTED', goods: 'Brass lamps', destCity: 'Chennai', pickupCity: 'Yiwu', customer: null, assignedTo: null });
    for (const secret of secrets) expect(JSON.stringify(row)).not.toContain(secret);

    const claimed = (await call('cs', 'POST', `/api/shipping-requests/${id}/assign`, {})).json().data;
    expect(claimed.status).toBe('UNDER_REVIEW');
    expect(claimed.assignedTo).toBeTruthy();
    expect(claimed.customer).toBeNull();
    expect((await call('cs', 'POST', `/api/shipping-requests/${id}/assign`, { userId: 'someone-else' })).statusCode).toBe(403);

    expect((await call('cs', 'POST', `/api/shipping-requests/${id}/freight-quotes`, { amount: 1 })).statusCode).toBe(403);
    expect((await call('cs', 'POST', `/api/shipping-requests/${id}/needs-info`, { question: 'Need packing list' })).statusCode).toBe(403);
    expect((await call('cs', 'PATCH', `/api/shipping-requests/${id}`, { destAddress: 'leaked' })).json().data.destAddress).toBeUndefined();
    await call('is', 'POST', `/api/shipping-requests/${id}/freight-quotes`, { amount: 65000, internalCost: 51000 });
    const qid = (await as(A.token, 'GET', `/api/portal/shipping-requests/${id}`)).json().data.freightQuotes[0].id;
    await acceptFq(as, A.token, qid);

    const detail = (await call('cs', 'GET', `/api/shipping-requests/${id}`)).json().data;
    expect(detail.status).toBe('ACCEPTED');
    expect(detail.freightQuotes).toEqual([]);
    expect(detail.files).toEqual([]);
    const raw = JSON.stringify(detail);
    for (const secret of [...secrets, '65000', '51000', 'internalCost', 'Secret Street', '600099']) expect(raw).not.toContain(secret);
    expect(raw).toContain('Yiwu'); expect(raw).toContain('Chennai'); expect(raw).toContain('Brass lamps');

    expect((await call('cs', 'POST', `/api/shipping-requests/${id}/stage`, { status: 'BOOKED', carrier: 'COSCO', tracking: 'TRK-C', etd: '2026-11-28', eta: '2026-12-20' })).json().data).toMatchObject({ status: 'BOOKED', carrier: 'COSCO', canPrice: false });
    expect((await call('is', 'POST', `/api/shipping-requests/${id}/stage`, { status: 'IN_TRANSIT' })).json().data.status).toBe('IN_TRANSIT');
    expect((await call('cs', 'POST', `/api/shipping-requests/${id}/stage`, { status: 'ARRIVED' })).json().data.status).toBe('ARRIVED');
    expect((await call('sa', 'POST', `/api/shipping-requests/${id}/stage`, { status: 'DELIVERED' })).json().data.status).toBe('DELIVERED');
    expect((await as(A.token, 'GET', `/api/portal/shipping-requests/${id}`)).json().data.tracking.stage).toBe('DELIVERED');
  });
});
