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
export const SUPPLIER_EMAIL_INBOX = 'inbox-supplier-email';

export const TEAM_INBOXES = {
  INDIA: 'inbox-india',
  CHINA: 'inbox-china',
  MARKETPLACE: 'inbox-marketplace',
  SUPPORT: SUPPORT_INBOX,
  SUPPLIER_EMAIL: SUPPLIER_EMAIL_INBOX,
} as const;

export function isChinaRole(role: string) {
  return role.startsWith('CHINA');
}

/** India team, Marketplace Team and super admin. Never China or suppliers. */
export function canAccessSupportInbox(u: { role: string }) {
  if (!u || isChinaRole(u.role) || u.role === 'SUPPLIER') return false;
  return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM' || u.role.startsWith('INDIA');
}

/** Supplier email (identity + contact details): China roles and super admin only. Never India, Marketplace or suppliers. */
export function canAccessSupplierEmail(u: { role: string } | null | undefined) {
  if (!u) return false;
  return u.role === 'SUPER_ADMIN' || isChinaRole(u.role);
}

export type ConvKind = 'LEAD' | 'CUSTOMER_SUPPORT' | 'SUPPLIER_EMAIL' | 'CHANNEL' | 'DM';
export type ConvClass = 'lead' | 'support' | 'supplier_email' | 'channel' | 'dm';
/** Conversation class. CHANNEL/DM must never fall through to "support" (those also have no lead). */
export function convClass(c: { kind?: string | null; leadId?: string | null }): ConvClass {
  if (c.kind === 'SUPPLIER_EMAIL') return 'supplier_email';
  if (c.kind === 'CHANNEL') return 'channel';
  if (c.kind === 'DM') return 'dm';
  if (c.kind === 'CUSTOMER_SUPPORT') return 'support';
  if (!c.kind && !c.leadId) return 'support';
  return 'lead';
}
export function isInternalConv(c: { kind?: string | null }) {
  return c.kind === 'CHANNEL' || c.kind === 'DM';
}
/** Staff who may take part in channels/DMs. Customers are portal users; suppliers are users but are never eligible. */
export function isInternalChatEligible(u: { role: string } | null | undefined) {
  return !!u && u.role !== 'SUPPLIER';
}
export type OfficeSide = 'INDIA' | 'CHINA' | 'MARKETPLACE';
export function officeSide(role: string): OfficeSide | null {
  if (role === 'SUPER_ADMIN') return null;
  if (role === 'MARKETPLACE_TEAM') return 'MARKETPLACE';
  if (role.startsWith('INDIA')) return 'INDIA';
  if (role.startsWith('CHINA')) return 'CHINA';
  return null;
}
export function conversationIsMixed(roles: (string | null | undefined)[]) {
  const sides = new Set<OfficeSide>();
  for (const r of roles) {
    const s = r ? officeSide(r) : null;
    if (s) sides.add(s);
  }
  return sides.size >= 2;
}

export const DEFAULT_CHANNELS = {
  ALL: { id: 'channel-all-staff', slug: 'all-staff', name: 'All staff' },
  INDIA: { id: 'channel-india-team', slug: 'india-team', name: 'India team' },
  CHINA: { id: 'channel-china-team', slug: 'china-team', name: 'China team' },
} as const;
export const MAX_GROUP_DM = 8;

