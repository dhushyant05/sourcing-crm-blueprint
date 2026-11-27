import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.ts';
import { issueSupportChallenge } from '../src/support-chat.ts';

const SECRET = 'x'.repeat(40);
const challenge = () => issueSupportChallenge(SECRET, Date.now() - 5000);

function cookie(res: { headers: Record<string, any> }) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const c of list) {
    const m = /se_support_vid=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}
function cookieHeader(res: { headers: Record<string, any> }) {
  const v = cookie(res);
  return v ? { cookie: `se_support_vid=${v}` } : {};
}

describe('customer support chat', () => {
  it('guest pre-chat requires name, contact, consent and a valid challenge', async () => {
    const { app } = await setup();
    const st = await app.inject({ method: 'GET', url: '/api/support/status' });
    expect(st.statusCode).toBe(200);
    expect(st.json().data.usualReply).toMatch(/hours|business day/);
    expect(st.json().data.challenge).toBeTruthy();

    const missing = await app.inject({ method: 'POST', url: '/api/support/start', payload: { challenge: challenge() } });
    expect(missing.statusCode).toBe(400);

    const noConsent = await app.inject({
      method: 'POST', url: '/api/support/start',
      payload: { challenge: challenge(), name: 'Ravi Guest', email: 'ravi@test.example', consent: false },
    });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().code).toBe('consent');

    const noContact = await app.inject({
      method: 'POST', url: '/api/support/start',
      payload: { challenge: challenge(), name: 'Ravi Guest', consent: true },
    });
    expect(noContact.statusCode).toBe(400);
    expect(noContact.json().code).toBe('contact');

    const badCh = await app.inject({
      method: 'POST', url: '/api/support/start',
      payload: { challenge: '0.deadbeef', name: 'Ravi Guest', email: 'ravi@test.example', consent: true },
    });
    expect(badCh.statusCode).toBe(400);
    expect(badCh.json().code).toBe('challenge');
  });

  it('honeypot is swallowed and does not set a visitor cookie', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: '10.20.1.1',
      payload: { challenge: challenge(), name: 'Bot', email: 'bot@test.example', consent: true, website: 'https://spam.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(cookie(res)).toBeNull();
  });

  it('ties a guest conversation to an httpOnly cookie and rejects a spoofed visitor', async () => {
    const { app, call } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: '10.20.2.2',
      payload: { challenge: challenge(), name: 'Meera Guest', email: 'meera@test.example', phone: '9876500001', consent: true, message: 'Need a quote on bottles', source: 'homepage' },
    });
    expect(started.statusCode).toBe(200);
    const set = String((Array.isArray(started.headers['set-cookie']) ? started.headers['set-cookie'][0] : started.headers['set-cookie']) ?? '');
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(started.json().data.id).toBeTruthy();
    expect(started.json().data.messages.some((m: any) => m.content.includes('Need a quote'))).toBe(true);
    // Body must never accept a spoofed visitor or conversation id as authority.
    const other = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: '10.20.2.3',
      payload: { challenge: challenge(), name: 'Other Guest', email: 'other@test.example', consent: true, visitorId: started.json().data.id, conversationId: started.json().data.id },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().data.id).not.toBe(started.json().data.id);
    expect(cookie(other)).not.toBe(cookie(started));

    const stolen = await app.inject({
      method: 'GET', url: '/api/support/conversation',
      headers: cookieHeader(other),
    });
    expect(stolen.json().data.id).not.toBe(started.json().data.id);

    const mine = await app.inject({ method: 'GET', url: '/api/support/conversation', headers: cookieHeader(started) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.id).toBe(started.json().data.id);

    const long = 'x'.repeat(4001);
    const tooLong = await app.inject({
      method: 'POST', url: '/api/support/messages', headers: cookieHeader(started),
      payload: { content: long },
    });
    expect(tooLong.statusCode).toBe(400);

    // India staff see the guest in Customer support; China must not.
    const boxes = (await call('ia', 'GET', '/api/chat/inboxes')).json().data as { id: string; name: string; slug: string }[];
    const support = boxes.find((b) => b.id === 'inbox-customer-support' || b.slug === 'customer-support');
    expect(support).toBeTruthy();
    const threads = (await call('ia', 'GET', `/api/chat/inboxes/${support!.id}/conversations`)).json().data as any[];
    expect(threads.some((t) => t.id === started.json().data.id)).toBe(true);
    expect(JSON.stringify(threads)).toContain('Meera Guest');

    const chinaBoxes = (await call('cs', 'GET', '/api/chat/inboxes')).json().data as { id: string; slug: string }[];
    expect(chinaBoxes.some((b) => b.id === 'inbox-customer-support' || b.slug === 'customer-support')).toBe(false);
    const chinaDirect = await call('cs', 'GET', `/api/chat/inboxes/inbox-customer-support/conversations`);
    expect(chinaDirect.statusCode).toBe(404);
    const chinaGet = await call('cs', 'GET', `/api/chat/conversations/${started.json().data.id}`);
    expect(chinaGet.statusCode).toBe(404);
    const chinaPost = await call('cs', 'POST', `/api/chat/conversations/${started.json().data.id}/messages`, { content: 'leaked' });
    expect(chinaPost.statusCode).toBe(404);

    const addChina = await call('sa', 'POST', '/api/chat/team-inboxes/inbox-customer-support/members', { userIds: [(await call('sa', 'GET', '/api/users')).json().data.find((u: any) => u.role === 'CHINA_STAFF').id] });
    expect(addChina.statusCode).toBe(403);
  });

  it('staff replies appear to the guest, internal notes do not, and a guest chat can become a lead', async () => {
    const { app, call } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: '10.20.3.3',
      payload: { challenge: challenge(), name: 'Arjun Buyer', email: 'arjun@test.example', phone: '9876500002', consent: true, message: 'Hello team' },
    });
    const cid = started.json().data.id as string;

    const reply = await call('ia', 'POST', `/api/chat/conversations/${cid}/messages`, { content: 'Thanks, we can help.' });
    expect(reply.statusCode).toBe(200);

    const note = await call('ia', 'POST', `/api/chat/conversations/${cid}/messages`, { content: 'Internal: factory cost is 1.2 USD', internal: true });
    expect(note.statusCode).toBe(200);

    const guest = await app.inject({ method: 'GET', url: '/api/support/conversation', headers: cookieHeader(started) });
    const texts = guest.json().data.messages.map((m: any) => m.content).join('\n');
    expect(texts).toContain('Thanks, we can help.');
    expect(texts).not.toContain('factory cost');
    expect(texts).not.toContain('1.2 USD');
    expect(JSON.stringify(guest.json().data)).not.toMatch(/Ningbo|WeChat|wx_/i);

    const conv = (await call('ia', 'GET', `/api/chat/conversations/${cid}`)).json().data;
    expect(conv.canConvert).toBe(true);
    expect(conv.guestEmail).toBe('arjun@test.example');
    expect(conv.messages.some((m: any) => m.visibility === 'staff_only' && m.content.includes('factory cost'))).toBe(true);

    const converted = await call('ia', 'POST', `/api/chat/conversations/${cid}/convert-lead`);
    expect(converted.statusCode).toBe(200);
    expect(converted.json().data.leadRef).toMatch(/^SE-/);
    const lead = (await call('ia', 'GET', `/api/records/leads/${converted.json().data.leadId}`));
    // records path may vary — fall back to lead endpoint
    const lead2 = await call('ia', 'GET', `/api/leads/${converted.json().data.leadId}`);
    expect([lead.statusCode, lead2.statusCode].some((s) => s === 200)).toBe(true);
    const body = (lead.statusCode === 200 ? lead : lead2).json();
    const rec = body.data ?? body;
    expect(JSON.stringify(rec)).toContain('Arjun');
    expect(rec.assignedOffice ?? rec.office).not.toBe('CHINA');

    const after = await app.inject({ method: 'GET', url: '/api/support/conversation', headers: cookieHeader(started) });
    expect(JSON.stringify(after.json().data.messages)).toContain(converted.json().data.leadRef);
    expect(JSON.stringify(after.json().data.messages)).not.toContain('factory cost');
  });

  it('logged-in customers have history and cannot see another customer\'s chat or staff lead threads', async () => {
    const { app, call, customer } = await setup();
    const a = await customer('Anita One', '9000000101', 'One Co');
    const b = await customer('Bala Two', '9000000102', 'Two Co');

    const startA = await app.inject({
      method: 'POST', url: '/api/portal/support/start',
      headers: { authorization: `Bearer ${a.token}` },
      payload: { message: 'Need help with my request', source: 'portal' },
    });
    expect(startA.statusCode).toBe(200);
    const idA = startA.json().data.id as string;

    const startB = await app.inject({
      method: 'POST', url: '/api/portal/support/start',
      headers: { authorization: `Bearer ${b.token}` },
      payload: { message: 'Private to Bala', source: 'portal' },
    });
    expect(startB.statusCode).toBe(200);

    const steal = await app.inject({
      method: 'GET', url: `/api/portal/support/conversations/${startB.json().data.id}`,
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(steal.statusCode).toBe(404);

    const hist = await app.inject({
      method: 'GET', url: '/api/portal/support/conversations',
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(hist.statusCode).toBe(200);
    const ids = hist.json().data.map((c: any) => c.id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(startB.json().data.id);

    // Customer cannot open a staff lead conversation by id.
    const leads = (await call('ia', 'GET', '/api/records/leads')).json().data as any[];
    const lead = leads[0];
    if (lead) {
      await call('ia', 'POST', `/api/leads/${lead.id}/chat`);
      const staffConv = await call('ia', 'GET', `/api/leads/${lead.id}/chat`);
      const convId = staffConv.json().data.conversationId;
      if (convId) {
        const sneak = await app.inject({
          method: 'GET', url: `/api/portal/support/conversations/${convId}`,
          headers: { authorization: `Bearer ${a.token}` },
        });
        expect(sneak.statusCode).toBe(404);
        const sneak2 = await app.inject({
          method: 'GET', url: '/api/support/conversation',
          headers: { authorization: `Bearer ${a.token}`, cookie: 'se_support_vid=totally-forged' },
        });
        expect([404, 401]).toContain(sneak2.statusCode);
      }
    }

    // Marketplace team can see the support inbox; still not China.
    const mt = (await call('sa', 'POST', '/api/users', { email: 'mt-support@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW })).json();
    const mtId = mt.data?.id ?? mt.id;
    const mtTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt-support@x.in', password: PW } })).json().token;
    const mtBoxes = (await app.inject({ method: 'GET', url: '/api/chat/inboxes', headers: { authorization: `Bearer ${mtTok}` } })).json().data as { id: string }[];
    expect(mtBoxes.some((b) => b.id === 'inbox-customer-support')).toBe(true);
    const mtGet = await app.inject({ method: 'GET', url: `/api/chat/conversations/${idA}`, headers: { authorization: `Bearer ${mtTok}` } });
    expect(mtGet.statusCode).toBe(200);
    expect(mtGet.json().data.messages.some((m: any) => m.content.includes('Need help'))).toBe(true);
    void mtId;
  });

  it('rate-limits new guest conversations per IP and does not create a lead chat for China to browse', async () => {
    const { app, call } = await setup();
    const ip = '10.20.9.9';
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/support/start', remoteAddress: ip,
        payload: { challenge: challenge(), name: `Guest ${i}`, email: `g${i}@test.example`, consent: true, message: 'hi' },
      });
      expect(r.statusCode).toBe(200);
    }
    const sixth = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: ip,
      payload: { challenge: challenge(), name: 'Guest 5', email: 'g5@test.example', consent: true, message: 'hi' },
    });
    expect(sixth.statusCode).toBe(429);

    const chinaBoxes = (await call('ca', 'GET', '/api/chat/inboxes')).json().data as { id: string }[];
    expect(chinaBoxes.some((b) => b.id === 'inbox-customer-support')).toBe(false);
  });
  it('plain India staff can work the Customer support desk; China staff cannot see it', async () => {
    const { app, call } = await setup();
    const started = await app.inject({
      method: 'POST', url: '/api/support/start', remoteAddress: '10.20.9.9',
      payload: { challenge: challenge(), name: 'Desk Guest', email: 'desk@test.example', consent: true, message: 'Hi desk' },
    });
    const cid = started.json().data.id as string;
    const inboxes = (await call('is', 'GET', '/api/chat/inboxes')).json().data;
    expect(inboxes.some((i: any) => i.id === 'inbox-customer-support')).toBe(true);
    const list = await call('is', 'GET', '/api/chat/inboxes/inbox-customer-support/conversations');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((c: any) => c.id === cid)).toBe(true);
    const reply = await call('is', 'POST', `/api/chat/conversations/${cid}/messages`, { content: 'India staff here.' });
    expect(reply.statusCode).toBe(200);
    for (const who of ['cs', 'ca'] as const) {
      const ci = (await call(who, 'GET', '/api/chat/inboxes')).json().data ?? [];
      expect(ci.some((i: any) => i.id === 'inbox-customer-support')).toBe(false);
      expect([403, 404]).toContain((await call(who, 'GET', '/api/chat/inboxes/inbox-customer-support/conversations')).statusCode);
      expect([403, 404]).toContain((await call(who, 'GET', `/api/chat/conversations/${cid}`)).statusCode);
    }
    const guest = await app.inject({ method: 'GET', url: '/api/support/conversation', headers: cookieHeader(started) });
    expect(JSON.stringify(guest.json().data.messages)).toContain('India staff here.');
  });
});
