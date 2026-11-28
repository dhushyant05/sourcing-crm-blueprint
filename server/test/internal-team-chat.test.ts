import { describe, expect, it } from 'vitest';
import { setup, PW, SUP } from './portal-helpers.ts';
import { allowedFor, ROLE_DEFAULTS } from '../src/permissions.ts';
import { convClass, isInternalConv, conversationIsMixed, dmKeyFor } from '../src/chat.ts';

describe('internal chat helpers and permissions', () => {
  it('does not treat channels or DMs as support conversations', () => {
    expect(convClass({ kind: 'CHANNEL' })).toBe('channel');
    expect(convClass({ kind: 'DM' })).toBe('dm');
    expect(convClass({ kind: 'CUSTOMER_SUPPORT' })).toBe('support');
    expect(convClass({ leadId: null })).toBe('support');
    expect(isInternalConv({ kind: 'CHANNEL' })).toBe(true);
    expect(conversationIsMixed(['INDIA_STAFF', 'CHINA_STAFF'])).toBe(true);
    expect(conversationIsMixed(['INDIA_STAFF', 'INDIA_ADMIN', 'SUPER_ADMIN'])).toBe(false);
    expect(conversationIsMixed(['INDIA_STAFF', 'MARKETPLACE_TEAM'])).toBe(true);
    expect(dmKeyFor(['b', 'a', 'a'])).toBe('a:b');
  });

  it('grants dm/channels to staff and manage_channels to admins; suppliers never qualify', () => {
    expect(allowedFor('SUPPLIER', 'chat.dm')).toBe(false);
    expect(allowedFor('SUPPLIER', 'chat.channels')).toBe(false);
    expect(ROLE_DEFAULTS.INDIA_STAFF).toContain('chat.dm');
    expect(ROLE_DEFAULTS.CHINA_STAFF).toContain('chat.channels');
    expect(ROLE_DEFAULTS.MARKETPLACE_TEAM).toContain('chat.dm');
    expect(ROLE_DEFAULTS.INDIA_ADMIN).toContain('chat.manage_channels');
    expect(ROLE_DEFAULTS.CHINA_ADMIN).toContain('chat.manage_channels');
    expect(ROLE_DEFAULTS.INDIA_STAFF).not.toContain('chat.manage_channels');
  });
});

