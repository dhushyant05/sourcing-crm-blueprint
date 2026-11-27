/**
 * Native India↔China staff chat. Conversations, inboxes, canned replies and quote
 * reference cards live in Source Easy's own PostgreSQL and are pushed over the
 * existing Redis/SSE bus. Quote cards are rendered per viewer; customer identity,
 * customer prices and supplier identity are never stored on a card and cannot be
 * revealed by a custom role or a per-person permission grant.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { UploadStore, Attachment } from './uploads.js';
import { quoteCarton, type Quote } from './quotes.js';
import type { CartonTotals } from './carton.js';
import type { Role } from './roles.js';
import { sides } from './roles.js';
import type { User } from './users.js';
import type { PermStore } from './permissions.js';
import type { Assignment, AssignStore, Office } from './assign.js';

export class ChatError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface QuoteReference {
  leadRef: string;
  quoteId: string;
  quoteLabel: string;
  product: string;
  moq: string | null;
  carton: {
    lengthCm: number | null; widthCm: number | null; heightCm: number | null;
    unitsPerCarton: number | null; cartonCount: number | null;
    cbmPerCarton: number | null; totalCbm: number | null;
  } | null;
  hasCoverPhoto: boolean;
  coverFileId: string | null;
}

export function buildQuoteReference(leadRef: string, quote: Quote, index: number, packing: CartonTotals | null, cover: Attachment | null): QuoteReference {
  return {
    leadRef,
    quoteId: quote.id,
    quoteLabel: `${leadRef}-Q${index + 1}`,
    product: quote.product,
    moq: quote.moq,
    carton: packing ? {
      lengthCm: packing.lengthCm, widthCm: packing.widthCm, heightCm: packing.heightCm,
      unitsPerCarton: packing.unitsPerCarton, cartonCount: packing.cartonCount,
      cbmPerCarton: packing.cbmPerCarton, totalCbm: packing.totalCbm,
    } : null,
    hasCoverPhoto: !!cover,
    coverFileId: cover?.id ?? null,
  };
}

export function formatQuoteReference(r: QuoteReference): string {
  const lines = [
    `Quote reference: ${r.quoteLabel}`,
    `SE ref: ${r.leadRef}`,
    r.product ? `Product: ${r.product}` : null,
    r.moq ? `MOQ: ${r.moq}` : null,
  ];
  if (r.carton) {
    const c = r.carton;
    const dims = c.lengthCm != null && c.widthCm != null && c.heightCm != null
      ? `${c.lengthCm} × ${c.widthCm} × ${c.heightCm} cm` : null;
    const cartons = c.cartonCount != null ? `${c.cartonCount} carton${c.cartonCount === 1 ? '' : 's'}` : null;
    const cbm = c.totalCbm != null ? `${c.totalCbm} CBM` : (c.cbmPerCarton != null ? `${c.cbmPerCarton} CBM/carton` : null);
    const pack = [dims, c.unitsPerCarton != null ? `${c.unitsPerCarton}/carton` : null, cartons, cbm].filter(Boolean).join(' · ');
    if (pack) lines.push(`Carton / CBM: ${pack}`);
  }
  return lines.filter(Boolean).join('\n');
}

/** Last-line guard: a quote card must never carry private fields. */
export function assertSafeQuoteReference(v: unknown): QuoteReference {
  if (!v || typeof v !== 'object') throw new ChatError('Invalid quote reference', 500);
  const o = v as Record<string, unknown>;
  const forbidden = [
    'clientName', 'contactPhone', 'contactEmail', 'customer', 'customerName', 'contactName',
    'unitPrice', 'currency', 'clientPrice', 'clientCurrency', 'cq', 'cqTotals',
    'supplier', 'supplierId', 'supplierName', 'price', 'prices', 'notes',
    'shipCost', 'shipCurrency',
  ];
  for (const k of forbidden) if (k in o) throw new ChatError('Quote reference contained a private field', 500);
  if (typeof o.leadRef !== 'string' || typeof o.quoteId !== 'string' || typeof o.quoteLabel !== 'string' || typeof o.product !== 'string') {
    throw new ChatError('Invalid quote reference', 500);
  }
  return o as unknown as QuoteReference;
}

