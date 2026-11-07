import { describe, expect, it } from 'vitest';
import { setup } from './portal-helpers.js';

describe('freight quote PDF + staff create', () => {
  it('staff creates a request; PDF only for the owning customer; never internal cost', async () => {
    const { call, as, customer, orderFor } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const B = await customer('Bala', '9876500000', 'Bala Imports');
    // Staff create (not API-only from the portal); China cannot.
    expect((await call('cs', 'POST', '/api/shipping-requests', { customerId: A.customerId, kind: 'FREIGHT_ONLY', goods: 'x' })).statusCode).toBe(403);
    const c = await call('is', 'POST', '/api/shipping-requests', { customerId: A.customerId, kind: 'FREIGHT_ONLY', goods: 'Brass lamps', pickupCity: 'Yiwu', destCity: 'Chennai', internalNote: 'margin note' });
    expect(c.statusCode).toBe(201); const sr = c.json().data;
    expect((await as(A.token, 'GET', `/api/portal/shipping-requests/${sr.id}`)).json().data.fields?.internalNote).toBeUndefined();
    const q = (await call('ia', 'POST', `/api/shipping-requests/${sr.id}/freight-quotes`, { amount: 41500, internalCost: 30123, notes: 'Sea LCL' })).json().data.freightQuotes[0];
    const mine = await as(A.token, 'GET', `/api/portal/freight-quotes/${q.id}/pdf`);
    expect(mine.statusCode).toBe(200); expect(mine.headers['content-type']).toContain('application/pdf');
    expect(mine.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mine.rawPayload.toString('latin1')).not.toContain('30123');
    expect((await as(B.token, 'GET', `/api/portal/freight-quotes/${q.id}/pdf`)).statusCode).toBe(404);
    expect((await call('ia', 'GET', `/api/shipping-requests/${sr.id}/freight-quotes/${q.id}/pdf`)).statusCode).toBe(200);
    expect((await call('cs', 'GET', `/api/shipping-requests/${sr.id}/freight-quotes/${q.id}/pdf`)).statusCode).toBe(403);
    // Shippable orders list for the staff create screen.
    const lead = (await as(A.token, 'GET', '/api/portal/requests')).json().data[0];
    await orderFor(A.token, lead.id);
    const so = (await call('is', 'GET', `/api/customers/${A.customerId}/shippable-orders`)).json().data;
    expect(so.length).toBe(1); expect(so[0].leadReference).toBe(lead.reference);
    expect((await call('ca', 'GET', `/api/customers/${A.customerId}/shippable-orders`)).statusCode).toBe(403);
  });
});
