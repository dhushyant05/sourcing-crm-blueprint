import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { ROLES, type Role } from '../src/roles.js';
import { MockTwenty } from './fixtures.js';

const PW = 'correct-horse-battery';
let app: Awaited<ReturnType<typeof buildApp>>, twenty: MockTwenty;
const tokens = {} as Record<Role, string>;
const email = (r: Role) => `${r.toLowerCase()}@sourceec.in`;

beforeAll(async () => {
  twenty = new MockTwenty();
  const users = new UserStore();
  for (const r of ROLES) await users.create(email(r), r, r, PW);
  app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40), backupLinks: [{ label: 'Backups', url: 'https://backups.sourceec.in' }] });
  for (const r of ROLES) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: email(r), password: PW } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe(r);
    tokens[r] = res.json().token;
  }
});

const get = (r: Role, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokens[r]}` } });
const send = (r: Role, method: 'POST' | 'PATCH', url: string, payload: object) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${tokens[r]}` } });
const data = async (r: Role, plural: string) => { const res = await get(r, `/api/records/${plural}`); expect(res.statusCode).toBe(200); return res.json().data as any[]; };
const keys = (o: object) => Object.keys(o).sort();
const json = (x: unknown) => JSON.stringify(x);

const CUSTOMER_STRINGS = ['Arora', 'Mehta', 'buyer@', '+9198', 'Mr Mehta', 'ok via phone', 'https://chat/1'];
const SUPPLIER_STRINGS = ['Ningbo', 'brightway', '+86138', 'MOQ 500', 'sup-1'];

describe('auth', () => {
  it('rejects bad password and missing token', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: email('INDIA_STAFF'), password: 'nope' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/records/leads' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/records/leads', headers: { authorization: 'Bearer forged' } })).statusCode).toBe(401);
  });
  it('/api/me returns role capabilities', async () => {
    const c = (await get('CHINA_STAFF', '/api/me')).json().capabilities;
    expect(c).toMatchObject({ customers: false, suppliers: true, rates: false, backups: false, currencies: ['CNY', 'USD'] });
    expect((await get('INDIA_STAFF', '/api/me')).json().capabilities).toMatchObject({ customers: true, suppliers: false, currencies: ['INR'] });
  });
});

describe.each(['CHINA_STAFF', 'CHINA_ADMIN'] as Role[])('%s', (role) => {
  it('sees only China-assigned leads, with no customer fields', async () => {
    const leads = await data(role, 'leads');
    expect(leads.map((l) => l.id)).toEqual(['lead-china-1']);
    expect(keys(leads[0])).toEqual(['assignedChinaAgent', 'assignedOffice', 'createdAt', 'id', 'name', 'office', 'productInterest', 'quantity', 'status']);
    expect(leads[0].name).toBe('Lead lead-chi');
  });
  it('sees suppliers with contact details', async () => {
    const s = await data(role, 'suppliers');
    expect(s[0]).toMatchObject({ name: 'Ningbo Brightway', wechatId: 'brightway_ly', phone: { primaryPhoneNumber: '+8613800000000' } });
  });
  it('sees raw supplier cost but not client price', async () => {
    const q = await data(role, 'quotations');
    const q1 = q.find((x) => x.id === 'q-1');
    expect(q1).toMatchObject({ unitCost: 10, currency: 'CNY', supplierId: 'sup-1' });
    expect(q1).not.toHaveProperty('clientUnitPriceInr');
  });
  it('sees approvals without approver/notes; shipments; never any customer string anywhere', async () => {
    const all = await Promise.all(['leads', 'sourcingRequests', 'suppliers', 'quotations', 'clientApprovals', 'shippingOrders', 'exchangeRates'].map((p) => data(role, p)));
    const blob = json(all);
    for (const s of CUSTOMER_STRINGS) expect(blob).not.toContain(s);
    expect(all[4][0]).toEqual({ id: 'ap-1', status: 'APPROVED', decidedAt: '2026-10-07', quotationId: 'q-1' });
    expect(all[5][0]).toMatchObject({ trackingNumber: 'MAEU1' });
  });
  it('cannot read the India-only lead by id, nor create leads', async () => {
    expect((await get(role, '/api/records/leads/lead-india-1')).statusCode).toBe(404);
    expect((await send(role, 'POST', '/api/records/leads', { name: 'x', clientName: 'y' })).statusCode).toBe(403);
  });
  it('can move a China lead to QUOTED but not WON, nor rename the client', async () => {
    expect((await send(role, 'PATCH', '/api/records/leads/lead-china-1', { status: 'QUOTED' })).statusCode).toBe(200);
    expect((await send(role, 'PATCH', '/api/records/leads/lead-china-1', { status: 'WON' })).statusCode).toBe(403);
    expect((await send(role, 'PATCH', '/api/records/leads/lead-china-1', { clientName: 'z' })).statusCode).toBe(403);
    expect((await send(role, 'PATCH', '/api/records/leads/lead-india-1', { status: 'SOURCING' })).statusCode).toBe(404);
  });
  it('can create suppliers/quotations; cannot set client price, rates or record approvals', async () => {
    expect((await send(role, 'POST', '/api/records/quotations', { name: 'Q', unitCost: 3, currency: 'CNY', sourcingRequestId: 'sr-1' })).statusCode).toBe(201);
    expect((await send(role, 'POST', '/api/records/suppliers', { name: 'New Co', wechatId: 'n' })).statusCode).toBe(201);
    expect((await send(role, 'PATCH', '/api/records/quotations/q-1', { clientUnitPriceInr: 1 })).statusCode).toBe(403);
    expect((await send(role, 'POST', '/api/records/exchangeRates', { currencyPair: 'CNY_INR', rate: 1 })).statusCode).toBe(403);
    expect((await send(role, 'POST', '/api/records/clientApprovals', { status: 'APPROVED' })).statusCode).toBe(403);
  });
  it('cannot filter by hidden fields', async () => {
    expect((await get(role, '/api/records/leads?clientName=Arora%20Home%20Store')).statusCode).toBe(400);
  });
});

