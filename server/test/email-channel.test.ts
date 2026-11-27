import { describe, expect, it } from 'vitest';
import { setup, PNG } from './portal-helpers.ts';
import { emailConfigFromEnv, parseInbound, stripQuoted, type OutboundMail, type MailSender } from '../src/email-channel.ts';

const SECRET = 's'.repeat(32);
const cfg = () => emailConfigFromEnv({
  EMAIL_CHANNEL_ENABLED: 'true', EMAIL_PROVIDER: 'generic', EMAIL_API_URL: 'https://mail.test/send', EMAIL_API_TOKEN: 'tok',
  EMAIL_INBOUND_SECRET: SECRET, EMAIL_CUSTOMER_ADDRESS: 'support@sourceeasy.test', EMAIL_SUPPLIER_ADDRESS: 'suppliers@sourceeasy.test',
  EMAIL_NOTIFY_FROM: 'notify@sourceeasy.test',
} as any);
function mockSender() {
  const sent: OutboundMail[] = [];
  const s: MailSender & { sent: OutboundMail[] } = { enabled: true, sent, async send(m) { sent.push(m); } };
  return s;
}
let n = 0;
const mail = (o: Record<string, unknown>) => ({
  from: { email: 'buyer@cust.test', name: 'Priya Buyer' }, to: 'support@sourceeasy.test', subject: 'Need 500 bottles',
  text: 'Hello, please quote 500 bottles.', messageId: `<m${++n}.${Date.now()}@cust.test>`, ...o,
});
async function env() {
  const sender = mockSender();
  const s = await setup({ emailConfig: cfg(), emailSender: sender, emailTickMs: 0 });
  const inbound = (body: unknown, secret = SECRET) => s.app.inject({ method: 'POST', url: '/api/email/inbound', payload: body as any, headers: { authorization: `Bearer ${secret}` } });
  // Desk membership is created on first inbox listing.
  for (const who of ['sa', 'ia', 'is', 'ca', 'cs']) await s.call(who, 'GET', '/api/chat/inboxes');
  return { ...s, sender, inbound };
}
const inboxIds = async (call: any, who: string) => ((await call(who, 'GET', '/api/chat/inboxes')).json().data ?? []).map((i: any) => i.id);

