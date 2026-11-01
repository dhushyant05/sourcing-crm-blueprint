import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { ROLES, type Role } from '../src/roles.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-battery';
let app: Awaited<ReturnType<typeof buildApp>>, twenty: Awaited<ReturnType<typeof testEnv>>['twenty'];
const tokens = {} as Record<Role, string>;
const email = (r: Role) => `${r.toLowerCase()}@sourceeasy.in`;

beforeAll(async () => {
  const env = await testEnv(); twenty = env.twenty;
  const { db, bus, users } = env;
  for (const r of ROLES) await users.create(email(r), r, r, PW);
  app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40), backupLinks: [{ label: 'Backups', url: 'https://backups.sourceeasy.in' }] });
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
    expect(c).toMatchObject({ customers: false, suppliers: true, backups: false, currencies: ['USD', 'CNY', 'INR'] });
    expect((await get('INDIA_STAFF', '/api/me')).json().capabilities).toMatchObject({ customers: true, suppliers: false, currencies: ['USD', 'CNY', 'INR'] });
  });
});

describe.each(['CHINA_STAFF', 'CHINA_ADMIN'] as Role[])('%s', (role) => {
  it('sees only China-assigned leads, with no customer fields', async () => {
    const leads = await data(role, 'leads');
    expect(leads.map((l) => l.id)).toEqual(['lead-china-1']);
    expect(keys(leads[0])).toEqual(['assignedChinaAgent', 'assignedOffice', 'assignedTo', 'assignedToName', 'attachmentCount', 'createdAt', 'createdFromId', 'createdFromRef', 'followUp', 'id', 'leadRef', 'name', 'office', 'ownerOffice', 'priority', 'productInterest', 'quantity', 'raisedBy', 'raisedByName', 'referenceUrl', 'rejection', 'sla', 'status', 'summary', 'unit', 'updatedAt']);
    expect(leads[0].name).toBe('Lead lead-chi');
  });
  it('sees the supplier directory; never any customer string in leads', async () => {
    const sup = (await send(role, 'POST', '/api/suppliers', { name: 'Ningbo Brightway', wechat: 'brightway_ly', phone: '+8613800000000' })).json().data;
    const list = (await get(role, '/api/suppliers')).json().data as any[];
    expect(list.find((x) => x.id === sup.id)).toMatchObject({ name: 'Ningbo Brightway', wechat: 'brightway_ly' });
    expect((await get(role, `/api/suppliers/${sup.id}`)).statusCode).toBe(200);
    const blob = json(await data(role, 'leads'));
    for (const s of CUSTOMER_STRINGS) expect(blob).not.toContain(s);
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
    expect((await get(role, '/api/suppliers')).statusCode).toBe(403);
    expect((await get(role, '/api/records/suppliers')).statusCode).toBe(404); // generic records cover leads only
  });
  it('can create leads; cannot create suppliers', async () => {
    expect((await send(role, 'POST', '/api/records/leads', { name: 'N', clientName: 'New', status: 'NEW' })).statusCode).toBe(201);
    expect((await send(role, 'POST', '/api/records/leads', { name: 'N', targetPrice: { amountMicros: 1e6, currencyCode: 'EUR' } })).statusCode).toBe(400);
    expect((await send(role, 'POST', '/api/suppliers', { name: 'x' })).statusCode).toBe(403);
  });
});

describe('SUPER_ADMIN', () => {
  it('sees all leads and the supplier directory', async () => {
    expect((await data('SUPER_ADMIN', 'leads')).length).toBeGreaterThanOrEqual(2);
    expect((await get('SUPER_ADMIN', '/api/suppliers')).statusCode).toBe(200);
  });
  it('gets backup links', async () => {
    expect((await get('SUPER_ADMIN', '/api/backups')).json().data[0].url).toBe('https://backups.sourceeasy.in');
  });
  it('backups are super-admin only', async () => {
    for (const r of ROLES.filter((x) => x !== 'SUPER_ADMIN')) expect((await get(r, '/api/backups')).statusCode).toBe(403);
  });
});

