/** Public, portal and staff HTTP routes for customer support chat. */
import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from './users.js';
import type { CustomerUser } from './portal.js';
import type { ChatStore } from './chat.js';
import { ChatError, chatFileKey, redactedFileName } from './chat.js';
import type { UploadStore } from './uploads.js';
import type { AssignStore } from './assign.js';
import type { Rec } from './policy.js';
import type { Presence } from './presence.js';
import {
  SupportStore, SUPPORT_COOKIE, SUPPORT_INBOX, STARTS_PER_HOUR, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC,
  canAccessSupportInbox, checkSupportChallenge, issueSupportChallenge, parseCookies, visitorCookieHeader,
  cleanEmail, cleanName, cleanPhone, publicStaffName, deskStatusFor, newVisitorToken, type SupportConversation,
  brandOf, type SourceSite,
} from './support-chat.js';
import {
  EMBED_PREFIX, EMBED_TOKEN_HEADER, EMBED_MAX_MESSAGE, EMBED_MAX_LINKS, EMBED_IP_MESSAGES_PER_WINDOW,
  issueEmbedToken, readEmbedToken, linkCount,
} from './support-embed.js';

export interface SupportRouteDeps {
  support: SupportStore;
  chat: ChatStore;
  uploads: UploadStore;
  assign: AssignStore;
  jwtSecret: string;
  liveData: (d: Rec) => void;
  readMultipart: (req: FastifyRequest, max: number) => Promise<any>;
  stripImageMetadata: (files: any[]) => Promise<void>;
  names: () => Map<string, string>;
  lookupProduct: (idOrSlug: string) => Promise<{ id: string; title: string; slug: string } | null>;
  createSupportLead: (input: {
    name: string; phone?: string | null; email?: string | null; company?: string | null;
    productTitle?: string | null; productId?: string | null; message?: string | null; sourceSite?: SourceSite;
  }) => Promise<{ leadId: string; leadRef: string }>;
  customerOwnsLead: (customerId: string, leadId: string) => Promise<boolean>;
  customerOwnsOrder: (customerId: string, orderId: string) => Promise<boolean>;
  leadRefOf: (leadId: string) => Promise<string | null>;
  onLive: (fn: (d: Rec) => void) => () => void;
  supportStaffIds: () => Promise<string[]>;
  presence: Presence;
}

const cookieOf = (req: FastifyRequest) => parseCookies(req.headers.cookie)[SUPPORT_COOKIE];
const wantsSecure = (req: FastifyRequest) => {
  const xf = String(req.headers['x-forwarded-proto'] ?? '');
  return xf.split(',')[0]?.trim() === 'https' || (req.protocol === 'https');
};
const setVid = (req: FastifyRequest, reply: FastifyReply, raw: string) => {
  reply.header('set-cookie', visitorCookieHeader(raw, wantsSecure(req)));
};

