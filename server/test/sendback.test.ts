import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-1';
async function setup() {
  const { db, bus, users } = await testEnv();
  const app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'sb-')) });
  const ids: Record<string, string> = {};
  for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['is', 'INDIA_STAFF'], ['cs', 'CHINA_STAFF'], ['cs2', 'CHINA_STAFF']] as const) ids[e] = (await users.create(`${e}@x.in`, e, r, PW)).id;
  const tok: Record<string, string> = {};
  for (const e of Object.keys(ids)) tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: any) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
  const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'Secret Customer Pvt', productInterest: 'Valves' })).json().data;
  await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
  return { call, ids, lead };
}
const get = async (call: any, who: string, id: string) => (await call(who, 'GET', `/api/records/leads/${id}`)).json().data;
const notifs = async (call: any, who: string) => (await call(who, 'GET', '/api/notifications')).json().data as any[];

describe('send back: China → India for missing lead details', () => {
  it('needs a note, only China, returns to the India raiser, re-send goes back to the same China staff', async () => {
    const { call, ids, lead } = await setup();
    const u = `/api/leads/${lead.id}/send-back`;
    expect((await call('cs', 'POST', u, {})).statusCode).toBe(400);
    expect((await call('cs', 'POST', u, { note: '   ' })).statusCode).toBe(400);
    expect((await call('is', 'POST', u, { note: 'x' })).statusCode).toBe(403);
    const r = await call('cs', 'POST', u, { note: 'Need drawing and quantity' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ ownerOffice: 'INDIA', assignedTo: ids.is, sendBack: { side: 'INDIA', note: 'Need drawing and quantity', byName: 'cs' } });
    expect(JSON.stringify(r.json().data)).not.toContain('Secret Customer'); // China's view still hides the customer
    expect((await get(call, 'is', lead.id)).sendBack.side).toBe('INDIA');
    expect((await get(call, 'is', lead.id)).sla.office).toBe('INDIA'); // India's clock restarts
    expect((await notifs(call, 'is')).some((n) => n.kind === 'SENT_BACK' && n.detail.includes('drawing'))).toBe(true);
    expect((await call('cs', 'POST', u, { note: 'again' })).statusCode).toBe(409); // India holds it now
    // India answers and re-sends
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/resend`, { note: 'x' })).statusCode).toBe(403);
    expect((await call('is', 'POST', `/api/leads/${lead.id}/resend`, {})).statusCode).toBe(400);
    const s = await call('is', 'POST', `/api/leads/${lead.id}/resend`, { note: 'Qty 500, drawing attached' });
    expect(s.statusCode).toBe(200);
    expect(s.json().data).toMatchObject({ ownerOffice: 'CHINA', assignedTo: ids.cs, sendBack: null });
    expect((await notifs(call, 'cs')).some((n) => n.kind === 'INFO_PROVIDED')).toBe(true);
    expect((await call('is', 'POST', `/api/leads/${lead.id}/resend`, { note: 'x' })).statusCode).toBe(409);
    for (const who of ['cs', 'is']) {
      const evs = (await call(who, 'GET', `/api/leads/${lead.id}/timeline`)).json().data.events as any[];
      expect(evs.filter((e) => e.kind === 'SENT_BACK' || e.kind === 'BACK_ANSWERED').map((e) => e.data.note)).toEqual(['Need drawing and quantity', 'Qty 500, drawing attached']);
    }
  });
});

describe('send back: India → China quote revision', () => {
  it('needs a note, goes to the quoting China staff, resubmit bumps the revision and keeps Q-number', async () => {
    const { call, ids, lead } = await setup();
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 5, currency: 'USD', newSupplier: { name: 'Hidden Supplier Co' } })).json().data;
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'INDIA' }); // China hands the quote over
    await call('sa', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs2 }); // someone else holds it in China now
    await call('sa', 'POST', `/api/leads/${lead.id}/assign`, { office: 'INDIA' });
    const u = `/api/quotes/${q.id}/send-back`;
    expect((await call('is', 'POST', u, {})).statusCode).toBe(400);
    expect((await call('cs', 'POST', u, { note: 'x' })).statusCode).toBe(403);
    const r = await call('is', 'POST', u, { note: 'Price too high, target $4' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ revision: 0, revRequest: { note: 'Price too high, target $4', byName: 'is' } });
    expect(JSON.stringify(r.json().data)).not.toContain('Hidden Supplier');
    const l = await get(call, 'cs', lead.id);
    expect(l).toMatchObject({ ownerOffice: 'CHINA', assignedTo: ids.cs, sendBack: { side: 'CHINA', quoteId: q.id } });
    expect(l.sla.office).toBe('CHINA');
    expect((await notifs(call, 'cs')).some((n) => n.kind === 'REVISE_REQUESTED' && n.detail.startsWith('Q1'))).toBe(true);
    expect((await call('is', 'POST', `/api/quotes/${q.id}/resubmit`, {})).statusCode).toBe(403);
    await call('cs', 'PATCH', `/api/quotes/${q.id}`, { unitPrice: 4 });
    const s = await call('cs', 'POST', `/api/quotes/${q.id}/resubmit`, { note: 'Done at $4' });
    expect(s.statusCode).toBe(200);
    expect(s.json().data).toMatchObject({ revision: 1, revRequest: null, unitPrice: 4, label: expect.stringMatching(/-Q1$/) });
    expect((await call('cs', 'POST', `/api/quotes/${q.id}/resubmit`, {})).statusCode).toBe(409);
    const l2 = await get(call, 'is', lead.id);
    expect(l2).toMatchObject({ ownerOffice: 'INDIA', assignedTo: ids.is, sendBack: null });
    expect((await notifs(call, 'is')).some((n) => n.kind === 'QUOTE_REVISED' && n.detail.includes('rev 1'))).toBe(true);
    const evs = (await call('is', 'GET', `/api/leads/${lead.id}/timeline`)).json().data.events as any[];
    expect(evs.find((e) => e.kind === 'QUOTE_REVISED').data).toMatchObject({ n: 1, rev: 1, note: 'Done at $4' });
  });
});
