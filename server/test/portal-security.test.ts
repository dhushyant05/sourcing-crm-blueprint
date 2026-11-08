import { describe, expect, it } from 'vitest';
import { SUP, setup } from './portal-helpers.js';

describe('portal security: logout and quote decisions', () => {
  it('logout revokes the session server-side (old token stops working)', async () => {
    const { as, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    expect((await as(A.token, 'GET', '/api/portal/requests')).statusCode).toBe(200);
    expect((await as(A.token, 'POST', '/api/portal/me/logout')).statusCode).toBe(200);
    expect((await as(A.token, 'GET', '/api/portal/requests')).statusCode).toBe(401);
    expect((await as(A.token, 'POST', '/api/portal/me/logout')).statusCode).toBe(401);
  });

  it('a SENT quote is decided exactly once even when accept and reject race', async () => {
    const { call, as, ids, customer } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const leadId = (await as(A.token, 'GET', '/api/portal/requests')).json().data[0].id;
    await call('ia', 'POST', `/api/leads/${leadId}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${leadId}/quotes`, { newSupplier: SUP, product: 'Thing', unitPrice: '3', currency: 'CNY' })).json().data;
    await call('cs', 'POST', `/api/leads/${leadId}/assign`, { office: 'INDIA' });
    await call('ia', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 10, unitPrice: 50 });
    await call('ia', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' });
    const rs = await Promise.all([
      as(A.token, 'POST', `/api/portal/quotes/${q.id}/accept`),
      as(A.token, 'POST', `/api/portal/quotes/${q.id}/reject`, { reasonCode: 'PRICE' }),
      as(A.token, 'POST', `/api/portal/quotes/${q.id}/accept`),
    ]);
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 409)).toHaveLength(2);
  });
});
