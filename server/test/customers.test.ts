import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-1';
describe('Customer directory (India side)', () => {
  it('auto-links + dedupes leads, side-locked visibility, permissions, add/edit/merge, pick on lead create', async () => {
    const { db, bus, users } = await testEnv(false);
    const app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40) });
    const ids: Record<string, string> = {}, tok: Record<string, string> = {};
    for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['ia', 'INDIA_ADMIN'], ['is', 'INDIA_STAFF'], ['ca', 'CHINA_ADMIN'], ['cs', 'CHINA_STAFF']] as const) {
      ids[e] = (await users.create(`${e}@x.in`, e, r as any, PW)).id;
      tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
    }
    const call = (who: string, method: any, url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
    // Two enquiries from the same phone (different formatting) + one other.
    for (const p of [{ name: 'Ravi', phone: '+91 98765 43210', product: 'Mugs' }, { name: 'Ravi K', phone: '9876543210', product: 'Bottles' }, { name: 'Asha', phone: '9123456780', product: 'Bags' }])
      expect((await app.inject({ method: 'POST', url: '/api/public/enquiry', payload: p })).statusCode).toBe(201);
    const list = (await call('ia', 'GET', '/api/customers')).json().data;
    expect(list).toHaveLength(2);
    const ravi = list.find((c: any) => c.name === 'Ravi');
    expect(ravi.leads).toBe(2);

    // Visibility: India admin + super admin yes; India staff off by default; China never (even if granted).
    expect((await call('sa', 'GET', '/api/customers')).statusCode).toBe(200);
    expect((await call('is', 'GET', '/api/customers')).statusCode).toBe(403);
    expect((await call('cs', 'GET', '/api/customers')).statusCode).toBe(403);
    expect((await call('ca', 'GET', '/api/customers')).statusCode).toBe(403);
    expect((await call('sa', 'PUT', `/api/users/${ids.ca}/permissions`, { permissions: { 'customers.view': true } })).statusCode).toBe(403);
    // Suppliers: China admin yes, India admin never.
    expect((await call('ca', 'GET', '/api/suppliers')).statusCode).toBe(200);
    expect((await call('ia', 'GET', '/api/suppliers')).statusCode).toBe(403);
    // India staff can be granted.
    expect((await call('sa', 'PUT', `/api/users/${ids.is}/permissions`, { permissions: { 'customers.view': true } })).statusCode).toBe(200);
    expect((await call('is', 'GET', '/api/customers')).statusCode).toBe(200);
    expect((await call('is', 'POST', '/api/customers', { name: 'X' })).statusCode).toBe(403);

    // Detail with history.
    const d = (await call('ia', 'GET', `/api/customers/${ravi.id}`)).json().data;
    expect(d.leads.map((l: any) => l.product).sort()).toEqual(['Bottles', 'Mugs']);
    // Edit + add + merge.
    expect((await call('ia', 'PATCH', `/api/customers/${ravi.id}`, { company: 'Ravi Traders', gst: '29ABCDE1234F1Z5', tags: 'vip, retail' })).json().data).toMatchObject({ company: 'Ravi Traders', tags: ['vip', 'retail'] });
    const dup = (await call('ia', 'POST', '/api/customers', { name: 'Ravi (dup)', email: 'ravi@x.in', tags: ['wholesale'] })).json().data;
    const asha = list.find((c: any) => c.name === 'Asha');
    const m = await call('ia', 'POST', `/api/customers/${ravi.id}/merge`, { from: [dup.id, asha.id] });
    expect(m.json().data).toMatchObject({ email: 'ravi@x.in', tags: ['vip', 'retail', 'wholesale'] });
    expect((await call('ia', 'GET', `/api/customers/${ravi.id}`)).json().data.leads).toHaveLength(3);
    expect((await call('ia', 'DELETE', `/api/customers/${ravi.id}`)).statusCode).toBe(409);

    // Lead creation can pick an existing customer.
    const nl = await call('ia', 'POST', '/api/records/leads', { productInterest: 'Caps', customerId: ravi.id });
    expect(nl.statusCode).toBe(201);
    const lead = (await call('ia', 'GET', `/api/records/leads/${nl.json().data.id}`)).json().data;
    expect(lead.clientName).toBe('Ravi Traders');
    expect((await call('ia', 'GET', `/api/customers/${ravi.id}`)).json().data.leads).toHaveLength(4);
    // New empty customer can be deleted.
    const e = (await call('sa', 'POST', '/api/customers', { name: 'Temp' })).json().data;
    expect((await call('sa', 'DELETE', `/api/customers/${e.id}`)).statusCode).toBe(204);
  });
});
