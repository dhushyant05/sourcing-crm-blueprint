/** HTTP routes for native India↔China staff chat, custom roles and team inboxes. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sides, type Role } from './roles.js';
import type { User } from './users.js';
import type { UserStore } from './users.js';
import type { QuoteStore, Quote } from './quotes.js';
import type { LeadStore } from './leads.js';
import type { UploadStore } from './uploads.js';
import type { AssignStore } from './assign.js';
import type { PermStore } from './permissions.js';
import type { CustomRoleStore } from './custom-roles.js';
import {
  ChatError, ChatStore, presentQuoteCard, pickerItems, suggestedQuoteId, chatFileKey,
  redactedFileName, qUploadKey, pickCover, canAccessSupportInbox, isChinaRole,
} from './chat.js';
import { quoteCarton } from './quotes.js';
import type { Rec } from './policy.js';

export interface ChatRouteDeps {
  chat: ChatStore;
  roles: CustomRoleStore;
  quotes: QuoteStore;
  leads: LeadStore;
  uploads: UploadStore;
  assign: AssignStore;
  users: UserStore;
  perms: PermStore;
  attLead: (req: FastifyRequest<{ Params: { id: string } }>) => Promise<string>;
  need: (u: User, k: string) => void;
  liveData: (d: Rec) => void;
  canReadLead: (u: User, leadId: string) => Promise<boolean>;
  readMultipart: (req: FastifyRequest, max: number) => Promise<any>;
  stripImageMetadata: (files: any[]) => Promise<void>;
  names: () => Map<string, string>;
}

export function registerStaffChat(api: FastifyInstance, d: ChatRouteDeps) {
  const { chat, roles, quotes, leads, uploads, assign, users, perms, need, liveData, canReadLead, names } = d;

  const leadRefOf = async (id: string | null) => {
    if (!id) return 'support';
    return ((await leads.get(id))?.leadRef as string | undefined) ?? 'SE';
  };
  const isSupportConv = (conv: { kind?: string; leadId?: string | null }) => conv.kind === 'CUSTOMER_SUPPORT' || !conv.leadId;
  const requireLeadId = (id: string | null | undefined) => {
    if (!id) throw Object.assign(new Error('Not found'), { status: 404 });
    return id;
  };
  const requireChat = (u: User) => {
    if (!perms.can(u, 'chat.view_own') && !perms.can(u, 'chat.view_team') && !perms.can(u, 'chat.view_all')) {
      throw Object.assign(new Error('You do not have permission: chat.view_own'), { status: 403 });
    }
  };
  const guard = async (u: User, conversationId: string) => {
    requireChat(u);
    await chat.bootstrapUser(u);
    const conv = await chat.get(conversationId);
    if (!conv) throw Object.assign(new Error('Not found'), { status: 404 });
    if (isSupportConv(conv)) {
      if (!canAccessSupportInbox(u) || !(await chat.canAccessId(u, conv.id, null))) {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }
      return conv;
    }
    if (!(await canReadLead(u, requireLeadId(conv.leadId)))) throw Object.assign(new Error('Not found'), { status: 404 });
    if (!(await chat.canAccessId(u, conv.id, requireLeadId(conv.leadId)))) throw Object.assign(new Error('Not found'), { status: 404 });
    return conv;
  };
  const presentMessage = async (u: User, leadRef: string, list: Quote[], m: any) => {
    const files = chat.messageFiles(m.id).map((f, i) => ({ ...f, name: redactedFileName(leadRef, i + 1, f.name) }));
    const quoteReference = m.kind === 'quote_reference' && m.quote_id ? presentQuoteCard(leadRef, list, m.quote_id, uploads) : null;
    const tagIdx = m.quote_id ? list.findIndex((q) => q.id === m.quote_id) : -1;
    return {
      id: m.id,
      kind: m.kind,
      content: m.body,
      senderId: m.sender_id,
      senderName: (m.sender_id && names().get(m.sender_id)) || 'Staff',
      at: m.created_at,
      quoteId: m.quote_id,
      quoteTag: tagIdx >= 0 ? { quoteId: m.quote_id, quoteLabel: `${leadRef}-Q${tagIdx + 1}` } : null,
      quoteReference,
      attachments: files,
      authorKind: m.author_kind ?? (m.sender_id ? 'staff' : 'guest'),
      visibility: m.visibility ?? 'customer',
    };
  };
  const presentSupport = async (u: User, conv: any) => {
    const msgs = await chat.messages(conv.id);
    const parts = await chat.participants(conv.id);
    const convertedRef = conv.convertedLeadId ? await leadRefOf(conv.convertedLeadId) : null;
    return {
      id: conv.id,
      kind: 'CUSTOMER_SUPPORT' as const,
      leadId: conv.convertedLeadId ?? null,
      leadRef: (convertedRef && convertedRef !== 'SE' && convertedRef !== 'support') ? convertedRef : (conv.guestName ?? 'Support'),
      product: conv.productTitle ?? null,
      guestName: conv.guestName ?? null,
      guestEmail: conv.guestEmail ?? null,
      guestPhone: conv.guestPhone ?? null,
      customerId: conv.customerId ?? null,
      convertedLeadId: conv.convertedLeadId ?? null,
      convertedLeadRef: (convertedRef && convertedRef !== 'SE' && convertedRef !== 'support') ? convertedRef : null,
      linkedLeadId: conv.linkedLeadId ?? null,
      linkedOrderId: conv.linkedOrderId ?? null,
      source: conv.source ?? null,
      assignedTo: conv.assignedTo,
      assignedToName: conv.assignedTo ? names().get(conv.assignedTo) ?? null : null,
      canConvert: !conv.convertedLeadId,
      quotes: [],
      suggestedQuoteId: null,
      participants: parts
        .filter((p: any) => {
          const member = users.byId(p.user_id);
          return !(member && isChinaRole(member.role));
        })
        .map((p: any) => ({
          userId: p.user_id, name: names().get(p.user_id) ?? 'Staff',
          lastReadAt: p.last_read_at, lastReadMessageId: p.last_read_message_id,
        })),
      messages: await Promise.all(msgs.map(async (m) => {
        const row = await presentMessage(u, 'support', [], m);
        const kind = row.authorKind;
        return {
          ...row,
          senderName: kind === 'system' ? 'Source Easy'
            : (kind === 'guest' || kind === 'customer') ? (conv.guestName || 'Customer')
            : row.senderName,
        };
      })),
      canSeeSupplier: false,
    };
  };
  const presentConversation = async (u: User, conv: any) => {
    if (isSupportConv(conv)) return presentSupport(u, conv);
    const lead = await leads.get(requireLeadId(conv.leadId));
    const ref = String(lead?.leadRef ?? 'SE');
    const list = await quotes.list(requireLeadId(conv.leadId));
    const msgs = await chat.messages(conv.id);
    const parts = await chat.participants(conv.id);
    const s = sides(u.role);
    const showCustomer = s.india && perms.can(u, 'chat.see_customer_fields');
    const showSupplier = (s.china || u.role === 'MARKETPLACE_TEAM') && perms.can(u, 'chat.see_supplier_fields');
    return {
      id: conv.id,
      leadId: conv.leadId,
      leadRef: ref,
      product: lead?.productInterest ?? null,
      clientName: showCustomer ? (lead?.clientName ?? null) : null,
      assignedTo: conv.assignedTo,
      assignedToName: conv.assignedTo ? names().get(conv.assignedTo) ?? null : null,
      participants: parts.map((p: any) => ({
        userId: p.user_id, name: names().get(p.user_id) ?? 'Staff',
        lastReadAt: p.last_read_at, lastReadMessageId: p.last_read_message_id,
      })),
      quotes: pickerItems(ref, list, uploads),
      suggestedQuoteId: suggestedQuoteId(list),
      messages: await Promise.all(msgs.map((m) => presentMessage(u, ref, list, m))),
      // showSupplier is reserved for future header context; quote cards never include supplier.
      canSeeSupplier: showSupplier,
    };
  };
  const notifyChat = async (conv: { id: string; leadId: string | null; kind?: string }, by: User, preview: string) => {
    if (isSupportConv(conv)) {
      const parts = await chat.participants(conv.id);
      const ids = parts.map((p: any) => String(p.user_id)).filter((id: string) => {
        if (id === by.id) return false;
        const member = users.byId(id);
        return !!member && canAccessSupportInbox(member);
      });
      if (!ids.length) return;
      await assign.notify(ids, {
        leadId: null, leadRef: 'Support', product: null, kind: 'CHAT_MESSAGE', office: 'INDIA',
        byName: by.name, detail: preview.slice(0, 140), conversationId: conv.id,
      });
      return;
    }
    const lead = await leads.get(requireLeadId(conv.leadId));
    const ref = String(lead?.leadRef ?? 'SE');
    const product = (lead?.productInterest as string | undefined) ?? null;
    const parts = await chat.participants(conv.id);
    const ids = parts.map((p: any) => String(p.user_id)).filter((id: string) => id !== by.id);
    if (!ids.length) return;
    const asg = await assign.get(requireLeadId(conv.leadId));
    const office = (asg?.ownerOffice ?? 'INDIA') as 'INDIA' | 'CHINA';
    await assign.notify(ids, {
      leadId: conv.leadId, leadRef: ref, product, kind: 'CHAT_MESSAGE', office, byName: by.name,
      detail: preview.slice(0, 140),
    });
  };
  const live = (leadId: string | null, conversationId: string, sub: string, extra: Rec = {}) => {
    liveData({ type: 'chat', leadId, conversationId, sub, ...extra });
  };

  api.get('/api/chat/status', async (req) => {
    const u = req.user!;
    return { data: { enabled: perms.can(u, 'chat.view_own') || perms.can(u, 'chat.view_team') || perms.can(u, 'chat.view_all') } };
  });

  api.get('/api/chat/inboxes', async (req) => {
    requireChat(req.user!);
    return { data: await chat.listInboxes(req.user!) };
  });

  api.get<{ Params: { id: string } }>('/api/chat/inboxes/:id/conversations', async (req) => {
    requireChat(req.user!);
    const list = await chat.listConversations(req.user!, req.params.id);
    const out = [];
    for (const c of list) {
      if (isSupportConv(c)) {
        if (!canAccessSupportInbox(req.user!)) continue;
        const last = (await chat.messages(c.id)).at(-1);
        out.push({
          ...c,
          leadRef: c.guestName || 'Support',
          product: c.productTitle ?? null,
          lastBody: last ? String(last.body ?? '').slice(0, 140) : null,
          lastAt: last?.created_at ?? c.lastMessageAt,
          assignedToName: c.assignedTo ? names().get(c.assignedTo) ?? null : null,
        });
        continue;
      }
      if (!(await canReadLead(req.user!, requireLeadId(c.leadId)))) continue;
      const lead = await leads.get(requireLeadId(c.leadId));
      const last = (await chat.messages(c.id)).at(-1);
      out.push({
        ...c,
        leadRef: lead?.leadRef ?? null,
        product: lead?.productInterest ?? null,
        lastBody: last ? String(last.body ?? '').slice(0, 140) : null,
        lastAt: last?.created_at ?? c.lastMessageAt,
        assignedToName: c.assignedTo ? names().get(c.assignedTo) ?? null : null,
      });
    }
    return { data: out };
  });

  api.get<{ Params: { id: string } }>('/api/chat/conversations/:id', async (req) => {
    const conv = await guard(req.user!, req.params.id);
    return { data: await presentConversation(req.user!, conv) };
  });

  api.post<{ Params: { id: string } }>('/api/leads/:id/chat', async (req) => {
    const u = req.user!;
    need(u, 'chat.view_own');
    const leadId = await d.attLead(req as any);
    const lead = await leads.get(leadId);
    if (!lead) throw Object.assign(new Error('Not found'), { status: 404 });
    const asg = await assign.get(leadId);
    const conv = await chat.ensureForLead(u, { id: leadId, leadRef: lead.leadRef as any, productInterest: lead.productInterest as any, assignedOffice: lead.assignedOffice as any }, asg);
    live(leadId, conv.id, 'opened');
    const full = await chat.get(conv.id);
    return { data: { created: conv.created, ...(await presentConversation(u, full!)) } };
  });

  api.get<{ Params: { id: string } }>('/api/leads/:id/chat', async (req) => {
    const u = req.user!;
    need(u, 'chat.view_own');
    const leadId = await d.attLead(req as any);
    const existing = await chat.byLead(leadId);
    const lead = await leads.get(leadId);
    const ref = String(lead?.leadRef ?? 'SE');
    const list = await quotes.list(leadId);
    if (!existing || !(await chat.canAccessId(u, existing.id, leadId))) {
      return { data: { enabled: true, conversationId: null, quotes: pickerItems(ref, list, uploads), suggestedQuoteId: suggestedQuoteId(list), messages: [], participants: [] } };
    }
    return { data: { enabled: true, conversationId: existing.id, ...(await presentConversation(u, existing)) } };
  });

  const postText = async (req: FastifyRequest<{ Params: { id: string }; Body?: { content?: string; quoteId?: string; cannedId?: string; internal?: boolean } }>, conversationId: string) => {
    const u = req.user!;
    const conv = await guard(u, conversationId);
    let content = String(req.body?.content ?? '');
    if (req.body?.cannedId) {
      const c = (await chat.canned()).find((x) => x.id === req.body!.cannedId);
      if (!c) throw Object.assign(new Error('Canned reply not found'), { status: 404 });
      content = c.body;
    }
    if (isSupportConv(conv)) {
      const internal = req.body?.internal === true;
      await chat.addParticipant(conv.id, u.id, u.id);
      const m = await chat.post(conv.id, u.id, content, 'text', null, { authorKind: 'staff', visibility: internal ? 'staff_only' : 'customer' });
      await chat.markRead(conv.id, u.id, m.id);
      live(null, conv.id, 'message', { messageId: m.id, kind: 'CUSTOMER_SUPPORT', preview: content.slice(0, 140), userId: u.id, visibility: internal ? 'staff_only' : 'customer' });
      if (!internal) await notifyChat(conv, u, content);
      return { data: await presentMessage(u, 'support', [], { ...m, sender_id: m.senderId, body: m.body, created_at: m.createdAt, quote_id: m.quoteId, kind: m.kind, author_kind: m.authorKind, visibility: m.visibility }) };
    }
    const list = await quotes.list(requireLeadId(conv.leadId));
    const tag = req.body?.quoteId ? suggestedQuoteId(list, String(req.body.quoteId)) : null;
    const m = await chat.post(conv.id, u.id, content, 'text', tag);
    await chat.markRead(conv.id, u.id, m.id);
    live(conv.leadId, conv.id, 'message', { messageId: m.id, leadRef: await leadRefOf(conv.leadId), preview: content.slice(0, 140), userId: u.id });
    await notifyChat(conv, u, content);
    const ref = await leadRefOf(conv.leadId);
    return { data: await presentMessage(u, ref, list, { ...m, sender_id: m.senderId, body: m.body, created_at: m.createdAt, quote_id: m.quoteId, kind: m.kind }) };
  };

  api.post<{ Params: { id: string }; Body: { content?: string; quoteId?: string; cannedId?: string } }>('/api/chat/conversations/:id/messages', async (req, reply) => {
    if ((req as any).isMultipart?.()) {
      const u = req.user!;
      if (!perms.can(u, 'chat.send_attachments')) throw Object.assign(new Error('You do not have permission: chat.send_attachments'), { status: 403 });
      const conv = await guard(u, req.params.id);
      const mpart = await d.readMultipart(req, 5);
      if (mpart.err) return reply.code(mpart.err.status).send({ error: mpart.err.error, code: mpart.err.code });
      await d.stripImageMetadata(mpart.files);
      const content = String(mpart.fields?.content ?? req.body?.content ?? '');
      if (isSupportConv(conv)) {
        const internal = String(mpart.fields?.internal ?? '') === 'true';
        await chat.addParticipant(conv.id, u.id, u.id);
        const msg = await chat.post(conv.id, u.id, content || ' ', 'text', null, { authorKind: 'staff', visibility: internal ? 'staff_only' : 'customer' });
        uploads.commit(chatFileKey(msg.id), mpart.files, u.id);
        await chat.markRead(conv.id, u.id, msg.id);
        live(null, conv.id, 'message', { messageId: msg.id, kind: 'CUSTOMER_SUPPORT', preview: (content || 'Attachment').slice(0, 140), userId: u.id, visibility: internal ? 'staff_only' : 'customer' });
        if (!internal) await notifyChat(conv, u, content || 'Attachment');
        const row = { ...msg, sender_id: msg.senderId, body: msg.body, created_at: msg.createdAt, quote_id: msg.quoteId, kind: msg.kind, author_kind: msg.authorKind, visibility: msg.visibility };
        return { data: await presentMessage(u, 'support', [], row) };
      }
      const list = await quotes.list(requireLeadId(conv.leadId));
      const tag = mpart.fields?.quoteId ? suggestedQuoteId(list, String(mpart.fields.quoteId)) : null;
      const msg = await chat.post(conv.id, u.id, content || ' ', 'text', tag);
      const ref = await leadRefOf(conv.leadId);
      uploads.commit(chatFileKey(msg.id), mpart.files, u.id);
      // Rename in manifest is already redacted at read time.
      await chat.markRead(conv.id, u.id, msg.id);
      live(conv.leadId, conv.id, 'message', { messageId: msg.id, leadRef: ref, preview: (content || 'Attachment').slice(0, 140), userId: u.id });
      await notifyChat(conv, u, content || 'Attachment');
      const row = { ...msg, sender_id: msg.senderId, body: msg.body, created_at: msg.createdAt, quote_id: msg.quoteId, kind: msg.kind };
      return { data: await presentMessage(u, ref, list, row) };
    }
    return postText(req as any, req.params.id);
  });

  api.post<{ Params: { id: string }; Body: { content?: string; quoteId?: string; cannedId?: string } }>('/api/leads/:id/chat/messages', async (req) => {
    const u = req.user!;
    need(u, 'chat.view_own');
    const leadId = await d.attLead(req as any);
    const asg = await assign.get(leadId);
    const lead = await leads.get(leadId);
    const conv = await chat.ensureForLead(u, { id: leadId, leadRef: lead?.leadRef as any, productInterest: lead?.productInterest as any, assignedOffice: lead?.assignedOffice as any }, asg);
    return postText(req as any, conv.id);
  });

  const attachRef = async (u: User, conversationId: string, quoteId?: string) => {
    if (!perms.can(u, 'chat.reference_quotes')) throw Object.assign(new Error('You do not have permission: chat.reference_quotes'), { status: 403 });
    const conv = await guard(u, conversationId);
    if (isSupportConv(conv)) throw Object.assign(new Error('Quote references are only for lead chats'), { status: 400 });
    const list = await quotes.list(requireLeadId(conv.leadId));
    const qid = suggestedQuoteId(list, quoteId ?? null);
    if (!qid) throw Object.assign(new Error('No quote to attach'), { status: 400 });
    const ref = await leadRefOf(conv.leadId);
    const card = presentQuoteCard(ref, list, qid, uploads);
    if (!card) throw Object.assign(new Error('Quote not found'), { status: 404 });
    const m = await chat.post(conv.id, u.id, formatSafe(card), 'quote_reference', qid);
    await chat.markRead(conv.id, u.id, m.id);
    live(conv.leadId, conv.id, 'message', { messageId: m.id, leadRef: ref, preview: `Quote reference: ${card.quoteLabel}`, userId: u.id });
    await notifyChat(conv, u, `Quote reference: ${card.quoteLabel}`);
    return { data: await presentMessage(u, ref, list, { ...m, sender_id: m.senderId, body: m.body, created_at: m.createdAt, quote_id: m.quoteId, kind: m.kind }) };
  };
  const formatSafe = (card: { quoteLabel: string; leadRef: string; product: string; moq: string | null; carton: any }) =>
    [`Quote reference: ${card.quoteLabel}`, `SE ref: ${card.leadRef}`, card.product ? `Product: ${card.product}` : null, card.moq ? `MOQ: ${card.moq}` : null].filter(Boolean).join('\n');

  api.post<{ Params: { id: string }; Body: { quoteId?: string } }>('/api/chat/conversations/:id/quote-reference', async (req) =>
    attachRef(req.user!, req.params.id, req.body?.quoteId ? String(req.body.quoteId) : undefined));
  api.post<{ Params: { id: string }; Body: { quoteId?: string } }>('/api/leads/:id/chat/quote-reference', async (req) => {
    const u = req.user!;
    need(u, 'chat.reference_quotes');
    const leadId = await d.attLead(req as any);
    const asg = await assign.get(leadId);
    const lead = await leads.get(leadId);
    const conv = await chat.ensureForLead(u, { id: leadId, leadRef: lead?.leadRef as any, productInterest: lead?.productInterest as any, assignedOffice: lead?.assignedOffice as any }, asg);
    return attachRef(u, conv.id, req.body?.quoteId ? String(req.body.quoteId) : undefined);
  });

  api.get<{ Params: { id: string; mid: string; fid: string } }>('/api/chat/conversations/:id/messages/:mid/files/:fid', async (req, reply) => {
    const conv = await guard(req.user!, req.params.id);
    const f = uploads.file(chatFileKey(req.params.mid), req.params.fid);
    if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
    const ref = await leadRefOf(conv.leadId);
    const list = chat.messageFiles(req.params.mid);
    const idx = list.findIndex((x) => x.id === req.params.fid);
    const name = redactedFileName(ref, idx >= 0 ? idx + 1 : 1, f.meta.name);
    const inline = /^image\/(jpeg|png|webp)$|^application\/pdf$|^video\//.test(f.meta.mime);
    reply.header('content-type', f.meta.mime).header('cache-control', 'private, no-store')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(await import('node:fs').then((fs) => fs.createReadStream(f.path)));
  });

  api.post<{ Params: { id: string } }>('/api/chat/conversations/:id/read', async (req) => {
    const conv = await guard(req.user!, req.params.id);
    await chat.markRead(conv.id, req.user!.id);
    live(conv.leadId, conv.id, 'read', { userId: req.user!.id });
    return { data: { ok: true } };
  });

  api.post<{ Params: { id: string } }>('/api/chat/conversations/:id/typing', async (req) => {
    const conv = await guard(req.user!, req.params.id);
    live(conv.leadId, conv.id, 'typing', { userId: req.user!.id, name: req.user!.name });
    return { data: { ok: true } };
  });

  api.post<{ Params: { id: string }; Body: { userId?: string | null } }>('/api/chat/conversations/:id/assign', async (req) => {
    const u = req.user!;
    if (u.role !== 'SUPER_ADMIN' && !u.role.endsWith('ADMIN') && !perms.can(u, 'chat.view_team')) {
      throw Object.assign(new Error('You cannot assign this chat'), { status: 403 });
    }
    const conv = await guard(u, req.params.id);
    const uid = req.body?.userId ? String(req.body.userId) : null;
    if (uid && !users.byId(uid)) throw Object.assign(new Error('User not found'), { status: 404 });
    if (uid && isSupportConv(conv) && !canAccessSupportInbox(users.byId(uid)!)) {
      throw Object.assign(new Error('This person cannot be assigned to a customer support chat'), { status: 403 });
    }
    await chat.setAssigned(conv.id, uid);
    live(conv.leadId, conv.id, 'assign', { userId: uid, ...(isSupportConv(conv) ? { kind: 'CUSTOMER_SUPPORT' } : {}) });
    if (uid) {
      if (isSupportConv(conv)) {
        await assign.notify([uid], {
          leadId: null, leadRef: conv.guestName || 'Support', product: conv.productTitle ?? null,
          kind: 'CHAT_MESSAGE', office: 'INDIA', byName: u.name, detail: 'Chat assigned to you', conversationId: conv.id,
        });
      } else {
        const lead = await leads.get(requireLeadId(conv.leadId));
        await assign.notify([uid], {
          leadId: conv.leadId, leadRef: String(lead?.leadRef ?? 'SE'), product: (lead?.productInterest as string) ?? null,
          kind: 'CHAT_MESSAGE', office: (await assign.get(requireLeadId(conv.leadId)))?.ownerOffice ?? 'INDIA', byName: u.name, detail: 'Chat assigned to you',
        });
      }
    }
    return { data: await presentConversation(u, (await chat.get(conv.id))!) };
  });

  api.post<{ Params: { id: string }; Body: { userId?: string } }>('/api/chat/conversations/:id/participants', async (req) => {
    const u = req.user!;
    const conv = await guard(u, req.params.id);
    const uid = String(req.body?.userId ?? '');
    const added = users.byId(uid);
    if (!added) throw Object.assign(new Error('User not found'), { status: 404 });
    if (isSupportConv(conv) && !canAccessSupportInbox(added)) {
      throw Object.assign(new Error('China staff cannot join a customer support chat'), { status: 403 });
    }
    await chat.addParticipant(conv.id, uid, u.id);
    live(conv.leadId, conv.id, 'participants');
    return { data: await presentConversation(u, (await chat.get(conv.id))!) };
  });

  api.get<{ Querystring: { q?: string } }>('/api/chat/search', async (req) => {
    requireChat(req.user!);
    const q = String(req.query.q ?? '');
    return { data: await chat.search(req.user!, q, null) };
  });

  api.get('/api/chat/canned', async (req) => {
    requireChat(req.user!);
    return { data: await chat.canned() };
  });
  api.post<{ Body: { title?: string; body?: string } }>('/api/chat/canned', async (req, reply) => {
    need(req.user!, 'chat.manage_canned');
    return reply.code(201).send({ data: await chat.saveCanned(null, String(req.body?.title ?? ''), String(req.body?.body ?? ''), req.user!.id) });
  });
  api.patch<{ Params: { id: string }; Body: { title?: string; body?: string } }>('/api/chat/canned/:id', async (req) => {
    need(req.user!, 'chat.manage_canned');
    const cur = (await chat.canned()).find((c) => c.id === req.params.id);
    if (!cur) throw Object.assign(new Error('Canned reply not found'), { status: 404 });
    return { data: await chat.saveCanned(cur.id, String(req.body?.title ?? cur.title), String(req.body?.body ?? cur.body), req.user!.id) };
  });
  api.delete<{ Params: { id: string } }>('/api/chat/canned/:id', async (req, reply) => {
    need(req.user!, 'chat.manage_canned');
    await chat.removeCanned(req.params.id);
    return reply.code(204).send();
  });

  // ---- Custom roles + team inboxes (super admin) ----
  const superOnly = (u: User) => { if (u.role !== 'SUPER_ADMIN') throw Object.assign(new Error('Super admin only'), { status: 403 }); };

  api.get('/api/chat/roles', async (req) => { superOnly(req.user!); return { data: await roles.list() }; });
  api.post<{ Body: { name?: string; description?: string; permissions?: Record<string, boolean> } }>('/api/chat/roles', async (req, reply) => {
    superOnly(req.user!);
    const r = await roles.create(String(req.body?.name ?? ''), req.body?.description ?? null, req.user!.id, req.body?.permissions ?? {});
    liveData({ type: 'perms' });
    return reply.code(201).send({ data: r });
  });
  api.patch<{ Params: { id: string }; Body: { name?: string; description?: string | null } }>('/api/chat/roles/:id', async (req) => {
    superOnly(req.user!);
    return { data: await roles.update(req.params.id, req.body ?? {}) };
  });
  api.delete<{ Params: { id: string } }>('/api/chat/roles/:id', async (req, reply) => {
    superOnly(req.user!);
    await roles.remove(req.params.id);
    liveData({ type: 'perms' });
    return reply.code(204).send();
  });
  api.post<{ Params: { id: string }; Body: Record<string, boolean> }>('/api/chat/roles/:id/permissions', async (req) => {
    superOnly(req.user!);
    const r = await roles.setPermissions(req.params.id, req.body ?? {});
    liveData({ type: 'perms' });
    return { data: r };
  });
  api.post<{ Params: { id: string }; Body: { roleId?: string | null } }>('/api/users/:id/custom-role', async (req) => {
    superOnly(req.user!);
    await roles.assignUser(req.params.id, req.body?.roleId ?? null);
    liveData({ type: 'perms', id: req.params.id });
    return { data: { ok: true, customRoleId: req.body?.roleId ?? null } };
  });

  api.get('/api/chat/team-inboxes', async (req) => {
    superOnly(req.user!);
    const boxes = await chat.teamInboxes();
    const data = [];
    for (const b of boxes) {
      data.push({ id: b.id, slug: b.slug, name: b.name, kind: b.kind, memberIds: await chat.membersOf(b.id) });
    }
    return { data };
  });
  api.post<{ Params: { id: string }; Body: { userIds?: string[] } }>('/api/chat/team-inboxes/:id/members', async (req) => {
    superOnly(req.user!);
    const ids = Array.isArray(req.body?.userIds) ? req.body!.userIds!.map(String) : [];
    await chat.setTeamMembers(req.params.id, ids, req.user!.id);
    return { data: { ok: true } };
  });
}

export { ChatError };