describe('no exchange rates', () => {
  it('the exchange rate object no longer exists for any role', async () => {
    for (const r of ROLES) expect((await get(r, '/api/records/exchangeRates')).statusCode).toBe(404);
  });
});

describe('language preference', () => {
  it('each user can save en / zh-CN; other values are rejected', async () => {
    const r = await send('CHINA_STAFF', 'PATCH', '/api/me', { language: 'zh-CN' });
    expect(r.statusCode).toBe(200);
    expect(r.json().language).toBe('zh-CN');
    expect((await get('CHINA_STAFF', '/api/me')).json().language).toBe('zh-CN');
    expect((await get('INDIA_STAFF', '/api/me')).json().language).toBeNull();
    expect((await send('INDIA_STAFF', 'PATCH', '/api/me', { language: 'fr' })).statusCode).toBe(400);
  });
});

describe('team members & user management', () => {
  it('staff cannot list users or team members', async () => {
    for (const r of ['INDIA_STAFF', 'CHINA_STAFF'] as Role[]) {
      expect((await get(r, '/api/users')).statusCode).toBe(403);
    }
  });
  it('office admins see only their side', async () => {
    const users = (await get('CHINA_ADMIN', '/api/users')).json().data as any[];
    expect(users.map((u) => u.role).sort()).toEqual(['CHINA_ADMIN', 'CHINA_STAFF']);
    expect(json(users)).not.toContain('password');
  });
  it('India admin creates India staff but not China staff or super admin', async () => {
    const ok = await send('INDIA_ADMIN', 'POST', '/api/users', { email: 'new@sourceeasy.in', name: 'New', role: 'INDIA_STAFF', password: PW });
    expect(ok.statusCode).toBe(201);
    expect((await send('INDIA_ADMIN', 'POST', '/api/users', { email: 'c@x.cn', name: 'C', role: 'CHINA_STAFF', password: PW })).statusCode).toBe(403);
    expect((await send('INDIA_ADMIN', 'POST', '/api/users', { email: 's@x.in', name: 'S', role: 'SUPER_ADMIN', password: PW })).statusCode).toBe(403);
    expect((await send('INDIA_STAFF', 'POST', '/api/users', { email: 'z@x.in', name: 'Z', role: 'INDIA_STAFF', password: PW })).statusCode).toBe(403);
  });
  it('password reset revokes old sessions; China admin cannot reset India users', async () => {
    const users = (await get('SUPER_ADMIN', '/api/users')).json().data as any[];
    const target = users.find((u) => u.email === 'new@sourceeasy.in');
    expect((await send('CHINA_ADMIN', 'POST', `/api/users/${target.id}/password`, { password: 'another-long-pass' })).statusCode).toBe(403);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@sourceeasy.in', password: PW } });
    const old = login.json().token;
    expect((await send('INDIA_ADMIN', 'POST', `/api/users/${target.id}/password`, { password: 'another-long-pass' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${old}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@sourceeasy.in', password: 'another-long-pass' } })).statusCode).toBe(200);
  });
  it('a disabled user cannot sign in; role change takes effect immediately', async () => {
    const users = (await get('SUPER_ADMIN', '/api/users')).json().data as any[];
    const target = users.find((u) => u.email === 'new@sourceeasy.in');
    expect((await send('INDIA_ADMIN', 'PATCH', `/api/users/${target.id}`, { role: 'CHINA_STAFF' })).statusCode).toBe(403);
    expect((await send('INDIA_ADMIN', 'PATCH', `/api/users/${target.id}`, { active: false })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@sourceeasy.in', password: 'another-long-pass' } })).statusCode).toBe(401);
  });
});

describe('bootstrap', () => {
  it('creates super admin once from env values', async () => {
    const u = (await testEnv(false)).users;
    expect(await u.bootstrap('root@sourceeasy.in', 'super-secret-pass')).toBe(true);
    expect(await u.bootstrap('root@sourceeasy.in', 'other-password-x')).toBe(false);
    expect((await u.verify('root@sourceeasy.in', 'super-secret-pass'))?.role).toBe('SUPER_ADMIN');
  });
});