export function pickCover(files: Attachment[]): Attachment | null {
  const imgs = files.filter((f) => /^image\//.test(f.mime) && f.kind !== 'INVOICE');
  return imgs.find((f) => f.isCover) ?? imgs[0] ?? null;
}

export function suggestedQuoteId(quotes: Quote[], preferredId?: string | null): string | null {
  if (preferredId && quotes.some((q) => q.id === preferredId)) return preferredId;
  if (quotes.length === 0) return null;
  return [...quotes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0]!.id;
}

export const qUploadKey = (id: string) => `q_${id.replace(/-/g, '')}`.slice(0, 64);
export const chatFileKey = (messageId: string) => `cm_${messageId.replace(/-/g, '')}`.slice(0, 64);

export const SUPPORT_INBOX = 'inbox-customer-support';

export const TEAM_INBOXES = {
  INDIA: 'inbox-india',
  CHINA: 'inbox-china',
  MARKETPLACE: 'inbox-marketplace',
  SUPPORT: SUPPORT_INBOX,
} as const;

export function isChinaRole(role: string) {
  return role.startsWith('CHINA');
}

/** India team, Marketplace Team and super admin. Never China or suppliers. */
export function canAccessSupportInbox(u: { role: string }) {
  if (!u || isChinaRole(u.role) || u.role === 'SUPPLIER') return false;
  return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM' || u.role.startsWith('INDIA');
}

export function officeTeamInbox(role: Role): string | null {
  if (role === 'MARKETPLACE_TEAM') return TEAM_INBOXES.MARKETPLACE;
  if (role.startsWith('INDIA')) return TEAM_INBOXES.INDIA;
  if (role.startsWith('CHINA')) return TEAM_INBOXES.CHINA;
  return null;
}

export function redactedFileName(leadRef: string, n: number, original: string): string {
  const ext = (/\.[A-Za-z0-9]{1,8}$/.exec(original)?.[0] ?? '').toLowerCase();
  return `${leadRef}-chat-${n}${ext}`;
}

type LeadLite = { id: string; leadRef?: string | null; productInterest?: string | null; assignedOffice?: string | null };

export class ChatStore {
  constructor(
    private db: Db,
    private perms: PermStore,
    private uploads: UploadStore,
    private assign: AssignStore,
  ) {}

  can(u: User, key: string) { return this.perms.can(u, key); }

  async ensurePersonalInbox(userId: string, name: string): Promise<string> {
    const existing = await this.db.get('SELECT id FROM chat_inboxes WHERE kind = ? AND owner_user_id = ?', 'PERSONAL', userId);
    if (existing) return String(existing.id);
    const id = randomUUID();
    try {
      await this.db.run(
        "INSERT INTO chat_inboxes (id, slug, name, kind, owner_user_id) VALUES (?,?,?,?,?)",
        id, `person-${userId.slice(0, 8)}`, name || 'My inbox', 'PERSONAL', userId,
      );
      await this.db.run('INSERT INTO chat_inbox_members (inbox_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', id, userId);
      return id;
    } catch {
      const again = await this.db.get('SELECT id FROM chat_inboxes WHERE kind = ? AND owner_user_id = ?', 'PERSONAL', userId);
      if (!again) throw new ChatError('Could not create a personal inbox', 500);
      return String(again.id);
    }
  }

  async ensureOfficeMembership(u: User, by: string | null = null) {
    const inbox = officeTeamInbox(u.role);
    if (!inbox) return;
    await this.db.run('INSERT INTO chat_inbox_members (inbox_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', inbox, u.id, by);
  }

  async bootstrapUser(u: User) {
    await this.ensurePersonalInbox(u.id, u.name);
    await this.ensureOfficeMembership(u);
    if (canAccessSupportInbox(u)) {
      await this.db.run(
        "INSERT INTO chat_inboxes (id, slug, name, kind) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING",
        SUPPORT_INBOX, 'customer-support', 'Customer support', 'TEAM',
      );
      await this.db.run(
        'INSERT INTO chat_inbox_members (inbox_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING',
        SUPPORT_INBOX, u.id, null,
      );
    }
  }

  async listInboxes(u: User) {
    await this.bootstrapUser(u);
    const rows = await this.db.all(
      `SELECT i.*, (SELECT COUNT(*)::int FROM chat_participants p
         JOIN chat_conversations c ON c.id = p.conversation_id
         JOIN chat_conversation_inboxes ci ON ci.conversation_id = c.id AND ci.inbox_id = i.id
         LEFT JOIN chat_messages m ON m.conversation_id = c.id
         WHERE (i.kind = 'PERSONAL' AND p.user_id = ?)
            OR (i.kind = 'TEAM' AND ci.inbox_id = i.id)
        ) AS rough
       FROM chat_inboxes i
       WHERE (i.kind = 'PERSONAL' AND i.owner_user_id = ?)
          OR (i.kind = 'TEAM' AND EXISTS (SELECT 1 FROM chat_inbox_members m WHERE m.inbox_id = i.id AND m.user_id = ?))
       ORDER BY i.kind DESC, i.name`,
      u.id, u.id, u.id,
    );
    const out = [];
    for (const r of rows) {
      if (r.id === SUPPORT_INBOX && !canAccessSupportInbox(u)) continue;
      if (r.kind === 'TEAM' && !this.can(u, 'chat.view_team') && !this.can(u, 'chat.view_all') && u.role !== 'SUPER_ADMIN') continue;
      const unread = await this.inboxUnread(u, String(r.id), r.kind);
      const members = r.kind === 'TEAM'
        ? await this.db.all('SELECT user_id FROM chat_inbox_members WHERE inbox_id = ?', r.id)
        : [];
      out.push({
        id: r.id, slug: r.slug, name: r.kind === 'PERSONAL' ? 'My inbox' : r.name, kind: r.kind,
        unread, memberIds: members.map((m: any) => String(m.user_id)),
      });
    }
    return out;
  }

  private async inboxUnread(u: User, inboxId: string, kind: string): Promise<number> {
    if (kind === 'PERSONAL') {
      const r = await this.db.get<{ c: number }>(
        `SELECT COUNT(*)::int c FROM chat_messages m
         JOIN chat_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
         WHERE (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
           AND (m.sender_id IS NULL OR m.sender_id <> ?)`,
        u.id, u.id,
      );
      return r?.c ?? 0;
    }
    // Team: unread across conversations in this inbox that the user may see.
    const convs = await this.conversationsForInbox(u, inboxId);
    return convs.reduce((n, c) => n + (c.unread ?? 0), 0);
  }

  private async conversationsForInbox(u: User, inboxId: string) {
    const inbox = await this.db.get('SELECT * FROM chat_inboxes WHERE id = ?', inboxId);
    if (!inbox) throw new ChatError('Inbox not found', 404);
    if (inbox.kind === 'PERSONAL' && inbox.owner_user_id !== u.id && u.role !== 'SUPER_ADMIN' && !this.can(u, 'chat.view_all')) {
      throw new ChatError('Inbox not found', 404);
    }
    if (inbox.id === SUPPORT_INBOX && !canAccessSupportInbox(u)) throw new ChatError('Inbox not found', 404);
    if (inbox.kind === 'TEAM') {
      const mem = await this.db.get('SELECT 1 FROM chat_inbox_members WHERE inbox_id = ? AND user_id = ?', inboxId, u.id);
      if (!mem && !this.can(u, 'chat.view_all')) throw new ChatError('Inbox not found', 404);
      if (!this.can(u, 'chat.view_team') && !this.can(u, 'chat.view_all')) throw new ChatError('Inbox not found', 404);
    }
    let rows: any[];
    if (inbox.kind === 'PERSONAL') {
      rows = await this.db.all(
        `SELECT c.*, p.last_read_at FROM chat_conversations c
         JOIN chat_participants p ON p.conversation_id = c.id AND p.user_id = ?
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
        u.id,
      );
    } else {
      rows = await this.db.all(
        `SELECT c.*, p.last_read_at FROM chat_conversations c
         JOIN chat_conversation_inboxes ci ON ci.conversation_id = c.id AND ci.inbox_id = ?
         LEFT JOIN chat_participants p ON p.conversation_id = c.id AND p.user_id = ?
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
        inboxId, u.id,
      );
    }
    const out = [];
    for (const r of rows) {
      const kind = r.kind ?? 'LEAD';
      if (kind === 'CUSTOMER_SUPPORT' && !canAccessSupportInbox(u)) continue;
      const unread = await this.unreadCount(u.id, r.id, r.last_read_at ?? null);
      out.push({
        id: r.id,
        kind,
        leadId: r.lead_id ?? null,
        assignedTo: r.assigned_to,
        lastMessageAt: r.last_message_at,
        createdAt: r.created_at,
        unread,
        guestName: r.guest_name ?? null,
        customerId: r.customer_id ?? null,
        productTitle: r.product_title ?? null,
        convertedLeadId: r.converted_lead_id ?? null,
        linkedLeadId: r.linked_lead_id ?? null,
        source: r.source ?? null,
        guestEmail: r.guest_email ?? null,
        guestPhone: r.guest_phone ?? null,
      });
    }
    return out;
  }

  async unreadCount(userId: string, conversationId: string, lastReadAt: string | null): Promise<number> {
    const r = lastReadAt
      ? await this.db.get<{ c: number }>('SELECT COUNT(*)::int c FROM chat_messages WHERE conversation_id = ? AND created_at > ? AND (sender_id IS NULL OR sender_id <> ?)', conversationId, lastReadAt, userId)
      : await this.db.get<{ c: number }>('SELECT COUNT(*)::int c FROM chat_messages WHERE conversation_id = ? AND (sender_id IS NULL OR sender_id <> ?)', conversationId, userId);
    return r?.c ?? 0;
  }

  async listConversations(u: User, inboxId: string) {
    return this.conversationsForInbox(u, inboxId);
  }

  async search(u: User, q: string, allowedLeadIds: Set<string> | null) {
    const needle = q.trim().slice(0, 80);
    if (needle.length < 2) return [];
    const like = `%${needle.replace(/[%_]/g, '')}%`;
    const rows = await this.db.all(
      `SELECT m.id, m.conversation_id, m.body, m.kind, m.created_at, m.sender_id, c.lead_id, c.kind AS conv_kind,
              c.guest_name, c.product_title, l.lead_ref, l.product_interest, m.visibility
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE (m.body ILIKE ? OR l.lead_ref ILIKE ? OR l.product_interest ILIKE ? OR c.guest_name ILIKE ? OR c.product_title ILIKE ?)
       ORDER BY m.created_at DESC LIMIT 80`,
      like, like, like, like, like,
    );
    const out = [];
    for (const r of rows) {
      if ((r.conv_kind ?? 'LEAD') === 'CUSTOMER_SUPPORT' && !canAccessSupportInbox(u)) continue;
      if (r.lead_id && allowedLeadIds && !allowedLeadIds.has(String(r.lead_id))) continue;
      if (!(await this.canAccessId(u, String(r.conversation_id), r.lead_id ?? null))) continue;
      out.push({
        messageId: r.id, conversationId: r.conversation_id, leadId: r.lead_id ?? null,
        leadRef: r.lead_ref ?? r.guest_name, product: r.product_interest ?? r.product_title,
        kind: r.kind, body: String(r.body ?? '').slice(0, 240), at: r.created_at,
        convKind: r.conv_kind ?? 'LEAD',
      });
      if (out.length >= 40) break;
    }
    return out;
  }

  async canAccessId(u: User, conversationId: string, leadId?: string | null): Promise<boolean> {
    const row = await this.db.get('SELECT kind FROM chat_conversations WHERE id = ?', conversationId);
    const kind = row?.kind ?? (leadId ? 'LEAD' : 'CUSTOMER_SUPPORT');
    if (kind === 'CUSTOMER_SUPPORT') {
      if (!canAccessSupportInbox(u)) return false;
      if (this.can(u, 'chat.view_all') || u.role === 'SUPER_ADMIN') return true;
      if (this.can(u, 'chat.view_team')) {
        const team = await this.db.get(
          `SELECT 1 FROM chat_conversation_inboxes ci
           JOIN chat_inbox_members m ON m.inbox_id = ci.inbox_id AND m.user_id = ?
           WHERE ci.conversation_id = ?`,
          u.id, conversationId,
        );
        if (team) return true;
      }
      const part = await this.db.get('SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?', conversationId, u.id);
      return !!(part && this.can(u, 'chat.view_own'));
    }
    if (this.can(u, 'chat.view_all')) return true;
    const part = await this.db.get('SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?', conversationId, u.id);
    if (part && this.can(u, 'chat.view_own')) return true;
    if (this.can(u, 'chat.view_team')) {
      const team = await this.db.get(
        `SELECT 1 FROM chat_conversation_inboxes ci
         JOIN chat_inbox_members m ON m.inbox_id = ci.inbox_id AND m.user_id = ?
         WHERE ci.conversation_id = ?`,
        u.id, conversationId,
      );
      if (team) return true;
    }
    return false;
  }

  async get(conversationId: string) {
    const r = await this.db.get('SELECT * FROM chat_conversations WHERE id = ?', conversationId);
    return r ? {
      id: String(r.id),
      leadId: r.lead_id ? String(r.lead_id) : null,
      kind: (r.kind ?? 'LEAD') as 'LEAD' | 'CUSTOMER_SUPPORT',
      assignedTo: r.assigned_to as string | null,
      lastMessageAt: r.last_message_at,
      createdAt: r.created_at,
      visitorId: r.visitor_id ?? null,
      customerId: r.customer_id ?? null,
      guestName: r.guest_name ?? null,
      guestEmail: r.guest_email ?? null,
      guestPhone: r.guest_phone ?? null,
      productTitle: r.product_title ?? null,
      productId: r.product_id ?? null,
      convertedLeadId: r.converted_lead_id ?? null,
      linkedLeadId: r.linked_lead_id ?? null,
      linkedOrderId: r.linked_order_id ?? null,
      source: r.source ?? null,
    } : null;
  }

  async byLead(leadId: string) {
    const r = await this.db.get('SELECT * FROM chat_conversations WHERE lead_id = ?', leadId);
    return r ? {
      id: String(r.id),
      leadId: r.lead_id ? String(r.lead_id) : null,
      kind: (r.kind ?? 'LEAD') as 'LEAD' | 'CUSTOMER_SUPPORT',
      assignedTo: r.assigned_to as string | null,
      lastMessageAt: r.last_message_at,
      createdAt: r.created_at,
      visitorId: r.visitor_id ?? null,
      customerId: r.customer_id ?? null,
      guestName: r.guest_name ?? null,
      guestEmail: r.guest_email ?? null,
      guestPhone: r.guest_phone ?? null,
      productTitle: r.product_title ?? null,
      productId: r.product_id ?? null,
      convertedLeadId: r.converted_lead_id ?? null,
      linkedLeadId: r.linked_lead_id ?? null,
      linkedOrderId: r.linked_order_id ?? null,
      source: r.source ?? null,
    } : null;
  }

  async ensureForLead(u: User, lead: LeadLite, asg: Assignment | null): Promise<{ id: string; created: boolean }> {
    const existing = await this.byLead(lead.id);
    if (existing) {
      await this.syncParticipants(existing.id, lead, asg, u.id);
      return { id: existing.id, created: false };
    }
    if (!this.can(u, 'chat.start') && u.role !== 'SUPER_ADMIN') throw new ChatError('You cannot start a chat', 403);
    const id = randomUUID();
    await this.db.run('INSERT INTO chat_conversations (id, lead_id, created_at) VALUES (?,?,?)', id, lead.id, new Date().toISOString());
    await this.syncParticipants(id, lead, asg, u.id);
    await this.linkTeamInboxes(id, lead, asg);
    return { id, created: true };
  }

  async syncParticipants(conversationId: string, lead: LeadLite, asg: Assignment | null, actorId: string) {
    const ids = new Set<string>();
    if (asg?.raisedBy) ids.add(asg.raisedBy);
    if (asg?.assignedTo) ids.add(asg.assignedTo);
    ids.add(actorId);
    for (const uid of ids) {
      await this.db.run(
        'INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING',
        conversationId, uid, actorId,
      );
    }
    await this.linkTeamInboxes(conversationId, lead, asg);
  }

  async linkTeamInboxes(conversationId: string, lead: LeadLite, asg: Assignment | null) {
    const boxes = new Set<string>([TEAM_INBOXES.INDIA]);
    if (asg?.ownerOffice === 'CHINA' || lead.assignedOffice === 'CHINA') boxes.add(TEAM_INBOXES.CHINA);
    for (const inbox of boxes) {
      await this.db.run('INSERT INTO chat_conversation_inboxes (conversation_id, inbox_id) VALUES (?,?) ON CONFLICT DO NOTHING', conversationId, inbox);
    }
  }

  async addParticipant(conversationId: string, userId: string, by: string) {
    await this.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', conversationId, userId, by);
  }

  async participants(conversationId: string) {
    return this.db.all('SELECT user_id, added_at, last_read_at, last_read_message_id FROM chat_participants WHERE conversation_id = ?', conversationId);
  }

  async setAssigned(conversationId: string, userId: string | null) {
    await this.db.run('UPDATE chat_conversations SET assigned_to = ? WHERE id = ?', userId, conversationId);
    if (userId) await this.addParticipant(conversationId, userId, userId);
  }

  async markRead(conversationId: string, userId: string, messageId?: string | null) {
    const last = messageId ?? (await this.db.get('SELECT id FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', conversationId))?.id ?? null;
    await this.db.run(
      'UPDATE chat_participants SET last_read_at = now(), last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?',
      last, conversationId, userId,
    );
  }

  async messages(conversationId: string) {
    return this.db.all('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at, id', conversationId);
  }

  async post(conversationId: string, senderId: string | null, body: string, kind: 'text' | 'quote_reference' | 'system', quoteId: string | null, opts?: { authorKind?: string; visibility?: string }) {
    const text = body.trim();
    if (kind === 'text' && !text) throw new ChatError('Message cannot be empty', 400);
    if (text.length > 4000) throw new ChatError('Message is too long', 400);
    const id = randomUUID();
    const at = new Date().toISOString();
    const authorKind = opts?.authorKind ?? (senderId ? 'staff' : 'guest');
    const visibility = opts?.visibility ?? 'customer';
    await this.db.run(
      'INSERT INTO chat_messages (id, conversation_id, sender_id, kind, body, quote_id, created_at, author_kind, visibility) VALUES (?,?,?,?,?,?,?,?,?)',
      id, conversationId, senderId, kind, text, quoteId, at, authorKind, visibility,
    );
    await this.db.run('UPDATE chat_conversations SET last_message_at = ? WHERE id = ?', at, conversationId);
    return { id, conversationId, senderId, kind, body: text, quoteId, createdAt: at, authorKind, visibility };
  }

  messageFiles(messageId: string) { return this.uploads.list(chatFileKey(messageId)); }

  async canned() {
    return (await this.db.all('SELECT * FROM chat_canned_replies ORDER BY lower(title), id')).map((r: any) => ({
      id: r.id, title: r.title, body: r.body, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }
  async saveCanned(id: string | null, title: string, body: string, by: string) {
    const t = title.trim().slice(0, 80), b = body.trim().slice(0, 4000);
    if (!t || !b) throw new ChatError('Title and message are required', 400);
    const now = new Date().toISOString();
    if (id) {
      const n = await this.db.run('UPDATE chat_canned_replies SET title=?, body=?, updated_at=? WHERE id=?', t, b, now, id);
      if (!n) throw new ChatError('Canned reply not found', 404);
      return { id, title: t, body: b };
    }
    const nid = randomUUID();
    await this.db.run('INSERT INTO chat_canned_replies (id, title, body, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)', nid, t, b, by, now, now);
    return { id: nid, title: t, body: b };
  }
  async removeCanned(id: string) {
    const n = await this.db.run('DELETE FROM chat_canned_replies WHERE id = ?', id);
    if (!n) throw new ChatError('Canned reply not found', 404);
  }

  async teamInboxes() {
    return this.db.all("SELECT * FROM chat_inboxes WHERE kind = 'TEAM' ORDER BY name");
  }
  async membersOf(inboxId: string): Promise<string[]> {
    return (await this.db.all('SELECT user_id FROM chat_inbox_members WHERE inbox_id = ?', inboxId)).map((r: any) => String(r.user_id));
  }
  async setTeamMembers(inboxId: string, userIds: string[], by: string) {
    const inbox = await this.db.get("SELECT * FROM chat_inboxes WHERE id = ? AND kind = 'TEAM'", inboxId);
    if (!inbox) throw new ChatError('Team inbox not found', 404);
    if (inboxId === SUPPORT_INBOX) {
      for (const uid of userIds) {
        const row = await this.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', uid);
        if (!row || isChinaRole(row.role) || row.role === 'SUPPLIER') {
          throw new ChatError('China staff and suppliers cannot join the Customer support inbox', 403);
        }
      }
    }
    await this.db.tx(async (t) => {
      await t.run('DELETE FROM chat_inbox_members WHERE inbox_id = ?', inboxId);
      for (const uid of userIds) {
        await t.run('INSERT INTO chat_inbox_members (inbox_id, user_id, added_by) VALUES (?,?,?)', inboxId, uid, by);
      }
    });
  }

  async linkMarketplace(conversationId: string) {
    await this.db.run('INSERT INTO chat_conversation_inboxes (conversation_id, inbox_id) VALUES (?,?) ON CONFLICT DO NOTHING', conversationId, TEAM_INBOXES.MARKETPLACE);
  }
}

export function presentQuoteCard(leadRef: string, list: Quote[], quoteId: string, uploads: UploadStore): QuoteReference | null {
  const idx = list.findIndex((q) => q.id === quoteId);
  if (idx < 0) return null;
  const q = list[idx]!;
  const cover = pickCover(uploads.list(qUploadKey(q.id)));
  return assertSafeQuoteReference(buildQuoteReference(leadRef, q, idx, quoteCarton(q), cover));
}

export function pickerItems(leadRef: string, list: Quote[], uploads: UploadStore) {
  return list.map((q, i) => buildQuoteReference(leadRef, q, i, quoteCarton(q), pickCover(uploads.list(qUploadKey(q.id)))));
}
