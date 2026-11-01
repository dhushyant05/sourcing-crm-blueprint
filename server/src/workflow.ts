/**
 * Lead workflow: an append-only event log (timeline) and the per-office SLA clock.
 * Stored in PostgreSQL (lead_events, sla_clocks, sla_runs, lead_meta, settings; priority is a column on leads). Events carry a visibility tag so China never sees customer/India-price events
 * and India never sees supplier identity (supplier names live in `data.supplier`, stripped for India at read time).
 */
import type { Db } from './db.js';
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
  constructor(private db: Db, private now: () => number = Date.now) {}
  private iso(ms = this.now()) { return new Date(ms).toISOString(); }

  // ---- events ----
  async log(leadId: string, kind: EventKind, actor: { id: string; name: string; office: Office | 'ADMIN' | null } | null, data: Record<string, unknown> = {}, vis: Vis = 'ALL') {
    const e: LeadEvent = { id: randomUUID(), leadId, at: this.iso(), kind, actorId: actor?.id ?? null, actorName: actor?.name ?? null, actorOffice: actor?.office ?? null, data, vis };
    await this.db.run('INSERT INTO lead_events (id,lead_id,at,kind,actor_id,actor_name,actor_office,data,vis) VALUES (?,?,?,?,?,?,?,?,?)',
      e.id, leadId, e.at, kind, e.actorId, e.actorName, e.actorOffice, JSON.stringify(data), vis);
    return e;
  }
  async events(leadId: string): Promise<LeadEvent[]> {
    return (await this.db.all('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY at, seq', leadId)).map((r) => ({
      id: r.id, leadId: r.lead_id, at: r.at, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name, actorOffice: r.actor_office, data: r.data ?? {}, vis: r.vis }));
  }
  async has(leadId: string, kind: EventKind) { return !!(await this.db.get('SELECT 1 FROM lead_events WHERE lead_id = ? AND kind = ? LIMIT 1', leadId, kind)); }

  // ---- settings ----
  async sla(): Promise<SlaSettings> {
    const r = await this.db.get("SELECT value FROM settings WHERE key = 'sla'");
    return r ? { ...SLA_DEFAULT, ...r.value } : { ...SLA_DEFAULT };
  }
  async setSla(s: Partial<SlaSettings>): Promise<SlaSettings> {
    const cur = await this.sla();
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30 * 24 * 60;
    const n = { normalMinutes: ok(s.normalMinutes) ? Math.round(s.normalMinutes!) : cur.normalMinutes, priorityMinutes: ok(s.priorityMinutes) ? Math.round(s.priorityMinutes!) : cur.priorityMinutes };
    await this.db.run("INSERT INTO settings (key,value) VALUES ('sla',?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", JSON.stringify(n));
    for (const c of await this.clocks()) await this.recalc(c.leadId); // running clocks follow the new hours
    return n;
  }
  /** True the first time it is called for `key` (one-off migrations). */
  async once(key: string) { return (await this.db.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO NOTHING', 'once:' + key, JSON.stringify(this.iso()))) > 0; }

  // ---- lost-lead meta: permanent close, follow-up reminder, copied-from link ----
  async meta(leadId: string): Promise<LeadMeta> {
    const r = await this.db.get('SELECT * FROM lead_meta WHERE lead_id = ?', leadId);
    return { closedAt: r?.closed_at ?? null, closedBy: r?.closed_by ?? null, followUp: r?.follow_up ?? null, followUpBy: r?.follow_up_by ?? null, fromId: r?.from_id ?? null, fromRef: r?.from_ref ?? null };
  }
  private async setMeta(leadId: string, cols: Record<string, unknown>) {
    const ks = Object.keys(cols);
    await this.db.run(`INSERT INTO lead_meta (lead_id, ${ks.join(', ')}) VALUES (?${', ?'.repeat(ks.length)}) ON CONFLICT (lead_id) DO UPDATE SET ${ks.map((k) => `${k} = excluded.${k}`).join(', ')}`, leadId, ...Object.values(cols));
  }
  async closeLead(leadId: string, by: string) { await this.setMeta(leadId, { closed_at: this.iso(), closed_by: by }); }
  async reopenLead(leadId: string) { await this.setMeta(leadId, { closed_at: null, closed_by: null }); }
  async closedIds(): Promise<Set<string>> { return new Set((await this.db.all('SELECT lead_id FROM lead_meta WHERE closed_at IS NOT NULL')).map((r) => r.lead_id)); }
  async setFollowUp(leadId: string, date: string | null, by: string) { await this.setMeta(leadId, { follow_up: date, follow_up_by: date ? by : null, follow_up_sent: false }); }
  async linkFrom(leadId: string, fromId: string, fromRef: string | null) { await this.setMeta(leadId, { from_id: fromId, from_ref: fromRef }); }
  /** Follow-ups whose date has arrived (each reported once). */
  async dueFollowUps(): Promise<{ leadId: string; by: string | null; date: string }[]> {
    const rows = await this.db.all('UPDATE lead_meta SET follow_up_sent = true WHERE follow_up IS NOT NULL AND follow_up_sent = false AND follow_up <= ?::date RETURNING *', this.iso().slice(0, 10));
    return rows.map((r) => ({ leadId: r.lead_id, by: r.follow_up_by, date: r.follow_up }));
  }
  // ---- priority (column on leads) ----
  async priority(leadId: string) { return !!(await this.db.get('SELECT priority FROM leads WHERE id = ?', leadId))?.priority; }
  async priorities(): Promise<Set<string>> { return new Set((await this.db.all('SELECT id FROM leads WHERE priority')).map((r) => r.id)); }
  async setPriority(leadId: string, on: boolean) {
    await this.db.run('UPDATE leads SET priority = ?, priority_at = ? WHERE id = ?', on, this.iso(), leadId);
    return this.recalc(leadId);
  }

  // ---- SLA clock ----
  private async minutes(leadId: string) { const s = await this.sla(); return (await this.priority(leadId)) ? s.priorityMinutes : s.normalMinutes; }
  private row(r: any): Clock { return { leadId: r.lead_id, office: r.office, assignee: r.assignee, startedAt: r.started_at, dueAt: r.due_at, priority: !!r.priority, warned: !!r.warned, breached: !!r.breached }; }
  private static SEL = 'SELECT c.*, COALESCE(l.priority, false) AS priority FROM sla_clocks c LEFT JOIN leads l ON l.id = c.lead_id';
  async clock(leadId: string): Promise<Clock | null> { const r = await this.db.get(`${WorkflowStore.SEL} WHERE c.lead_id = ?`, leadId); return r ? this.row(r) : null; }
  async clocks(): Promise<Clock[]> { return (await this.db.all(WorkflowStore.SEL)).map((r) => this.row(r)); }
  /** Starts a clock for `office` (stopping any other office's clock). A running clock for the same office just changes assignee. */
  async start(leadId: string, office: Office, assignee: string | null) {
    const cur = await this.clock(leadId);
    if (cur && cur.office === office) { await this.db.run('UPDATE sla_clocks SET assignee = ? WHERE lead_id = ?', assignee, leadId); return (await this.clock(leadId))!; }
    if (cur) await this.stop(leadId);
    const t = this.now();
    await this.db.run('INSERT INTO sla_clocks (lead_id,office,assignee,started_at,due_at) VALUES (?,?,?,?,?)', leadId, office, assignee, this.iso(t), this.iso(t + (await this.minutes(leadId)) * 60e3));
    return (await this.clock(leadId))!;
  }
  /** Stops the running clock (optionally only if it belongs to `office`) and records the run for the SLA report. */
  async stop(leadId: string, office?: Office): Promise<ClockRun | null> {
    const c = await this.clock(leadId);
    if (!c || (office && c.office !== office)) return null;
    const ended = this.iso(), breached = c.breached || ended > c.dueAt;
    await this.db.run('INSERT INTO sla_runs (id,lead_id,office,assignee,started_at,due_at,ended_at,breached) VALUES (?,?,?,?,?,?,?,?)',
      randomUUID(), leadId, c.office, c.assignee, c.startedAt, c.dueAt, ended, breached);
    await this.db.run('DELETE FROM sla_clocks WHERE lead_id = ?', leadId);
    return { leadId, office: c.office, assignee: c.assignee, startedAt: c.startedAt, dueAt: c.dueAt, endedAt: ended, breached };
  }
  /** Due time follows the lead's current priority and settings; warn/breach flags reset when the new due time is later. */
  async recalc(leadId: string): Promise<Clock | null> {
    const c = await this.clock(leadId); if (!c) return null;
    const start = Date.parse(c.startedAt), total = (await this.minutes(leadId)) * 60e3, due = start + total, now = this.now();
    const warned = c.warned && now >= start + total * 0.8, breached = c.breached && now >= due;
    await this.db.run('UPDATE sla_clocks SET due_at = ?, warned = ?, breached = ? WHERE lead_id = ?', this.iso(due), warned, breached, leadId);
    return this.clock(leadId);
  }
  /** Clocks that just crossed 80% / 100% (each reported once). */
  async tick(): Promise<{ warn: Clock[]; breach: Clock[] }> {
    const now = this.now(), warn: Clock[] = [], breach: Clock[] = [];
    for (const c of await this.clocks()) {
      const start = Date.parse(c.startedAt), due = Date.parse(c.dueAt);
      if (!c.breached && now >= due) { if (await this.db.run('UPDATE sla_clocks SET breached = true, warned = true WHERE lead_id = ? AND NOT breached', c.leadId)) breach.push({ ...c, breached: true }); }
      else if (!c.warned && !c.breached && now >= start + (due - start) * 0.8) { if (await this.db.run('UPDATE sla_clocks SET warned = true WHERE lead_id = ? AND NOT warned', c.leadId)) warn.push({ ...c, warned: true }); }
    }
    return { warn, breach };
  }
  async runs(sinceIso?: string): Promise<ClockRun[]> {
    return (await this.db.all("SELECT * FROM sla_runs WHERE ended_at >= ?::timestamptz ORDER BY ended_at", sinceIso || '-infinity')).map((r) => ({
      leadId: r.lead_id, office: r.office, assignee: r.assignee, startedAt: r.started_at, dueAt: r.due_at, endedAt: r.ended_at, breached: !!r.breached }));
  }
  async forgetLead(leadId: string) {
    for (const t of ['lead_events', 'sla_clocks', 'sla_runs', 'lead_meta']) await this.db.run(`DELETE FROM ${t} WHERE lead_id = ?`, leadId);
  }
}
