import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ROLES, type Role } from '../src/roles.js';
import { ROLE_DEFAULTS } from '../src/permissions.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-battery';
let app: Awaited<ReturnType<typeof buildApp>>;
const tok = {} as Record<Role, string>, ids = {} as Record<Role, string>;
const email = (r: Role) => `${r.toLowerCase()}@sourceeasy.in`;
beforeAll(async () => {
  const { db, bus, users } = await testEnv();
  for (const r of ROLES) ids[r] = (await users.create(email(r), r, r, PW)).id;
  app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40) });
  for (const r of ROLES) tok[r] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: email(r), password: PW } })).json().token;
});
const call = (r: Role, method: string, url: string, payload?: object) => app.inject({ method: method as any, url, payload, headers: { authorization: `Bearer ${tok[r]}` } });
const setPerm = (r: Role, target: Role, permissions: Record<string, boolean | null>) => call(r, 'PUT', `/api/users/${ids[target]}/permissions`, { permissions });

describe('per-user permissions', () => {
  it('me carries the role defaults', async () => {
    for (const r of ROLES) expect((await call(r, 'GET', '/api/me')).json().permissions.sort()).toEqual([...ROLE_DEFAULTS[r]].sort());
  });
  it('only the super admin may change permissions', async () => {
    expect((await setPerm('INDIA_ADMIN', 'INDIA_STAFF', { 'reports.view': false })).statusCode).toBe(403);
    expect((await setPerm('SUPER_ADMIN', 'SUPER_ADMIN', { 'reports.view': false })).statusCode).toBe(400);
  });
  it('hard separation cannot be overridden', async () => {
    expect((await setPerm('SUPER_ADMIN', 'INDIA_STAFF', { 'suppliers.view': true })).statusCode).toBe(403);
    expect((await setPerm('SUPER_ADMIN', 'CHINA_STAFF', { 'prices.inr': true })).statusCode).toBe(403);
    expect((await call('INDIA_STAFF', 'GET', '/api/suppliers')).statusCode).toBe(403);
  });
  it('revoke → 403 instantly, audited, restore', async () => {
    expect((await call('CHINA_STAFF', 'GET', '/api/suppliers')).statusCode).toBe(200);
    const r = await setPerm('SUPER_ADMIN', 'CHINA_STAFF', { 'suppliers.view': false });
    expect(r.statusCode).toBe(200); expect(r.json().data.changed).toBe(1);
    expect((await call('CHINA_STAFF', 'GET', '/api/suppliers')).statusCode).toBe(403);
    expect((await call('CHINA_STAFF', 'GET', '/api/me')).json().permissions).not.toContain('suppliers.view');
    const m = (await call('SUPER_ADMIN', 'GET', `/api/users/${ids.CHINA_STAFF}/permissions`)).json().data;
    expect(m.audit[0]).toMatchObject({ perm: 'suppliers.view', before: null, after: false, changedBy: ids.SUPER_ADMIN });
    expect(m.permissions.find((p: any) => p.key === 'prices.inr').locked).toBe(true);
    await setPerm('SUPER_ADMIN', 'CHINA_STAFF', { 'suppliers.view': null });
    expect((await call('CHINA_STAFF', 'GET', '/api/suppliers')).statusCode).toBe(200);
    expect((await call('SUPER_ADMIN', 'GET', '/api/permissions/audit')).json().data.length).toBe(2);
  });
  it('grants: staff gets SLA settings, lead delete, export', async () => {
    expect((await call('INDIA_STAFF', 'PUT', '/api/settings/sla', { normalMinutes: 120 })).statusCode).toBe(403);
    expect((await call('INDIA_STAFF', 'GET', '/api/export/leads')).statusCode).toBe(403);
    await setPerm('SUPER_ADMIN', 'INDIA_STAFF', { 'settings.sla': true, 'data.export': true });
    expect((await call('INDIA_STAFF', 'PUT', '/api/settings/sla', { normalMinutes: 120 })).statusCode).toBe(200);
    const csv = await call('INDIA_STAFF', 'GET', '/api/export/leads');
    expect(csv.statusCode).toBe(200); expect(csv.headers['content-type']).toMatch(/text\/csv/); expect(csv.body).toContain('Arora');
    // China export never contains customer identity
    await setPerm('SUPER_ADMIN', 'CHINA_STAFF', { 'data.export': true });
    const c = await call('CHINA_STAFF', 'GET', '/api/export/leads');
    expect(c.statusCode).toBe(200); expect(c.body).not.toMatch(/Arora|Mehta|buyer@/);
  });
  it('leads.all off → only my leads', async () => {
    expect((await call('INDIA_STAFF', 'GET', '/api/records/leads')).json().data.length).toBeGreaterThan(0);
    await setPerm('SUPER_ADMIN', 'INDIA_STAFF', { 'leads.all': false });
    expect((await call('INDIA_STAFF', 'GET', '/api/records/leads')).json().data.length).toBe(0);
    expect((await call('INDIA_STAFF', 'GET', '/api/records/leads/lead-india-1')).statusCode).toBe(404);
    await setPerm('SUPER_ADMIN', 'INDIA_STAFF', { 'leads.all': null });
  });
  it('staff.manage lets a staff member manage own-side staff only', async () => {
    expect((await call('INDIA_STAFF', 'GET', '/api/users')).statusCode).toBe(403);
    await setPerm('SUPER_ADMIN', 'INDIA_STAFF', { 'staff.manage': true });
    const us = (await call('INDIA_STAFF', 'GET', '/api/users')).json().data as any[];
    expect(us.every((u) => u.role === 'INDIA_STAFF')).toBe(true);
  });
});
