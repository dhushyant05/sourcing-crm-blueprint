import { describe, expect, it } from 'vitest';
import { setup } from './portal-helpers.js';

describe('shipping request SLA', () => {
  it('runs while India owes a response, warns/breaches once, stops on answer, restarts on customer reply; never shown to the customer', async () => {
    const { app, db, call, as, customer, ids } = await setup({ slaTickMs: 0 });
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const cr = await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'FREIGHT_ONLY', goods: 'Lamps', pickupCity: 'Yiwu', destCity: 'Chennai' }); if (cr.statusCode >= 300) console.log(cr.body); const sr = cr.json().data;
    let s = (await call('is', 'GET', `/api/shipping-requests/${sr.id}`)).json().data;
    expect(s.sla).toMatchObject({ warned: false, breached: false });
    expect(new Date(s.sla.dueAt).getTime() - new Date(s.sla.startedAt).getTime()).toBe(5 * 3600e3); // lead SLA default (normal hours)
    const cust = JSON.stringify((await as(A.token, 'GET', `/api/portal/shipping-requests/${sr.id}`)).json());
    expect(cust).not.toMatch(/sla|dueAt/i);
    // Claim keeps the clock (UNDER_REVIEW still owes a response).
    await call('is', 'POST', `/api/shipping-requests/${sr.id}/assign`);
    // Near the end → warning to the owner; past due → breach to India admins (+ owner), each once.
    await db.run("UPDATE shipping_requests SET sla_started_at = now() - interval '290 minutes', sla_due_at = now() + interval '10 minutes' WHERE id = ?", sr.id);
    expect(await app.slaTick()).toMatchObject({ warn: 1 });
    expect(await app.slaTick()).toMatchObject({ warn: 0, breach: 0 });
    await db.run("UPDATE shipping_requests SET sla_due_at = now() - interval '1 minute' WHERE id = ?", sr.id);
    expect(await app.slaTick()).toMatchObject({ breach: 1 });
    expect(await app.slaTick()).toMatchObject({ breach: 0 });
    const kinds = async (who: string) => (await call(who, 'GET', '/api/notifications')).json().data.map((n: any) => n.kind);
    expect(await kinds('is')).toEqual(expect.arrayContaining(['SHIP_SLA_WARN', 'SHIP_SLA_BREACH']));
    expect(await kinds('ia')).toContain('SHIP_SLA_BREACH');
    for (const who of ['ca', 'cs']) expect(await kinds(who)).not.toEqual(expect.arrayContaining(['SHIP_SLA_WARN']));
    expect((await call('is', 'GET', `/api/shipping-requests/${sr.id}`)).json().data.sla.breached).toBe(true);
    // India answers (asks for info) → clock stops and the run is recorded as breached.
    await call('is', 'POST', `/api/shipping-requests/${sr.id}/needs-info`, { question: 'Packing list?' });
    expect((await call('is', 'GET', `/api/shipping-requests/${sr.id}`)).json().data.sla).toBeNull();
    expect(await db.all('SELECT breached, assignee FROM shipping_sla_runs WHERE request_id = ?', sr.id)).toEqual([{ breached: true, assignee: ids.is }]);
    // Customer replies → back to UNDER_REVIEW → new clock.
    await as(A.token, 'POST', `/api/portal/shipping-requests/${sr.id}/reply`, { message: 'Attached' });
    s = (await call('is', 'GET', `/api/shipping-requests/${sr.id}`)).json().data;
    expect(s.status).toBe('UNDER_REVIEW'); expect(s.sla).toMatchObject({ breached: false });
    await call('ia', 'POST', `/api/shipping-requests/${sr.id}/freight-quotes`, { amount: 5000 });
    expect((await call('is', 'GET', `/api/shipping-requests/${sr.id}`)).json().data.sla).toBeNull();
    expect((await db.all('SELECT breached FROM shipping_sla_runs WHERE request_id = ? ORDER BY ended_at', sr.id)).map((r: any) => r.breached)).toEqual([true, false]);
  });
});
