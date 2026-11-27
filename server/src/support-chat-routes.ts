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
import {
  SupportStore, SUPPORT_COOKIE, SUPPORT_INBOX, STARTS_PER_HOUR, MESSAGES_PER_WINDOW, MESSAGE_WINDOW_SEC,
  canAccessSupportInbox, checkSupportChallenge, issueSupportChallenge, parseCookies, visitorCookieHeader,
  cleanEmail, cleanName, cleanPhone, publicStaffName, supportDeskStatus, newVisitorToken, type SupportConversation,
} from './support-chat.js';

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
    productTitle?: string | null; productId?: string | null; message?: string | null;
  }) => Promise<{ leadId: string; leadRef: string }>;
  customerOwnsLead: (customerId: string, leadId: string) => Promise<boolean>;
  customerOwnsOrder: (customerId: string, orderId: string) => Promise<boolean>;
  leadRefOf: (leadId: string) => Promise<string | null>;
  onLive: (fn: (d: Rec) => void) => () => void;
  supportStaffIds: () => Promise<string[]>;
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
    const desk = supportDeskStatus();
    return { data: { ...desk, challenge: issueSupportChallenge(jwtSecret), maxMessage: 4000 } };
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
      messages: msgs.map((m: any) => presentMsg(m, forCustomer)),
    };
  };

  const presentMsg = (m: any, forCustomer: boolean) => {
    const files = chat.messageFiles(m.id).map((f, i) => ({
      ...f,
      name: redactedFileName('support', i + 1, f.name),
      url: forCustomer
        ? `/api/support/messages/${m.id}/files/${f.id}`
        : `/api/chat/messages/${m.id}/files/${f.id}`,
    }));
    const authorKind = m.author_kind ?? (m.sender_id ? 'staff' : 'guest');
    const staffName = authorKind === 'staff' ? publicStaffName(d.names().get(m.sender_id) ?? null) : null;
    return {
      id: m.id,
      kind: m.kind,
      content: m.body,
      at: m.created_at,
      authorKind,
      visibility: m.visibility ?? 'customer',
      senderName: authorKind === 'staff' ? staffName : authorKind === 'system' ? 'Source Easy' : (forCustomer ? 'You' : null),
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
    return { data: presentMsg(row, true) };
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
    const desk = supportDeskStatus();
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
    leadRef: conv.productTitle || 'Support',
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