describe.each(['INDIA_STAFF', 'INDIA_ADMIN'] as Role[])('%s', (role) => {
  it('sees all leads with customer details', async () => {
    const leads = await data(role, 'leads');
    expect(leads.map((l) => l.id)).toEqual(expect.arrayContaining(['lead-china-1', 'lead-india-1']));
    expect(leads.find((l) => l.id === 'lead-india-1')).toMatchObject({ clientName: 'Arora Home Store', contactEmail: { primaryEmail: 'buyer@arora.in' } });
    expect(leads[0]).not.toHaveProperty('secretInternal');
  });
  it('cannot read suppliers', async () => {
    expect((await get(role, '/api/records/suppliers')).statusCode).toBe(403);
    expect((await get(role, '/api/records/suppliers/sup-1')).statusCode).toBe(403);
  });
  it('sees quotations in INR only, without supplier identity or raw cost', async () => {
    const q = await data(role, 'quotations');
    const q1 = q.find((x) => x.id === 'q-1'), q2 = q.find((x) => x.id === 'q-2');
    expect(keys(q1)).toEqual(['clientUnitPriceInr', 'createdAt', 'currency', 'id', 'inrEquivalent', 'name', 'pdfAttachment', 'sourcingRequestId', 'unitCostInr', 'validityDate']);
    expect(q1).toMatchObject({ currency: 'INR', unitCostInr: 120, inrEquivalent: 144000, clientUnitPriceInr: expect.any(Number) });
    // No snapshot rate: uses admin-set USD_INR (84)
    expect(q2).toMatchObject({ currency: 'INR', unitCostInr: 168, inrEquivalent: 16800 });
    const all = json(await Promise.all(['leads', 'sourcingRequests', 'quotations', 'clientApprovals', 'shippingOrders'].map((p) => data(role, p))));
    for (const s of SUPPLIER_STRINGS) expect(all).not.toContain(s);
    expect(all).not.toContain('"unitCost"');
    expect(all).not.toContain('CNY');
  });
  it('sourcing request target price is converted to INR', async () => {
    const [sr] = await data(role, 'sourcingRequests');
    expect(sr.targetPrice).toEqual({ amountMicros: 119e6, currencyCode: 'INR' });
  });
  it('sees approvals in full', async () => {
    expect((await data(role, 'clientApprovals'))[0]).toMatchObject({ approver: 'Mr Mehta' });
  });
  it('can create leads and set client price; cannot write supplier cost, suppliers or rates', async () => {
    expect((await send(role, 'POST', '/api/records/leads', { name: 'N', clientName: 'New', status: 'NEW' })).statusCode).toBe(201);
    expect((await send(role, 'PATCH', '/api/records/quotations/q-1', { clientUnitPriceInr: 160 })).statusCode).toBe(200);
    expect((await send(role, 'PATCH', '/api/records/quotations/q-1', { unitCost: 1 })).statusCode).toBe(403);
    expect((await send(role, 'PATCH', '/api/records/quotations/q-1', { supplierId: 'x' })).statusCode).toBe(403);
    expect((await send(role, 'POST', '/api/records/suppliers', { name: 'x' })).statusCode).toBe(403);
    expect((await send(role, 'POST', '/api/records/exchangeRates', { currencyPair: 'CNY_INR', rate: 1 })).statusCode).toBe(403);
  });
});