describe('email channel', () => {
  it('is disabled by default and hides the inbound route; status is super-admin only and has no secrets', async () => {
    const { app, call } = await setup({ emailTickMs: 0, emailConfig: emailConfigFromEnv({} as any) });
    const r = await app.inject({ method: 'POST', url: '/api/email/inbound', payload: mail({}) });
    expect(r.statusCode).toBe(404);
    const st = await call('sa', 'GET', '/api/email/status');
    expect(st.statusCode).toBe(200);
    expect(st.json().data.enabled).toBe(false);
    expect(st.json().data.missing).toContain('EMAIL_CHANNEL_ENABLED=true');
    expect((await call('ia', 'GET', '/api/email/status')).statusCode).toBe(403);
    const ok = await env();
    const st2 = JSON.stringify((await ok.call('sa', 'GET', '/api/email/status')).json());
    expect(st2).not.toContain(SECRET);
    expect(st2).not.toContain('"tok"');
  });

  it('rejects a bad secret and unusable payloads', async () => {
    const { inbound } = await env();
    expect((await inbound(mail({}), 'wrong-secret-wrong-secret-wrong')).statusCode).toBe(401);
    expect((await inbound({ nothing: true })).statusCode).toBe(422);
  });

  it('customer email lands in Customer support for India/super admin only, threads replies and sends staff replies by email', async () => {
    const { call, inbound, sender } = await env();
    const first = mail({ attachments: [
      { filename: 'spec.png', contentType: 'image/png', contentBase64: PNG.toString('base64') },
      { filename: 'run.exe', contentType: 'application/octet-stream', contentBase64: Buffer.from('MZ\x90\x00not allowed').toString('base64') },
    ] });
    const r = await inbound(first);
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('accepted');
    expect((await inbound(first)).json().status).toBe('duplicate');

    for (const who of ['is', 'ia', 'sa']) expect(await inboxIds(call, who)).toContain('inbox-customer-support');
    const list = (await call('is', 'GET', '/api/chat/inboxes/inbox-customer-support/conversations')).json().data;
    const conv = list.find((c: any) => c.channel === 'EMAIL');
    expect(conv).toBeTruthy();
    for (const who of ['cs', 'ca']) {
      expect(await inboxIds(call, who)).not.toContain('inbox-customer-support');
      expect([403, 404]).toContain((await call(who, 'GET', `/api/chat/conversations/${conv.id}`)).statusCode);
    }
    const full = (await call('ia', 'GET', `/api/chat/conversations/${conv.id}`)).json().data;
    expect(full.channel).toBe('EMAIL');
    expect(full.emailAddress).toBe('buyer@cust.test');
    const inMsg = full.messages.find((m: any) => m.authorKind === 'customer');
    expect(inMsg.content).toContain('500 bottles');
    expect(inMsg.attachments.length).toBe(1);
    expect(full.messages.some((m: any) => m.visibility === 'staff_only' && /not imported/.test(m.content))).toBe(true);

    const rep = await call('ia', 'POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'Thanks Priya, quote coming today.' });
    expect(rep.statusCode).toBe(200);
    expect(rep.json().data.emailStatus).toBe('SENT');
    const out = sender.sent.at(-1)!;
    expect(out.to).toBe('buyer@cust.test');
    expect(out.from).toBe('support@sourceeasy.test');
    expect(out.subject).toBe('Re: Need 500 bottles');
    expect(out.inReplyTo).toBe(first.messageId);
    expect(out.messageId).toMatch(/^<se\..+@sourceeasy\.test>$/);
    const before = sender.sent.length;
    await call('ia', 'POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'Internal: margin 12%', internal: true });
    expect(sender.sent.length).toBe(before);

    // Customer replies to our message: same thread.
    const reply = await inbound(mail({ subject: 'Re: Need 500 bottles', text: 'Great, thanks!\n\nOn Mon, Team wrote:\n> quote coming', inReplyTo: out.messageId, references: [first.messageId, out.messageId] }));
    expect(reply.json().conversationId ?? conv.id).toBeTruthy();
    const after = (await call('ia', 'GET', `/api/chat/conversations/${conv.id}`)).json().data;
    const last = after.messages.filter((m: any) => m.authorKind === 'customer').at(-1);
    expect(last.content).toBe('Great, thanks!');

    // Someone else forging the header cannot join that thread.
    await inbound(mail({ from: { email: 'attacker@evil.test' }, subject: 'Re: Need 500 bottles', inReplyTo: out.messageId }));
    const again = (await call('ia', 'GET', `/api/chat/conversations/${conv.id}`)).json().data;
    expect(JSON.stringify(again.messages)).not.toContain('attacker');
  });

  it('supplier email lands in Supplier email for China/super admin only; India and Marketplace never see it', async () => {
    const { call, inbound, sender } = await env();
    const mp = await call('sa', 'POST', '/api/users', { email: 'mp@x.in', name: 'Market Place', role: 'MARKETPLACE_TEAM', password: 'correct-horse-1' });
    expect(mp.statusCode).toBeLessThan(300);
    const r = await inbound(mail({ from: { email: 'sales@ningbo.test', name: 'Ningbo Sales' }, to: 'suppliers@sourceeasy.test', subject: 'Price list', text: 'Our price list attached. WeChat wx_123' }));
    expect(r.json().side).toBe('SUPPLIER');
    for (const who of ['cs', 'ca', 'sa']) expect(await inboxIds(call, who)).toContain('inbox-supplier-email');
    for (const who of ['is', 'ia']) expect(await inboxIds(call, who)).not.toContain('inbox-supplier-email');
    const conv = (await call('cs', 'GET', '/api/chat/inboxes/inbox-supplier-email/conversations')).json().data[0];
    expect(conv.kind).toBe('SUPPLIER_EMAIL');
    for (const who of ['is', 'ia']) {
      expect([403, 404]).toContain((await call(who, 'GET', `/api/chat/conversations/${conv.id}`)).statusCode);
      expect([403, 404]).toContain((await call(who, 'GET', '/api/chat/inboxes/inbox-supplier-email/conversations')).statusCode);
      const search = (await call(who, 'GET', '/api/chat/search?q=price')).json().data ?? [];
      expect(JSON.stringify(search)).not.toContain('Ningbo');
    }
    const full = (await call('cs', 'GET', `/api/chat/conversations/${conv.id}`)).json().data;
    expect(full.canConvert).toBe(false);
    expect(full.messages[0].senderName).toBe('Ningbo Sales');
    const rep = await call('cs', 'POST', `/api/chat/conversations/${conv.id}/messages`, { content: 'Received, thank you.' });
    expect(rep.json().data.emailStatus).toBe('SENT');
    expect(sender.sent.at(-1)!.from).toBe('suppliers@sourceeasy.test');
    expect(sender.sent.at(-1)!.to).toBe('sales@ningbo.test');
    // India cannot be added or assigned.
    expect((await call('sa', 'POST', `/api/chat/conversations/${conv.id}/participants`, { userId: (await call('ia', 'GET', '/api/me')).json().id ?? (await call('ia', 'GET', '/api/me')).json().data?.id })).statusCode).toBe(403);
  });

  it('routes by known sender first: a supplier writing to support goes to China, a customer writing to suppliers goes to India', async () => {
    const { call, inbound, enquire } = await env();
    const s = await call('ca', 'POST', '/api/suppliers', { name: 'Yiwu Plastics', contact: 'Ms Li li@yiwu.test', phone: '+86 1', wechat: 'wx_li', city: 'Yiwu' });
    expect(s.statusCode).toBe(201);
    const a = await inbound(mail({ from: { email: 'li@yiwu.test' }, to: 'support@sourceeasy.test', subject: 'Hello' }));
    expect(a.json().side).toBe('SUPPLIER');
    const e = await enquire('Kumar Customer', '9876501234', 'KumarCo', { email: 'kumar@buyer.test' });
    const b = await inbound(mail({ from: { email: 'kumar@buyer.test' }, to: 'suppliers@sourceeasy.test', subject: `About ${e.reference}` }));
    expect(b.json().side).toBe('CUSTOMER');
    const conv = (await call('ia', 'GET', `/api/chat/conversations/${b.json().conversationId}`)).json().data;
    expect(conv.linkedLeadId).toBeTruthy(); // own lead → linked
    const c = await inbound(mail({ from: { email: 'stranger@else.test' }, to: 'support@sourceeasy.test', subject: `About ${e.reference}` }));
    const conv2 = (await call('ia', 'GET', `/api/chat/conversations/${c.json().conversationId}`)).json().data;
    expect(conv2.linkedLeadId).toBeNull(); // not their lead → not linked
    const d = await inbound(mail({ from: { email: 'x@factory.test' }, to: 'suppliers@sourceeasy.test', subject: `Re ${e.reference} samples` }));
    expect(d.json().side).toBe('SUPPLIER');
    const ignored = await inbound(mail({ headers: { 'Auto-Submitted': 'auto-replied' } }));
    expect(ignored.json().status).toBe('ignored');
  });

  it('staff can turn unread-chat emails off; the digest carries only counts and a link', async () => {
    const { app, call, inbound, sender } = await env();
    const p = await call('is', 'GET', '/api/me/notification-prefs');
    expect(p.json().data.chatEmail).toBe(true);
    expect((await call('ia', 'PUT', '/api/me/notification-prefs', { chatEmail: false })).json().data.chatEmail).toBe(false);
    expect((await call('ia', 'PUT', '/api/me/notification-prefs', { chatEmail: 'no' })).statusCode).toBe(400);
    await inbound(mail({ text: 'My secret budget is 4 lakh' }));
    const before = sender.sent.length;
    const n1 = await app.emailChannel!.unreadDigest({ minAgeMin: 0 });
    expect(n1).toBeGreaterThan(0);
    const digests = sender.sent.slice(before);
    expect(digests.some((m) => m.to === 'is@x.in')).toBe(true);
    expect(digests.some((m) => m.to === 'ia@x.in')).toBe(false);
    expect(digests.every((m) => !/budget|lakh|Priya|buyer@/.test(m.text + m.subject))).toBe(true);
    expect(digests.some((m) => m.to === 'cs@x.in' || m.to === 'ca@x.in')).toBe(false);
    expect(await app.emailChannel!.unreadDigest({ minAgeMin: 0 })).toBe(0); // at most hourly
  });

  it('parses Postmark payloads and strips quoted history', () => {
    const m = parseInbound({
      FromFull: { Email: 'A@B.test', Name: 'A' }, ToFull: [{ Email: 'support@sourceeasy.test' }], Subject: 'Hi', MessageID: 'pm-1',
      TextBody: 'Hello\n\n> old', Headers: [{ Name: 'Message-ID', Value: '<real@b.test>' }, { Name: 'In-Reply-To', Value: '<se.1@sourceeasy.test>' }],
      Attachments: [{ Name: 'a.png', Content: PNG.toString('base64'), ContentType: 'image/png' }],
    })!;
    expect(m.fromEmail).toBe('a@b.test');
    expect(m.messageId).toBe('<real@b.test>');
    expect(m.inReplyTo).toBe('<se.1@sourceeasy.test>');
    expect(m.attachments.length).toBe(1);
    expect(stripQuoted('Yes please\n\nOn Tue, 1 Dec 2026, Team <a@b> wrote:\n> earlier')).toBe('Yes please');
  });
});
