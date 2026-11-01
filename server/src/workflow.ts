/**
 * Lead workflow: an append-only event log (timeline) and the per-office SLA clock.
 * Stored in the same SQLite DB as users. Events carry a visibility tag so China never sees customer/India-price events
 * and India never sees supplier identity (supplier names live in `data.supplier`, stripped for India at read time).
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Office } from './assign.js';

export type Vis = 'ALL' | 'INDIA' | 'CHINA';
export type EventKind =
  | 'CREATED' | 'SUMMARY' | 'MEDIA_ADDED' | 'ASSIGNED' | 'REASSIGNED' | 'QUEUED' | 'RETURNED' | 'STATUS'
  | 'QUOTE_ADDED' | 'QUOTE_EDITED' | 'CQ_PREPARED' | 'CQ_SENT' | 'CQ_ACCEPTED' | 'CQ_REJECTED'
  | 'ORDER_CREATED' | 'ORDER_UPDATE' | 'SHIPPED' | 'SHIPMENT_UPDATE' | 'REVISE_REQUESTED' | 'LEAD_CLOSED' | 'REOPENED' | 'COPIED_TO' | 'CREATED_FROM' | 'CLOSED_PERMANENT' | 'FOLLOW_UP_SET' | 'FOLLOW_UP_DUE' | 'PRIORITY' | 'SLA_WARN' | 'SLA_BREACH';
export interface LeadEvent { id: string; leadId: string; at: string; kind: EventKind; actorId: string | null; actorName: string | null; actorOffice: Office | 'ADMIN' | null; data: Record<string, unknown>; vis: Vis }
export interface Clock { leadId: string; office: Office; assignee: string | null; startedAt: string; dueAt: string; priority: boolean; warned: boolean; breached: boolean }
export interface ClockRun { leadId: string; office: Office; assignee: string | null; startedAt: string; dueAt: string; endedAt: string; breached: boolean }
export interface SlaSettings { normalMinutes: number; priorityMinutes: number }
export const SLA_DEFAULT: SlaSettings = { normalMinutes: 5 * 60, priorityMinutes: 2 * 60 };

export interface LeadMeta { closedAt: string | null; closedBy: string | null; followUp: string | null; followUpBy: string | null; fromId: string | null; fromRef: string | null }
export class WorkflowStore {
  constructor(private db: DatabaseSync, private now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS lead_events (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT, actor_name TEXT, actor_office TEXT, data TEXT NOT NULL, vis TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS le_lead ON lead_events(lead_id, at);
    CREATE TABLE IF NOT EXISTS lead_clock (
      lead_id TEXT PRIMARY KEY, office TEXT NOT NULL, assignee TEXT, started_at TEXT NOT NULL, due_at TEXT NOT NULL, warned INTEGER NOT NULL DEFAULT 0, breached INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS lead_clock_runs (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, office TEXT NOT NULL, assignee TEXT, started_at TEXT NOT NULL, due_at TEXT NOT NULL, ended_at TEXT NOT NULL, breached INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lead_priority (lead_id TEXT PRIMARY KEY, priority INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lead_meta (lead_id TEXT PRIMARY KEY, closed_at TEXT, closed_by TEXT, follow_up TEXT, follow_up_by TEXT, follow_up_sent INTEGER NOT NULL DEFAULT 0, from_id TEXT, from_ref TEXT);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  private iso(ms = this.now()) { return new Date(ms).toISOString(); }

  // ---- events ----
  log(leadId: string, kind: EventKind, actor: { id: string; name: string; office: Office | 'ADMIN' | null } | null, data: Record<string, unknown> = {}, vis: Vis = 'ALL') {
    const e: LeadEvent = { id: randomUUID(), leadId, at: this.iso(), kind, actorId: actor?.id ?? null, actorName: actor?.name ?? null, actorOffice: actor?.office ?? null, data, vis };
    this.db.prepare('INSERT INTO lead_events (id,lead_id,at,kind,actor_id,actor_name,actor_office,data,vis) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(e.id, leadId, e.at, kind, e.actorId, e.actorName, e.actorOffice, JSON.stringify(data), vis);
    return e;
  }
  events(leadId: string): LeadEvent[] {
    return (this.db.prepare('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY at, rowid').all(leadId) as any[]).map((r) => ({
      id: r.id, leadId: r.lead_id, at: r.at, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name, actorOffice: r.actor_office, data: JSON.parse(r.data), vis: r.vis }));
  }
  has(leadId: string, kind: EventKind) { return !!this.db.prepare('SELECT 1 FROM lead_events WHERE lead_id = ? AND kind = ? LIMIT 1').get(leadId, kind); }

  // ---- settings ----
  sla(): SlaSettings {
    const r = this.db.prepare("SELECT value FROM app_settings WHERE key = 'sla'").get() as any;
    return r ? { ...SLA_DEFAULT, ...JSON.parse(r.value) } : { ...SLA_DEFAULT };
  }
  setSla(s: Partial<SlaSettings>): SlaSettings {
    const cur = this.sla();
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30 * 24 * 60;
    const n = { normalMinutes: ok(s.normalMinutes) ? Math.round(s.normalMinutes!) : cur.normalMinutes, priorityMinutes: ok(s.priorityMinutes) ? Math.round(s.priorityMinutes!) : cur.priorityMinutes };
    this.db.prepare("INSERT INTO app_settings (key,value) VALUES ('sla',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(n));
    for (const c of this.clocks()) this.recalc(c.leadId); // running clocks follow the new hours
    return n;
  }

  /** True the first time it is called for `key` (one-off migrations). */
  once(key: string) { const k = 'once:' + key; if (this.db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(k)) return false; this.db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?)').run(k, this.iso()); return true; }
  // ---- lost-lead meta: permanent close, follow-up reminder, copied-from link ----
  meta(leadId: string): LeadMeta {
    const r = this.db.prepare('SELECT * FROM lead_meta WHERE lead_id = ?').get(leadId) as any;
    return { closedAt: r?.closed_at ?? null, closedBy: r?.closed_by ?? null, followUp: r?.follow_up ?? null, followUpBy: r?.follow_up_by ?? null, fromId: r?.from_id ?? null, fromRef: r?.from_ref ?? null };
  }
  private setMeta(leadId: string, cols: Record<string, unknown>) {
    this.db.prepare('INSERT INTO lead_meta (lead_id) VALUES (?) ON CONFLICT(lead_id) DO NOTHING').run(leadId);
    for (const [k, v] of Object.entries(cols)) this.db.prepare(`UPDATE lead_meta SET ${k} = ? WHERE lead_id = ?`).run(v as any, leadId);
  }
  closeLead(leadId: string, by: string) { this.setMeta(leadId, { closed_at: this.iso(), closed_by: by }); }
  reopenLead(leadId: string) { this.setMeta(leadId, { closed_at: null, closed_by: null }); }
  closedIds(): Set<string> { return new Set((this.db.prepare('SELECT lead_id FROM lead_meta WHERE closed_at IS NOT NULL').all() as any[]).map((r) => r.lead_id)); }
  setFollowUp(leadId: string, date: string | null, by: string) { this.setMeta(leadId, { follow_up: date, follow_up_by: date ? by : null, follow_up_sent: 0 }); }
  linkFrom(leadId: string, fromId: string, fromRef: string | null) { this.setMeta(leadId, { from_id: fromId, from_ref: fromRef }); }
  /** Follow-ups whose date has arrived (each reported once). */
  dueFollowUps(): { leadId: string; by: string | null; date: string }[] {
    const today = this.iso().slice(0, 10);
    const rows = this.db.prepare('SELECT * FROM lead_meta WHERE follow_up IS NOT NULL AND follow_up_sent = 0 AND follow_up <= ?').all(today) as any[];
    for (const r of rows) this.db.prepare('UPDATE lead_meta SET follow_up_sent = 1 WHERE lead_id = ?').run(r.lead_id);
    return rows.map((r) => ({ leadId: r.lead_id, by: r.follow_up_by, date: r.follow_up }));
  }
  // ---- priority ----
  priority(leadId: string) { return !!(this.db.prepare('SELECT priority FROM lead_priority WHERE lead_id = ?').get(leadId) as any)?.priority; }
  priorities(): Set<string> { return new Set((this.db.prepare('SELECT lead_id FROM lead_priority WHERE priority = 1').all() as any[]).map((r) => r.lead_id)); }
  setPriority(leadId: string, on: boolean) {
    this.db.prepare('INSERT INTO lead_priority (lead_id,priority,updated_at) VALUES (?,?,?) ON CONFLICT(lead_id) DO UPDATE SET priority=excluded.priority, updated_at=excluded.updated_at').run(leadId, on ? 1 : 0, this.iso());
    return this.recalc(leadId);
  }

  // ---- SLA clock ----
  private minutes(leadId: string) { const s = this.sla(); return this.priority(leadId) ? s.priorityMinutes : s.normalMinutes; }
  private row(r: any): Clock { return { leadId: r.lead_id, office: r.office, assignee: r.assignee, startedAt: r.started_at, dueAt: r.due_at, priority: this.priority(r.lead_id), warned: !!r.warned, breached: !!r.breached }; }
  clock(leadId: string): Clock | null { const r = this.db.prepare('SELECT * FROM lead_clock WHERE lead_id = ?').get(leadId); return r ? this.row(r) : null; }
  clocks(): Clock[] { const pr = this.priorities(); return (this.db.prepare('SELECT * FROM lead_clock').all() as any[]).map((r) => ({ ...this.row(r), priority: pr.has(r.lead_id) })); }
  /** Starts a clock for `office` (stopping any other office's clock). A running clock for the same office just changes assignee. */
  start(leadId: string, office: Office, assignee: string | null) {
    const cur = this.clock(leadId);
    if (cur && cur.office === office) { this.db.prepare('UPDATE lead_clock SET assignee = ? WHERE lead_id = ?').run(assignee, leadId); return this.clock(leadId)!; }
    if (cur) this.stop(leadId);
    const t = this.now();
    this.db.prepare('INSERT INTO lead_clock (lead_id,office,assignee,started_at,due_at) VALUES (?,?,?,?,?)').run(leadId, office, assignee, this.iso(t), this.iso(t + this.minutes(leadId) * 60e3));
    return this.clock(leadId)!;
  }
  /** Stops the running clock (optionally only if it belongs to `office`) and records the run for the SLA report. */
  stop(leadId: string, office?: Office): ClockRun | null {
    const c = this.clock(leadId);
    if (!c || (office && c.office !== office)) return null;
    const ended = this.iso(), breached = c.breached || ended > c.dueAt;
    this.db.prepare('INSERT INTO lead_clock_runs (id,lead_id,office,assignee,started_at,due_at,ended_at,breached) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), leadId, c.office, c.assignee, c.startedAt, c.dueAt, ended, breached ? 1 : 0);
    this.db.prepare('DELETE FROM lead_clock WHERE lead_id = ?').run(leadId);
    return { leadId, office: c.office, assignee: c.assignee, startedAt: c.startedAt, dueAt: c.dueAt, endedAt: ended, breached };
  }
  /** Due time follows the lead's current priority and settings; warn/breach flags reset when the new due time is later. */
  recalc(leadId: string): Clock | null {
    const c = this.clock(leadId); if (!c) return null;
    const start = Date.parse(c.startedAt), total = this.minutes(leadId) * 60e3, due = start + total, now = this.now();
    const warned = c.warned && now >= start + total * 0.8, breached = c.breached && now >= due;
    this.db.prepare('UPDATE lead_clock SET due_at = ?, warned = ?, breached = ? WHERE lead_id = ?').run(this.iso(due), warned ? 1 : 0, breached ? 1 : 0, leadId);
    return this.clock(leadId);
  }
  /** Clocks that just crossed 80% / 100% (each reported once). */
  tick(): { warn: Clock[]; breach: Clock[] } {
    const now = this.now(), warn: Clock[] = [], breach: Clock[] = [];
    for (const c of this.clocks()) {
      const start = Date.parse(c.startedAt), due = Date.parse(c.dueAt);
      if (!c.breached && now >= due) { this.db.prepare('UPDATE lead_clock SET breached = 1, warned = 1 WHERE lead_id = ?').run(c.leadId); breach.push({ ...c, breached: true }); }
      else if (!c.warned && !c.breached && now >= start + (due - start) * 0.8) { this.db.prepare('UPDATE lead_clock SET warned = 1 WHERE lead_id = ?').run(c.leadId); warn.push({ ...c, warned: true }); }
    }
    return { warn, breach };
  }
  runs(sinceIso?: string): ClockRun[] {
    return (this.db.prepare('SELECT * FROM lead_clock_runs WHERE ended_at >= ? ORDER BY ended_at').all(sinceIso ?? '') as any[]).map((r) => ({
      leadId: r.lead_id, office: r.office, assignee: r.assignee, startedAt: r.started_at, dueAt: r.due_at, endedAt: r.ended_at, breached: !!r.breached }));
  }
  forgetLead(leadId: string) {
    for (const t of ['lead_events', 'lead_clock', 'lead_clock_runs', 'lead_priority', 'lead_meta']) this.db.prepare(`DELETE FROM ${t} WHERE lead_id = ?`).run(leadId);
  }
}