describe('SUPER_ADMIN', () => {
  it('sees everything incl. both price views', async () => {
    expect((await data('SUPER_ADMIN', 'leads')).length).toBeGreaterThanOrEqual(2);
    expect((await data('SUPER_ADMIN', 'suppliers'))[0]).toMatchObject({ wechatId: 'brightway_ly' });
    const q1 = (await data('SUPER_ADMIN', 'quotations')).find((q) => q.id === 'q-1');
    expect(q1).toMatchObject({ unitCost: 10, currency: 'CNY', supplierId: 'sup-1', unitCostInr: 120 });
    expect(q1).toHaveProperty('clientUnitPriceInr');
    expect((await data('SUPER_ADMIN', 'teamMembers')).length).toBe(2);
  });
  it('sets exchange rates (setBy forced to the user) and gets backup links', async () => {
    const r = await send('SUPER_ADMIN', 'POST', '/api/records/exchangeRates', { name: 'CNY_INR', currencyPair: 'CNY_INR', rate: 12.1, isManualOverride: true, setBy: 'spoof', effectiveDate: '2026-11-01' });
    expect(r.statusCode).toBe(201);
    expect(twenty.writes.at(-1)!.data.setBy).toBe('SUPER_ADMIN');
    expect((await get('SUPER_ADMIN', '/api/backups')).json().data[0].url).toBe('https://backups.sourceec.in');
  });
  it('backups are super-admin only', async () => {
    for (const r of ROLES.filter((x) => x !== 'SUPER_ADMIN')) expect((await get(r, '/api/backups')).statusCode).toBe(403);
  });
});

describe('exchange rate reads', () => {
  it('every role can read rates; only super admin writes them', async () => {
    for (const r of ROLES) expect((await data(r, 'exchangeRates')).length).toBeGreaterThan(0);
  });
});

describe('team members & user management', () => {
  it('staff cannot list users or team members', async () => {
    for (const r of ['INDIA_STAFF', 'CHINA_STAFF'] as Role[]) {
      expect((await get(r, '/api/users')).statusCode).toBe(403);
      expect((await get(r, '/api/records/teamMembers')).statusCode).toBe(403);
    }
  });
  it('office admins see only their side', async () => {
    expect((await data('INDIA_ADMIN', 'teamMembers')).map((t) => t.email)).toEqual(['asha@se.in']);
    const users = (await get('CHINA_ADMIN', '/api/users')).json().data as any[];
    expect(users.map((u) => u.role).sort()).toEqual(['CHINA_ADMIN', 'CHINA_STAFF']);
    expect(json(users)).not.toContain('password');
  });
  it('India admin creates India staff (synced to Team Member) but not China staff or super admin', async () => {
    const ok = await send('INDIA_ADMIN', 'POST', '/api/users', { email: 'new@sourceec.in', name: 'New', role: 'INDIA_STAFF', password: PW });
    expect(ok.statusCode).toBe(201);
    expect(twenty.db.teamMembers.find((t) => t.email === 'new@sourceec.in')).toMatchObject({ role: 'INDIA_STAFF' });
    expect((await send('INDIA_ADMIN', 'POST', '/api/users', { email: 'c@x.cn', name: 'C', role: 'CHINA_STAFF', password: PW })).statusCode).toBe(403);
    expect((await send('INDIA_ADMIN', 'POST', '/api/users', { email: 's@x.in', name: 'S', role: 'SUPER_ADMIN', password: PW })).statusCode).toBe(403);
    expect((await send('INDIA_STAFF', 'POST', '/api/users', { email: 'z@x.in', name: 'Z', role: 'INDIA_STAFF', password: PW })).statusCode).toBe(403);
  });
  it('password reset revokes old sessions; China admin cannot reset India users', async () => {
    const users = (await get('SUPER_ADMIN', '/api/users')).json().data as any[];
    const target = users.find((u) => u.email === 'new@sourceec.in');
    expect((await send('CHINA_ADMIN', 'POST', `/api/users/${target.id}/password`, { password: 'another-long-pass' })).statusCode).toBe(403);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@sourceec.in', password: PW } });
    const old = login.json().token;
    expect((await send('INDIA_ADMIN', 'POST', `/api/users/${target.id}/password`, { password: 'another-long-pass' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${old}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@sourceec.in', password: 'another-long-pass' } })).statusCode).toBe(200);
  });
  it('a disabled user cannot sign in; role change takes effect immediately', async () => {
    const users = (await get('SUPER_ADMIN', '/api/users')).json().data as any[];
    const target = users.find((u) => u.email === 'new@sourceec.in');
    expect((await send('INDIA_ADMIN', 'PATCH', `/api/users/${target.id}`, { role: 'CHINA_STAFF' })).statusCode).toBe(403);
    expect((await send('INDIA_ADMIN', 'PATCH', `/api/users/${target.id}`, { active: false })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@sourceec.in', password: 'another-long-pass' } })).statusCode).toBe(401);
  });
});

describe('bootstrap', () => {
  it('creates super admin once from env values', async () => {
    const u = new UserStore();
    expect(await u.bootstrap('root@sourceec.in', 'super-secret-pass')).toBe(true);
    expect(await u.bootstrap('root@sourceec.in', 'other-password-x')).toBe(false);
    expect((await u.verify('root@sourceec.in', 'super-secret-pass'))?.role).toBe('SUPER_ADMIN');
  });
});
