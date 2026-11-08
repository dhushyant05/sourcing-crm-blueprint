import { describe, expect, it } from 'vitest';
import { setup } from './portal-helpers.js';

// Super-admin edit / delete / revert of freight (shipping) quotes.
describe('freight quote super-admin controls', () => {
  const start = async () => {
    const t = await setup();
    const A = await t.customer('Asha Secret', '9876543210', 'Asha Traders');
    const r = (await t.as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'FREIGHT_ONLY', goods: 'Lamps', pickupCity: 'Yiwu', destCity: 'Chennai' })).json().data;
    await t.call('is', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 50000, internalCost: 41000, mode: 'SEA' });
    const fq = () => t.as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`).then((x) => x.json().data);
    return { ...t, A, id: r.id as string, fq };
  };

  it('edit: super admin only, SENT only, keeps an immutable revision, customer sees the new amount + a fixed line (never the reason)', async () => {
    const { call, as, A, id, fq, db } = await start();
    const q = (await fq()).freightQuotes[0];
    for (const who of ['ia', 'is', 'ca', 'cs']) expect((await call(who, 'PATCH', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { amount: 1, reason: 'typo' })).statusCode).toBe(403);
    expect((await call('sa', 'PATCH', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { amount: 45000 })).statusCode).toBe(400); // reason required
    const e = await call('sa', 'PATCH', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { amount: 45000, transit: '25 days', reason: 'Secret internal: carrier discount' });
    expect(e.statusCode).toBe(200);
    expect(e.json().data.freightQuotes[0]).toMatchObject({ amount: 45000, transit: '25 days', revision: 2, status: 'SENT' });
    const rev = await db.all('SELECT revision, snapshot, action FROM freight_quote_revisions WHERE quote_id = ?', q.id);
    expect(rev).toHaveLength(1); expect(rev[0].action).toBe('EDIT'); expect((typeof rev[0].snapshot === 'string' ? JSON.parse(rev[0].snapshot) : rev[0].snapshot).amount).toBe(50000);
    const d = await fq();
    expect(d.freightQuotes[0]).toMatchObject({ amount: 45000, canDecide: true });
    expect(d.timeline.map((x: any) => x.text)).toContain('Freight quote F1 updated');
    expect(JSON.stringify(d)).not.toMatch(/Secret internal|41000|internalCost/);
    // Internal-cost-only edit is not announced to the customer.
    await call('sa', 'PATCH', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { internalCost: 40000, reason: 'cost fix' });
    expect((await fq()).timeline.filter((x: any) => x.text === 'Freight quote F1 updated')).toHaveLength(1);
    // The customer accepts the corrected amount; an accepted quote cannot be edited or deleted without a revert.
    expect((await as(A.token, 'POST', `/api/portal/freight-quotes/${q.id}/accept`)).json().data.status).toBe('ACCEPTED');
    expect((await call('sa', 'PATCH', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { amount: 1, reason: 'late change' })).json().code).toBe('accepted');
    expect((await call('sa', 'DELETE', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { reason: 'gone', confirm: true })).json().code).toBe('accepted');
  });

  it('revert: accepted → sent again (request back to QUOTED), needs reason + confirm, blocked once booked, never rolls stages back', async () => {
    const { call, as, A, id, fq } = await start();
    const q = (await fq()).freightQuotes[0];
    await as(A.token, 'POST', `/api/portal/freight-quotes/${q.id}/accept`);
    expect((await call('ia', 'POST', `/api/shipping-requests/${id}/freight-quotes/${q.id}/revert`, { reason: 'wrong', confirm: true })).statusCode).toBe(403);
    expect((await call('sa', 'POST', `/api/shipping-requests/${id}/freight-quotes/${q.id}/revert`, { reason: 'wrong' })).json().code).toBe('confirm');
    const rv = await call('sa', 'POST', `/api/shipping-requests/${id}/freight-quotes/${q.id}/revert`, { reason: 'Customer accepted by mistake (internal)', confirm: true });
    expect(rv.statusCode).toBe(200);
    expect(rv.json().data).toMatchObject({ status: 'QUOTED' }); expect(rv.json().data.freightQuotes[0]).toMatchObject({ status: 'SENT', decidedAt: null });
    const d = await fq();
    expect(d.freightQuotes[0].canDecide).toBe(true); expect(d.timeline.at(-1).text).toBe('Freight quote F1 reopened for your decision');
    expect(JSON.stringify(d)).not.toContain('by mistake');
    // Booking gate still holds: no acceptance → China cannot book.
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED' })).statusCode).toBe(404);
    // Twice is idempotent-safe: second revert is refused.
    expect((await call('sa', 'POST', `/api/shipping-requests/${id}/freight-quotes/${q.id}/revert`, { reason: 'again', confirm: true })).json().code).toBe('state');
    // Accept again, China books → revert/delete are blocked with a reason, and the booking stays.
    await as(A.token, 'POST', `/api/portal/freight-quotes/${q.id}/accept`);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED', carrier: 'COSCO' })).json().data.status).toBe('BOOKED');
    const blocked = await call('sa', 'POST', `/api/shipping-requests/${id}/freight-quotes/${q.id}/revert`, { reason: 'too late', confirm: true });
    expect(blocked.json().code).toBe('booked'); expect(blocked.json().error).toMatch(/not rolled back/);
    expect((await call('sa', 'DELETE', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { reason: 'too late', confirm: true })).json().code).toBe('booked');
    expect((await call('sa', 'GET', `/api/shipping-requests/${id}`)).json().data).toMatchObject({ status: 'BOOKED', carrier: 'COSCO' });
  });

  it('revert racing China booking: exactly one wins, never an unaccepted booked request', async () => {
    const { call, as, A, id, fq } = await start();
    const q = (await fq()).freightQuotes[0];
    await as(A.token, 'POST', `/api/portal/freight-quotes/${q.id}/accept`);
    const [rv, bk] = await Promise.all([
      call('sa', 'POST', `/api/shipping-requests/${id}/freight-quotes/${q.id}/revert`, { reason: 'race', confirm: true }),
      call('cs', 'POST', `/api/china/shipping-requests/${id}/stage`, { status: 'BOOKED' }),
    ]);
    expect([rv.statusCode, bk.statusCode].filter((s) => s === 200)).toHaveLength(1);
    const s = (await call('sa', 'GET', `/api/shipping-requests/${id}`)).json().data;
    if (s.status === 'BOOKED') expect(s.freightQuotes[0].status).toBe('ACCEPTED'); else expect(s).toMatchObject({ status: 'QUOTED' });
  });

  it('delete: soft, super admin only, hidden from lists/PDF/decisions, request returns to review, audit kept', async () => {
    const { call, as, A, id, fq, db } = await start();
    const q = (await fq()).freightQuotes[0];
    expect((await call('ia', 'DELETE', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { reason: 'x', confirm: true })).statusCode).toBe(403);
    expect((await call('sa', 'DELETE', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { reason: 'wrong customer quote' })).json().code).toBe('confirm');
    const del = await call('sa', 'DELETE', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { reason: 'wrong customer quote', confirm: true });
    expect(del.statusCode).toBe(200); expect(del.json().data).toMatchObject({ status: 'UNDER_REVIEW', freightQuotes: [] });
    expect((await db.get('SELECT deleted_at, delete_reason FROM freight_quotes WHERE id = ?', q.id))?.delete_reason).toBe('wrong customer quote');
    const d = await fq();
    expect(d).toMatchObject({ status: 'UNDER_REVIEW', freightQuotes: [], quoteWaiting: false });
    expect(d.timeline.at(-1).text).toBe('Freight quote F1 withdrawn'); expect(JSON.stringify(d)).not.toContain('wrong customer');
    expect((await as(A.token, 'POST', `/api/portal/freight-quotes/${q.id}/accept`)).statusCode).toBe(404);
    expect((await as(A.token, 'GET', `/api/portal/freight-quotes/${q.id}/pdf`)).statusCode).toBe(404);
    expect((await call('sa', 'GET', `/api/shipping-requests/${id}/freight-quotes/${q.id}/pdf`)).statusCode).toBe(404);
    expect((await call('sa', 'DELETE', `/api/shipping-requests/${id}/freight-quotes/${q.id}`, { reason: 'again', confirm: true })).statusCode).toBe(404);
    // A new quote gets the next number (no reuse of F1).
    const n2 = (await call('is', 'POST', `/api/shipping-requests/${id}/freight-quotes`, { amount: 52000 })).json().data.freightQuotes;
    expect(n2.map((x: any) => x.label.slice(-2))).toEqual(['F2']);
    expect((await call('sa', 'GET', `/api/shipping-requests/${id}`)).json().data.events.some((e: any) => e.kind === 'FQ_DELETED' && e.data.reason === 'wrong customer quote')).toBe(true);
  });
});
