import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.ts';
import { issueSupportChallenge, newVisitorToken } from '../src/support-chat.ts';
import { issueEmbedToken, parseEmbedOrigins, readEmbedToken } from '../src/support-embed.ts';

const SECRET = 'x'.repeat(40);
const FE = 'https://fortuneengineering.in';
const challenge = () => issueSupportChallenge(SECRET, Date.now() - 5000);
let ipN = 1;
const nextIp = () => `10.77.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

async function startFe(app: any, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}, ip = nextIp()) {
  return app.inject({
    method: 'POST', url: '/api/embed/support/start', remoteAddress: ip,
    headers: { origin: FE, ...headers },
    payload: { challenge: challenge(), name: 'Test FE Guest', email: 'fe-guest@test.example', consent: true, message: 'TEST hello from Fortune Engineering', page: '/en/', ...extra },
  });
}
const feGet = (app: any, url: string, token?: string, origin = FE) =>
  app.inject({ method: 'GET', url, headers: { origin, ...(token ? { 'x-support-token': token } : {}) } });

describe('support chat embed (Fortune Engineering)', () => {
  it('allowlist parsing is exact, https-only and ignores wildcards/unknown sites', () => {
    const m = parseEmbedOrigins('https://fortuneengineering.in=fortune_engineering,http://evil.test=fortune_engineering,*=fortune_engineering,https://x.test=sourceeasy,https://WWW.FortuneEngineering.in=fortune_engineering');
    expect([...m.keys()].sort()).toEqual(['https://fortuneengineering.in', 'https://www.fortuneengineering.in']);
  });

  it('CORS: allowlisted origin only, no wildcard and no credentials', async () => {
    const { app } = await setup();
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/embed/support/start', headers: { origin: FE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-support-token' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(FE);
    expect(String(pre.headers['access-control-allow-headers'])).toMatch(/x-support-token/);
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
    const www = await feGet(app, '/api/embed/support/status', undefined, 'https://www.fortuneengineering.in');
    expect(www.statusCode).toBe(200);
    expect(www.headers['access-control-allow-origin']).toBe('https://www.fortuneengineering.in');
    for (const origin of ['https://evil.example', 'https://fortuneengineering.in.evil.example', 'http://fortuneengineering.in', 'null', 'https://sourceeasy.in']) {
      const bad = await app.inject({ method: 'OPTIONS', url: '/api/embed/support/start', headers: { origin, 'access-control-request-method': 'POST' } });
      expect(bad.statusCode).toBe(403);
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
      const badPost = await startFe(app, {}, { origin });
      expect(badPost.statusCode).toBe(403);
      expect(badPost.headers['access-control-allow-origin']).toBeUndefined();
    }
    const noOrigin = await app.inject({ method: 'GET', url: '/api/embed/support/status' });
    expect(noOrigin.statusCode).toBe(403);
    const st = await feGet(app, '/api/embed/support/status');
    expect(st.json().data.brand).toBe('Fortune Engineering');
    expect(st.json().data.challenge).toBeTruthy();
  });

  it('serves the widget script cross-origin', async () => {
    const { app } = await setup();
    const js = await app.inject({ method: 'GET', url: '/embed/support-chat.js' });
    expect(js.statusCode).toBe(200);
    expect(String(js.headers['content-type'])).toMatch(/javascript/);
    expect(js.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(js.body).toContain('X-Support-Token');
  });

  it('issues a site-scoped header token (no cookie); tokens never cross sites', async () => {
    const { app } = await setup();
    const res = await startFe(app);
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const { token, conversation } = res.json().data;
    expect(token).toMatch(/^v1\.fortune_engineering\./);
    expect(conversation.sourceSite).toBe('fortune_engineering');
    expect(conversation.brand).toBe('Fortune Engineering');
    expect(conversation.messages.some((m: any) => m.content.includes('TEST hello'))).toBe(true);
    // Token works with the header…
    const again = await feGet(app, '/api/embed/support/conversation', token);
    expect(again.statusCode).toBe(200);
    expect(again.json().data.id).toBe(conversation.id);
    // …but not as a Source Easy cookie (raw part or whole token).
    const raw = token.split('.')[2];
    for (const c of [raw, token]) {
      const se = await app.inject({ method: 'GET', url: '/api/support/conversation', headers: { cookie: `se_support_vid=${c}` } });
      expect([401, 404]).toContain(se.statusCode);
    }
    // Tampered / re-labelled / forged tokens are rejected.
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect((await feGet(app, '/api/embed/support/conversation', tampered)).statusCode).toBe(401);
    const relabel = token.replace('v1.fortune_engineering.', 'v1.sourceeasy.');
    expect((await feGet(app, '/api/embed/support/conversation', relabel)).statusCode).toBe(401);
    expect(readEmbedToken(SECRET, 'sourceeasy', issueEmbedToken(SECRET, 'sourceeasy', raw).token)).toBe(raw);
    expect((await feGet(app, '/api/embed/support/conversation', issueEmbedToken(SECRET, 'sourceeasy', raw).token)).statusCode).toBe(401);
    expect((await feGet(app, '/api/embed/support/conversation', issueEmbedToken('y'.repeat(40), 'fortune_engineering', raw).token)).statusCode).toBe(401);

    // A Source Easy cookie visitor cannot be used on the FE embed either.
    const seStart = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: nextIp(),
      payload: { challenge: challenge(), name: 'SE Guest', email: 'se-guest@test.example', consent: true, message: 'TEST SE side' },
    });
    const seCookie = /se_support_vid=([^;]+)/.exec(String(seStart.headers['set-cookie']))![1]!;
    expect(seStart.json().data.sourceSite).toBe('sourceeasy');
    const cross = await feGet(app, '/api/embed/support/conversation', issueEmbedToken(SECRET, 'fortune_engineering', decodeURIComponent(seCookie)).token);
    expect(cross.statusCode).toBe(401);
    void newVisitorToken;
  });

  it('spam protection: honeypot, challenge, links, size caps and per-IP / per-token rate limits', async () => {
    const { app } = await setup();
    const hp = await startFe(app, { website: 'https://spam.test' });
    expect(hp.statusCode).toBe(200);
    expect(hp.json().data.token).toBeUndefined();
    expect((await startFe(app, { challenge: '0.deadbeef' })).json().code).toBe('challenge');
    expect((await startFe(app, { consent: false })).json().code).toBe('consent');
    expect((await startFe(app, { email: '', phone: '' })).json().code).toBe('contact');
    expect((await startFe(app, { message: 'x'.repeat(2001) })).json().code).toBe('size');
    expect((await startFe(app, { message: 'http://a.test http://b.test http://c.test http://d.test' })).json().code).toBe('links');
    const big = await app.inject({ method: 'POST', url: '/api/embed/support/start', headers: { origin: FE, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'x'.repeat(20000) }) });
    expect(big.statusCode).toBe(413);

    const ip = '10.88.0.1';
    for (let i = 0; i < 5; i++) expect((await startFe(app, { name: `TEST Guest ${i}` }, {}, ip)).statusCode).toBe(200);
    expect((await startFe(app, { name: 'TEST Guest 6' }, {}, ip)).statusCode).toBe(429);

    const { token } = (await startFe(app)).json().data;
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/embed/support/messages', remoteAddress: nextIp(), headers: { origin: FE, 'x-support-token': token }, payload: { content: `TEST ${i}` } });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });

  it('lands in the shared Customer support inbox with a site tag; role scoping holds; replies reach the widget', async () => {
    const { app, call } = await setup();
    const fe = (await startFe(app)).json().data;
    const se = (await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: nextIp(),
      payload: { challenge: challenge(), name: 'SE Guest', email: 'se-guest2@test.example', consent: true, message: 'TEST from Source Easy' },
    })).json().data;

    for (const who of ['is', 'ia'] as const) await call(who, 'GET', '/api/chat/inboxes');
    const all = (await call('is', 'GET', '/api/chat/inboxes/inbox-customer-support/conversations')).json().data as any[];
    expect(all.find((c) => c.id === fe.conversation.id)?.sourceSite).toBe('fortune_engineering');
    expect(all.find((c) => c.id === se.id)?.sourceSite).toBe('sourceeasy');
    const onlyFe = (await call('is', 'GET', '/api/chat/inboxes/inbox-customer-support/conversations?site=fortune_engineering')).json().data as any[];
    expect(onlyFe.map((c) => c.id)).toContain(fe.conversation.id);
    expect(onlyFe.map((c) => c.id)).not.toContain(se.id);
    const onlySe = (await call('is', 'GET', '/api/chat/inboxes/inbox-customer-support/conversations?site=sourceeasy')).json().data as any[];
    expect(onlySe.map((c) => c.id)).not.toContain(fe.conversation.id);

    const detail = (await call('ia', 'GET', `/api/chat/conversations/${fe.conversation.id}`)).json().data;
    expect(detail.sourceSite).toBe('fortune_engineering');
    expect(detail.guestEmail).toBe('fe-guest@test.example');

    // China never sees the inbox or the conversation (customer identity).
    for (const who of ['ca', 'cs'] as const) {
      const boxes = (await call(who, 'GET', '/api/chat/inboxes')).json().data ?? [];
      expect(boxes.some((b: any) => b.id === 'inbox-customer-support')).toBe(false);
      expect([403, 404]).toContain((await call(who, 'GET', '/api/chat/inboxes/inbox-customer-support/conversations')).statusCode);
      expect([403, 404]).toContain((await call(who, 'GET', `/api/chat/conversations/${fe.conversation.id}`)).statusCode);
      const hits = await call(who, 'GET', '/api/chat/search?q=fe-guest');
      expect(JSON.stringify(hits.json())).not.toContain('Test FE Guest');
    }
    // Marketplace Team works the shared desk too.
    await call('sa', 'POST', '/api/users', { email: 'mt-embed@x.in', name: 'Market Team', role: 'MARKETPLACE_TEAM', password: PW });
    const mtTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt-embed@x.in', password: PW } })).json().token;
    const mt = await app.inject({ method: 'GET', url: `/api/chat/conversations/${fe.conversation.id}`, headers: { authorization: `Bearer ${mtTok}` } });
    expect(mt.statusCode).toBe(200);

    // Staff reply + internal note: guest sees the reply (first name, FE brand), never the note.
    expect((await call('is', 'POST', `/api/chat/conversations/${fe.conversation.id}/messages`, { content: 'TEST reply from India desk' })).statusCode).toBe(200);
    await call('is', 'POST', `/api/chat/conversations/${fe.conversation.id}/messages`, { content: 'TEST internal factory cost note', internal: true });
    const guest = (await feGet(app, '/api/embed/support/conversation', fe.token)).json().data;
    const reply = guest.messages.find((m: any) => m.content === 'TEST reply from India desk');
    expect(reply.senderName).toBe('Staff');
    expect(JSON.stringify(guest)).not.toContain('factory cost');
    expect(JSON.stringify(guest)).not.toMatch(/assignedTo|guestEmail|linkedLeadId/);

    // Convert-to-lead keeps the site in the lead notes; India-owned.
    const conv = await call('ia', 'POST', `/api/chat/conversations/${fe.conversation.id}/convert-lead`);
    expect(conv.statusCode).toBe(200);
    const a = await call('ia', 'GET', `/api/records/leads/${conv.json().data.leadId}`);
    const b = await call('ia', 'GET', `/api/leads/${conv.json().data.leadId}`);
    const lead = a.statusCode === 200 ? a : b;
    expect(lead.statusCode).toBe(200);
    const rec = (lead.json().data ?? lead.json());
    expect(JSON.stringify(rec)).toContain('Via Fortune Engineering website chat');
    expect(JSON.stringify(rec)).toContain('SUPPORT_CHAT');
    expect(rec.assignedOffice ?? rec.office).not.toBe('CHINA');
    const after = (await feGet(app, '/api/embed/support/conversation', fe.token)).json().data;
    expect(after.convertedLeadRef).toBe(conv.json().data.leadRef);
    expect(after.messages.find((m: any) => m.authorKind === 'system' && m.content.includes(conv.json().data.leadRef))?.senderName).toBe('Fortune Engineering');
  });

  it('realtime stream works cross-origin with the header token', async () => {
    const { app, call } = await setup();
    const fe = (await startFe(app)).json().data;
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    const unauth = await fetch(`${addr}/api/embed/support/stream`, { headers: { origin: FE } });
    expect(unauth.status).toBe(401);
    const evil = await fetch(`${addr}/api/embed/support/stream`, { headers: { origin: 'https://evil.example', 'x-support-token': fe.token } });
    expect(evil.status).toBe(403);
    const ac = new AbortController(); let text = '';
    const res = await fetch(`${addr}/api/embed/support/stream`, { headers: { origin: FE, 'x-support-token': fe.token }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(FE);
    const rd = res.body!.getReader(), dec = new TextDecoder();
    const pump = (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; text += dec.decode(value); } } catch { /* aborted */ } })();
    await new Promise((r) => setTimeout(r, 150));
    await call('is', 'POST', `/api/chat/conversations/${fe.conversation.id}/messages`, { content: 'TEST live reply' });
    await call('is', 'POST', `/api/chat/conversations/${fe.conversation.id}/messages`, { content: 'TEST hidden', internal: true });
    await new Promise((r) => setTimeout(r, 400)); ac.abort(); await pump;
    const events = text.split('\n\n').filter((x) => x.startsWith('data:'));
    expect(events.length).toBe(1);
    expect(events[0]).toContain(fe.conversation.id);
    expect(text).not.toContain('TEST');
  });
});
