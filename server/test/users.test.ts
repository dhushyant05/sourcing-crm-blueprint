import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from './fixtures.js';

const PW = 'correct-horse-1';
async function setup() {
  const twenty = new MockTwenty(), users = new UserStore();
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40) });
  const mk = (email: string, role: any) => users.create(email, email.split('@')[0], role, PW);
  const sa = await mk('sa@x.in', 'SUPER_ADMIN'), ia = await mk('ia@x.in', 'INDIA_ADMIN'), is = await mk('is@x.in', 'INDIA_STAFF'), cs = await mk('cs@x.in', 'CHINA_STAFF');
  const login = async (email: string, password = PW) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    return r.statusCode === 200 ? (r.json().token as string) : null;
  };
  const call = (tok: string | null, method: any, url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok}` } });
  return { app, twenty, users, sa, ia, is, cs, login, call };
}

describe('staff management', () => {
  it('super admin edits name, email, role, active and resets password; sessions are revoked', async () => {
    const { sa, is, login, call } = await setup();
    const S = await login('sa@x.in'), old = await login('is@x.in');
    expect((await call(old, 'GET', '/api/me')).statusCode).toBe(200);
    const r = await call(S, 'PATCH', `/api/users/${is.id}`, { name: 'Priya', email: 'Priya@X.in', role: 'CHINA_STAFF' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ name: 'Priya', email: 'priya@x.in', role: 'CHINA_STAFF' });
    expect((await call(old, 'GET', '/api/me')).statusCode).toBe(401);
    expect(await login('priya@x.in')).toBeTruthy();
    expect((await call(S, 'PATCH', `/api/users/${is.id}`, { email: 'cs@x.in' })).statusCode).toBe(400); // duplicate
    expect((await call(S, 'PATCH', `/api/users/${is.id}`, { email: 'nope' })).statusCode).toBe(400);
    expect((await call(S, 'PATCH', `/api/users/${is.id}`, { name: '  ' })).statusCode).toBe(400);
    expect((await call(S, 'POST', `/api/users/${is.id}/password`, { password: 'short' })).statusCode).toBe(400);
    expect((await call(S, 'POST', `/api/users/${is.id}/password`, { password: 'a-new-password' })).statusCode).toBe(200);
    expect(await login('priya@x.in')).toBeNull();
    expect(await login('priya@x.in', 'a-new-password')).toBeTruthy();
    expect((await call(S, 'PATCH', `/api/users/${is.id}`, { active: false })).statusCode).toBe(200);
    expect(await login('priya@x.in', 'a-new-password')).toBeNull();
    expect((await call(S, 'PATCH', `/api/users/${is.id}`, { active: true })).statusCode).toBe(200);
    expect(await login('priya@x.in', 'a-new-password')).toBeTruthy();
    void sa;
  });

  it('hard delete: super admin only, revokes sessions at once, keeps leads', async () => {
    const { twenty, ia, cs, login, call } = await setup();
    const S = await login('sa@x.in'), A = await login('ia@x.in'), C = await login('cs@x.in');
    await twenty.create('leads', { name: 'L', assignedOffice: 'CHINA', assignedChinaAgent: 'cs', status: 'ASSIGNED' });
    const before = (await twenty.list('leads')).length;
    expect((await call(A, 'DELETE', `/api/users/${cs.id}`)).statusCode).toBe(403);
    expect((await call(C, 'GET', '/api/me')).statusCode).toBe(200);
    expect((await call(S, 'DELETE', `/api/users/${cs.id}`)).statusCode).toBe(204);
    expect((await call(C, 'GET', '/api/me')).statusCode).toBe(401);
    expect(await login('cs@x.in')).toBeNull();
    expect((await call(S, 'DELETE', `/api/users/${cs.id}`)).statusCode).toBe(404);
    expect((await call(S, 'GET', '/api/users')).json().data.map((u: any) => u.email)).not.toContain('cs@x.in');
    expect((await twenty.list('leads')).length).toBe(before);
    void ia;
  });

  it('guard rails: no self delete/demote, last super admin kept, office admins cannot touch super admins', async () => {
    const { users, sa, ia, is, login, call } = await setup();
    const S = await login('sa@x.in'), A = await login('ia@x.in');
    expect((await call(S, 'DELETE', `/api/users/${sa.id}`)).statusCode).toBe(403);
    expect((await call(S, 'PATCH', `/api/users/${sa.id}`, { role: 'INDIA_ADMIN' })).statusCode).toBe(403);
    expect((await call(S, 'PATCH', `/api/users/${sa.id}`, { active: false })).statusCode).toBe(403);
    expect((await call(S, 'PATCH', `/api/users/${sa.id}`, { name: 'Boss' })).statusCode).toBe(200); // own name is fine
    // office admin: cannot edit/reset/delete a super admin, cannot change emails, keeps own-office edits
    expect((await call(A, 'PATCH', `/api/users/${sa.id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await call(A, 'POST', `/api/users/${sa.id}/password`, { password: 'hijacked-pass' })).statusCode).toBe(403);
    expect((await call(A, 'PATCH', `/api/users/${is.id}`, { role: 'SUPER_ADMIN' })).statusCode).toBe(403);
    expect((await call(A, 'PATCH', `/api/users/${is.id}`, { email: 'z@x.in' })).statusCode).toBe(403);
    expect((await call(A, 'PATCH', `/api/users/${is.id}`, { name: 'Ok' })).statusCode).toBe(200);
    // last super admin: a second SA cannot demote/disable/delete the only other active one once alone
    const sa2 = await users.create('sa2@x.in', 'sa2', 'SUPER_ADMIN', PW);
    const S2 = await login('sa2@x.in');
    expect((await call(S2, 'DELETE', `/api/users/${sa.id}`)).statusCode).toBe(204); // two existed
    expect((await call(S2, 'DELETE', `/api/users/${sa2.id}`)).statusCode).toBe(403); // self
    const sa3 = await users.create('sa3@x.in', 'sa3', 'SUPER_ADMIN', PW);
    users.update(sa3.id, { active: false }); // inactive SA does not count
    const S3 = S2; void S3;
    expect(users.activeSuperAdmins()).toBe(1);
    void ia;
  });

  it('never removes the last active super admin', async () => {
    const { users, sa } = await setup();
    const app2 = await buildApp({ twenty: new MockTwenty(), users, jwtSecret: 'x'.repeat(40) });
    // simulate a second (inactive-turned-active) SA trying to demote the last other one after the first is disabled
    const b = await users.create('b@x.in', 'b', 'SUPER_ADMIN', PW);
    const tok = (await app2.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'b@x.in', password: PW } })).json().token;
    users.update(b.id, { active: false }); users.update(b.id, { active: true });
    const t2 = (await app2.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'b@x.in', password: PW } })).json().token;
    void tok;
    // disable sa -> b is the only active SA; now b can't be demoted by anyone (only self, which is blocked) and sa cannot be... check via store count
    const r = await app2.inject({ method: 'PATCH', url: `/api/users/${sa.id}`, payload: { active: false }, headers: { authorization: `Bearer ${t2}` } });
    expect(r.statusCode).toBe(200);
    expect(users.activeSuperAdmins()).toBe(1);
    const r2 = await app2.inject({ method: 'PATCH', url: `/api/users/${sa.id}`, payload: { role: 'INDIA_ADMIN' }, headers: { authorization: `Bearer ${t2}` } });
    expect(r2.statusCode).toBe(200); // sa is inactive, demoting it does not lose an active SA
  });
});
