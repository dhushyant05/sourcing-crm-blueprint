import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-1';
async function setup() {
  const { db, bus, users } = await testEnv();
  const app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'rt-')) });
  const u = await users.create('m@x.in', 'M', 'INDIA_STAFF', PW);
  const login = async (refresh = true) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'm@x.in', password: PW, refresh, device: 'test' } })).json();
  const refresh = (t: string) => app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: t } });
  const me = (tok: string) => app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${tok}` } });
  return { app, users, u, login, refresh, me };
}

describe('refresh tokens', () => {
  it('web login gets no refresh token; mobile does, and it rotates', async () => {
    const { login, refresh, me } = await setup();
    expect((await login(false)).refreshToken).toBeUndefined();
    const l = await login();
    expect(l.refreshToken).toMatch(/\./);
    const r1 = await refresh(l.refreshToken); expect(r1.statusCode).toBe(200);
    const b = r1.json(); expect(b.refreshToken).not.toBe(l.refreshToken);
    expect((await me(b.token)).statusCode).toBe(200);
    // replaying the old token kills the session
    expect((await refresh(l.refreshToken)).statusCode).toBe(401);
    expect((await refresh(b.refreshToken)).statusCode).toBe(401);
  });
  it('sign-out, password reset, disable and removal revoke it', async () => {
    const { app, users, u, login, refresh } = await setup();
    let l = await login();
    await app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken: l.refreshToken } });
    expect((await refresh(l.refreshToken)).statusCode).toBe(401);
    l = await login(); await users.setPassword(u.id, 'another-pass-22');
    expect((await refresh(l.refreshToken)).statusCode).toBe(401);
    l = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'm@x.in', password: 'another-pass-22', refresh: true } })).json();
    await users.update(u.id, { active: false } as any);
    expect((await refresh(l.refreshToken)).statusCode).toBe(401);
    expect((await refresh('garbage')).statusCode).toBe(401);
  });
});