describe('internal team chat', () => {
  it('seeds default channels, opens a unique 1:1 DM, and keeps suppliers out', async () => {
    const { call, users } = await setup();
    await call('is', 'GET', '/api/chat/inboxes');
    const list = (await call('is', 'GET', '/api/chat/internal')).json().data;
    const slugs = list.channels.map((c: any) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['all-staff', 'india-team']));
    expect(slugs).not.toContain('china-team');
    expect((await call('cs', 'GET', '/api/chat/internal')).json().data.channels.map((c: any) => c.slug)).toEqual(expect.arrayContaining(['all-staff', 'china-team']));

    const inboxes = (await call('is', 'GET', '/api/chat/inboxes')).json().data;
    expect(inboxes.some((i: any) => i.slug === 'all-staff' || i.kind === 'CHANNEL')).toBe(false);

    const dir = (await call('is', 'GET', '/api/chat/directory')).json().data;
    expect(dir.some((p: any) => p.role === 'SUPPLIER')).toBe(false);
    const china = dir.find((p: any) => p.role === 'CHINA_STAFF');
    const dm1 = await call('is', 'POST', '/api/chat/dms', { userId: china.id });
    expect(dm1.statusCode).toBe(201);
    const dm2 = await call('cs', 'POST', '/api/chat/dms', { userId: (await call('is', 'GET', '/api/me')).json().id ?? (await call('is', 'GET', '/api/me')).json().data?.id });
    // Both sides resolve to the same thread
    expect(dm2.json().data.id).toBe(dm1.json().data.id);
    expect(dm1.json().data.mixed).toBe(true);

    const me = (await call('is', 'GET', '/api/me')).json();
    const myId = me.id ?? me.data?.id;
    const leaveMandatory = await call('is', 'POST', `/api/chat/conversations/channel-all-staff/leave`);
    expect(leaveMandatory.statusCode).toBe(403);
    const indiaTeam = list.channels.find((c: any) => c.slug === 'india-team');
    expect((await call('is', 'POST', `/api/chat/conversations/${indiaTeam.id}/leave`)).statusCode).toBe(403);

    const sup = await users.create('sup@x.in', 'A Supplier', 'SUPPLIER', PW);
    const blocked = await call('is', 'POST', '/api/chat/dms', { userId: sup.id });
    expect(blocked.statusCode).toBe(403);

    const custom = await call('ia', 'POST', '/api/chat/channels', { name: 'Sourcing desk', memberIds: [myId] });
    expect(custom.statusCode).toBe(201);
    expect((await call('is', 'POST', `/api/chat/conversations/${custom.json().data.id}/leave`)).statusCode).toBe(200);
    expect((await call('is', 'GET', `/api/chat/conversations/${custom.json().data.id}`)).statusCode).toBe(404);
  });

  it('posts messages, mentions, quote cards (redacted per viewer) and hides previews on mixed-chat notifications', async () => {
    const { call, enquire, ids } = await setup();
    const e = await enquire('Arora Home Store', '9000000009', 'Arora Home');
    const lead = (await call('ia', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === e.reference);
    await call('ia', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
      newSupplier: SUP, product: 'Steel bottle', unitPrice: '1.25', currency: 'USD', moq: '500',
    })).json().data;

    const chinaId = ids.cs;
    const dm = (await call('ia', 'POST', '/api/chat/dms', { userId: chinaId })).json().data;
    const mention = await call('ia', 'POST', `/api/chat/conversations/${dm.id}/messages`, { content: 'Hello Staff cs, please check.', mentionIds: [chinaId] });
    expect(mention.statusCode).toBe(200);

    const card = await call('ia', 'POST', `/api/chat/conversations/${dm.id}/quote-reference`, { quoteId: q.id });
    expect(card.statusCode).toBe(200);
    expect(card.json().data.quoteReference.product).toBe('Steel bottle');
    expect(JSON.stringify(card.json().data.quoteReference)).not.toMatch(/Arora|1\.25|Ningbo Secret|199|INR/i);

    const chinaView = (await call('cs', 'GET', `/api/chat/conversations/${dm.id}`)).json().data;
    const chinaCard = chinaView.messages.find((m: any) => m.kind === 'quote_reference')?.quoteReference;
    expect(chinaCard.quoteLabel).toMatch(/-Q1$/);
    expect(JSON.stringify(chinaCard)).not.toMatch(/Arora|1\.25|customer|199/i);

    const notifs = (await call('cs', 'GET', '/api/notifications')).json();
    const chatN = (notifs.data ?? notifs).filter((n: any) => n.kind === 'CHAT_MESSAGE' && n.conversationId === dm.id);
    expect(chatN.length).toBeGreaterThan(0);
    expect(JSON.stringify(chatN)).not.toMatch(/Arora Home Store|1\.25|199/);
    // Mixed conversation: message body is not copied into the notification.
    expect(chatN.some((n: any) => /Hello Staff cs/.test(n.detail ?? ''))).toBe(false);
    expect(chatN.some((n: any) => /mentioned you/.test(n.detail ?? ''))).toBe(true);

    // India cannot attach a quote they cannot read? They can read this lead.
    // China-only: a second lead China cannot open shouldn't appear in India's picker as China-owned... skip.
    const opts = (await call('ia', 'GET', `/api/chat/quote-options?q=${encodeURIComponent(lead.leadRef)}`)).json().data;
    expect(opts.some((o: any) => o.quoteId === q.id)).toBe(true);
    expect(JSON.stringify(opts)).not.toMatch(/1\.25|Ningbo Secret/);
  });

  it('keeps China out of a custom India channel and staff without manage_channels cannot create one', async () => {
    const { call, ids } = await setup();
    const mine = (await call('is', 'POST', '/api/chat/channels', { name: 'Private India' }));
    expect(mine.statusCode).toBe(403);
    const ch = (await call('ia', 'POST', '/api/chat/channels', { name: 'Private India', memberIds: [ids.is] })).json().data;
    expect((await call('cs', 'GET', `/api/chat/conversations/${ch.id}`)).statusCode).toBe(404);
    expect((await call('cs', 'GET', '/api/chat/internal')).json().data.channels.some((c: any) => c.id === ch.id)).toBe(false);
    const search = (await call('cs', 'GET', '/api/chat/search?q=Private')).json().data ?? [];
    expect(JSON.stringify(search)).not.toContain(ch.id);
    expect((await call('ia', 'POST', `/api/chat/conversations/${ch.id}/participants`, { userId: ids.cs })).statusCode).toBe(200);
    expect((await call('cs', 'GET', `/api/chat/conversations/${ch.id}`)).statusCode).toBe(200);
  });

  it('blocks a revoked chat.channels user from opening channels, and group DMs cap at 8', async () => {
    const { call, ids } = await setup();
    const rev = await call('sa', 'PUT', `/api/users/${ids.is}/permissions`, { permissions: { 'chat.channels': false } });
    expect(rev.statusCode).toBe(200);
    expect((await call('is', 'GET', '/api/chat/conversations/channel-all-staff')).statusCode).toBe(403);
    const extras = [];
    for (let i = 0; i < 8; i++) {
      const r = await call('sa', 'POST', '/api/users', { email: `g${i}@x.in`, name: `Group ${i}`, role: 'INDIA_STAFF', password: PW });
      extras.push(r.json().data.id);
    }
    const tooMany = await call('ia', 'POST', '/api/chat/dms', { userIds: extras });
    expect(tooMany.statusCode).toBe(400);
    const ok = await call('ia', 'POST', '/api/chat/dms', { userIds: extras.slice(0, 6) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.isGroup).toBe(true);
    expect((await call('ia', 'POST', `/api/chat/conversations/${ok.json().data.id}/leave`)).statusCode).toBe(200);
  });
});
