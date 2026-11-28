import { describe, expect, it } from 'vitest';
import { setup } from './portal-helpers.ts';
import { MemoryBus } from '../src/bus.ts';
import { Presence } from '../src/presence.ts';

const FE = 'https://fortuneengineering.in';
const online = async (app: any) => (await app.inject({ method: 'GET', url: '/api/support/presence' })).json().online as boolean;

describe('support desk presence', () => {
  it('is offline with nobody connected, online after an eligible staff heartbeat, offline again when away', async () => {
    const { app, call } = await setup();
    const pub = await app.inject({ method: 'GET', url: '/api/support/presence' });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toEqual({ online: false });
    expect(pub.headers['cache-control']).toMatch(/max-age=10/);
    expect((await app.inject({ method: 'GET', url: '/api/support/status' })).json().data.online).toBe(false);

    expect((await call('is', 'POST', '/api/chat/presence/heartbeat', {})).json().data.state).toBe('available');
    expect(await online(app)).toBe(true);
    const st = (await app.inject({ method: 'GET', url: '/api/support/status' })).json().data;
    expect(st.online).toBe(true);
    expect(st.label).toBe('Online – we usually reply in a few minutes');
    expect((await app.inject({ method: 'GET', url: '/api/portal/support/status' })).statusCode).toBe(401); // portal route still needs a customer

    const away = await call('is', 'PUT', '/api/chat/presence', { status: 'away' });
    expect(away.json().data).toMatchObject({ state: 'away', away: 'manual' });
    expect(await online(app)).toBe(false);
    // A heartbeat (even an "active" one) does not undo a manual Away.
    await call('is', 'POST', '/api/chat/presence/heartbeat', { active: true });
    expect(await online(app)).toBe(false);
    await call('is', 'PUT', '/api/chat/presence', { status: 'available' });
    expect(await online(app)).toBe(true);
    expect((await call('is', 'PUT', '/api/chat/presence', { status: 'busy' })).statusCode).toBe(400);
  });

  it('China staff never make the desk online; idle heartbeat means auto-away', async () => {
    const { app, call } = await setup();
    await call('cs', 'POST', '/api/chat/presence/heartbeat', {});
    await call('ca', 'PUT', '/api/chat/presence', { status: 'available' });
    expect((await call('cs', 'GET', '/api/chat/presence')).json().data.counts).toBe(false);
    expect(await online(app)).toBe(false);

    await call('ia', 'POST', '/api/chat/presence/heartbeat', {});
    expect(await online(app)).toBe(true);
    const idle = await call('ia', 'POST', '/api/chat/presence/heartbeat', { active: false });
    expect(idle.json().data).toMatchObject({ state: 'away', away: 'auto' });
    expect(await online(app)).toBe(false);
    await call('ia', 'POST', '/api/chat/presence/heartbeat', { active: true });
    expect(await online(app)).toBe(true);
  });

  it('serves only a boolean on the embed route, with CORS only for the allowlisted origin', async () => {
    const { app, call } = await setup();
    await call('sa', 'POST', '/api/chat/presence/heartbeat', {});
    const ok = await app.inject({ method: 'GET', url: '/api/embed/support/presence', headers: { origin: FE } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ online: true });
    expect(ok.headers['access-control-allow-origin']).toBe(FE);
    expect(ok.headers['cache-control']).toMatch(/max-age=10/);
    const bad = await app.inject({ method: 'GET', url: '/api/embed/support/presence', headers: { origin: 'https://evil.example' } });
    expect(bad.statusCode).toBe(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    // The embed status route reports the same live value (older embed script versions read `online` from it).
    const st = await app.inject({ method: 'GET', url: '/api/embed/support/status', headers: { origin: FE } });
    expect(st.json().data.online).toBe(true);
  });

  it('expires on its own when the connection stops (Redis TTL)', async () => {
    const bus = new MemoryBus();
    const p = new Presence(bus, async () => ['u1']);
    await p.touch('u1');
    expect(await p.anyOnline()).toBe(true);
    await bus.del('se:presence:seen:u1');
    (p as any).cache = null;
    expect(await p.anyOnline()).toBe(false);
  });
});
