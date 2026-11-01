/**
 * Lead ownership + in-app notifications (PostgreSQL). Ownership lives on the lead row:
 * raisedBy = staff user who created the lead (empty for public enquiries until an India admin sets it),
 * assignedTo = current owner (null = office queue), ownerOffice = which office currently holds the lead.
 * Notifications never store customer data: only the SE reference, product summary and the actor's name.
 * New notifications are published on Redis (`se:notif`) so every API process can push them to its SSE streams.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { Bus } from './bus.js';

export type Office = 'INDIA' | 'CHINA';
export interface Assignment { leadId: string; raisedBy: string | null; assignedTo: string | null; ownerOffice: Office | null; updatedAt: string }
export type NotifKind = 'ASSIGNED' | 'RETURNED' | 'QUEUE' | 'QUOTE_ACCEPTED' | 'QUOTE_REJECTED' | 'ORDER_NEW' | 'ORDER_UPDATE' | 'SHIPMENT_UPDATE' | 'ORDER_SHIPPED' | 'FOLLOW_UP' | 'REVISE_REQUESTED' | 'LEAD_CLOSED' | 'SLA_WARN' | 'SLA_BREACH' | 'PRIORITY';
export interface Notification { id: string; leadId: string; leadRef: string | null; product: string | null; kind: NotifKind; office: Office; byName: string | null; detail?: string | null; createdAt: string; read: boolean }
export const NOTIF_CHANNEL = 'se:notif';

const asg = (r: any): Assignment => ({ leadId: r.id, raisedBy: r.raised_by, assignedTo: r.assigned_to, ownerOffice: r.owner_office, updatedAt: r.assigned_at });
const notif = (r: any): Notification => ({ id: r.id, leadId: r.lead_id, leadRef: r.lead_ref, product: r.product, kind: r.kind, office: r.office, byName: r.by_name, detail: r.detail ?? null, createdAt: r.created_at, read: !!r.read_at });

export class AssignStore {
  private subs = new Map<string, Set<(n: Notification, unread: number) => void>>();
  constructor(private db: Db, private bus: Bus) {
    bus.subscribe(NOTIF_CHANNEL, (m: { userId: string; n: Notification; unread: number }) => {
      for (const f of this.subs.get(m.userId) ?? []) { try { f(m.n, m.unread); } catch { /* ignore a broken stream */ } }
    });
  }
  async get(leadId: string): Promise<Assignment | null> {
    const r = await this.db.get('SELECT id, raised_by, assigned_to, owner_office, assigned_at FROM leads WHERE id = ? AND assigned_at IS NOT NULL', leadId);
    return r ? asg(r) : null;
  }
  async all(): Promise<Map<string, Assignment>> {
    const rs = await this.db.all('SELECT id, raised_by, assigned_to, owner_office, assigned_at FROM leads WHERE assigned_at IS NOT NULL');
    return new Map(rs.map((r) => [r.id, asg(r)]));
  }
  async set(leadId: string, patch: Partial<Omit<Assignment, 'leadId' | 'updatedAt'>>): Promise<Assignment> {
    const cur = (await this.get(leadId)) ?? { leadId, raisedBy: null, assignedTo: null, ownerOffice: null, updatedAt: '' };
    const n = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    await this.db.run('UPDATE leads SET raised_by = ?, assigned_to = ?, owner_office = ?, assigned_at = ? WHERE id = ?', n.raisedBy, n.assignedTo, n.ownerOffice, n.updatedAt, leadId);
    return n;
  }
  async forgetLead(leadId: string) { await this.db.run('DELETE FROM notifications WHERE lead_id = ?', leadId); }
  /** A removed user owns nothing any more: their leads fall back to the office queue (lead data stays). */
  async forgetUser(userId: string) {
    await this.db.run('UPDATE leads SET assigned_to = NULL WHERE assigned_to = ?', userId);
    await this.db.run('DELETE FROM notifications WHERE user_id = ?', userId);
  }
  async notify(userIds: string[], n: Omit<Notification, 'id' | 'createdAt' | 'read'>) {
    const at = new Date().toISOString(), product = n.product?.slice(0, 120) ?? null;
    for (const u of new Set(userIds)) {
      const id = randomUUID();
      await this.db.run('INSERT INTO notifications (id,user_id,lead_id,lead_ref,product,kind,office,by_name,created_at,detail) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, u, n.leadId, n.leadRef, product, n.kind, n.office, n.byName, at, n.detail ?? null);
      const ev: Notification = { id, leadId: n.leadId, leadRef: n.leadRef, product, kind: n.kind, office: n.office, byName: n.byName, detail: n.detail ?? null, createdAt: at, read: false };
      await this.bus.publish(NOTIF_CHANNEL, { userId: u, n: ev, unread: await this.unreadOf(u) }).catch(() => undefined);
    }
  }
  /** Live listeners (SSE streams on this process) per user. */
  subscribe(userId: string, f: (n: Notification, unread: number) => void) {
    let s = this.subs.get(userId); if (!s) this.subs.set(userId, (s = new Set()));
    s.add(f); return () => { s.delete(f); if (!s.size) this.subs.delete(userId); };
  }
  async unreadOf(userId: string) { return (await this.db.get<{ c: number }>('SELECT COUNT(*)::int c FROM notifications WHERE user_id = ? AND read_at IS NULL', userId))!.c; }
  async list(userId: string, limit = 50): Promise<{ data: Notification[]; unread: number }> {
    const rows = await this.db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, seq DESC LIMIT ?', userId, limit);
    return { unread: await this.unreadOf(userId), data: rows.map(notif) };
  }
  async markRead(userId: string, id?: string) {
    const at = new Date().toISOString();
    if (id) return (await this.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL', at, userId, id)) > 0;
    return (await this.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', at, userId)) > 0;
  }
}
