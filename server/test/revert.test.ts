import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-1';
async function setup() {
  const { db, bus, users } = await testEnv();
  const app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'ser-')) });
  const ids: Record<string, string> = {};
  for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['ia', 'INDIA_ADMIN'], ['is', 'INDIA_STAFF'], ['cs', 'CHINA_STAFF']] as const) ids[e] = (await users.create(`${e}@x.in`, e, r, PW)).id;
  const tok: Record<string, string> = {};
  for (const e of Object.keys(ids)) tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: any) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
  const accepted = async () => {
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'C', productInterest: 'P' })).json().data;
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'USD' })).json().data;
    await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 10, unitPrice: 200 });
    await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' });
    const before = (await call('is', 'GET', `/api/records/leads/${lead.id}`)).json().data.status;
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'ACCEPTED' })).statusCode).toBe(200);
    return { lead, q, before };
  };
  return { app, call, ids, accepted };
}
const R = (q: any) => `/api/quotes/${q.id}/revert-acceptance`;

describe('super admin reverts a customer acceptance', () => {
  it('only the super admin, needs a reason; restores quote + lead status, logs, notifies', async () => {
    const { call, accepted } = await setup();
    const { lead, q, before } = await accepted();
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'DRAFT' })).statusCode).toBe(403);
    for (const who of ['ia', 'is', 'cs']) expect((await call(who, 'POST', R(q), { reason: 'oops' })).statusCode).toBe(403);
    expect((await call('sa', 'POST', R(q), {})).statusCode).toBe(400);
    const r = await call('sa', 'POST', R(q), { reason: 'Clicked accept by mistake' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ status: 'SENT' });
    expect(r.json().data.decidedAt ?? null).toBeNull();
    const l = (await call('sa', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l.status).not.toBe('WON'); expect(l.status).toBe(before === 'WON' ? 'QUOTED' : before);
    const evs = (await call('sa', 'GET', `/api/leads/${lead.id}/timeline`)).json().data.events as any[];
    expect(evs.some((e) => e.kind === 'CQ_REVERTED' && e.data.reason === 'Clicked accept by mistake')).toBe(true);
    const n = (await call('cs', 'GET', '/api/notifications')).json().data as any[];
    expect(n.some((x) => x.kind === 'QUOTE_REVERTED')).toBe(true);
    expect((await call('sa', 'POST', R(q), { reason: 'again' })).statusCode).toBe(409); // not accepted any more
    // can be accepted again afterwards
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'ACCEPTED' })).json().data.status).toBe('ACCEPTED');
  });
  it('with a draft order: blocked unless cancelOrder; order with payment needs force', async () => {
    const { call, accepted } = await setup();
    const { q } = await accepted();
    const o = (await call('is', 'POST', `/api/quotes/${q.id}/order`, {})).json().data;
    const pre = (await call('sa', 'GET', R(q))).json().data;
    expect(pre).toMatchObject({ canRevert: true, order: { id: o.id, progress: [] } });
    expect((await call('sa', 'POST', R(q), { reason: 'mistake' })).statusCode).toBe(409);
    const r = await call('sa', 'POST', R(q), { reason: 'mistake', cancelOrder: true });
    expect(r.statusCode).toBe(200);
    expect((await call('sa', 'GET', '/api/orders')).json().data).toHaveLength(0);
    expect((await call('sa', 'GET', '/api/shipments')).json().data).toHaveLength(0);

    await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'ACCEPTED' });
    await call('is', 'POST', `/api/quotes/${q.id}/order`, { advance: 5000, paymentStatus: 'PARTIAL' });
    expect((await call('sa', 'GET', R(q))).json().data.order.progress).toContain('payment');
    const blocked = await call('sa', 'POST', R(q), { reason: 'mistake', cancelOrder: true });
    expect(blocked.statusCode).toBe(409); expect(blocked.json().error).toMatch(/force/);
    expect((await call('sa', 'POST', R(q), { reason: 'mistake', cancelOrder: true, force: true, to: 'DRAFT' })).json().data.status).toBe('DRAFT');
    expect((await call('sa', 'GET', '/api/orders')).json().data).toHaveLength(0);
  });
});

describe('customer quote PDF download', () => {
  it('?dl=1 forces an attachment download; default stays inline', async () => {
    const { app, call, accepted } = await setup();
    const { q } = await accepted();
    const url = (await call('is', 'POST', `/api/quotes/${q.id}/pdf`)).json().data.pdfUrl;
    const a = await app.inject({ method: 'GET', url: `${url}?dl=1` });
    expect(a.statusCode).toBe(200); expect(a.headers['content-disposition']).toMatch(/^attachment; filename="Quotation-.*\.pdf"/);
    expect(a.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ method: 'GET', url })).headers['content-disposition']).toMatch(/^inline/);
  });
});
