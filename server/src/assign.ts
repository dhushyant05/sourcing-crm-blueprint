/**
 * Lead ownership + in-app notifications. Stored in the same SQLite DB as users (not in Twenty).
 * raisedBy = staff user who created the lead (empty for public enquiries until an India admin sets it),
 * assignedTo = current owner (null = office queue), ownerOffice = which office currently holds the lead.
 * Notifications never store customer data: only the SE reference, product summary and the actor's name.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Office = 'INDIA' | 'CHINA';
export interface Assignment { leadId: string; raisedBy: string | null; assignedTo: string | null; ownerOffice: Office | null; updatedAt: string }
export type NotifKind = 'ASSIGNED' | 'RETURNED' | 'QUEUE' | 'QUOTE_ACCEPTED' | 'QUOTE_REJECTED' | 'ORDER_NEW' | 'ORDER_UPDATE' | 'SHIPMENT_UPDATE' | 'ORDER_SHIPPED' | 'REVISE_REQUESTED' | 'LEAD_CLOSED' | 'SLA_WARN' | 'SLA_BREACH' | 'PRIORITY';
export interface Notification { id: string; leadId: string; leadRef: string | null; product: string | null; kind: NotifKind; office: Office; byName: string | null; createdAt: string; read: boolean }

export class AssignStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS lead_assignments (
      lead_id TEXT PRIMARY KEY, raised_by TEXT, assigned_to TEXT, owner_office TEXT, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS la_assigned ON lead_assignments(assigned_to);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, lead_id TEXT NOT NULL, lead_ref TEXT, product TEXT, kind TEXT NOT NULL,
      office TEXT NOT NULL, by_name TEXT, created_at TEXT NOT NULL, read_at TEXT);
    CREATE INDEX IF NOT EXISTS n_user ON notifications(user_id, created_at);`);
  }
  get(leadId: string): Assignment | null {
    const r = this.db.prepare('SELECT * FROM lead_assignments WHERE lead_id = ?').get(leadId) as any;
    return r ? { leadId: r.lead_id, raisedBy: r.raised_by, assignedTo: r.assigned_to, ownerOffice: r.owner_office, updatedAt: r.updated_at } : null;
  }
  all(): Map<string, Assignment> {
    const m = new Map<string, Assignment>();
    for (const r of this.db.prepare('SELECT * FROM lead_assignments').all() as any[])
      m.set(r.lead_id, { leadId: r.lead_id, raisedBy: r.raised_by, assignedTo: r.assigned_to, ownerOffice: r.owner_office, updatedAt: r.updated_at });
    return m;
  }
  set(leadId: string, patch: Partial<Omit<Assignment, 'leadId' | 'updatedAt'>>): Assignment {
    const cur = this.get(leadId) ?? { leadId, raisedBy: null, assignedTo: null, ownerOffice: null, updatedAt: '' };
    const n = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`INSERT INTO lead_assignments (lead_id, raised_by, assigned_to, owner_office, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(lead_id) DO UPDATE SET raised_by=excluded.raised_by, assigned_to=excluded.assigned_to, owner_office=excluded.owner_office, updated_at=excluded.updated_at`)
      .run(leadId, n.raisedBy, n.assignedTo, n.ownerOffice, n.updatedAt);
    return n;
  }
  /** A removed user owns nothing any more: their leads fall back to the office queue (lead data stays). */
  forgetLead(leadId: string) { this.db.prepare('DELETE FROM lead_assignments WHERE lead_id = ?').run(leadId); this.db.prepare('DELETE FROM notifications WHERE lead_id = ?').run(leadId); }
  forgetUser(userId: string) {
    this.db.prepare('UPDATE lead_assignments SET assigned_to = NULL WHERE assigned_to = ?').run(userId);
    this.db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  }
  notify(userIds: string[], n: Omit<Notification, 'id' | 'createdAt' | 'read'>) {
    const st = this.db.prepare('INSERT INTO notifications (id,user_id,lead_id,lead_ref,product,kind,office,by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const at = new Date().toISOString();
    for (const u of new Set(userIds)) {
      const id = randomUUID(); const product = n.product?.slice(0, 120) ?? null;
      st.run(id, u, n.leadId, n.leadRef, product, n.kind, n.office, n.byName, at);
      const subs = this.subs.get(u);
      if (subs?.size) { const unread = this.unreadOf(u); const ev = { id, leadId: n.leadId, leadRef: n.leadRef, product, kind: n.kind, office: n.office, byName: n.byName, createdAt: at, read: false };
        for (const f of subs) { try { f(ev, unread); } catch { /* ignore a broken stream */ } } }
    }
  }
  /** Live listeners (SSE streams) per user. */
  private subs = new Map<string, Set<(n: Notification, unread: number) => void>>();
  subscribe(userId: string, f: (n: Notification, unread: number) => void) {
    let s = this.subs.get(userId); if (!s) this.subs.set(userId, (s = new Set()));
    s.add(f); return () => { s!.delete(f); if (!s!.size) this.subs.delete(userId); };
  }
  unreadOf(userId: string) { return (this.db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as any).c as number; }
  list(userId: string, limit = 50): { data: Notification[]; unread: number } {
    const rows = this.db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(userId, limit) as any[];
    const unread = (this.db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as any).c as number;
    return { unread, data: rows.map((r) => ({ id: r.id, leadId: r.lead_id, leadRef: r.lead_ref, product: r.product, kind: r.kind, office: r.office, byName: r.by_name, createdAt: r.created_at, read: !!r.read_at })) };
  }
  markRead(userId: string, id?: string) {
    const at = new Date().toISOString();
    if (id) return this.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL').run(at, userId, id).changes > 0;
    return this.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(at, userId).changes > 0;
  }
}
