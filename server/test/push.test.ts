import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { PushStore } from '../src/push.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-battery';
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe('push devices', () => {
  let app: Awaited<ReturnType<typeof buildApp>>, env: Awaited<ReturnType<typeof testEnv>>;
  const calls: { url: string; body: string }[] = [];
  beforeAll(async () => {
    env = await testEnv();
    await env.users.create('a@x.in', 'A', 'INDIA_STAFF', PW);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const http = (async (url: string, init: any) => {
      calls.push({ url, body: String(init.body) });
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }));
      return new Response(init.body.includes('dead') ? '{}' : '{}', { status: init.body.includes('dead') ? 404 : 200 });
    }) as typeof fetch;
    const push = new PushStore(env.db, undefined, http, { client_email: 'x@y', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), project_id: 'p1' });
    app = await buildApp({ ...env, push, jwtSecret: 'x'.repeat(40) });
  });

  it('registers a token and sends FCM v1 with the bell channel; drops dead tokens', async () => {
    const t = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@x.in', password: PW } })).json().token;
    expect((await app.inject({ method: 'POST', url: '/api/devices', headers: H(t), payload: {} })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/devices', headers: H(t), payload: { token: 'tok-1' } });
    expect(r.json()).toEqual({ ok: true, push: true });
    await app.inject({ method: 'POST', url: '/api/devices', headers: H(t), payload: { token: 'dead-2' } });
    const uid = env.users.list().find((u) => u.email === 'a@x.in')!.id;
    const push = (app as any).push as PushStore | undefined;
    const store = push ?? new PushStore(env.db);
    expect((await store.tokens(uid)).sort()).toEqual(['dead-2', 'tok-1']);
    calls.length = 0;
    const p = new PushStore(env.db, undefined, (async (u: string, i: any) => { calls.push({ url: u, body: String(i.body) }); return u.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 })) : new Response('{}', { status: String(i.body).includes('dead') ? 404 : 200 }); }) as typeof fetch,
      { client_email: 'x@y', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), project_id: 'p1' });
    expect(await p.send([uid], { title: 'Order updated', body: 'x' })).toBe(1);
    const msg = calls.find((c) => c.url.includes('fcm.googleapis.com/v1/projects/p1/messages:send') && c.body.includes('tok-1'))!;
    expect(JSON.parse(msg.body).message.android.notification.channel_id).toBe('alerts_bell');
    expect(await store.tokens(uid)).toEqual(['tok-1']);
    expect((await app.inject({ method: 'DELETE', url: '/api/devices', headers: H(t), payload: { token: 'tok-1' } })).statusCode).toBe(200);
    expect(await store.tokens(uid)).toEqual([]);
  });

  it('is a no-op without a service account', async () => {
    const p = new PushStore(env.db, undefined);
    expect(p.enabled).toBe(false);
    expect(await p.send(['u'], { title: 't', body: 'b' })).toBe(0);
  });
});
