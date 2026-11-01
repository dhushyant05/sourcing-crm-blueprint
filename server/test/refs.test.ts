import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { RefCounter } from '../src/refs.js';
import { openMemoryDb, type Db } from '../src/db.js';
import { MemoryBus } from '../src/bus.js';
import { UserStore } from '../src/users.js';
import { testEnv } from './fixtures.js';

async function setup(shared?: Db) {
  const env = await testEnv(), twenty = env.twenty;
  const db = shared ?? env.db, users = shared ? await new UserStore(db).load() : env.users;
  const app = await buildApp({ db, bus: new MemoryBus(), users, jwtSecret: 'x'.repeat(40) });
  for (const r of ['INDIA_STAFF', 'CHINA_STAFF', 'SUPER_ADMIN'] as const) if (!users.row(`${r}@x.in`)) await users.create(`${r}@x.in`, r, r, 'demo-password-1');
  const tok: Record<string, string> = {};
  for (const r of ['INDIA_STAFF', 'CHINA_STAFF', 'SUPER_ADMIN'])
    tok[r] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${r}@x.in`, password: 'demo-password-1' } })).json().token;
  const call = (role: string, method: string, url: string, payload?: object) =>
    app.inject({ method: method as any, url, payload, headers: { authorization: `Bearer ${tok[role]}` } });
  return { app, twenty, call, db };
}
const yymm = (() => { const d = new Date(); return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

describe('shared lead reference SE-YYMM-NNNN', () => {
  it('is sequential, unique under concurrency, and continues after existing refs', async () => {
    const { twenty, call, db } = await setup();
    await twenty.update('leads', 'lead-india-1', { leadRef: `SE-${yymm}-0041` });
    await new RefCounter(db).seen(`SE-${yymm}-0041`); // as the legacy migration does for imported refs
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call('INDIA_STAFF', 'POST', '/api/records/leads', { name: `L${i}`, clientName: `C${i}` })));
    const refs = rs.map((r) => r.json().data.leadRef).sort();
    expect(new Set(refs).size).toBe(20);
    expect(refs[0]).toBe(`SE-${yymm}-0042`);
    expect(refs[19]).toBe(`SE-${yymm}-0061`);
  });

  it('cannot be set or changed by clients; never reused across restarts', async () => {
    const db = await openMemoryDb();
    const a = await setup(db);
    const r1 = await a.call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'x', leadRef: 'SE-0000-0001' });
    expect(r1.statusCode).toBe(403);
    const ok = await a.call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'x' });
    expect((await a.call('SUPER_ADMIN', 'PATCH', `/api/records/leads/${ok.json().data.id}`, { leadRef: 'SE-0000-0009' })).statusCode).toBe(403);
    const b = await setup(db); // new process, same database
    const r2 = await b.call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'y' });
    expect(r2.json().data.leadRef).toBe(`SE-${yymm}-0002`);
  });

  it('is visible on the lead for every role; China sees the ref instead of the client name', async () => {
    const { call } = await setup();
    const lead = (await call('INDIA_STAFF', 'POST', '/api/records/leads', { name: 'Acme — cups', clientName: 'Acme', contactEmail: { primaryEmail: 'a@acme.in' }, enquiryMessage: 'call me' })).json().data;
    expect(lead.leadRef).toMatch(new RegExp(`^SE-${yymm}-\\d{4}$`));
    await call('INDIA_STAFF', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' });
    for (const role of ['INDIA_STAFF', 'CHINA_STAFF', 'SUPER_ADMIN']) {
      const l = (await call(role, 'GET', `/api/records/leads/${lead.id}`)).json().data;
      expect(l.leadRef).toBe(lead.leadRef);
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

  it('the counter never goes below a reference already in use', async () => {
    const db = await openMemoryDb(), refs = new RefCounter(db);
    await refs.seen('SE-2610-0043');
    expect(await refs.next(new Date('2026-10-15T00:00:00Z'))).toBe('SE-2610-0044');
    await refs.seen('SE-2610-0002');
    expect(await refs.next(new Date('2026-10-15T00:00:00Z'))).toBe('SE-2610-0045');
  });
});