export function registerPublicSupport(app: FastifyInstance, d: SupportRouteDeps) {
  const { support, chat, uploads, jwtSecret } = d;

  app.get('/api/support/status', async () => {
    const desk = deskStatusFor(await d.presence.anyOnline());
    return { data: { ...desk, challenge: issueSupportChallenge(jwtSecret), maxMessage: 4000 } };
  });

  // Only a boolean: no names, no counts. Cached a few seconds server-side and briefly by browsers.
  app.get('/api/support/presence', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=10');
    return { online: await d.presence.anyOnline() };
  });

  const visitorOf = async (req: FastifyRequest) => support.visitorFromToken(cookieOf(req));

  const presentForCustomer = async (conv: SupportConversation, forCustomer: boolean) => {
    const msgs = await support.messages(conv.id, forCustomer);
    return {
      id: conv.id,
      kind: 'CUSTOMER_SUPPORT' as const,
      subject: conv.guestName,
      productTitle: conv.productTitle,
      productSlug: conv.productSlug,
      convertedLeadRef: conv.convertedLeadId ? await d.leadRefOf(conv.convertedLeadId) : null,
      linkedLeadId: forCustomer ? null : conv.linkedLeadId,
      assignedTo: forCustomer ? null : conv.assignedTo,
      source: conv.source,
      createdAt: conv.createdAt,
      lastMessageAt: conv.lastMessageAt,
      sourceSite: conv.sourceSite,
      brand: brandOf(conv.sourceSite),
      messages: msgs.map((m: any) => presentMsg(m, forCustomer, conv.sourceSite)),
    };
  };

  const presentMsg = (m: any, forCustomer: boolean, site: SourceSite = 'sourceeasy') => {
    const embed = site !== 'sourceeasy';
    const files = chat.messageFiles(m.id).map((f, i) => ({
      ...f,
      name: redactedFileName('support', i + 1, f.name),
      url: !forCustomer
        ? `/api/chat/messages/${m.id}/files/${f.id}`
        : embed ? `${EMBED_PREFIX}/messages/${m.id}/files/${f.id}` : `/api/support/messages/${m.id}/files/${f.id}`,
    }));
    const authorKind = m.author_kind ?? (m.sender_id ? 'staff' : 'guest');
    const staffName = authorKind === 'staff' ? publicStaffName(d.names().get(m.sender_id) ?? null, site) : null;
    return {
      id: m.id,
      kind: m.kind,
      content: m.body,
      at: m.created_at,
      authorKind,
      visibility: m.visibility ?? 'customer',
      senderName: authorKind === 'staff' ? staffName : authorKind === 'system' ? brandOf(site) : (forCustomer ? 'You' : null),
      attachments: files,
    };
  };

  const startGuest = async (req: FastifyRequest, reply: FastifyReply, body: Record<string, any>) => {
    if (body.website || body.company_url || body.honeypot) return reply.code(200).send({ data: { ok: true } });
    if (!checkSupportChallenge(jwtSecret, String(body.challenge ?? ''))) {
      return reply.code(400).send({ error: 'Please wait a moment and try again', code: 'challenge' });
    }
    if (body.consent !== true && body.consent !== 'true' && body.consent !== '1' && body.consent !== 'on') {
      return reply.code(400).send({ error: 'Please agree to be contacted about this conversation', code: 'consent' });
    }
    const name = cleanName(body.name);
    const email = cleanEmail(body.email);
    const phone = cleanPhone(body.phone);
    if (!name) return reply.code(400).send({ error: 'Please enter your name', code: 'name' });
    if (!email && !phone) return reply.code(400).send({ error: 'Please enter a phone number or email', code: 'contact' });
    const hourKey = `se:support:start:${req.ip}:${Math.floor(Date.now() / 3600e3)}`;
    if (!(await support.rateLimit(hourKey, STARTS_PER_HOUR, 3600))) {
      return reply.code(429).send({ error: 'Too many conversations from this network. Please try later.', code: 'rate' });
    }
    let raw = cookieOf(req);
    let visitor = await support.visitorFromToken(raw);
    if (!visitor) {
      raw = newVisitorToken();
      visitor = await support.createVisitor(raw);
    }
    setVid(req, reply, raw!);
    let product: { id: string; title: string; slug: string } | null = null;
    const ref = String(body.productId || body.productSlug || '').trim();
    if (ref) product = await d.lookupProduct(ref);
    const { conv, created } = await support.open({
      visitorId: visitor.id,
      guestName: name,
      guestEmail: email,
      guestPhone: phone,
      productId: product?.id ?? null,
      productTitle: product?.title ?? null,
      productSlug: product?.slug ?? null,
      source: String(body.source ?? 'homepage').slice(0, 40),
      reuse: true,
    });
    const message = String(body.message ?? '').trim();
    if (message) {
      const ok = await support.rateLimit(`se:support:msg:${visitor.id}`, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC);
      if (!ok) return reply.code(429).send({ error: 'Please wait a little before sending more messages', code: 'rate' });
      const m = await support.post(conv.id, null, message, 'text', { authorKind: 'guest', visibility: 'customer' });
      d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: message.slice(0, 140), authorKind: 'guest' });
      await notifyStaff(d, conv, name, message);
      void m;
    } else if (created) {
      d.liveData({ type: 'chat', sub: 'opened', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT' });
      await notifyStaff(d, conv, name, conv.productTitle ? `New chat about ${conv.productTitle}` : 'New support chat');
    }
    return reply.send({ data: await presentForCustomer((await support.get(conv.id))!, true) });
  };

  app.post('/api/support/start', async (req, reply) => startGuest(req, reply, (req.body ?? {}) as any));

  app.get('/api/support/conversation', async (req, reply) => {
    const v = await visitorOf(req);
    if (!v) return reply.code(404).send({ error: 'Not found' });
    const conv = (await support.byVisitor(v.id))[0];
    if (!conv) return reply.code(404).send({ error: 'Not found' });
    return { data: await presentForCustomer(conv, true) };
  });

  const postGuestMessage = async (req: FastifyRequest, reply: FastifyReply, content: string, files: any[] = []) => {
    const v = await visitorOf(req);
    if (!v) return reply.code(401).send({ error: 'Not found' });
    const conv = (await support.byVisitor(v.id))[0];
    if (!conv) return reply.code(404).send({ error: 'Not found' });
    if (!(await support.rateLimit(`se:support:msg:${v.id}`, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC))) {
      return reply.code(429).send({ error: 'Please wait a little before sending more messages', code: 'rate' });
    }
    const text = content.trim() || (files.length ? ' ' : '');
    const m = await support.post(conv.id, null, text || ' ', 'text', { authorKind: 'guest', visibility: 'customer' });
    if (files.length) {
      uploads.commit(chatFileKey(m.id), files);
    }
    d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: (content || 'Attachment').slice(0, 140), authorKind: 'guest', messageId: m.id });
    await notifyStaff(d, conv, conv.guestName || 'Guest', content || 'Attachment');
    const row = { ...m, created_at: m.createdAt, author_kind: m.authorKind, visibility: m.visibility, body: m.body, sender_id: null, kind: m.kind };
    return { data: presentMsg(row, true, conv.sourceSite) };
  };

  app.post('/api/support/messages', async (req, reply) => {
    if ((req as any).isMultipart?.()) {
      const mpart = await d.readMultipart(req, 3);
      if (mpart.err) return reply.code(mpart.err.status).send({ error: mpart.err.error, code: mpart.err.code });
      await d.stripImageMetadata(mpart.files);
      return postGuestMessage(req, reply, String(mpart.fields?.content ?? ''), mpart.files);
    }
    return postGuestMessage(req, reply, String((req.body as any)?.content ?? ''), []);
  });

  app.get<{ Params: { mid: string; fid: string } }>('/api/support/messages/:mid/files/:fid', async (req, reply) => {
    const v = await visitorOf(req);
    if (!v) return reply.code(404).send({ error: 'Not found' });
    const owned = (await support.byVisitor(v.id));
    const msg = await support.messageById(req.params.mid);
    if (!msg || msg.visibility === 'staff_only' || !owned.some((c) => c.id === msg.conversation_id)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const f = uploads.file(chatFileKey(req.params.mid), req.params.fid);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    return sendUpload(req, reply, f);
  });

  app.get('/api/support/stream', async (req, reply) => {
    const v = await visitorOf(req);
    if (!v) return reply.code(401).send({ error: 'Not found' });
    const ids = new Set((await support.byVisitor(v.id)).map((c) => c.id));
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const write = (d: Rec) => {
      if (d?.type !== 'chat' || !ids.has(String(d.conversationId ?? ''))) return;
      if (d.visibility === 'staff_only') return;
      res.write(`data: ${JSON.stringify({ type: 'chat', conversationId: d.conversationId, sub: d.sub })}\n\n`);
    };
    // Re-check owned conversations periodically in case a new one was started.
    const tick = setInterval(() => { void support.byVisitor(v.id).then((list) => { for (const c of list) ids.add(c.id); }); }, 15000);
    const unsub = d.onLive(write);
    req.raw.on('close', () => { clearInterval(tick); unsub(); });
    res.write(':\n\n');
  });
}

