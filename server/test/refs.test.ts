import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { RefCounter } from '../src/refs.js';
import { UserStore } from '../src/users.js';
import { backfill } from '../scripts/backfill-refs.js';
import { MockTwenty } from './fixtures.js';

async function setup(refs?: RefCounter) {
  const twenty = new MockTwenty(), users = new UserStore();
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40), refs });
  for (const r of ['INDIA_STAFF', 'CHINA_STAFF', 'SUPER_ADMIN'] as const) await users.create(`${r}@x.in`, r, r, 'demo-password-1');
  const tok: Record<string, string> = {};
  for (const r of ['INDIA_STAFF', 'CHINA_STAFF', 'SUPER_ADMIN'])
    tok[r] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${r}@x.in`, password: 'demo-password-1' } })).json().token;
  const call = (role: string, method: string, url: string, payload?: object) =>
    app.inject({ method: method as any, url, payload, headers: { authorization: `Bearer ${tok[role]}` } });
  return { app, twenty, call };
}
const yymm = (() => { const d = new Date(); return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

describe('shared lead reference SE-YYMM-NNNN', () => {
  it('is sequential, unique under concurrency, and continues after existing refs', async () => {
    const { twenty, call } = await setup();
    await twenty.update('leads', 'lead-india-1', { leadRef: `SE-${yymm}-0041` });
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call('INDIA_STAFF', 'POST', '/api/records/leads', { name: `L${i}`, clientName: `C${i}` })));
    const refs = rs.map((r) => r.json().data.leadRef).sort();
    expect(new Set(refs).size).toBe(20);
    expect(refs[0]).toBe(`SE-${yymm}-0042`);
    expect(refs[19]).toBe(`SE-${yymm}-0061`);
  });

  it('cannot be set or changed by clients; never reused across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-ref-')), file = join(dir, 'refs.json');
    const a = await setup(new RefCounter(file));
    const r1 = await a.call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'x', leadRef: 'SE-0000-0001' });
    expect(r1.statusCode).toBe(403);
    const ok = await a.call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'x' });
    expect((await a.call('SUPER_ADMIN', 'PATCH', `/api/records/leads/${ok.json().data.id}`, { leadRef: 'SE-0000-0009' })).statusCode).toBe(403);
    const b = await setup(new RefCounter(file)); // fresh Twenty, same counter file
    const r2 = await b.call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'y' });
    expect(r2.json().data.leadRef).toBe(`SE-${yymm}-0002`);
  });

  it('carries onto sourcing requests, quotations and shipments, visible and searchable on both sides', async () => {
    const { twenty, call } = await setup();
    const lead = (await call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'Acme — cups', clientName: 'Acme', contactEmail: { primaryEmail: 'a@acme.in' }, enquiryMessage: 'call me' })).json().data;
    await twenty.update('leads', lead.id, { assignedOffice: 'CHINA' });
    const sr = (await call('CHINA_STAFF', 'POST', '/api/records/sourcingRequests', { name: 'cups', leadId: lead.id })).json().data;
    const q = (await call('CHINA_STAFF', 'POST', '/api/records/quotations', { name: 'QT', sourcingRequestId: sr.id, unitCost: 1, currency: 'CNY' })).json().data;
    const sh = (await call('CHINA_STAFF', 'POST', '/api/records/shippingOrders', { name: 'SH', quotationId: q.id })).json().data;
    for (const x of [sr, q, sh]) expect(x.leadRef).toBe(lead.leadRef);
    for (const role of ['INDIA_STAFF', 'CHINA_STAFF', 'SUPER_ADMIN']) {
      const l = (await call(role, 'GET', `/api/records/leads/${lead.id}`)).json().data;
      expect(l.leadRef).toBe(lead.leadRef);
      const qs = (await call(role, 'GET', `/api/records/quotations?leadRef=${lead.leadRef}`)).json().data;
      expect(qs.map((x: any) => x.leadRef)).toEqual([lead.leadRef]);
      expect((await call(role, 'GET', `/api/records/shippingOrders?leadRef=${lead.leadRef}`)).json().data).toHaveLength(1);
      if (role === 'CHINA_STAFF') {
        for (const k of ['clientName', 'contactEmail', 'contactPhone', 'enquiryMessage', 'contactName']) expect(l).not.toHaveProperty(k);
        expect(l.name).toBe(lead.leadRef); // the real name contains the client
      }
    }
  });

  it('website enquiry success returns the same reference stored on the lead', async () => {
    const { app, twenty } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/public/enquiry', payload: { name: 'Ravi', phoneCode: '+91', phone: '9000000000', product: 'LED' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().reference).toMatch(new RegExp(`^SE-${yymm}-\\d{4}$`));
    expect((await twenty.list('leads')).at(-1)!.leadRef).toBe(r.json().reference);
  });

  it('backfill numbers old leads by creation month and propagates to children', async () => {
    const twenty = new MockTwenty();
    const out = await backfill(twenty, new RefCounter(), false);
    const leads = await twenty.list('leads');
    expect(leads.map((l) => l.leadRef)).toEqual(['SE-2610-0001', 'SE-2610-0002']);
    expect((await twenty.get('sourcingRequests', 'sr-1'))!.leadRef).toBe('SE-2610-0002');
    expect((await twenty.get('quotations', 'q-1'))!.leadRef).toBe('SE-2610-0002');
    expect(out.leads).toBe(2);
    expect((await backfill(twenty, new RefCounter(), false)).leads).toBe(0); // idempotent
  });
});