export function dmKeyFor(ids: string[]) {
  return [...new Set(ids)].sort().join(':');
}
export function slugifyChannel(name: string) {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'channel';
}
/** May this user see desk conversations of this kind at all (role-level hard rule)? */
export function canAccessDeskKind(u: { role: string } | null | undefined, kind: string | null | undefined) {
  if (!u) return false;
  if (kind === 'SUPPLIER_EMAIL') return canAccessSupplierEmail(u);
  if (kind === 'CUSTOMER_SUPPORT') return canAccessSupportInbox(u);
  return true;
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
        id, `person-${userId}`, name || 'My inbox', 'PERSONAL', userId,
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
    await this.ensureDefaultChannels(u);
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
    if (canAccessSupplierEmail(u)) {
      await this.db.run(
        "INSERT INTO chat_inboxes (id, slug, name, kind) VALUES (?,?,?,?) ON CONFLICT (id) DO NOTHING",
        SUPPLIER_EMAIL_INBOX, 'supplier-email', 'Supplier email', 'TEAM',
      );
      await this.db.run(
        'INSERT INTO chat_inbox_members (inbox_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING',
        SUPPLIER_EMAIL_INBOX, u.id, null,
      );
    }
  }

  /**
   * The Customer support desk is the India side's front line: every India role, the Marketplace Team and
   * super admin with any chat permission may work it, even without `chat.view_team`. China and suppliers never.
   */
  supportDesk(u: User): boolean {
    if (!canAccessSupportInbox(u)) return false;
    return u.role === 'SUPER_ADMIN' || this.can(u, 'chat.view_own') || this.can(u, 'chat.view_team') || this.can(u, 'chat.view_all');
  }

  /** Same idea for the Supplier email desk: China roles (and super admin) with any chat permission. */
  supplierDesk(u: User): boolean {
    if (!canAccessSupplierEmail(u)) return false;
    return u.role === 'SUPER_ADMIN' || this.can(u, 'chat.view_own') || this.can(u, 'chat.view_team') || this.can(u, 'chat.view_all');
  }

  private deskInbox(u: User, inboxId: string) {
    return (inboxId === SUPPORT_INBOX && this.supportDesk(u)) || (inboxId === SUPPLIER_EMAIL_INBOX && this.supplierDesk(u));
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
      if (r.id === SUPPLIER_EMAIL_INBOX && !canAccessSupplierEmail(u)) continue;
      if (r.kind === 'TEAM' && !this.deskInbox(u, String(r.id)) && !this.can(u, 'chat.view_team') && !this.can(u, 'chat.view_all') && u.role !== 'SUPER_ADMIN') continue;
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
         JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE c.kind NOT IN ('CHANNEL', 'DM')
           AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
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
    if (inbox.id === SUPPLIER_EMAIL_INBOX && !canAccessSupplierEmail(u)) throw new ChatError('Inbox not found', 404);
    if (inbox.kind === 'TEAM') {
      const mem = await this.db.get('SELECT 1 FROM chat_inbox_members WHERE inbox_id = ? AND user_id = ?', inboxId, u.id);
      if (!mem && !this.can(u, 'chat.view_all')) throw new ChatError('Inbox not found', 404);
      if (!this.deskInbox(u, String(inbox.id)) && !this.can(u, 'chat.view_team') && !this.can(u, 'chat.view_all')) throw new ChatError('Inbox not found', 404);
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
      if (kind === 'CHANNEL' || kind === 'DM') continue;
      if (!canAccessDeskKind(u, kind)) continue;
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
        sourceSite: r.source_site ?? 'sourceeasy',
        guestEmail: r.guest_email ?? null,
        guestPhone: r.guest_phone ?? null,
        channel: r.channel ?? 'CHAT',
        emailSubject: r.email_subject ?? null,
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
              c.guest_name, c.product_title, c.title, l.lead_ref, l.product_interest, m.visibility
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE (m.body ILIKE ? OR l.lead_ref ILIKE ? OR l.product_interest ILIKE ? OR c.guest_name ILIKE ? OR c.product_title ILIKE ? OR c.title ILIKE ?)
         AND (m.visibility IS NULL OR m.visibility = 'customer')
       ORDER BY m.created_at DESC LIMIT 80`,
      like, like, like, like, like, like,
    );
    const out = [];
    for (const r of rows) {
      if (!canAccessDeskKind(u, r.conv_kind ?? 'LEAD')) continue;
      if (r.lead_id && allowedLeadIds && !allowedLeadIds.has(String(r.lead_id))) continue;
      if (!(await this.canAccessId(u, String(r.conversation_id), r.lead_id ?? null))) continue;
      out.push({
        messageId: r.id, conversationId: r.conversation_id, leadId: r.lead_id ?? null,
        leadRef: r.lead_ref ?? r.guest_name ?? r.title, product: r.product_interest ?? r.product_title ?? r.title,
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
    if (kind === 'CHANNEL' || kind === 'DM') {
      if (!isInternalChatEligible(u)) return false;
      if (kind === 'CHANNEL' && !this.can(u, 'chat.channels') && u.role !== 'SUPER_ADMIN') return false;
      if (kind === 'DM' && !this.can(u, 'chat.dm') && u.role !== 'SUPER_ADMIN') return false;
      const part = await this.db.get('SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?', conversationId, u.id);
      if (part) return true;
      if (kind === 'CHANNEL' && (u.role === 'SUPER_ADMIN' || this.can(u, 'chat.manage_channels') || this.can(u, 'chat.view_all'))) return true;
      if (kind === 'DM' && (u.role === 'SUPER_ADMIN' || this.can(u, 'chat.view_all'))) return true;
      return false;
    }
    if (kind === 'CUSTOMER_SUPPORT' || kind === 'SUPPLIER_EMAIL') {
      if (!canAccessDeskKind(u, kind)) return false;
      if (this.can(u, 'chat.view_all') || u.role === 'SUPER_ADMIN') return true;
      if (this.can(u, 'chat.view_team') || (kind === 'SUPPLIER_EMAIL' ? this.supplierDesk(u) : this.supportDesk(u))) {
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


  private mapConv(r: any) {
    return {
      id: String(r.id),
      leadId: r.lead_id ? String(r.lead_id) : null,
      kind: (r.kind ?? 'LEAD') as ConvKind,
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
      sourceSite: (r.source_site ?? 'sourceeasy') as string,
      channel: (r.channel ?? 'CHAT') as 'CHAT' | 'EMAIL',
      emailAddress: r.email_address ?? null,
      emailSubject: r.email_subject ?? null,
      emailMailbox: r.email_mailbox ?? null,
      supplierId: r.supplier_id ?? null,
      title: r.title ?? null,
      slug: r.slug ?? null,
      isMandatory: !!r.is_mandatory,
      isGroup: !!r.is_group,
      archivedAt: r.archived_at ?? null,
      createdBy: r.created_by ?? null,
      dmKey: r.dm_key ?? null,
    };
  }

  async get(conversationId: string) {
    const r = await this.db.get('SELECT * FROM chat_conversations WHERE id = ?', conversationId);
    return r ? this.mapConv(r) : null;
  }

  async byLead(leadId: string) {
    const r = await this.db.get('SELECT * FROM chat_conversations WHERE lead_id = ?', leadId);
    return r ? this.mapConv(r) : null;
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


  // ---- Internal channels and direct messages ----

  async ensureDefaultChannels(u: User) {
    if (!isInternalChatEligible(u)) return;
    for (const ch of Object.values(DEFAULT_CHANNELS)) {
      await this.db.run(
        `INSERT INTO chat_conversations (id, lead_id, kind, title, slug, is_mandatory, is_group, created_at)
         VALUES (?,?,?,?,?,?,?,now()) ON CONFLICT (id) DO NOTHING`,
        ch.id, null, 'CHANNEL', ch.name, ch.slug, true, true,
      );
    }
    const join = async (id: string) => {
      await this.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', id, u.id, null);
    };
    const leaveIfMandatory = async (id: string) => {
      // Drop auto-membership when the person's office no longer matches. Manual custom-channel membership is left alone.
      await this.db.run('DELETE FROM chat_participants WHERE conversation_id = ? AND user_id = ? AND added_by IS NULL', id, u.id);
    };
    if (this.can(u, 'chat.channels') || u.role === 'SUPER_ADMIN') await join(DEFAULT_CHANNELS.ALL.id);
    if (u.role.startsWith('INDIA')) await join(DEFAULT_CHANNELS.INDIA.id);
    else await leaveIfMandatory(DEFAULT_CHANNELS.INDIA.id);
    if (u.role.startsWith('CHINA')) await join(DEFAULT_CHANNELS.CHINA.id);
    else await leaveIfMandatory(DEFAULT_CHANNELS.CHINA.id);
  }

  defaultMandatoryFor(u: User, conv: { slug?: string | null; isMandatory?: boolean; kind?: string }) {
    if (conv.kind !== 'CHANNEL' || !conv.isMandatory) return false;
    if (conv.slug === DEFAULT_CHANNELS.ALL.slug) return true;
    if (conv.slug === DEFAULT_CHANNELS.INDIA.slug) return u.role.startsWith('INDIA');
    if (conv.slug === DEFAULT_CHANNELS.CHINA.slug) return u.role.startsWith('CHINA');
    return !!conv.isMandatory;
  }

  canManageChannels(u: User) {
    return u.role === 'SUPER_ADMIN' || this.can(u, 'chat.manage_channels');
  }

  async participantRoles(conversationId: string): Promise<{ userId: string; role: string; name: string }[]> {
    const rows = await this.db.all(
      `SELECT p.user_id, u.role, u.name FROM chat_participants p JOIN users u ON u.id = p.user_id WHERE p.conversation_id = ?`,
      conversationId,
    );
    return rows.map((r: any) => ({ userId: String(r.user_id), role: String(r.role), name: String(r.name) }));
  }

  async isMixed(conversationId: string) {
    const parts = await this.participantRoles(conversationId);
    return conversationIsMixed(parts.map((p) => p.role));
  }

  private async unreadOf(u: User, conversationId: string, lastReadAt: string | null) {
    return this.unreadCount(u.id, conversationId, lastReadAt);
  }

  private async lastMessage(conversationId: string) {
    return this.db.get('SELECT body, created_at, kind FROM chat_messages WHERE conversation_id = ? AND (visibility IS NULL OR visibility = ?) ORDER BY created_at DESC, id DESC LIMIT 1', conversationId, 'customer');
  }

  async listInternal(u: User, opts: { includeArchived?: boolean } = {}) {
    await this.bootstrapUser(u);
    const manage = this.canManageChannels(u);
    const archived = opts.includeArchived && manage ? '' : 'AND c.archived_at IS NULL';
    const channelRows = await this.db.all(
      `SELECT c.*, p.last_read_at FROM chat_conversations c
       LEFT JOIN chat_participants p ON p.conversation_id = c.id AND p.user_id = ?
       WHERE c.kind = 'CHANNEL' ${archived}
         AND (p.user_id IS NOT NULL OR ? = true)
       ORDER BY c.is_mandatory DESC, lower(c.title), c.id`,
      u.id, manage,
    );
    const dmRows = await this.db.all(
      `SELECT c.*, p.last_read_at FROM chat_conversations c
       JOIN chat_participants p ON p.conversation_id = c.id AND p.user_id = ?
       WHERE c.kind = 'DM' AND c.archived_at IS NULL
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      u.id,
    );
    const present = async (r: any) => {
      const conv = this.mapConv(r);
      const parts = await this.participantRoles(conv.id);
      const last = await this.lastMessage(conv.id);
      return {
        ...conv,
        members: parts.map((x) => ({ userId: x.userId, name: x.name, role: x.role })),
        mixed: conversationIsMixed(parts.map((x) => x.role)),
        unread: await this.unreadOf(u, conv.id, r.last_read_at ?? null),
        lastBody: last ? String(last.body ?? '').slice(0, 140) : null,
        lastAt: last?.created_at ?? conv.lastMessageAt,
        canLeave: this.canLeave(u, conv),
        isMember: parts.some((x) => x.userId === u.id),
      };
    };
    const canCh = this.can(u, 'chat.channels') || u.role === 'SUPER_ADMIN';
    const canDm = this.can(u, 'chat.dm') || u.role === 'SUPER_ADMIN';
    return {
      channels: canCh ? await Promise.all(channelRows.map(present)) : [],
      dms: canDm ? await Promise.all(dmRows.map(present)) : [],
    };
  }

  canLeave(u: User, conv: { kind?: string; slug?: string | null; isMandatory?: boolean; isGroup?: boolean }) {
    if (conv.kind === 'DM') return !!conv.isGroup;
    if (conv.kind !== 'CHANNEL') return false;
    return !this.defaultMandatoryFor(u, conv);
  }

  async createChannel(u: User, name: string, memberIds: string[], mandatory = false) {
    if (!this.canManageChannels(u)) throw new ChatError('You cannot manage channels', 403);
    const title = name.trim().slice(0, 80);
    if (title.length < 2) throw new ChatError('Please enter a channel name', 400);
    let slug = slugifyChannel(title);
    const id = randomUUID();
    for (let i = 0; i < 8; i++) {
      const clash = await this.db.get("SELECT 1 FROM chat_conversations WHERE kind = 'CHANNEL' AND slug = ? AND archived_at IS NULL", slug);
      if (!clash) break;
      slug = `${slugifyChannel(title)}-${i + 2}`;
    }
    const at = new Date().toISOString();
    await this.db.run(
      `INSERT INTO chat_conversations (id, lead_id, kind, title, slug, is_mandatory, is_group, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, null, 'CHANNEL', title, slug, !!mandatory, true, u.id, at,
    );
    const members = [...new Set([u.id, ...memberIds])];
    for (const uid of members) await this.addInternalMember(id, uid, u.id, { skipManage: true });
    await this.post(id, null, `${u.name} created #${title}`, 'system', null, { authorKind: 'system', visibility: 'customer' });
    return (await this.get(id))!;
  }

  async updateChannel(u: User, conversationId: string, patch: { title?: string; archived?: boolean }) {
    if (!this.canManageChannels(u)) throw new ChatError('You cannot manage channels', 403);
    const conv = await this.get(conversationId);
    if (!conv || conv.kind !== 'CHANNEL') throw new ChatError('Channel not found', 404);
    if (patch.title !== undefined) {
      const title = patch.title.trim().slice(0, 80);
      if (title.length < 2) throw new ChatError('Please enter a channel name', 400);
      if (conv.slug && Object.values(DEFAULT_CHANNELS).some((c) => c.slug === conv.slug) && title !== conv.title) {
        throw new ChatError('The default team channels cannot be renamed', 400);
      }
      await this.db.run('UPDATE chat_conversations SET title = ? WHERE id = ?', title, conv.id);
      if (title !== conv.title) await this.post(conv.id, null, `${u.name} renamed the channel to #${title}`, 'system', null, { authorKind: 'system', visibility: 'customer' });
    }
    if (patch.archived === true) {
      if (conv.slug && Object.values(DEFAULT_CHANNELS).some((c) => c.slug === conv.slug)) {
        throw new ChatError('The default team channels cannot be archived', 400);
      }
      await this.db.run('UPDATE chat_conversations SET archived_at = now() WHERE id = ?', conv.id);
      await this.post(conv.id, null, `${u.name} archived this channel`, 'system', null, { authorKind: 'system', visibility: 'customer' });
    }
    if (patch.archived === false) {
      await this.db.run('UPDATE chat_conversations SET archived_at = NULL WHERE id = ?', conv.id);
    }
    return (await this.get(conv.id))!;
  }

  async addInternalMember(conversationId: string, userId: string, by: string, opts: { skipManage?: boolean; user?: User } = {}) {
    const u = opts.user;
    const conv = await this.get(conversationId);
    if (!conv || !isInternalConv(conv)) throw new ChatError('Not found', 404);
    if (conv.archivedAt) throw new ChatError('This channel is archived', 400);
    const row = await this.db.get<{ role: string; name: string; active: boolean }>('SELECT role, name, active FROM users WHERE id = ?', userId);
    if (!row || !row.active) throw new ChatError('Person not found', 404);
    if (!isInternalChatEligible(row)) throw new ChatError('Customers and suppliers cannot join internal chats', 403);
    if (conv.kind === 'CHANNEL') {
      // membership itself does not require chat.channels (a manager can add someone who will then need the perm to open it)
    } else if (conv.kind === 'DM') {
      const count = (await this.db.get<{ c: number }>('SELECT COUNT(*)::int c FROM chat_participants WHERE conversation_id = ?', conversationId))?.c ?? 0;
      if (!conv.isGroup && count >= 2) throw new ChatError('Turn this into a group to add more people', 400);
      if (count >= MAX_GROUP_DM) throw new ChatError(`A group can have up to ${MAX_GROUP_DM} people`, 400);
      if (count >= 2 && !conv.isGroup) await this.db.run('UPDATE chat_conversations SET is_group = true WHERE id = ?', conversationId);
    }
    await this.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', conversationId, userId, by);
    const adder = u?.name ?? 'Staff';
    if (opts.skipManage) return;
    await this.post(conversationId, null, `${adder} added ${row.name}`, 'system', null, { authorKind: 'system', visibility: 'customer' });
  }

  async setChannelMembers(u: User, conversationId: string, userIds: string[]) {
    if (!this.canManageChannels(u)) throw new ChatError('You cannot manage channels', 403);
    const conv = await this.get(conversationId);
    if (!conv || conv.kind !== 'CHANNEL') throw new ChatError('Channel not found', 404);
    const wanted = new Set(userIds);
    // Mandatory default channels always keep their office members.
    if (conv.slug === DEFAULT_CHANNELS.ALL.slug) {
      const all = await this.db.all("SELECT id FROM users WHERE active IS TRUE AND role <> 'SUPPLIER'");
      for (const r of all) wanted.add(String(r.id));
    }
    if (conv.slug === DEFAULT_CHANNELS.INDIA.slug) {
      const all = await this.db.all("SELECT id FROM users WHERE active IS TRUE AND role LIKE 'INDIA%'");
      for (const r of all) wanted.add(String(r.id));
    }
    if (conv.slug === DEFAULT_CHANNELS.CHINA.slug) {
      const all = await this.db.all("SELECT id FROM users WHERE active IS TRUE AND role LIKE 'CHINA%'");
      for (const r of all) wanted.add(String(r.id));
    }
    const current = await this.db.all('SELECT user_id FROM chat_participants WHERE conversation_id = ?', conversationId);
    const have = new Set(current.map((r: any) => String(r.user_id)));
    for (const id of wanted) if (!have.has(id)) await this.addInternalMember(conversationId, id, u.id, { skipManage: true });
    for (const id of have) {
      if (wanted.has(id)) continue;
      const row = await this.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', id);
      if (row && this.defaultMandatoryFor({ ...(u as any), id, role: row.role } as User, conv)) continue;
      await this.db.run('DELETE FROM chat_participants WHERE conversation_id = ? AND user_id = ?', conversationId, id);
    }
  }

  async leaveInternal(u: User, conversationId: string) {
    const conv = await this.get(conversationId);
    if (!conv || !isInternalConv(conv)) throw new ChatError('Not found', 404);
    if (!this.canLeave(u, conv)) throw new ChatError('You cannot leave this conversation', 403);
    const part = await this.db.get('SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?', conversationId, u.id);
    if (!part) throw new ChatError('You are not in this conversation', 400);
    await this.db.run('DELETE FROM chat_participants WHERE conversation_id = ? AND user_id = ?', conversationId, u.id);
    await this.post(conversationId, null, `${u.name} left`, 'system', null, { authorKind: 'system', visibility: 'customer' });
  }

  async openDm(u: User, userIds: string[]) {
    if (!this.can(u, 'chat.dm') && u.role !== 'SUPER_ADMIN') throw new ChatError('You do not have permission: chat.dm', 403);
    const ids = [...new Set([u.id, ...userIds.map(String)])];
    if (ids.length < 2) throw new ChatError('Pick at least one person to message', 400);
    if (ids.length > MAX_GROUP_DM) throw new ChatError(`A group can have up to ${MAX_GROUP_DM} people`, 400);
    const people = [];
    for (const id of ids) {
      const row = await this.db.get<{ role: string; name: string; active: boolean }>('SELECT role, name, active FROM users WHERE id = ?', id);
      if (!row || !row.active) throw new ChatError('Person not found', 404);
      if (!isInternalChatEligible(row)) throw new ChatError('Customers and suppliers cannot join internal chats', 403);
      people.push({ id, ...row });
    }
    const isGroup = ids.length > 2;
    if (!isGroup) {
      const key = dmKeyFor(ids);
      const existing = await this.db.get("SELECT * FROM chat_conversations WHERE kind = 'DM' AND dm_key = ? AND archived_at IS NULL", key);
      if (existing) {
        await this.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', existing.id, u.id, u.id);
        return { conv: this.mapConv(existing), created: false };
      }
      const id = randomUUID();
      const at = new Date().toISOString();
      const other = people.find((x) => x.id !== u.id)!;
      await this.db.run(
        `INSERT INTO chat_conversations (id, lead_id, kind, title, is_mandatory, is_group, created_by, dm_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, null, 'DM', other.name, false, false, u.id, key, at,
      );
      for (const pid of ids) await this.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', id, pid, u.id);
      return { conv: (await this.get(id))!, created: true };
    }
    const id = randomUUID();
    const at = new Date().toISOString();
    const title = people.filter((x) => x.id !== u.id).map((x) => x.name).slice(0, 3).join(', ');
    await this.db.run(
      `INSERT INTO chat_conversations (id, lead_id, kind, title, is_mandatory, is_group, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, null, 'DM', title, false, true, u.id, at,
    );
    for (const pid of ids) await this.db.run('INSERT INTO chat_participants (conversation_id, user_id, added_by) VALUES (?,?,?) ON CONFLICT DO NOTHING', id, pid, u.id);
    await this.post(id, null, `${u.name} started a group chat`, 'system', null, { authorKind: 'system', visibility: 'customer' });
    return { conv: (await this.get(id))!, created: true };
  }

  async saveMentions(messageId: string, userIds: string[]) {
    for (const id of [...new Set(userIds)]) {
      await this.db.run('INSERT INTO chat_mentions (message_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', messageId, id);
    }
  }

  /** Resolve @Name tokens against participants (longest name first). Also accepts explicit ids. */
  resolveMentions(body: string, participants: { userId: string; name: string }[], explicit: string[] = []) {
    const ids = new Set(explicit.filter((id) => participants.some((p) => p.userId === id)));
    const named = [...participants].sort((a, b) => b.name.length - a.name.length);
    for (const p of named) {
      const re = new RegExp(`(^|[^\\w])@${p.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?=$|[^\\w])`, 'i');
      if (re.test(body)) ids.add(p.userId);
    }
    return [...ids];
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