/**
 * Cross-origin support chat for allowlisted partner sites (e.g. fortuneengineering.in).
 * CORS only for exact allowlisted origins, no credentials; identity is the signed
 * `X-Support-Token` header, valid only for the site it was issued to.
 */
export function registerEmbedSupport(app: FastifyInstance, d: SupportRouteDeps, origins: Map<string, SourceSite>) {
  const { support, chat, uploads, jwtSecret } = d;
  const corsHeaders = (origin: string) => ({
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': `content-type, ${EMBED_TOKEN_HEADER}`,
    'access-control-max-age': '600',
    vary: 'Origin',
  });
  const siteOfReq = (req: FastifyRequest) => (req as any).embedSite as SourceSite;
  const originOfReq = (req: FastifyRequest) => (req as any).embedOrigin as string;

  const presentMsg = (m: any, site: SourceSite) => {
    const authorKind = m.author_kind ?? (m.sender_id ? 'staff' : 'guest');
    return {
      id: m.id,
      kind: m.kind,
      content: m.body,
      at: m.created_at,
      authorKind,
      senderName: authorKind === 'staff' ? publicStaffName(d.names().get(m.sender_id) ?? null, site)
        : authorKind === 'system' ? brandOf(site) : 'You',
      attachments: chat.messageFiles(m.id).map((f, i) => ({
        ...f, name: redactedFileName('support', i + 1, f.name),
        url: `${EMBED_PREFIX}/messages/${m.id}/files/${f.id}`,
      })),
    };
  };
  const present = async (conv: SupportConversation) => ({
    id: conv.id,
    kind: 'CUSTOMER_SUPPORT' as const,
    sourceSite: conv.sourceSite,
    brand: brandOf(conv.sourceSite),
    subject: conv.guestName,
    convertedLeadRef: conv.convertedLeadId ? await d.leadRefOf(conv.convertedLeadId) : null,
    createdAt: conv.createdAt,
    lastMessageAt: conv.lastMessageAt,
    messages: (await support.messages(conv.id, true)).map((m: any) => presentMsg(m, conv.sourceSite)),
  });
  const visitorOf = async (req: FastifyRequest) => {
    const raw = readEmbedToken(jwtSecret, siteOfReq(req), req.headers[EMBED_TOKEN_HEADER]);
    return raw ? support.visitorFromToken(raw, siteOfReq(req)) : null;
  };
  const convOf = async (req: FastifyRequest) => {
    const v = await visitorOf(req);
    if (!v) return { v: null, conv: null };
    const conv = (await support.byVisitor(v.id)).find((c) => c.sourceSite === siteOfReq(req)) ?? null;
    return { v, conv };
  };

  // Plain root routes (not a child plugin: this runs inside the staff API plugin's boot and must not inherit its auth hooks).
  const cors = async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = String(req.headers.origin ?? '').toLowerCase();
    const site = origin ? origins.get(origin) : undefined;
    if (!site) return reply.code(403).header('vary', 'Origin').send({ error: 'Origin not allowed', code: 'origin' });
    (req as any).embedSite = site;
    (req as any).embedOrigin = origin;
    reply.headers(corsHeaders(origin));
    reply.header('cache-control', 'no-store');
  };
  const P = EMBED_PREFIX;
  {
    app.options(`${P}/*`, { onRequest: cors }, async (_req, reply) => reply.code(204).send());

    app.get(`${P}/status`, { onRequest: cors }, async (req) => {
      const desk = deskStatusFor(await d.presence.anyOnline());
      return { data: { ...desk, brand: brandOf(siteOfReq(req)), challenge: issueSupportChallenge(jwtSecret), maxMessage: EMBED_MAX_MESSAGE } };
    });

    app.get(`${P}/presence`, { onRequest: cors }, async (_req, reply) => {
      reply.header('cache-control', 'public, max-age=10').header('vary', 'Origin');
      return { online: await d.presence.anyOnline() };
    });

    app.post(`${P}/start`, { onRequest: cors, bodyLimit: 16 * 1024 }, async (req, reply) => {
      const site = siteOfReq(req);
      const body = (req.body ?? {}) as Record<string, any>;
      if (body.website || body.company_url || body.honeypot) return reply.code(200).send({ data: { ok: true } });
      if (!checkSupportChallenge(jwtSecret, String(body.challenge ?? ''))) {
        return reply.code(400).send({ error: 'Please wait a moment and try again', code: 'challenge' });
      }
      if (body.consent !== true && body.consent !== 'true' && body.consent !== '1' && body.consent !== 'on') {
        return reply.code(400).send({ error: 'Please agree to be contacted about this conversation', code: 'consent' });
      }
      const name = cleanName(body.name);
      const email = cleanEmail(body.email);
      const phone = cleanPhone(body.phone);
      if (!name) return reply.code(400).send({ error: 'Please enter your name', code: 'name' });
      if (!email && !phone) return reply.code(400).send({ error: 'Please enter a phone number or email', code: 'contact' });
      const message = String(body.message ?? '').trim();
      if (message.length > EMBED_MAX_MESSAGE) return reply.code(400).send({ error: 'Message is too long', code: 'size' });
      if (linkCount(message) > EMBED_MAX_LINKS) return reply.code(400).send({ error: 'Please send fewer links', code: 'links' });
      const hourKey = `se:support:embed:start:${site}:${req.ip}:${Math.floor(Date.now() / 3600e3)}`;
      if (!(await support.rateLimit(hourKey, STARTS_PER_HOUR, 3600))) {
        return reply.code(429).send({ error: 'Too many conversations from this network. Please try later.', code: 'rate' });
      }
      let raw = readEmbedToken(jwtSecret, site, req.headers[EMBED_TOKEN_HEADER]);
      let visitor = raw ? await support.visitorFromToken(raw, site) : null;
      if (!visitor) {
        raw = newVisitorToken();
        visitor = await support.createVisitor(raw, site);
      }
      const token = issueEmbedToken(jwtSecret, site, raw!).token;
      const page = String(body.page ?? '').replace(/[^\w\-/.]/g, '').slice(0, 60);
      const { conv, created } = await support.open({
        visitorId: visitor.id, guestName: name, guestEmail: email, guestPhone: phone,
        source: `${site === 'fortune_engineering' ? 'fortuneengineering.in' : site}${page ? ` ${page}` : ''}`.slice(0, 40),
        sourceSite: site,
        reuse: true,
      });
      if (message) {
        const ok = await support.rateLimit(`se:support:msg:${visitor.id}`, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC);
        if (!ok) return reply.code(429).send({ error: 'Please wait a little before sending more messages', code: 'rate' });
        await support.post(conv.id, null, message, 'text', { authorKind: 'guest', visibility: 'customer' });
        d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: message.slice(0, 140), authorKind: 'guest', sourceSite: site });
        await notifyStaff(d, conv, name, message);
      } else if (created) {
        d.liveData({ type: 'chat', sub: 'opened', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', sourceSite: site });
        await notifyStaff(d, conv, name, `New ${brandOf(site)} chat`);
      }
      return reply.send({ data: { token, conversation: await present((await support.get(conv.id))!) } });
    });

    app.get(`${P}/conversation`, { onRequest: cors }, async (req, reply) => {
      const { v, conv } = await convOf(req);
      if (!v) return reply.code(401).send({ error: 'Not found', code: 'token' });
      if (!conv) return reply.code(404).send({ error: 'Not found' });
      return { data: await present(conv) };
    });

    app.post(`${P}/messages`, { onRequest: cors, bodyLimit: 16 * 1024 }, async (req, reply) => {
      const { v, conv } = await convOf(req);
      if (!v) return reply.code(401).send({ error: 'Not found', code: 'token' });
      if (!conv) return reply.code(404).send({ error: 'Not found' });
      const content = String((req.body as any)?.content ?? '').trim();
      if (!content) return reply.code(400).send({ error: 'Message cannot be empty', code: 'empty' });
      if (content.length > EMBED_MAX_MESSAGE) return reply.code(400).send({ error: 'Message is too long', code: 'size' });
      if (linkCount(content) > EMBED_MAX_LINKS) return reply.code(400).send({ error: 'Please send fewer links', code: 'links' });
      const ipKey = `se:support:embed:msgip:${req.ip}:${Math.floor(Date.now() / (MESSAGE_WINDOW_SEC * 1000))}`;
      if (!(await support.rateLimit(ipKey, EMBED_IP_MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC))
        || !(await support.rateLimit(`se:support:msg:${v.id}`, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC))) {
        return reply.code(429).send({ error: 'Please wait a little before sending more messages', code: 'rate' });
      }
      const m = await support.post(conv.id, null, content, 'text', { authorKind: 'guest', visibility: 'customer' });
      d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: content.slice(0, 140), authorKind: 'guest', messageId: m.id, sourceSite: conv.sourceSite });
      await notifyStaff(d, conv, conv.guestName || 'Guest', content);
      const row = { id: m.id, kind: m.kind, body: m.body, created_at: m.createdAt, author_kind: 'guest', sender_id: null };
      return { data: presentMsg(row, conv.sourceSite) };
    });

    app.get<{ Params: { mid: string; fid: string } }>(`${P}/messages/:mid/files/:fid`, { onRequest: cors }, async (req, reply) => {
      const { v, conv } = await convOf(req);
      if (!v || !conv) return reply.code(404).send({ error: 'Not found' });
      const msg = await support.messageById(req.params.mid);
      if (!msg || msg.visibility === 'staff_only' || msg.conversation_id !== conv.id) return reply.code(404).send({ error: 'Not found' });
      const f = uploads.file(chatFileKey(req.params.mid), req.params.fid);
      if (!f) return reply.code(404).send({ error: 'Not found' });
      return sendUpload(req, reply, f);
    });

    // Realtime: SSE over fetch() (the widget reads the stream so it can send the token header).
    app.get(`${P}/stream`, { onRequest: cors }, async (req, reply) => {
      const { v, conv } = await convOf(req);
      if (!v || !conv) return reply.code(401).send({ error: 'Not found', code: 'token' });
      const res = reply.raw;
      res.writeHead(200, {
        ...corsHeaders(originOfReq(req)),
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff',
      });
      const write = (ev: Rec) => {
        if (ev?.type !== 'chat' || String(ev.conversationId ?? '') !== conv.id) return;
        if (ev.visibility === 'staff_only') return;
        res.write(`data: ${JSON.stringify({ type: 'chat', conversationId: ev.conversationId, sub: ev.sub })}\n\n`);
      };
      const ping = setInterval(() => { res.write(':\n\n'); }, 25000);
      const unsub = d.onLive(write);
      req.raw.on('close', () => { clearInterval(ping); unsub(); });
      res.write(':\n\n');
    });
  }
}

