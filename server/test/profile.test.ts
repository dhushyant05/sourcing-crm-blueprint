import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from './fixtures.js';

const PW = 'correct-horse-battery';
let app: Awaited<ReturnType<typeof buildApp>>;
const login = async (email: string, password = PW) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
const form = (buf: Buffer, type = 'image/png', name = 'a.png') => {
  const b = '----x' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
};
const H = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  const users = new UserStore();
  await users.create('admin@x.in', 'Admin', 'SUPER_ADMIN', PW);
  await users.create('staff@x.in', 'Staff', 'INDIA_STAFF', PW);
  app = await buildApp({ twenty: new MockTwenty(), users, jwtSecret: 'x'.repeat(40) } as never);
});

describe('profile', () => {
  it('uploads, resizes, serves and removes an avatar', async () => {
    const t = (await login('staff@x.in')).json().token;
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#f80' } }).png().toBuffer();
    const f = form(png);
    const r = await app.inject({ method: 'POST', url: '/api/me/avatar', payload: f.payload, headers: { ...f.headers, ...H(t) } });
    expect(r.statusCode).toBe(200);
    const url = r.json().avatarUrl as string; expect(url).toMatch(/^\/api\/avatars\//);
    const img = await app.inject({ method: 'GET', url });
    expect(img.headers['content-type']).toBe('image/webp');
    const m = await sharp(img.rawPayload).metadata(); expect([m.width, m.height]).toEqual([256, 256]);
    expect((await app.inject({ method: 'GET', url: '/api/people', headers: H(t) })).json().data.find((p: any) => p.name === 'Staff').avatarUrl).toBe(url);
    const bad = form(Buffer.from('not an image'), 'image/png');
    expect((await app.inject({ method: 'POST', url: '/api/me/avatar', payload: bad.payload, headers: { ...bad.headers, ...H(t) } })).statusCode).toBe(400);
    const txt = form(Buffer.from('hello'), 'text/plain', 'a.txt');
    expect((await app.inject({ method: 'POST', url: '/api/me/avatar', payload: txt.payload, headers: { ...txt.headers, ...H(t) } })).statusCode).toBe(400);
    const big = form(Buffer.alloc(5 * 1024 * 1024 + 10), 'image/png');
    expect((await app.inject({ method: 'POST', url: '/api/me/avatar', payload: big.payload, headers: { ...big.headers, ...H(t) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/me/avatar', headers: H(t) })).json().avatarUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
  it('only the super admin sets staff avatars', async () => {
    const ta = (await login('admin@x.in')).json().token, ts = (await login('staff@x.in')).json().token;
    const staffId = (await app.inject({ method: 'GET', url: '/api/me', headers: H(ts) })).json().id;
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#08f' } }).png().toBuffer();
    let f = form(png);
    expect((await app.inject({ method: 'POST', url: `/api/users/${staffId}/avatar`, payload: f.payload, headers: { ...f.headers, ...H(ts) } })).statusCode).toBe(403);
    f = form(png);
    expect((await app.inject({ method: 'POST', url: `/api/users/${staffId}/avatar`, payload: f.payload, headers: { ...f.headers, ...H(ta) } })).json().data.avatarUrl).toBeTruthy();
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${staffId}/avatar`, headers: H(ta) })).json().data.avatarUrl).toBeNull();
  });
  it('changes password: checks current, min 10, keeps this session, revokes others', async () => {
    const a = (await login('staff@x.in')).json().token, b = (await login('staff@x.in')).json().token;
    const post = (pl: object) => app.inject({ method: 'POST', url: '/api/me/password', payload: pl, headers: H(a) });
    expect((await post({ currentPassword: 'wrong-password', newPassword: 'brand-new-pass-1' })).statusCode).toBe(400);
    expect((await post({ currentPassword: PW, newPassword: 'short' })).statusCode).toBe(400);
    const ok = await post({ currentPassword: PW, newPassword: 'brand-new-pass-1' });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: H(ok.json().token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: H(b) })).statusCode).toBe(401);
    expect((await login('staff@x.in', 'brand-new-pass-1')).statusCode).toBe(200);
  });
});