export function registerPortalSupport(api: FastifyInstance, d: SupportRouteDeps) {
  const { support, chat, uploads } = d;
  const present = async (conv: SupportConversation, customerId: string) => {
    if (conv.customerId !== customerId) throw Object.assign(new Error('Not found'), { status: 404 });
    const msgs = await support.messages(conv.id, true);
    return {
      id: conv.id,
      kind: 'CUSTOMER_SUPPORT' as const,
      subject: conv.guestName,
      productTitle: conv.productTitle,
      productSlug: conv.productSlug,
      convertedLeadRef: conv.convertedLeadId ? await d.leadRefOf(conv.convertedLeadId) : null,
      linkedLeadId: conv.linkedLeadId,
      createdAt: conv.createdAt,
      lastMessageAt: conv.lastMessageAt,
      messages: msgs.map((m: any) => ({
        id: m.id, kind: m.kind, content: m.body, at: m.created_at,
        authorKind: m.author_kind ?? (m.sender_id ? 'staff' : 'customer'),
        senderName: (m.author_kind === 'staff' || m.sender_id) ? publicStaffName(d.names().get(m.sender_id) ?? null)
          : m.author_kind === 'system' ? 'Source Easy' : 'You',
        attachments: chat.messageFiles(m.id).map((f, i) => ({
          ...f, name: redactedFileName('support', i + 1, f.name),
          url: `/api/portal/support/messages/${m.id}/files/${f.id}`,
        })),
      })),
    };
  };

  const claim = async (req: FastifyRequest, c: CustomerUser) => {
    const raw = cookieOf(req);
    const v = await support.visitorFromToken(raw);
    if (v) await support.claimVisitor(v.id, c.customerId, c.name, c.email, c.phone);
  };

  api.get('/api/portal/support/status', async () => {
    const desk = deskStatusFor(await d.presence.anyOnline());
    return { data: { ...desk, maxMessage: 4000 } };
  });

  api.get('/api/portal/support/conversations', async (req) => {
    const c = req.customer!;
    await claim(req, c);
    const list = await support.byCustomer(c.customerId);
    const data = [];
    for (const conv of list) {
      const last = (await support.messages(conv.id, true)).at(-1);
      data.push({
        id: conv.id, productTitle: conv.productTitle, createdAt: conv.createdAt,
        lastMessageAt: conv.lastMessageAt, lastBody: last ? String(last.body ?? '').slice(0, 140) : null,
        convertedLeadRef: conv.convertedLeadId ? await d.leadRefOf(conv.convertedLeadId) : null,
      });
    }
    return { data };
  });

  api.post('/api/portal/support/start', async (req, reply) => {
    const c = req.customer!;
    await claim(req, c);
    const body = (req.body ?? {}) as any;
    const hourKey = `se:support:start:cust:${c.customerId}:${Math.floor(Date.now() / 3600e3)}`;
    if (!(await support.rateLimit(hourKey, STARTS_PER_HOUR, 3600))) {
      return reply.code(429).send({ error: 'Too many conversations right now. Please try later.', code: 'rate' });
    }
    let product: { id: string; title: string; slug: string } | null = null;
    const ref = String(body.productId || body.productSlug || '').trim();
    if (ref) product = await d.lookupProduct(ref);
    let linkedLeadId: string | null = body.leadId ? String(body.leadId) : null;
    let linkedOrderId: string | null = body.orderId ? String(body.orderId) : null;
    if (linkedLeadId && !(await d.customerOwnsLead(c.customerId, linkedLeadId))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (linkedOrderId && !(await d.customerOwnsOrder(c.customerId, linkedOrderId))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const { conv, created } = await support.open({
      customerId: c.customerId,
      guestName: c.name || 'Customer',
      guestEmail: c.email ?? null,
      guestPhone: c.phone ?? null,
      productId: product?.id ?? null,
      productTitle: product?.title ?? null,
      productSlug: product?.slug ?? null,
      source: String(body.source ?? 'portal').slice(0, 40),
      linkedLeadId, linkedOrderId,
      reuse: body.new === true || body.new === 'true' ? false : true,
    });
    const message = String(body.message ?? '').trim();
    if (message) {
      if (!(await support.rateLimit(`se:support:msg:cust:${c.customerId}`, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC))) {
        return reply.code(429).send({ error: 'Please wait a little before sending more messages', code: 'rate' });
      }
      await support.post(conv.id, null, message, 'text', { authorKind: 'customer', visibility: 'customer' });
      d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: message.slice(0, 140), authorKind: 'customer' });
      await notifyStaff(d, conv, c.name, message);
    } else if (created) {
      d.liveData({ type: 'chat', sub: 'opened', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT' });
      await notifyStaff(d, conv, c.name, conv.productTitle ? `New chat about ${conv.productTitle}` : 'New support chat');
    }
    return { data: await present((await support.get(conv.id))!, c.customerId) };
  });

  api.get<{ Params: { id: string } }>('/api/portal/support/conversations/:id', async (req) => {
    const c = req.customer!;
    const conv = await support.get(req.params.id);
    if (!conv) throw Object.assign(new Error('Not found'), { status: 404 });
    return { data: await present(conv, c.customerId) };
  });

  const postPortalMsg = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, content: string, files: any[] = []) => {
    const c = req.customer!;
    const conv = await support.get(req.params.id);
    if (!conv || conv.customerId !== c.customerId) return reply.code(404).send({ error: 'Not found' });
    if (!(await support.rateLimit(`se:support:msg:cust:${c.customerId}`, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC))) {
      return reply.code(429).send({ error: 'Please wait a little before sending more messages', code: 'rate' });
    }
    const m = await support.post(conv.id, null, content.trim() || (files.length ? ' ' : ''), 'text', { authorKind: 'customer', visibility: 'customer' });
    if (files.length) uploads.commit(chatFileKey(m.id), files);
    d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: (content || 'Attachment').slice(0, 140), authorKind: 'customer', messageId: m.id });
    await notifyStaff(d, conv, c.name, content || 'Attachment');
    return { data: (await present((await support.get(conv.id))!, c.customerId)).messages.find((x) => x.id === m.id) };
  };

  api.post<{ Params: { id: string } }>('/api/portal/support/conversations/:id/messages', async (req, reply) => {
    if ((req as any).isMultipart?.()) {
      const mpart = await d.readMultipart(req, 3);
      if (mpart.err) return reply.code(mpart.err.status).send({ error: mpart.err.error, code: mpart.err.code });
      await d.stripImageMetadata(mpart.files);
      return postPortalMsg(req, reply, String(mpart.fields?.content ?? ''), mpart.files);
    }
    return postPortalMsg(req, reply, String((req.body as any)?.content ?? ''), []);
  });

  api.get<{ Params: { mid: string; fid: string } }>('/api/portal/support/messages/:mid/files/:fid', async (req, reply) => {
    const c = req.customer!;
    const msg = await support.messageById(req.params.mid);
    if (!msg || msg.visibility === 'staff_only') return reply.code(404).send({ error: 'Not found' });
    const conv = await support.get(msg.conversation_id);
    if (!conv || conv.customerId !== c.customerId) return reply.code(404).send({ error: 'Not found' });
    const f = uploads.file(chatFileKey(req.params.mid), req.params.fid);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    return sendUpload(req, reply, f);
  });

  api.get('/api/portal/support/stream', async (req, reply) => {
    const c = req.customer!;
    const ids = new Set((await support.byCustomer(c.customerId)).map((x) => x.id));
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const write = (ev: Rec) => {
      if (ev?.type !== 'chat' || !ids.has(String(ev.conversationId ?? ''))) return;
      if (ev.visibility === 'staff_only') return;
      res.write(`data: ${JSON.stringify({ type: 'chat', conversationId: ev.conversationId, sub: ev.sub })}\n\n`);
    };
    const tick = setInterval(() => { void support.byCustomer(c.customerId).then((list) => { for (const x of list) ids.add(x.id); }); }, 15000);
    const unsub = d.onLive(write);
    req.raw.on('close', () => { clearInterval(tick); unsub(); });
    res.write(':\n\n');
  });
}

export function registerStaffSupport(api: FastifyInstance, d: SupportRouteDeps) {
  const { support, chat } = d;

  const guard = async (u: User, id: string) => {
    if (!canAccessSupportInbox(u)) throw Object.assign(new Error('Not found'), { status: 404 });
    const conv = await support.get(id);
    if (!conv) throw Object.assign(new Error('Not found'), { status: 404 });
    return conv;
  };

  // ---- Own availability for the customer support desk (Available / Away). Only inbox members count towards "Online". ----
  const presenceOf = async (u: User) => {
    const st = await d.presence.stateOf(u.id);
    return { data: { state: st.state, away: st.away, counts: d.chat.supportDesk(u) } };
  };
  api.get('/api/chat/presence', async (req) => presenceOf(req.user!));
  // Heartbeat from the web app / floating chat: `active:false` when the user is idle (auto-away), `active:true` when back.
  api.post<{ Body: { active?: boolean } | null }>('/api/chat/presence/heartbeat', async (req) => {
    const active = typeof req.body?.active === 'boolean' ? req.body.active : undefined;
    await d.presence.touch(req.user!.id, { active });
    return presenceOf(req.user!);
  });
  api.put<{ Body: { status?: string } | null }>('/api/chat/presence', async (req, reply) => {
    const st = String(req.body?.status ?? '');
    if (st !== 'available' && st !== 'away') return reply.code(400).send({ error: 'status must be available or away' });
    await d.presence.setAway(req.user!.id, st === 'away');
    return presenceOf(req.user!);
  });

  api.post<{ Params: { id: string } }>('/api/chat/conversations/:id/convert-lead', async (req) => {
    const conv = await guard(req.user!, req.params.id);
    if (conv.convertedLeadId) {
      return { data: { leadId: conv.convertedLeadId, leadRef: await d.leadRefOf(conv.convertedLeadId) } };
    }
    const last = (await support.messages(conv.id, false)).filter((m: any) => m.visibility !== 'staff_only' && m.kind === 'text').at(-1);
    const out = await d.createSupportLead({
      name: conv.guestName || 'Support guest',
      phone: conv.guestPhone,
      email: conv.guestEmail,
      productTitle: conv.productTitle,
      productId: conv.productId,
      message: last ? String(last.body ?? '') : null,
      sourceSite: conv.sourceSite,
    });
    await support.setConverted(conv.id, out.leadId);
    await support.post(conv.id, req.user!.id, `We've opened a sourcing request ${out.leadRef} for you.`, 'system', { authorKind: 'system', visibility: 'customer' });
    await support.post(conv.id, req.user!.id, `Converted this chat into lead ${out.leadRef}.`, 'system', { authorKind: 'system', visibility: 'staff_only' });
    d.liveData({ type: 'chat', sub: 'message', conversationId: conv.id, kind: 'CUSTOMER_SUPPORT', preview: `Opened ${out.leadRef}`, leadId: out.leadId, leadRef: out.leadRef });
    d.liveData({ type: 'lead', id: out.leadId, leadId: out.leadId, created: true, at: Date.now() });
    return { data: { leadId: out.leadId, leadRef: out.leadRef } };
  });

  api.post<{ Params: { id: string }; Body: { leadId?: string; orderId?: string } }>('/api/chat/conversations/:id/link', async (req) => {
    const conv = await guard(req.user!, req.params.id);
    const leadId = req.body?.leadId ? String(req.body.leadId) : undefined;
    const orderId = req.body?.orderId ? String(req.body.orderId) : undefined;
    if (leadId && conv.customerId && !(await d.customerOwnsLead(conv.customerId, leadId))) {
      throw Object.assign(new Error('Not found'), { status: 404 });
    }
    if (orderId && conv.customerId && !(await d.customerOwnsOrder(conv.customerId, orderId))) {
      throw Object.assign(new Error('Not found'), { status: 404 });
    }
    await support.setLinked(conv.id, leadId ?? null, orderId ?? null);
    return { data: { ok: true, linkedLeadId: leadId ?? null, linkedOrderId: orderId ?? null } };
  });

}


async function notifyStaff(d: SupportRouteDeps, conv: SupportConversation, byName: string, preview: string) {
  const ids = await d.supportStaffIds();
  if (!ids.length) return;
  await d.assign.notify(ids, {
    leadId: conv.convertedLeadId ?? conv.linkedLeadId ?? null,
    leadRef: conv.productTitle || (conv.sourceSite === 'sourceeasy' ? 'Support' : `${brandOf(conv.sourceSite)} chat`),
    product: conv.productTitle,
    kind: 'CHAT_MESSAGE',
    office: 'INDIA',
    byName: byName.slice(0, 80),
    detail: preview.slice(0, 140),
    conversationId: conv.id,
  });
}


function sendUpload(_req: FastifyRequest, reply: FastifyReply, f: { meta: { mime: string; name: string }; path: string; size: number }) {
  const inline = /^image\/(jpeg|png|webp)$|^application\/pdf$|^video\//.test(f.meta.mime);
  reply.header('content-type', f.meta.mime).header('cache-control', 'private, no-store')
    .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.meta.name)}`);
  return reply.send(createReadStream(f.path));
}
