import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import jwt from 'jsonwebtoken';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { RefCounter } from './refs.js';
import { MAX_FILES, MAX_STAFF_FILES, MAX_VIDEO_BYTES, UploadStore, type Staged, type Attachment } from './uploads.js';
import { capabilities, isRole, manageableRoles, sides, type Role } from './roles.js';
import { PermStore, PERMISSIONS } from './permissions.js';
import { canRead, CHINA_LEAD_STATUSES, FILTERABLE, Forbidden, PLURAL_TO_OBJECT, readFilter, writeCheck, type Ctx, type ObjectName, type Rec } from './policy.js';
import type { Db } from './db.js';
import type { Bus } from './bus.js';
import { LeadStore } from './leads.js';
import { CustomerStore, BadCustomer, NO_STATS } from './customers.js';
import type { UserStore, User } from './users.js';
import { QuoteStore, QUOTE_STATUSES, cqTotals, type Quote } from './quotes.js';
import { OrderStore, INDIA_KEYS, CHINA_KEYS, type Order } from './orders.js';
import { customerQuotePdf } from './pdf.js';
import { AvatarStore, BadImage, AVATAR_MAX_BYTES } from './avatars.js';
import { RejectStore, REJECT_REASONS } from './rejections.js';
import { ShipmentStore, SHIP_CHINA_KEYS, SHIP_INDIA_KEYS, CHINA_SHIP_STATUS, INDIA_SHIP_STATUS, shipRank, type Shipment } from './shipments.js';
import { PushStore } from './push.js';
import { AssignStore, type Assignment, type Office, type NotifKind } from './assign.js';
import { WorkflowStore, type LeadEvent, type EventKind, type Vis } from './workflow.js';
import { PortalStore, PortalError, loginView, tempPassword, customerStage, PORTAL_MIN_PASSWORD, type CustomerUser } from './portal.js';
import { phoneKey } from './customers.js';

export interface AppOptions {
  db: Db;
  bus: Bus;
  users: UserStore;
  jwtSecret: string;
  jwtTtl?: string;
  /** Customer portal token lifetime (default 12h). */
  portalTtl?: string;
  webDir?: string;
  push?: PushStore;
  backupLinks?: { label: string; url: string }[];
  logger?: boolean;
  /** Private folder for enquiry attachments (default: in-memory temp dir for tests). */
  uploadsDir?: string;
  /** Persistent folder holding source-easy.apk + version.json (published by infra/app-servers/publish-apk.sh). */
  downloadsDir?: string;
  /** Clock for SLA (tests). */
  now?: () => number;
  /** SLA checker interval in ms (default 30 s; 0 = off, call app.slaTick() manually). */
  slaTickMs?: number;
}

declare module 'fastify' { interface FastifyRequest { user?: User; customer?: CustomerUser } interface FastifyInstance { slaTick: () => Promise<{ warn: number; breach: number }> } }

export async function buildApp(o: AppOptions) {
  const app = Fastify({ logger: o.logger ?? false, trustProxy: true, bodyLimit: 1 << 20 });
  const refs = new RefCounter(o.db);
  const leadDb = new LeadStore(o.db);
  /** Next shared lead reference (atomic counter in PostgreSQL). */
  const nextRef = () => refs.next();
  // Another API process changed a user (or a token was revoked): reload, and close that user's live streams if revoked.
  const revokeSubs = new Map<string, Set<() => void>>();
  o.users.onChange = (id) => { void o.bus.publish('se:revoke', { id, v: o.users.tokenVersion(id) ?? null, pid: process.pid }).catch(() => undefined); };
  o.bus.subscribe('se:revoke', (m: { id: string; v: number | null; pid: number }) => {
    void (async () => {
      if (m.pid !== process.pid) await o.users.reload();
      const u = o.users.byId(m.id);
      for (const f of revokeSubs.get(m.id) ?? []) f();
    })().catch(() => undefined);
  });

  // ---- Lead ownership (raisedBy / assignedTo) + notifications ----
  const assign = new AssignStore(o.db, o.bus);
  const push = o.push ?? new PushStore(o.db);
  const KIND_EN: Record<string, string> = { ORDER_UPDATE: 'Order updated', ORDER_SHIPPED: 'Order shipped', SHIPMENT_UPDATE: 'Shipment updated', ORDER_NEW: 'New order', ASSIGNED: 'Lead assigned to you', QUEUE: 'New lead in queue', RETURNED: 'Lead returned', QUOTE_ACCEPTED: 'Quote accepted', QUOTE_REJECTED: 'Quote rejected', LEAD_CLOSED: 'Lead closed', LEAD_COMPLETED: 'Lead completed', FOLLOW_UP: 'Follow-up due', REVISE_REQUESTED: 'Revision requested', SENT_BACK: 'Sent back — needs info', INFO_PROVIDED: 'Info added — lead re-sent', QUOTE_REVISED: 'Quote revised', SLA_WARN: 'SLA warning', SLA_BREACH: 'SLA breached', PRIORITY: 'Priority changed', LOGIN_REQUEST: 'Customer portal login requested', PORTAL_REQUEST: 'New request from customer portal' };
  if (push.enabled) assign.onNotify = (ids, n) => {
    const det = n.detail ? ` — ${String(n.detail).replace(/^(production|ship|payment):/, '').replace(/_/g, ' ')}` : '';
    void push.send(ids, { title: `${KIND_EN[n.kind] ?? 'Source Easy'}${n.leadRef ? ` · ${n.leadRef}` : ''}`, body: `${n.product ?? ''}${det}${n.byName ? ` (${n.byName})` : ''}`.trim() || 'Source Easy',
      data: { id: n.id, leadId: n.leadId, kind: n.kind } }).catch((e) => app.log.warn(e, 'push failed'));
  };
  const quotes = new QuoteStore(o.db);
  const customers = new CustomerStore(o.db);
  const orders = new OrderStore(o.db);
  const ships = new ShipmentStore(o.db);
  const rejects = new RejectStore(o.db);
  /** Shipment fields from the customer quote (falls back to China's shipping offer). */
  const shipFrom = (q: Quote | null) => ({ mode: q?.cq?.shipMode ?? q?.shipMode ?? null, incoterm: q?.cq?.shipTerm ?? q?.shipTerm ?? null,
    port: q?.cq?.port ?? q?.shipPort ?? null, transit: q?.cq?.transit ?? q?.shipTransit ?? null });
  const orderShipStatus = (x: Order) => (x.indiaStatus !== 'NONE' && x.indiaStatus ? x.indiaStatus : x.production === 'SHIPPED' ? 'IN_TRANSIT' : 'PENDING');
  const shipFor = async (x: Order) => (await ships.byOrder(x.id)) ?? ships.create({ orderId: x.id, leadId: x.leadId, leadRef: x.leadRef, ...shipFrom(await quotes.get(x.quoteId)),
    tracking: x.tracking, container: x.container, etd: x.etd, eta: x.eta, status: orderShipStatus(x), createdAt: x.createdAt });
  // Every order has its shipment.
  for (const x of (await orders.all()).reverse()) await shipFor(x);
  const wf = new WorkflowStore(o.db, o.now ?? Date.now);
  const portal = new PortalStore(o.db, o.jwtSecret, o.portalTtl ?? '12h');
  const officeOf = (r: Role): Office | null => (r.startsWith('INDIA') ? 'INDIA' : r.startsWith('CHINA') ? 'CHINA' : null);
  const staffOf = (office: Office) => o.users.list().filter((u) => u.active && officeOf(u.role) === office);
  const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
  /** No India owner yet (typically a public website enquiry): nobody raised it and no India member holds it. */
  const noIndiaOwner = (rec: Rec, a: Assignment | null | undefined) => !a?.raisedBy && !((a?.ownerOffice ?? 'INDIA') === 'INDIA' && a?.assignedTo) && !['CLOSED', 'LOST', 'COMPLETED', 'DELIVERED'].includes(String(rec.status));
  /** Adds raisedBy/assignedTo (+ names) to a filtered lead. Only staff names/ids, never customer data. */
  const decorate = async (rec: Rec, a: Assignment | null | undefined, names: Map<string, string>) => ({
    ...rec, raisedBy: a?.raisedBy ?? null, raisedByName: (a?.raisedBy && names.get(a.raisedBy)) || null,
    assignedTo: a?.assignedTo ?? null, assignedToName: (a?.assignedTo && names.get(a.assignedTo)) || null,
    ownerOffice: a?.ownerOffice ?? (rec.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA'),
    unassignedIndia: noIndiaOwner(rec, a),
    rejection: rec.id ? await rejects.summary(String(rec.id), names) : null,
    priority: await wf.priority(String(rec.id)), sla: await slaView(String(rec.id), names),
    ...(await leadMetaView(rec, names)),
  });
  const leadMetaView = async (rec: Rec, names: Map<string, string>) => {
    const m = rec.id ? await wf.meta(String(rec.id)) : null;
    if (!m) return {};
    const sb = m.sendBack;
    return { sendBack: sb ? { side: sb.side, note: sb.note, at: sb.at, byName: (sb.by && names.get(sb.by)) || null, quoteId: sb.quoteId } : null, ...(m.closedAt ? { status: 'CLOSED', closedAt: m.closedAt, closedByName: (m.closedBy && names.get(m.closedBy)) || null } : {}),
      followUp: m.followUp, createdFromRef: m.fromRef, createdFromId: m.fromId };
  };
  const slaView = async (leadId: string, names?: Map<string, string>) => {
    const c = await wf.clock(leadId);
    return c ? { office: c.office, startedAt: c.startedAt, dueAt: c.dueAt, breached: c.breached, assignee: c.assignee, assigneeName: (c.assignee && names?.get(c.assignee)) || null } : null;
  };
  const actorOf = (u: User | null) => (u ? { id: u.id, name: u.name, office: officeOf(u.role) ?? ('ADMIN' as const) } : null);
  /** Log a timeline event. */
  const ev = (leadId: string, kind: EventKind, actor: User | null, data: Record<string, unknown> = {}, vis: Vis = 'ALL') => wf.log(leadId, kind, actorOf(actor), data, vis);
  const userNames = () => new Map(o.users.list().map((u) => [u.id, u.name]));
  /**
   * Hands a lead to an office. `to` = specific member, null = office queue, undefined = default
   * (China: queue; India: the India member who raised it, else queue). Notifies the new owner, or the office admins for a queue.
   */
  /** India members + the super admin can own a returned lead; a raiser must be one of them and active. */
  const indiaOwner = (u: User | null | undefined) => !!u && u.active && (officeOf(u.role) === 'INDIA' || u.role === 'SUPER_ADMIN');
  /** Who hears about an unowned India/China lead: that office's admins, plus the super admin(s). */
  const queueWatchers = (office: Office) => o.users.list().filter((u) => u.active && (u.role === 'SUPER_ADMIN' || (officeOf(u.role) === office && u.role.endsWith('ADMIN')))).map((u) => u.id);
  const handoff = async (lead: Rec, actor: User | null, office: Office, to: string | null | undefined, why?: { kind: NotifKind; detail?: string | null }) => {
    const leadId = String(lead.id), prev = await assign.get(leadId);
    if (to) {
      const u = o.users.byId(to);
      if (!u || !u.active || (officeOf(u.role) !== office && !(office === 'INDIA' && u.role === 'SUPER_ADMIN'))) throw bad(`Assignee must be an active ${office} staff member`);
    }
    // Remember who raised the lead when nobody was recorded (public enquiries, older leads):
    // the India member/super admin who sends it to China, or the India member it gets assigned to.
    if (!prev?.raisedBy) {
      const by = office === 'CHINA' && indiaOwner(actor) ? actor!.id : office === 'INDIA' && to ? to : null;
      if (by) await assign.set(leadId, { raisedBy: by });
    }
    if (to === undefined) {
      const r = prev?.raisedBy ? o.users.byId(prev.raisedBy) : null;
      to = office === 'INDIA' && indiaOwner(r) ? r!.id : null;
    }
    const returned = office === 'INDIA' && prev?.ownerOffice === 'CHINA';
    // Any move to the other office closes an open send-back request held by this office.
    { const sb = (await wf.meta(leadId)).sendBack; if (sb && sb.side !== office) await wf.setSendBack(leadId, null); }
    const changed = prev?.ownerOffice !== office || (prev?.assignedTo ?? null) !== to;
    await assign.set(leadId, { ownerOffice: office, assignedTo: to });
    if (changed) {
      const toName = to ? o.users.byId(to)?.name ?? null : null;
      await ev(leadId, returned ? 'RETURNED' : prev?.ownerOffice === office ? 'REASSIGNED' : !to ? 'QUEUED' : 'ASSIGNED', actor, { office, to: toName });
      // Each handoff to another office starts that office's SLA clock; a reassignment within the office keeps it running.
      if (prev?.ownerOffice !== office || (await wf.clock(leadId))) await wf.start(leadId, office, to);
    }
    if (changed || why) {
      const recips = (to ? [to] : queueWatchers(office)).filter((id) => id !== actor?.id);
      await assign.notify(recips, { leadId, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null,
        kind: why?.kind ?? (!to ? 'QUEUE' : returned ? 'RETURNED' : 'ASSIGNED'), office, byName: actor?.name ?? null, detail: why?.detail ?? null });
    }
    await liveData({ type: 'lead', id: leadId, leadId, at: Date.now() });
  };
  const stopClock = (leadId: string, office?: Office) => wf.stop(leadId, office);
  /** SLA watcher: 80% → the clock's assignee (or the office queue watchers); breach → office admins + super admin (+ assignee), logged on the timeline. */
  const slaTick = async () => {
    const { warn, breach } = await wf.tick();
    for (const [c, kind] of [...warn.map((c) => [c, 'SLA_WARN'] as const), ...breach.map((c) => [c, 'SLA_BREACH'] as const)]) {
      const lead = await leadDb.get(c.leadId);
      if (!lead) { await wf.forgetLead(c.leadId); continue; }
      const owner = c.assignee && o.users.byId(c.assignee)?.active ? [c.assignee] : [];
      const sa = o.users.list().filter((u) => u.active && u.role === 'SUPER_ADMIN').map((u) => u.id);
      const recips = kind === 'SLA_WARN' ? [...new Set([...(owner.length ? owner : queueWatchers(c.office)), ...sa])] : [...new Set([...queueWatchers(c.office), ...owner])];
      if (kind === 'SLA_BREACH') await wf.log(c.leadId, 'SLA_BREACH', null, { office: c.office, dueAt: c.dueAt, assignee: (c.assignee && o.users.byId(c.assignee)?.name) || null, priority: c.priority });
      await assign.notify(recips, { leadId: c.leadId, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind, office: c.office, byName: null });
    }
    for (const f of await wf.dueFollowUps()) {
      const lead = await leadDb.get(f.leadId); if (!lead) continue;
      const a = await assign.get(f.leadId);
      const recips = [...new Set([f.by, a?.raisedBy, a?.ownerOffice === 'INDIA' ? a?.assignedTo : null].filter((x): x is string => !!x && !!o.users.byId(x)?.active))];
      await wf.log(f.leadId, 'FOLLOW_UP_DUE', null, { date: f.date });
      if (recips.length) await assign.notify(recips, { leadId: f.leadId, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind: 'FOLLOW_UP', office: 'INDIA', byName: null, detail: f.date });
    }
    return { warn: warn.length, breach: breach.length };
  };
  const tickMs = o.slaTickMs ?? 30000;
  if (tickMs > 0) {
    const t = setInterval(() => { slaTick().catch((e) => app.log.warn(e, 'sla tick failed')); }, tickMs);
    t.unref?.(); app.addHook('onClose', async () => clearInterval(t));
    // One-off: open leads created before SLA clocks existed get a clock (from now) for the office that holds them.
    const bf = setTimeout(() => { void (async () => {
      if (!(await wf.once('clock-backfill-v1'))) return;
      const ls = await leadDb.list(); let n = 0;
      for (const l of ls) {
        const id = String(l.id), st = String(l.status ?? 'NEW');
        if (['WON', 'LOST', 'DELIVERED', 'SHIPPING', 'CLOSED', 'COMPLETED'].includes(st) || (await wf.clock(id))) continue;
        const a = await assign.get(id), office = (a?.ownerOffice ?? (l.assignedOffice as Office) ?? 'INDIA') as Office;
        await wf.start(id, office, a?.assignedTo ?? null); n++;
      }
      app.log.info({ n }, 'sla clock backfill');
    })().catch((e) => app.log.warn(e, 'sla clock backfill failed')); }, 5000);
    bf.unref?.(); app.addHook('onClose', async () => clearTimeout(bf));
  }
  app.decorate('slaTick', slaTick);
  // Live data-change events go through Redis (`se:data`) so every API process can push them to its SSE streams.
  const dataSubs = new Set<(d: Rec) => void>();
  o.bus.subscribe('se:data', (d: Rec) => { for (const f of dataSubs) { try { f(d); } catch { /* broken stream */ } } });
  const onLiveData = (f: (d: Rec) => void) => { dataSubs.add(f); return () => { dataSubs.delete(f); }; };
  const liveData = (d: Rec) => o.bus.publish('se:data', d).catch((e) => app.log.warn(e, 'live publish failed'));
  /** Workflow stage for the progress bar. */
  const STAGES = ['NEW', 'CHINA', 'SOURCING', 'QUOTED', 'CQ_SENT', 'DECIDED', 'ORDER', 'SHIPPED', 'DELIVERED'] as const;
  const stageOf = async (lead: Rec, owner: Office | null) => {
    // While a revised quote is being sourced after a rejection, the rejected quotes no longer decide the stage.
    const revising = !!(await rejects.summary(String(lead.id), new Map()))?.revising;
    const qs = (await quotes.list(String(lead.id))).filter((q) => !(revising && q.status === 'REJECTED')), ords = await orders.byLead(String(lead.id)), st = String(lead.status ?? 'NEW');
    const lost = st === 'LOST' || (qs.some((q) => q.status === 'REJECTED') && !qs.some((q) => q.status === 'ACCEPTED' || q.status === 'SENT'));
    let stage: (typeof STAGES)[number] = 'NEW';
    if (st === 'DELIVERED' || st === 'COMPLETED' || ords.some((x) => x.indiaStatus === 'DELIVERED')) stage = 'DELIVERED';
    else if (st === 'SHIPPING' || ords.some((x) => x.production === 'SHIPPED')) stage = 'SHIPPED';
    else if (ords.length) stage = 'ORDER';
    else if (st === 'WON' || st === 'LOST' || qs.some((q) => q.status === 'ACCEPTED' || q.status === 'REJECTED')) stage = 'DECIDED';
    else if (qs.some((q) => q.status === 'SENT')) stage = 'CQ_SENT';
    else if (st === 'QUOTED' || st === 'APPROVED' || (qs.length && owner === 'INDIA')) stage = 'QUOTED';
    else if (st === 'SOURCING' || qs.length) stage = 'SOURCING';
    else if (owner === 'CHINA' || lead.assignedOffice === 'CHINA' || st === 'ASSIGNED') stage = 'CHINA';
    return { stage, index: STAGES.indexOf(stage), stages: STAGES, won: !lost && STAGES.indexOf(stage) >= 5, lost };
  };
  /** Role filter: China never sees India-only events (customer quote prices, payments); India never sees supplier identity. China does see the customer's rejection reason so it can revise. */
  const viewEvent = (role: Role, e: LeadEvent) => {
    const s = sides(role);
    if (s.superAdmin) return e;
    if (e.vis === 'INDIA' && !s.india) return null;
    if (e.vis === 'CHINA' && !s.china) return null;
    const data = { ...e.data };
    if (!s.china) delete data.supplier;
    return { ...e, data };
  };
  /** Body field `assignedTo` ('' / null = office queue). Stripped before the lead write. */
  const takeAssignee = (body: Rec): string | null | undefined => {
    if (!('assignedTo' in body)) return undefined;
    const v = body.assignedTo; delete body.assignedTo;
    return v ? String(v) : null;
  };

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof BadImage || err?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(400).send({ error: err instanceof BadImage ? err.message : 'Image must be 5 MB or smaller' });
    const status = err instanceof Forbidden ? 403 : err.status ?? err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: status >= 500 && status !== 502 ? 'Internal error' : err.message, ...(status < 500 && err.appCode ? { code: err.appCode } : {}) });
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  // Per-user feature permissions (role defaults + super-admin overrides). Reloaded on every API process via Redis `se:perms`.
  const perms = await new PermStore(o.db, o.bus).load();
  const can = (u: User, k: string) => perms.can(u, k);
  const need = (u: User, k: string) => { if (!perms.can(u, k)) throw new Forbidden(`You do not have permission: ${k}`); };
  o.bus.subscribe('se:perms', (m: { id: string; pid: number }) => { void (async () => {
    if (m.pid !== process.pid) await perms.load();
    void liveData({ type: 'perms', id: m.id, leadId: null, at: Date.now() });
  })(); });
  /** Users this actor may manage: office admins their side, staff granted staff.manage their own side's staff; the super admin everyone. */
  const manageable = (u: User): Role[] => {
    if (u.role === 'SUPER_ADMIN') return manageableRoles(u.role);
    if (!can(u, 'staff.manage')) return [];
    const r = manageableRoles(u.role); if (r.length) return r;
    return [u.role];
  };
  /** Lead ids a user without `leads.all` may see: assigned to them, raised by them, or (China) quoted by them. */
  const mineSet = async (u: User) => {
    const ids = new Set<string>();
    const india = officeOf(u.role) === 'INDIA';
    for (const [id, a] of await assign.all()) if (a?.assignedTo === u.id || a?.raisedBy === u.id || (india && !a?.raisedBy && !a?.assignedTo && a?.ownerOffice === 'INDIA')) ids.add(id);
    for (const q of await quotes.all()) if (q.createdBy === u.id) ids.add(q.leadId);
    return ids;
  };
  const scope = async (u: User) => (can(u, 'leads.all') ? null : await mineSet(u));
  const sign = (u: User) => jwt.sign({ sub: u.id, role: u.role, v: o.users.tokenVersion(u.id) }, o.jwtSecret, { expiresIn: (o.jwtTtl ?? '12h') as any });

  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const h = req.headers.authorization;
    // Customer portal routes live in a separate realm: only a portal token is accepted there, never a staff one (and vice versa).
    if (req.routeOptions.url?.startsWith('/api/portal/')) return portalAuth(req, reply);
    if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Not signed in' });
    try {
      const p = jwt.verify(h.slice(7), o.jwtSecret) as { sub: string; v: number };
      const u = o.users.byId(p.sub);
      // Role always comes from the DB, never from the token; token is revoked on password/role change.
      if (!u || !u.active || o.users.tokenVersion(u.id) !== p.v) return reply.code(401).send({ error: 'Session expired' });
      req.user = u;
    } catch { return reply.code(401).send({ error: 'Session expired' }); }
  }
  /** Portal realm: bearer token in the Authorization header only (never in URLs, which end up in logs). */
  async function portalAuth(req: FastifyRequest, reply: FastifyReply) {
    const h = req.headers.authorization, t = h?.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) return reply.code(401).send({ error: 'Not signed in' });
    const c = await portal.verifyToken(t);
    if (!c) return reply.code(401).send({ error: 'Session expired' });
    req.customer = c;
    // A temporary password must be changed before anything else.
    if (c.mustChangePassword && !['/api/portal/me', '/api/portal/me/password'].includes(req.routeOptions.url ?? ''))
      return reply.code(403).send({ error: 'Please change your temporary password first', code: 'password_change' });
  }
  const ctxOf = async (role: Role): Promise<Ctx> => ({ role });
  const avatars = await new AvatarStore(o.db).load();
  const avatarOf = (id: string) => avatars.urls().get(id) ?? null;
  const me = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, language: u.language ?? null, avatarUrl: avatarOf(u.id), capabilities: capabilities(u.role), permissions: perms.effective(u) });
  // Public by design (an <img> cannot send a bearer token); ids are random UUIDs and pictures are low-sensitivity.
  app.get<{ Params: { id: string } }>('/api/avatars/:id', async (req, reply) => {
    const a = await avatars.get(req.params.id); if (!a) return reply.code(404).send({ error: 'Not found' });
    return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=31536000, immutable').send(a.data);
  });
  /** Reads one image file from a multipart request into memory (max 5 MB). */
  const readImage = async (req: FastifyRequest) => {
    if (!req.isMultipart()) throw new BadImage('multipart/form-data expected');
    const f = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
    if (!f) throw new BadImage('No file');
    if (!/^image\//.test(f.mimetype)) { f.file.resume(); throw new BadImage('Upload an image (JPG, PNG, WebP or HEIC)'); }
    const buf = await f.toBuffer();
    if (f.file.truncated) throw new BadImage('Image must be 5 MB or smaller');
    return buf;
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const { email = '', password = '' } = req.body ?? {};
    // Failed-login counter in Redis (shared by every API process): 5 failures → 10 min lock.
    const key = `se:fail:${req.ip}|${email.toLowerCase()}`;
    if (Number((await o.bus.get(key)) ?? 0) >= 5) return reply.code(429).send({ error: 'Too many attempts, try again in a few minutes' });
    const u = await o.users.verify(email, password);
    if (!u) { await o.bus.incr(key, 600); return reply.code(401).send({ error: 'Invalid email or password' }); }
    await o.bus.del(key);
    const body = (req.body ?? {}) as { refresh?: boolean; device?: string };
    return { token: sign(u), user: me(u), ...(body.refresh ? { refreshToken: await issueRefresh(u, body.device) } : {}) };
  });

  // ---- Customer portal sign-in (phone + password). Separate counters from staff; 5 failures per phone+IP → 10 min lock, 30 per IP per 10 min. ----
  app.post<{ Body: { phone?: string; password?: string } }>('/api/portal/auth/login', async (req, reply) => {
    const phone = String(req.body?.phone ?? '').slice(0, 40), password = String(req.body?.password ?? '').slice(0, 200);
    const pk = phoneKey(phone) ?? 'none', k1 = `se:pfail:${req.ip}|${pk}`, k2 = `se:pip:${req.ip}`;
    if (Number((await o.bus.get(k1)) ?? 0) >= 5 || Number((await o.bus.get(k2)) ?? 0) >= 30) return reply.code(429).send({ error: 'Too many attempts, try again in a few minutes' });
    const c = phone && password ? await portal.verify(phone, password) : null;
    if (!c) { await o.bus.incr(k1, 600); await o.bus.incr(k2, 600); return reply.code(401).send({ error: 'Invalid mobile number or password' }); }
    await o.bus.del(k1);
    await portal.audit({ id: c.id, kind: 'CUSTOMER' }, 'LOGIN', c.customerId, { ip: req.ip });
    return { token: portal.sign(c), customer: { name: c.name, phone: c.phone, mustChangePassword: c.mustChangePassword } };
  });

  // Long-lived rotating refresh tokens (mobile). Format "<id>.<secret>"; only a SHA-256 of the secret is stored.
  // Revoked by sign-out, password reset/role change (token_version), disabling or removing the user.
  const RT_DAYS = Number(process.env.REFRESH_TTL_DAYS ?? 60);
  const sha = (x: string) => createHash('sha256').update(x).digest('hex');
  const issueRefresh = async (u: User, device?: string) => {
    const id = randomUUID(), secret = randomBytes(32).toString('base64url');
    await o.db.run("DELETE FROM refresh_tokens WHERE expires_at < now()");
    await o.db.run(`INSERT INTO refresh_tokens (id, user_id, token_hash, token_version, device, expires_at) VALUES (?,?,?,?,?, now() + interval '${RT_DAYS} days')`, id, u.id, sha(secret), o.users.tokenVersion(u.id) ?? 0, String(device ?? '').slice(0, 120) || null);
    return `${id}.${secret}`;
  };
  const parseRt = (t: unknown) => { const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(String(t ?? '')); return m ? { id: m[1], secret: m[2] } : null; };
  app.post<{ Body: { refreshToken?: string } }>('/api/auth/refresh', async (req, reply) => {
    const p = parseRt(req.body?.refreshToken); if (!p) return reply.code(401).send({ error: 'Session expired' });
    const row = await o.db.get<{ user_id: string; token_hash: string; prev_hash: string | null; token_version: number; expired: boolean }>('SELECT user_id, token_hash, prev_hash, token_version, expires_at < now() AS expired FROM refresh_tokens WHERE id = ?', p.id);
    if (!row) return reply.code(401).send({ error: 'Session expired' });
    const h = sha(p.secret);
    if (h !== row.token_hash) {
      // An already-rotated token was replayed: treat the whole session as stolen.
      if (h === row.prev_hash) await o.db.run('DELETE FROM refresh_tokens WHERE id = ?', p.id);
      return reply.code(401).send({ error: 'Session expired' });
    }
    const u = o.users.byId(row.user_id);
    if (row.expired || !u || !u.active || (o.users.tokenVersion(u.id) ?? 0) !== row.token_version) {
      await o.db.run('DELETE FROM refresh_tokens WHERE id = ?', p.id);
      return reply.code(401).send({ error: u && !u.active ? 'Account disabled' : 'Session expired' });
    }
    const secret = randomBytes(32).toString('base64url');
    await o.db.run(`UPDATE refresh_tokens SET prev_hash = token_hash, token_hash = ?, rotated_at = now(), expires_at = now() + interval '${RT_DAYS} days' WHERE id = ?`, sha(secret), p.id);
    return { token: sign(u), refreshToken: `${p.id}.${secret}`, user: me(u) };
  });
  app.post<{ Body: { refreshToken?: string } }>('/api/auth/logout', async (req) => {
    const p = parseRt(req.body?.refreshToken);
    if (p) { const row = await o.db.get<{ token_hash: string }>('SELECT token_hash FROM refresh_tokens WHERE id = ?', p.id); if (row && row.token_hash === sha(p.secret)) await o.db.run('DELETE FROM refresh_tokens WHERE id = ?', p.id); }
    return { ok: true };
  });

  // Public website enquiry -> a NEW lead for the India office. No auth; honeypot + per-IP rate limit (5/hour).
  // Accepts multipart/form-data (with up to 5 attachments, 10 MB each) or plain JSON.
  const uploads = new UploadStore(o.uploadsDir ?? `${process.env.TMPDIR ?? '/tmp'}/se-uploads-${process.pid}`);
  /** Indexes a folder's files in lead_media (the bytes stay on disk) and keeps the lead's attachmentCount in step. */
  const mediaSync = async (key: string, list: Attachment[]) => {
    await o.db.tx(async (t) => {
      await t.run('DELETE FROM lead_media WHERE owner_key = ?', key);
      for (const a of list) await t.run('INSERT INTO lead_media (id, owner_key, name, mime, size, created_at) VALUES (?,?,?,?,?,?)', a.id, key, a.name, a.mime, a.size, a.createdAt);
      if (!key.startsWith('q_')) await t.run('UPDATE leads SET attachment_count = ?, updated_at = now() WHERE id = ?', list.length, key);
    });
  };
  await app.register(multipart, { limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_STAFF_FILES, fields: 40, fieldSize: 4000 } });
  /** Reads a multipart body: files are streamed to staging (validated by magic bytes), fields collected. */
  const readMultipart = async (req: FastifyRequest, maxFiles: number) => {
    const fields: Record<string, string> = {}; const files: Staged[] = [];
    const bad = (status: number, error: string, code: string) => { uploads.discard(files); return { fields, files, err: { status, error, code } }; };
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const f = await uploads.stage(part.filename ?? 'file', part.file);
          if (f.error === 'empty') continue;
          if (f.error === 'size') return bad(413, `Too large: ${part.filename} (photos/documents 10 MB, videos 100 MB)`, 'size');
          if (f.error === 'type') return bad(415, `File type not allowed: ${part.filename}`, 'type');
          files.push(f);
          if (files.length > maxFiles) return bad(413, `Up to ${maxFiles} files`, 'count');
        } else fields[part.fieldname] = String(part.value ?? '');
      }
    } catch (e: any) {
      if (e?.code === 'FST_FILES_LIMIT') return bad(413, `Up to ${maxFiles} files`, 'count');
      if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return bad(413, 'Videos must be 100 MB or smaller', 'size');
      uploads.discard(files); throw e;
    }
    return { fields, files, err: null };
  };
  const UNITS = ['pcs', 'kg', 'ton', 'm', 'sqm', 'sets', 'cartons', 'containers'];
  app.post('/api/public/enquiry', async (req, reply) => {
    const b: Record<string, string> = {}; let files: Staged[] = [];
    if (req.isMultipart()) {
      const m = await readMultipart(req, MAX_FILES);
      if (m.err) return reply.code(m.err.status).send({ error: m.err.error, code: m.err.code });
      Object.assign(b, m.fields); files = m.files;
    } else Object.assign(b, Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])));
    const reject = (code: number, body: unknown) => { uploads.discard(files); return reply.code(code).send(body); };
    const str = (k: string, max = 200) => (b[k] ?? '').trim().slice(0, max);
    if (str('website')) return reject(202, { ok: true }); // bot filled the hidden field
    const enqKey = `se:enq:${req.ip}:${Math.floor(Date.now() / 3600e3)}`;
    if (Number((await o.bus.get(enqKey)) ?? 0) >= 5) return reject(429, { error: 'Too many enquiries, please try again later' });

    const name = str('name', 120), email = str('email', 160), product = str('product', 1000);
    const code = str('phoneCode', 6) || '+91';
    let digits = str('phone', 40).replace(/[\s\-().]/g, '');
    if (digits.startsWith(code)) digits = digits.slice(code.length);
    if (!name || !product || !digits) return reject(400, { error: 'Name, mobile number and product are required', code: 'required' });
    if (!/^\+\d{1,4}$/.test(code) || !/^\d{6,14}$/.test(digits) || (code === '+91' && !/^[6-9]\d{9}$/.test(digits)))
      return reject(400, { error: 'Invalid mobile number', code: 'phone' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reject(400, { error: 'Invalid email', code: 'email' });
    const ref = str('referenceUrl', 500);
    if (ref && !/^https?:\/\/[^\s]+$/i.test(ref)) return reject(400, { error: 'Reference link must start with http:// or https://', code: 'url' });
    const currency = ['USD', 'CNY', 'INR'].includes(str('currency', 3)) ? str('currency', 3) : 'INR';
    const price = Number(str('targetPrice', 20)), qty = Number(str('quantity', 12));
    const unit = UNITS.includes(str('unit', 12)) ? str('unit', 12) : 'pcs';
    await o.bus.incr(enqKey, 3600);

    const leadRef = await nextRef();
    const company = str('company', 160), msg = str('message', 2000), city = str('deliveryCity', 120);
    const lead = await leadDb.create({
      name: `${company || name} — ${product}`.slice(0, 200), clientName: company || name, productInterest: product,
      ...(qty > 0 ? { quantity: qty, unit } : {}),
      ...(price > 0 ? { targetPrice: { amountMicros: Math.round(price * 1e6), currencyCode: currency } } : {}),
      contactPhone: { primaryPhoneNumber: digits, primaryPhoneCallingCode: code },
      ...(email ? { contactEmail: { primaryEmail: email } } : {}),
      ...(city ? { deliveryCity: city } : {}), ...(ref ? { referenceUrl: { primaryLinkUrl: ref } } : {}),
      ...(msg ? { enquiryMessage: msg } : {}), contactName: name, leadRef, attachmentCount: files.length,
      ...(str('summary', 2000) ? { summary: str('summary', 2000) } : {}),
      sourceChannel: 'WEBSITE', status: 'NEW', assignedOffice: 'INDIA', office: 'INDIA',
    });
    if (files.length) await mediaSync(String(lead.id), uploads.commit(String(lead.id), files)); else uploads.discard(files);
    { await ev(String(lead.id), 'CREATED', null, { channel: 'WEBSITE', files: files.length }); await handoff({ ...lead, leadRef, productInterest: product }, null, 'INDIA', null); }
    // Every active India staff member (not only admins) hears about a new website enquiry, live.
    {
      const admins = new Set(queueWatchers('INDIA'));
      const staff = o.users.list().filter((u) => u.active && officeOf(u.role) === 'INDIA' && !admins.has(u.id)).map((u) => u.id);
      if (staff.length) await assign.notify(staff, { leadId: String(lead.id), leadRef, product, kind: 'QUEUE', office: 'INDIA', byName: null });
      await liveData({ type: 'lead', id: String(lead.id), leadId: String(lead.id), created: true, at: Date.now() });
    } // India queue; India admins are notified
    // Optional: the enquirer asks for a customer portal login (manual approval by India admins / super admin).
    let loginRequested = false;
    if (/^(1|true|on|yes)$/i.test(str('requestLogin', 5))) {
      const r = await portal.request({ leadId: String(lead.id), name, phone: `${code} ${digits}`, email: email || null, company: company || null });
      if (r) {
        loginRequested = true;
        await portal.audit({ id: null, kind: 'PUBLIC' }, 'LOGIN_REQUESTED', r.id, { leadRef });
        await assign.notify(queueWatchers('INDIA'), { leadId: String(lead.id), leadRef, product, kind: 'LOGIN_REQUEST', office: 'INDIA', byName: null });
      }
    }
    return reply.code(201).send({ ok: true, reference: leadRef, attachments: files.length, ...(loginRequested ? { loginRequested } : {}) });
  });

  app.register(async (api) => {
    api.addHook('preHandler', auth);
    // Feature permissions: one 403 gate per endpoint (route pattern + method), after authentication.
    const PAY = ['qty', 'agreedPrice', 'advance', 'paymentStatus'], INR = ['agreedPrice', 'advance'];
    const GATES: Record<string, (u: User, b: Rec) => string[]> = {
      'GET /api/quotes/:qid/files/:fid': () => ['quotes.view'],
      'POST /api/leads/:id/quotes': () => ['quotes.create'],
      'DELETE /api/quotes/:qid': () => ['quotes.create'],
      'POST /api/quotes/:qid/files': () => ['quotes.create'],
      'PATCH /api/quotes/:qid': (u) => (sides(u.role).china ? ['quotes.create'] : ['quotes.customer', 'prices.inr']),
      'PUT /api/quotes/:qid/customer': () => ['quotes.customer', 'prices.inr'],
      'POST /api/quotes/:qid/pdf': () => ['quotes.customer', 'prices.inr'],
      'POST /api/quotes/:qid/status': () => ['quotes.customer'],
      'POST /api/leads/:id/rejection/revise': () => ['quotes.customer'],
      'POST /api/quotes/:qid/send-back': () => ['quotes.view'],
      'POST /api/quotes/:qid/resubmit': () => ['quotes.create'],
      'POST /api/leads/:id/rejection/close': () => ['quotes.customer'],
      'POST /api/quotes/:qid/order': () => ['orders.create'],
      'PATCH /api/orders/:id': (_u, b) => { const k = Object.keys(b); const r: string[] = [];
        if (k.some((x) => PAY.includes(x))) r.push('orders.payment'); if (k.some((x) => INR.includes(x))) r.push('prices.inr');
        if (k.some((x) => !PAY.includes(x))) r.push('orders.production'); return r; },
      'PATCH /api/shipments/:id': () => ['orders.production'],
      'GET /api/customers': () => ['customers.view'],
      'GET /api/customers/:id': () => ['customers.view'],
      'POST /api/customers': () => ['customers.edit'],
      'PATCH /api/customers/:id': () => ['customers.edit'],
      'POST /api/customers/:id/merge': () => ['customers.edit'],
      'DELETE /api/customers/:id': () => ['customers.edit'],
      'GET /api/leads/:id/customer': () => ['customers.view'],
      'POST /api/leads/:id/customer': () => ['customers.edit'],
      'GET /api/suppliers': () => ['suppliers.view'],
      'GET /api/suppliers/:id': () => ['suppliers.view'],
      'POST /api/suppliers': () => ['suppliers.edit'],
      'PATCH /api/suppliers/:id': () => ['suppliers.edit'],
      'DELETE /api/suppliers/:id': () => ['suppliers.edit'],
      'GET /api/sla/report': () => ['reports.view'],
      'PUT /api/settings/sla': () => ['settings.sla'],
      'DELETE /api/records/leads/:id': () => ['leads.delete'],
      'POST /api/leads/bulk-delete': () => ['leads.delete'],
      'GET /api/export/:kind': () => ['data.export'],
    };
    api.addHook('preHandler', async (req) => {
      const g = req.user && GATES[`${req.method} ${req.routeOptions.url}`];
      if (g) for (const k of g(req.user!, (req.body && typeof req.body === 'object' ? req.body : {}) as Rec)) need(req.user!, k);
    });
    // Without `prices.inr` the INR selling side (customer quote, agreed price, advance) is removed from quote/order responses.
    const INR_KEYS = new Set(['clientPrice', 'clientCurrency', 'clientNotes', 'cq', 'cqTotals', 'pdfToken', 'pdfUrl', 'agreedPrice', 'advance', 'total']);
    const stripInr = (v: unknown): unknown => Array.isArray(v) ? v.map(stripInr) : v && typeof v === 'object' && !(v instanceof Buffer)
      ? Object.fromEntries(Object.entries(v).filter(([k]) => !INR_KEYS.has(k)).map(([k, x]) => [k, stripInr(x)])) : v;
    api.addHook('preSerialization', async (req, _reply, payload) => {
      const u = req.user; if (!u || u.role === 'SUPER_ADMIN' || !sides(u.role).india || can(u, 'prices.inr')) return payload;
      return /^\/api\/(quotes|orders|leads\/[^/]+\/quotes)/.test(req.url) ? stripInr(payload) : payload;
    });
    // Live data: after any successful write, tell every open stream what changed (type + ids only; clients refetch through role-filtered endpoints).
    api.addHook('onResponse', async (req, reply) => {
      if (req.method === 'GET' || reply.statusCode >= 400) return;
      const path = req.url.split('?')[0]; let m: RegExpMatchArray | null; let type = '', id: string | null = null, leadId: string | null = null;
      if ((m = path.match(/^\/api\/(?:records\/leads|leads)\/([^/]+)(\/quotes)?/))) { type = m[2] ? 'quote' : 'lead'; id = m[1]; leadId = m[1]; }
      else if (path === '/api/records/leads') { type = 'lead'; }
      else if ((m = path.match(/^\/api\/quotes\/([^/]+)(\/order)?/))) { type = m[2] ? 'order' : 'quote'; id = m[1]; leadId = (await quotes.get(m[1]))?.leadId ?? null; }
      else if ((m = path.match(/^\/api\/orders\/([^/]+)/))) { type = 'order'; id = m[1]; leadId = (await orders.get(m[1]))?.leadId ?? null; }
      else if ((m = path.match(/^\/api\/shipments\/([^/]+)/))) { type = 'shipment'; id = m[1]; leadId = (await ships.get(m[1]))?.leadId ?? null; }
      else if (path.startsWith('/api/suppliers')) type = 'supplier';
      else if (path.startsWith('/api/customers')) type = 'customer';
      else return;
      await liveData({ type, id, leadId, ...(req.method === 'DELETE' && /^\/api\/(?:records\/leads|leads)\/[^/]+$/.test(path) ? { deleted: true } : {}), at: Date.now() });
    });
    api.get('/api/me', async (req) => me(req.user!));
    // Per-user UI language (devices also keep their own choice).
    api.patch<{ Body: { language?: string } }>('/api/me', async (req, reply) => {
      try { return me(await o.users.setLanguage(req.user!.id, String(req.body?.language ?? ''))); }
      catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    });
    api.post<{ Body: { currentPassword: string; newPassword: string } }>('/api/me/password', async (req, reply) => {
      if (!(await o.users.verify(req.user!.email, req.body?.currentPassword ?? ''))) return reply.code(400).send({ error: 'Current password is wrong' });
      try { await o.users.setPassword(req.user!.id, String(req.body.newPassword ?? '')); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      // All other sessions are revoked (token version bumped); this device gets a fresh token.
      const nu = o.users.byId(req.user!.id)!;
      const rq = (req.body ?? {}) as { refresh?: boolean; device?: string };
      return { token: sign(nu), ...(rq.refresh ? { refreshToken: await issueRefresh(nu, rq.device) } : {}) };
    });
    api.post('/api/me/avatar', async (req) => { await avatars.set(req.user!.id, await readImage(req)); return me(req.user!); });
    api.delete('/api/me/avatar', async (req) => { await avatars.remove(req.user!.id); return me(req.user!); });
    // Names + pictures of active staff, to show avatars next to names (timeline, notifications…).
    api.get('/api/people', async () => { const a = avatars.urls(); return { data: o.users.list().filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, avatarUrl: a.get(u.id) ?? null })) }; });

    // ---- Enquiry attachments: only for a lead the user can read. Never a public URL. ----
    const attLead = async (req: FastifyRequest<{ Params: { id: string } }>) => {
      // Product photos/documents: any side that can read the lead (China only sees China-assigned leads).
      const role = req.user!.role;
      const r = await leadDb.get(req.params.id);
      if (!r || !readFilter('lead', r, await ctxOf(role))) throw Object.assign(new Error('Not found'), { status: 404 });
      const sc = await scope(req.user!); if (sc && !sc.has(String(r.id))) throw Object.assign(new Error('Not found'), { status: 404 });
      return String(r.id);
    };
    api.get<{ Params: { id: string } }>('/api/leads/:id/attachments', async (req) => ({ data: uploads.list(await attLead(req)) }));
    const sendFile = (req: FastifyRequest, reply: any, f: { meta: { mime: string; name: string }; path: string; size: number }, name = f.meta.name) => {
      const inline = /^image\/(jpeg|png|webp)$|^application\/pdf$|^video\//.test(f.meta.mime);
      reply.header('content-type', f.meta.mime).header('cache-control', 'private, no-store').header('accept-ranges', 'bytes')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
      // HTTP Range so videos can be played/seeked without downloading the whole file first. Original bytes, never re-encoded.
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
        if (start >= f.size || start > end) return reply.code(416).header('content-range', `bytes */${f.size}`).send();
        return reply.code(206).header('content-range', `bytes ${start}-${end}/${f.size}`).header('content-length', end - start + 1)
          .send(createReadStream(f.path, { start, end }));
      }
      return reply.header('content-length', f.size).send(createReadStream(f.path));
    };
    api.get<{ Params: { id: string; fid: string } }>('/api/leads/:id/attachments/:fid', async (req, reply) => {
      const f = uploads.file(await attLead(req), req.params.fid);
      if (!f) return reply.code(404).send({ error: 'Not found' });
      return sendFile(req, reply, f);
    });
    // India side (and super admin) attach product photos/videos to a lead from the web or Android app.
    const attWrite = async (req: FastifyRequest<{ Params: { id: string } }>) => {
      if (!sides(req.user!.role).india) throw new Forbidden('Only the India office can change lead files');
      return attLead(req);
    };
    const syncCount = (leadId: string, list: Parameters<typeof mediaSync>[1]) => mediaSync(leadId, list);
    api.post<{ Params: { id: string } }>('/api/leads/:id/attachments', async (req, reply) => {
      const id = await attWrite(req);
      if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart/form-data expected' });
      const m = await readMultipart(req, MAX_STAFF_FILES);
      if (m.err) return reply.code(m.err.status).send({ error: m.err.error, code: m.err.code });
      if (uploads.list(id).length + m.files.length > 30) { uploads.discard(m.files); return reply.code(413).send({ error: 'Up to 30 files per lead', code: 'count' }); }
      const list = uploads.commit(id, m.files, req.user!.id);
      await syncCount(id, list);
      await ev(id, 'MEDIA_ADDED', req.user!, { count: m.files.length });
      return reply.code(201).send({ data: list });
    });
    api.delete<{ Params: { id: string; fid: string } }>('/api/leads/:id/attachments/:fid', async (req, reply) => {
      // Any signed-in user who can see this lead may delete its media (attLead 404s otherwise).
      const id = await attLead(req), u = req.user!;
      const meta = uploads.list(id).find((f) => f.id === req.params.fid); if (!meta) return reply.code(404).send({ error: 'Not found' });
      const rest = uploads.remove(id, req.params.fid)!;
      await syncCount(id, rest);
      await ev(id, 'MEDIA_REMOVED', u, { name: meta.name });
      return { data: rest };
    });

    // ---- Supplier quotes on a lead (China writes; India reads a redacted view + adds its selling price) ----
    const qKey = (id: string) => `q_${id.replace(/-/g, '')}`.slice(0, 64);
    const quoteOf = async (req: FastifyRequest<{ Params: { qid: string } }>) => {
      const q = await quotes.get(req.params.qid);
      if (!q) throw Object.assign(new Error('Not found'), { status: 404 });
      await attLead({ ...req, params: { id: q.leadId } } as any); // 404 unless this user can read the lead
      return q;
    };
    const canEditQuote = (role: Role, uid: string, q: Quote) => role === 'SUPER_ADMIN' || role === 'CHINA_ADMIN' || (role === 'CHINA_STAFF' && q.createdBy === uid);
    /** China + super admin: everything. India: no supplier id/identity/contact, neutral file names. */
    const viewQuote = async (u: { role: Role; id: string }, q: Quote, i: number, ref: string | null) => {
      const role = u.role;
      const s = sides(role), names = userNames();
      const files = uploads.list(qKey(q.id));
      const base = { id: q.id, leadId: q.leadId, product: q.product, unitPrice: q.unitPrice, currency: q.currency, moq: q.moq, leadTime: q.leadTime,
        validity: q.validity, notes: q.notes, createdAt: q.createdAt, updatedAt: q.updatedAt,
        shipCost: q.shipCost, shipCurrency: q.shipCurrency, shipTerm: q.shipTerm, shipMode: q.shipMode, shipPort: q.shipPort, shipTransit: q.shipTransit,
        status: q.status, sentAt: q.sentAt, decidedAt: q.decidedAt, rejectReason: q.rejectReason, revision: q.revision,
        revRequest: q.revRequest ? { note: q.revRequest.note, at: q.revRequest.at, byName: (q.revRequest.by && names.get(q.revRequest.by)) || null } : null, orderId: (await orders.byQuote(q.id))?.id ?? null };
      const client = { clientPrice: q.clientPrice, clientCurrency: q.clientCurrency, clientNotes: q.clientNotes, cq: q.cq, cqTotals: q.cq ? cqTotals(q.cq) : null,
        pdfUrl: q.pdfToken ? `/api/public/cq/${q.pdfToken}.pdf` : null };
      if (s.china) {
        const sup = q.supplierId ? await quotes.supplier(q.supplierId) : null;
        return { ...base, ...(s.india ? client : {}), supplierId: q.supplierId, supplier: sup, createdBy: q.createdBy, createdByName: names.get(q.createdBy) ?? null, canEdit: canEditQuote(role, u.id, q), files };
      }
      return { ...base, ...client, label: `${ref ?? 'Quote'}-Q${i + 1}`,
        files: files.map((f, k) => ({ ...f, name: `${ref ?? 'quote'}-Q${i + 1}-${k + 1}${(/\.[A-Za-z0-9]{1,5}$/.exec(f.name)?.[0] ?? '').toLowerCase()}` })) };
    };
    const leadRefOf = async (id: string) => ((await leadDb.get(id))?.leadRef as string | undefined) ?? null;
    const chinaOnly = (role: Role) => { if (!sides(role).china) throw new Forbidden('Only the China office can do this'); };
    api.get<{ Params: { id: string } }>('/api/leads/:id/quotes', async (req) => {
      need(req.user!, 'quotes.view');
      const id = await attLead(req), ref = await leadRefOf(id);
      return { data: await Promise.all((await quotes.list(id)).map((q, i) => viewQuote(req.user!, q, i, ref))) };
    });
    api.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/leads/:id/quotes', async (req, reply) => {
      chinaOnly(req.user!.role);
      const id = await attLead(req);
      if ((await quotes.count(id)) >= 50) return reply.code(413).send({ error: 'Up to 50 quotes per lead' });
      let body = { ...(req.body ?? {}) } as Record<string, unknown>;
      if (body.newSupplier && typeof body.newSupplier === 'object') body.supplierId = (await quotes.addSupplier(body.newSupplier as any, req.user!.id)).id;
      const q = await quotes.create(id, body, req.user!.id);
      const list = await quotes.list(id);
      await ev(id, 'QUOTE_ADDED', req.user!, { n: list.findIndex((x) => x.id === q.id) + 1, supplier: q.supplierId ? (await quotes.supplier(q.supplierId))?.name ?? null : null });
      return reply.code(201).send({ data: await viewQuote(req.user!, q, list.findIndex((x) => x.id === q.id), await leadRefOf(id)) });
    });
    api.patch<{ Params: { qid: string }; Body: Record<string, unknown> }>('/api/quotes/:qid', async (req) => {
      const q = await quoteOf(req), role = req.user!.role, s = sides(role), b = { ...(req.body ?? {}) };
      const clientKeys = ['clientPrice', 'clientCurrency', 'clientNotes'];
      let n = q;
      if (clientKeys.some((k) => k in b)) {
        if (!s.india) throw new Forbidden('Only the India office sets the customer price');
        n = await quotes.setClient(q.id, Object.fromEntries(clientKeys.filter((k) => k in b).map((k) => [k, b[k]])));
      }
      const chinaKeys = Object.keys(b).filter((k) => !clientKeys.includes(k));
      if (chinaKeys.length) {
        if (!canEditQuote(role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can edit it');
        if (b.newSupplier && typeof b.newSupplier === 'object') b.supplierId = (await quotes.addSupplier(b.newSupplier as any, req.user!.id)).id;
        delete b.newSupplier; for (const k of clientKeys) delete b[k];
        n = await quotes.update(q.id, b);
      }
      const list = await quotes.list(q.leadId), qn = list.findIndex((x) => x.id === n.id) + 1;
      if (chinaKeys.length) await ev(q.leadId, 'QUOTE_EDITED', req.user!, { n: qn });
      if (clientKeys.some((k) => k in (req.body ?? {}))) await ev(q.leadId, 'CQ_PREPARED', req.user!, { n: qn, edit: true }, 'INDIA');
      return { data: await viewQuote(req.user!, n, list.findIndex((x) => x.id === n.id), await leadRefOf(q.leadId)) };
    });
    api.delete<{ Params: { qid: string } }>('/api/quotes/:qid', async (req, reply) => {
      const q = await quoteOf(req);
      if (!canEditQuote(req.user!.role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can delete it');
      await quotes.remove(q.id); uploads.removeAll(qKey(q.id)); await mediaSync(qKey(q.id), []); { const x = await orders.byQuote(q.id); if (x) await ships.removeOrder(x.id); } await orders.removeQuote(q.id);
      return reply.code(204).send();
    });
    api.post<{ Params: { qid: string } }>('/api/quotes/:qid/files', async (req, reply) => {
      const q = await quoteOf(req);
      if (!canEditQuote(req.user!.role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can add files');
      if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart/form-data expected' });
      const m = await readMultipart(req, MAX_STAFF_FILES);
      if (m.err) return reply.code(m.err.status).send({ error: m.err.error, code: m.err.code });
      if (uploads.list(qKey(q.id)).length + m.files.length > 30) { uploads.discard(m.files); return reply.code(413).send({ error: 'Up to 30 files per quote', code: 'count' }); }
      await mediaSync(qKey(q.id), uploads.commit(qKey(q.id), m.files, req.user!.id));
      const list = await quotes.list(q.leadId);
      return reply.code(201).send({ data: await viewQuote(req.user!, q, list.findIndex((x) => x.id === q.id), await leadRefOf(q.leadId)) });
    });
    api.get<{ Params: { qid: string; fid: string } }>('/api/quotes/:qid/files/:fid', async (req, reply) => {
      const q = await quoteOf(req);
      const all = uploads.list(qKey(q.id)), k = all.findIndex((a) => a.id === req.params.fid);
      const f = uploads.file(qKey(q.id), req.params.fid);
      if (!f) return reply.code(404).send({ error: 'Not found' });
      if (sides(req.user!.role).china) return sendFile(req, reply, f);
      const ref = await leadRefOf(q.leadId), i = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id);
      return sendFile(req, reply, f, `${ref ?? 'quote'}-Q${i + 1}-${k + 1}${(/\.[A-Za-z0-9]{1,5}$/.exec(f.meta.name)?.[0] ?? '').toLowerCase()}`);
    });
    api.delete<{ Params: { qid: string; fid: string } }>('/api/quotes/:qid/files/:fid', async (req, reply) => {
      const q = await quoteOf(req);
      const u = req.user!, meta = uploads.list(qKey(q.id)).find((f) => f.id === req.params.fid); if (!meta) return reply.code(404).send({ error: 'Not found' });
      const rest = uploads.remove(qKey(q.id), req.params.fid)!;
      await mediaSync(qKey(q.id), rest);
      await ev(q.leadId, 'MEDIA_REMOVED', u, { quote: true });
      return reply.code(204).send();
    });
    // ---- All quotes across leads (role-filtered) ----
    const readableLeads = async (u: User) => {
      const [rows, ctx, sc] = await Promise.all([leadDb.list(), ctxOf(u.role), scope(u)]);
      const all = await assign.all(), names = userNames(), m = new Map<string, Rec>();
      for (const r of rows) { const f = readFilter('lead', r, ctx); if (f && (!sc || sc.has(String(f.id)))) m.set(String(f.id), await decorate(f, all.get(String(f.id)), names)); }
      return m;
    };
    const quoteRow = async (u: { role: Role; id: string }, q: Quote, lead: Rec, keepFiles = false) => {
      const i = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id);
      const v: any = await viewQuote(u, q, i, (lead.leadRef as string) ?? null);
      if (!keepFiles) delete v.files; // the all-quotes list omits files; single-quote responses keep them (the lead panel renders them)
      return { ...v, label: `${lead.leadRef ?? 'Quote'}-Q${i + 1}`, leadRef: lead.leadRef ?? null, leadStatus: lead.status ?? null, ownerOffice: lead.ownerOffice,
        assignedTo: lead.assignedTo ?? null, assignedToName: lead.assignedToName ?? null, raisedBy: lead.raisedBy ?? null };
    };
    api.get<{ Querystring: { status?: string; office?: string; mine?: string } }>('/api/quotes', async (req) => {
      need(req.user!, 'quotes.view');
      const u = req.user!, leads = await readableLeads(u), q = req.query ?? {};
      let rows = await Promise.all((await quotes.all()).filter((x) => leads.has(x.leadId)).map((x) => quoteRow(u, x, leads.get(x.leadId)!)));
      if (q.status) rows = rows.filter((r) => r.status === String(q.status).toUpperCase());
      if (q.office) rows = rows.filter((r) => r.ownerOffice === String(q.office).toUpperCase());
      if (q.mine === '1' || q.mine === 'true') rows = rows.filter((r) => r.assignedTo === u.id || r.raisedBy === u.id || (r as any).createdBy === u.id);
      return { data: rows };
    });
    const indiaOnly = (role: Role) => { if (!sides(role).india) throw new Forbidden('Only the India office can do this'); };
    const leadOf = async (id: string) => { const l = await leadDb.get(id); if (!l) throw Object.assign(new Error('Not found'), { status: 404 }); return l; };
    const refresh = async (u: User, q: Quote) => { const l = await leadOf(q.leadId); return quoteRow(u, (await quotes.get(q.id))!, await decorate(l, await assign.get(q.leadId), userNames()), true); };
    /** Notify about a lead-level event (quote decided, order created/updated). */
    const tell = async (recips: (string | null | undefined)[], lead: Rec, kind: 'QUOTE_ACCEPTED' | 'QUOTE_REJECTED' | 'QUOTE_REVERTED' | 'ORDER_NEW' | 'ORDER_UPDATE' | 'SHIPMENT_UPDATE' | 'ORDER_SHIPPED' | 'LEAD_CLOSED', office: Office, actor: { id: string; name: string }) => {
      const ids = [...new Set(recips.filter((x): x is string => !!x && x !== actor.id && !!o.users.byId(x)?.active))];
      if (ids.length) await assign.notify(ids, { leadId: String(lead.id), leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind, office, byName: actor.name });
    };
    /** India side of a lead: its raiser/assignee, else India admins + super admin. China side: who quoted, else China assignee, else China admins. */
    const indiaPeople = async (leadId: string) => { const a = await assign.get(leadId); const p = [a?.ownerOffice === 'INDIA' ? a?.assignedTo : null, a?.raisedBy].filter(Boolean) as string[]; return p.length ? p : queueWatchers('INDIA'); };
    const chinaPeople = async (q: Quote) => { const a = await assign.get(q.leadId); const p = [q.createdBy, a?.ownerOffice === 'CHINA' ? a?.assignedTo : null].filter((x) => x && officeOf(o.users.byId(x)?.role as Role) === 'CHINA') as string[]; return p.length ? p : queueWatchers('CHINA'); };
    api.put<{ Params: { qid: string }; Body: Record<string, unknown> }>('/api/quotes/:qid/customer', async (req) => {
      indiaOnly(req.user!.role); const q = await quoteOf(req);
      const n = await quotes.setCustomer(q.id, req.body ?? {});
      await ev(q.leadId, 'CQ_PREPARED', req.user!, { n: (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id) + 1, edit: !!q.cq }, 'INDIA');
      return { data: await refresh(req.user!, n) };
    });
    api.post<{ Params: { qid: string } }>('/api/quotes/:qid/pdf', async (req) => {
      indiaOnly(req.user!.role); const q = await quoteOf(req);
      if (!q.cq) throw bad('Prepare the customer quote first');
      if (!q.pdfToken) await quotes.setToken(q.id, randomBytes(32).toString('base64url'));
      return { data: await refresh(req.user!, q) };
    });
    /**
     * The one customer-decision flow for a quote, used by India staff and by the customer portal.
     * `actor` is the staff user (null for a customer); `by` names who decided (notifications, rejection record).
     */
    const applyQuoteStatus = async (actor: User | null, by: { id: string; name: string }, q: Quote, b: Rec & { status?: string; reason?: string }) => {
      const st = String(b.status ?? '').toUpperCase() as Quote['status'];
      if (!QUOTE_STATUSES.includes(st)) throw bad('status must be DRAFT, SENT, ACCEPTED or REJECTED');
      if (st !== 'DRAFT' && !q.cq) throw bad('Prepare the customer quote first');
      if (q.status === 'ACCEPTED' && st !== 'ACCEPTED') throw new Forbidden('An accepted quote can only be reverted by the super admin (Revert acceptance)');
      const rcode = String((b as Rec).reasonCode ?? (st === 'REJECTED' && String(b.reason ?? '').trim() ? 'OTHER' : '')).toUpperCase();
      if (st === 'REJECTED' && !REJECT_REASONS.includes(rcode as any)) throw bad('A reason is required when the customer rejects');
      if (st === 'REJECTED' && rcode === 'OTHER' && !String(b.reason ?? '').trim()) throw bad('A reason is required when the customer rejects');
      if (st === 'DRAFT' && (await orders.byQuote(q.id))) throw bad('This quote already has an order');
      const prevLeadStatus = (await leadOf(q.leadId)).status ?? null;
      await quotes.setStatus(q.id, st, st === 'REJECTED' ? (String(b.reason ?? '').trim() || rcode) : b.reason);
      const lead = await leadOf(q.leadId), qn = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id) + 1;
      if (st !== q.status && st !== 'DRAFT') {
        await ev(q.leadId, st === 'SENT' ? 'CQ_SENT' : st === 'ACCEPTED' ? 'CQ_ACCEPTED' : 'CQ_REJECTED', actor, { n: qn, ...(actor ? {} : { byCustomer: true }), ...(st === 'REJECTED' ? { reasonCode: rcode, reason: String(b.reason ?? '').trim().slice(0, 500) } : {}), ...(st === 'ACCEPTED' ? { quoteId: q.id, prevLeadStatus, prevQuoteStatus: q.status } : {}) });
        await stopClock(q.leadId, 'INDIA'); // sending (or closing) the customer quote is India's next action
      }
      if (st === 'ACCEPTED') {
        const p = await rejects.pending(q.leadId); if (p) await rejects.resolve(p.id, 'REVISE', by.id, {});
        const patch: Rec = { status: 'WON' };
        await leadDb.update(q.leadId, patch); Object.assign(lead, patch);
        await tell(await chinaPeople(q), lead, 'QUOTE_ACCEPTED', 'CHINA', by);
        if (!actor) await tell(await indiaPeople(q.leadId), lead, 'QUOTE_ACCEPTED', 'INDIA', by); // India reviews and creates the order (never automatic)
      }
      if (st === 'REJECTED') {
        // Not LOST yet: back to the India owner (raiser) with "Rejected – action needed".
        await rejects.add(q.leadId, q.id, rcode, b.reason, by.id);
        await handoff(lead, actor, 'INDIA', undefined);
        await tell(await chinaPeople(q), lead, 'QUOTE_REJECTED', 'CHINA', by);
        if (!actor) await tell(await indiaPeople(q.leadId), lead, 'QUOTE_REJECTED', 'INDIA', by);
      }
      return quotes.get(q.id);
    };
    api.post<{ Params: { qid: string }; Body: { status?: string; reason?: string } }>('/api/quotes/:qid/status', async (req) => {
      const u = req.user!; indiaOnly(u.role); const q = await quoteOf(req);
      await applyQuoteStatus(u, u, q, req.body ?? {});
      return { data: await refresh(u, q) };
    });
    // ---- Super admin: undo a customer acceptance recorded by mistake ----
    /** Order "progress" that makes a revert destructive: any payment, production past NEW, or shipment past PENDING. */
    const orderProgress = async (ord: Order) => {
      const shp = await ships.byOrder(ord.id), why: string[] = [];
      if (ord.paymentStatus !== 'PENDING' || Number(ord.advance ?? 0) > 0) why.push('payment');
      if (ord.production && ord.production !== 'NEW') why.push('production');
      if (shp && shp.status && shp.status !== 'PENDING') why.push('shipment');
      if (ord.closedAt) why.push('closed');
      return why;
    };
    api.get<{ Params: { qid: string } }>('/api/quotes/:qid/revert-acceptance', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can revert an acceptance');
      const q = await quoteOf(req); const ord = await orders.byQuote(q.id);
      return { data: { status: q.status, canRevert: q.status === 'ACCEPTED', order: ord ? { id: ord.id, progress: await orderProgress(ord) } : null } };
    });
    api.post<{ Params: { qid: string }; Body: { reason?: string; to?: string; cancelOrder?: boolean; force?: boolean } }>('/api/quotes/:qid/revert-acceptance', async (req) => {
      const u = req.user!; if (u.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can revert an acceptance');
      const q = await quoteOf(req), b = req.body ?? {};
      if (q.status !== 'ACCEPTED') throw bad('Only an accepted quote can be reverted', 409);
      const reason = String(b.reason ?? '').trim();
      if (reason.length < 3) throw bad('A reason is required to revert an acceptance');
      const to = String(b.to ?? 'SENT').toUpperCase();
      if (!['SENT', 'DRAFT'].includes(to)) throw bad('to must be SENT or DRAFT');
      const ord = await orders.byQuote(q.id);
      let orderRemoved: string | null = null;
      if (ord) {
        const progress = await orderProgress(ord);
        if (!b.cancelOrder) throw bad(`An order was already created from this quote${progress.length ? ` (has ${progress.join(', ')})` : ''}. Cancel the order to revert.`, 409);
        if (progress.length && !b.force) throw bad(`The order already has ${progress.join(', ')}. Use force to cancel it anyway — this deletes the order and its shipment.`, 409);
        await ships.removeOrder(ord.id); await orders.removeQuote(q.id); orderRemoved = ord.id;
        await ev(q.leadId, 'ORDER_CANCELLED', u, { orderId: ord.id, forced: !!progress.length, progress, reason: reason.slice(0, 500) });
      }
      const evs = await wf.events(q.leadId);
      const acc = [...evs].reverse().find((e) => e.kind === 'CQ_ACCEPTED' && (!e.data.quoteId || e.data.quoteId === q.id));
      const lead = await leadOf(q.leadId);
      const prevLead = (acc?.data.prevLeadStatus as string | undefined) && acc!.data.prevLeadStatus !== 'WON' ? String(acc!.data.prevLeadStatus) : 'QUOTED';
      await quotes.setStatus(q.id, to as Quote['status'], null as any);
      if (lead.status === 'WON') { const patch: Rec = { status: prevLead }; await leadDb.update(q.leadId, patch); Object.assign(lead, patch); }
      const qn = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id) + 1;
      await ev(q.leadId, 'CQ_REVERTED', u, { n: qn, to, reason: reason.slice(0, 500), leadStatus: lead.status ?? null, orderRemoved });
      const recips = [...await indiaPeople(q.leadId), ...await chinaPeople(q)];
      await tell(recips, lead, 'QUOTE_REVERTED', 'INDIA', u);
      if (orderRemoved) await liveData({ type: 'order', id: orderRemoved, leadId: q.leadId, deleted: true, at: Date.now() });
      await liveData({ type: 'lead', id: q.leadId, leadId: q.leadId, at: Date.now() });
      return { data: await refresh(u, (await quotes.get(q.id))!) };
    });
    // ---- Send-back loop: China asks India for missing lead details; India asks China to revise a quote. ----
    // Notes are free text, shown to both offices on the timeline: nothing strips customer/supplier names typed into them.
    const noteOf = (b: Rec | undefined, required = true) => {
      const t = typeof b?.note === 'string' ? b.note.trim().slice(0, 2000) : '';
      if (required && !t) throw bad('A note is required');
      return t || null;
    };
    const sbOut = async (u: User, lead: Rec) => decorate(readFilter('lead', lead, await ctxOf(u.role))!, await assign.get(String(lead.id)), userNames());
    const activeChina = (id: string | null | undefined) => { const x = id ? o.users.byId(id) : null; return x && x.active && officeOf(x.role) === 'CHINA' ? x.id : null; };
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/send-back', async (req) => {
      const u = req.user!; chinaOnly(u.role);
      const id = await attLead(req), lead = await leadOf(id), a = await assign.get(id), note = noteOf(req.body)!;
      if ((a?.ownerOffice ?? (lead.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA')) !== 'CHINA') throw bad('Only a lead China is holding can be sent back', 409);
      const from = activeChina(a?.assignedTo) ?? activeChina(u.id);
      await ev(id, 'SENT_BACK', u, { to: 'INDIA', note });
      await handoff(lead, u, 'INDIA', undefined, { kind: 'SENT_BACK', detail: note.slice(0, 120) });
      await wf.setSendBack(id, { side: 'INDIA', note, by: u.id, quoteId: null, from });
      await liveData({ type: 'lead', id, leadId: id, at: Date.now() });
      return { data: await sbOut(u, lead) };
    });
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/resend', async (req) => {
      const u = req.user!; indiaOnly(u.role);
      const id = await attLead(req), lead = await leadOf(id), sb = (await wf.meta(id)).sendBack, note = noteOf(req.body)!;
      if (sb?.side !== 'INDIA' || sb.quoteId) throw bad('This lead has no open request from China', 409);
      await ev(id, 'BACK_ANSWERED', u, { to: 'CHINA', note });
      await handoff(lead, u, 'CHINA', activeChina(sb.from), { kind: 'INFO_PROVIDED', detail: note.slice(0, 120) });
      return { data: await sbOut(u, lead) };
    });
    api.post<{ Params: { qid: string }; Body: Rec }>('/api/quotes/:qid/send-back', async (req) => {
      const u = req.user!; indiaOnly(u.role); need(u, 'quotes.view');
      const q = await quoteOf(req), note = noteOf(req.body)!, lead = await leadOf(q.leadId);
      if (q.status === 'ACCEPTED' || (await orders.byQuote(q.id))) throw bad('An accepted quote cannot be sent back', 409);
      const n = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id) + 1;
      await quotes.requestRevision(q.id, note, u.id);
      await ev(q.leadId, 'SENT_BACK', u, { to: 'CHINA', n, rev: q.revision, note });
      if (lead.assignedOffice !== 'CHINA') { await leadDb.update(q.leadId, { assignedOffice: 'CHINA' }); lead.assignedOffice = 'CHINA'; }
      const a = await assign.get(q.leadId);
      await handoff(lead, u, 'CHINA', activeChina(q.createdBy) ?? activeChina(a?.ownerOffice === 'CHINA' ? a?.assignedTo : null), { kind: 'REVISE_REQUESTED', detail: `Q${n}: ${note}`.slice(0, 120) });
      await wf.setSendBack(q.leadId, { side: 'CHINA', note, by: u.id, quoteId: q.id, from: a?.raisedBy ?? u.id });
      await liveData({ type: 'lead', id: q.leadId, leadId: q.leadId, at: Date.now() });
      return { data: await refresh(u, q) };
    });
    api.post<{ Params: { qid: string }; Body: Rec }>('/api/quotes/:qid/resubmit', async (req) => {
      const u = req.user!; chinaOnly(u.role);
      const q = await quoteOf(req), note = noteOf(req.body, false), lead = await leadOf(q.leadId);
      if (!canEditQuote(u.role, u.id, q) && activeChina(u.id) !== (await assign.get(q.leadId))?.assignedTo) throw new Forbidden('Only the China staff working this quote can resubmit it');
      if (!q.revRequest) throw bad('No revision was requested on this quote', 409);
      const n = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id) + 1, nq = await quotes.revised(q.id);
      await ev(q.leadId, 'QUOTE_REVISED', u, { to: 'INDIA', n, rev: nq.revision, note });
      const sb = (await wf.meta(q.leadId)).sendBack;
      if (sb?.quoteId === q.id) await wf.setSendBack(q.leadId, null);
      const back = sb?.quoteId === q.id && sb.from && indiaOwner(o.users.byId(sb.from)) ? sb.from : undefined;
      await handoff(lead, u, 'INDIA', back, { kind: 'QUOTE_REVISED', detail: `Q${n} rev ${nq.revision}${note ? ': ' + note : ''}`.slice(0, 120) });
      return { data: await refresh(u, nq) };
    });
    // ---- Customer rejection follow-up (India): request a revised quote from China, or close as LOST ----
    const rejLead = async (u: User, id: string) => {
      if (!sides(u.role).india) throw new Forbidden('Only the India office handles customer rejections');
      const lead = await leadOf(id);
      const p = await rejects.pending(id); if (!p) throw bad('This lead has no open customer rejection');
      return { lead, p };
    };
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/rejection/revise', async (req) => {
      const u = req.user!, { lead, p } = await rejLead(u, req.params.id), b = req.body ?? {};
      await rejects.resolve(p.id, 'REVISE', u.id, { targetPrice: b.targetPrice, targetCurrency: b.targetCurrency, notes: b.notes });
      const q = await quotes.get(p.quoteId), maker = q?.createdBy ? o.users.byId(q.createdBy) : null;
      const to = maker && maker.active && officeOf(maker.role) === 'CHINA' ? maker.id : null;
      const patch: Rec = { assignedOffice: 'CHINA', status: 'SOURCING' };
      await leadDb.update(String(lead.id), patch); Object.assign(lead, patch);
      await ev(String(lead.id), 'REVISE_REQUESTED', u, { reasonCode: p.reasonCode, reason: p.reasonText ?? null, targetPrice: b.targetPrice ?? null, targetCurrency: b.targetCurrency ?? null, notes: b.notes ?? null });
      await handoff(lead, u, 'CHINA', to);
      const recips = (to ? [to] : queueWatchers('CHINA')).filter((x) => x !== u.id);
      await assign.notify(recips, { leadId: String(lead.id), leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind: 'REVISE_REQUESTED', office: 'CHINA', byName: u.name });
      return { data: await decorate(readFilter('lead', lead, await ctxOf(u.role))!, await assign.get(String(lead.id)), userNames()) };
    });
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/rejection/close', async (req) => {
      const u = req.user!, { lead, p } = await rejLead(u, req.params.id);
      await rejects.resolve(p.id, 'CLOSED', u.id, { notes: (req.body ?? {}).notes });
      const patch: Rec = { status: 'LOST', winLossReason: [p.reasonCode, p.reasonText].filter(Boolean).join(': ').slice(0, 500) };
      await leadDb.update(String(lead.id), patch); Object.assign(lead, patch);
      await ev(String(lead.id), 'LEAD_CLOSED', u, { reasonCode: p.reasonCode, reason: p.reasonText ?? null }); await stopClock(String(lead.id));
      const q = await quotes.get(p.quoteId); if (q) await tell(await chinaPeople(q), lead, 'LEAD_CLOSED', 'CHINA', u);
      return { data: await decorate(readFilter('lead', lead, await ctxOf(u.role))!, await assign.get(String(lead.id)), userNames()) };
    });
    // Public, unguessable link (32 random bytes) so the customer can open the PDF from WhatsApp/email.
    app.get<{ Params: { token: string }; Querystring: { dl?: string } }>('/api/public/cq/:token', async (req, reply) => {
      const q = await quotes.byToken(req.params.token.replace(/\.pdf$/, ''));
      if (!q?.cq) return reply.code(404).send({ error: 'Not found' });
      const lead = (await leadDb.get(q.leadId)) as any;
      const i = (await quotes.list(q.leadId)).findIndex((x) => x.id === q.id), ref = lead?.leadRef ?? 'SE', label = `${ref}-Q${i + 1}`;
      const photos = uploads.list(qKey(q.id)).filter((f) => /^image\/(png|jpe?g)$/.test(f.mime)).map((f) => uploads.file(qKey(q.id), f.id)?.path).filter((p): p is string => !!p);
      const pdf = await customerQuotePdf({ ref, label, product: q.product, customer: lead?.clientName ?? null, cq: q.cq, moq: q.moq, leadTime: q.leadTime,
        date: new Date(q.sentAt ?? q.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }), photos });
      return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `${req.query?.dl ? 'attachment' : 'inline'}; filename="Quotation-${label}.pdf"`)
        .header('Cache-Control', 'private, no-store').header('X-Robots-Tag', 'noindex').send(pdf);
    });

    // ---- Orders (v1) ----
    const viewOrder = async (u: User, ord: Order, lead: Rec | null) => {
      const s = sides(u.role), q = await quotes.get(ord.quoteId), shp = await ships.byOrder(ord.id);
      const base = { id: ord.id, leadId: ord.leadId, quoteId: ord.quoteId, leadRef: ord.leadRef, product: ord.product, qty: ord.qty, expectedShip: ord.expectedShip,
        production: ord.production, tracking: ord.tracking, container: ord.container, etd: ord.etd, eta: ord.eta, indiaStatus: ord.indiaStatus,
        createdAt: ord.createdAt, updatedAt: ord.updatedAt, leadStatus: lead?.status ?? null, shipmentId: shp?.id ?? null, shipmentRef: shp?.ref ?? null, closed: !!ord.closedAt, closedAt: ord.closedAt };
      const india = { agreedPrice: ord.agreedPrice, advance: ord.advance, paymentStatus: ord.paymentStatus, paymentPending: ord.paymentStatus !== 'PAID', total: ord.qty * ord.agreedPrice,
        customer: lead?.clientName ?? null, assignedToName: (lead as any)?.assignedToName ?? null };
      const china = { supplier: q?.supplierId ? await quotes.supplier(q.supplierId) : null, unitPrice: q?.unitPrice ?? null, currency: q?.currency ?? null,
        shipCost: q?.shipCost ?? null, shipCurrency: q?.shipCurrency ?? null };
      if (s.superAdmin) return { ...base, ...india, ...china };
      return s.india ? { ...base, ...india } : { ...base, ...china };
    };
    const orderOf = async (u: User, id: string) => {
      const ord = await orders.get(id); if (!ord) throw Object.assign(new Error('Not found'), { status: 404 });
      const lead = (await readableLeads(u)).get(ord.leadId);
      if (!lead && !(sides(u.role).china && can(u, 'leads.all'))) throw Object.assign(new Error('Not found'), { status: 404 });
      return { ord, lead: lead ?? null };
    };
    api.post<{ Params: { qid: string }; Body: Record<string, unknown> }>('/api/quotes/:qid/order', async (req, reply) => {
      const u = req.user!; indiaOnly(u.role); const q = await quoteOf(req);
      if (q.status !== 'ACCEPTED') throw bad('Only an accepted quote can become an order');
      if (await orders.byQuote(q.id)) throw bad('This quote already has an order', 409);
      const lead = await leadOf(q.leadId), b = req.body ?? {};
      const ord = await orders.create({ leadId: q.leadId, quoteId: q.id, leadRef: (lead.leadRef as string) ?? null, product: q.product },
        { qty: q.cq?.qty, agreedPrice: q.cq?.unitPrice, ...b }, u.id);
      await shipFor(ord);
      await tell(await chinaPeople(q), lead, 'ORDER_NEW', 'CHINA', u);
      await ev(q.leadId, 'ORDER_CREATED', u, { qty: ord.qty });
      return reply.code(201).send({ data: await viewOrder(u, ord, await decorate(lead, await assign.get(q.leadId), userNames())) });
    });
    api.get('/api/orders', async (req) => {
      const u = req.user!, leads = await readableLeads(u), china = sides(u.role).china && can(u, 'leads.all');
      return { data: await Promise.all((await orders.all()).filter((x) => china || leads.has(x.leadId)).map((x) => viewOrder(u, x, leads.get(x.leadId) ?? null))) };
    });
    api.get<{ Params: { id: string } }>('/api/orders/:id', async (req) => { const { ord, lead } = await orderOf(req.user!, req.params.id); return { data: await viewOrder(req.user!, ord, lead) }; });
    /**
     * The one gated order/shipment workflow (used by Orders, Shipping and lead status changes):
     *  China: NEW > DEPOSIT_PAID > IN_PRODUCTION > READY > SHIPPED (needs tracking or container no + ETD; cannot be undone).
     *  India (only after SHIPPED): IN_TRANSIT > CUSTOMS > OUT_FOR_DELIVERY > DELIVERED.
     * Marking SHIPPED moves the lead to SHIPPING, the shipment to IN_TRANSIT with China's data, and notifies India (real-time).
     */
    const IND_TO_SHIP: Record<string, string> = { IN_TRANSIT: 'IN_TRANSIT', CUSTOMS: 'CUSTOMS', OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERED: 'DELIVERED' };
    const SHIP_TO_IND: Record<string, string> = { IN_TRANSIT: 'IN_TRANSIT', ARRIVED: 'IN_TRANSIT', CUSTOMS: 'CUSTOMS', CLEARED: 'CUSTOMS', OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERED: 'DELIVERED' };
    const setLeadStatus = async (leadId: string, lead: Rec | null, ls: string) => {
      if (lead?.status === ls) return;
      try { await leadDb.update(leadId, { status: ls }); if (lead) lead.status = ls; }
      catch (e) { app.log.error({ err: e, leadId, ls }, 'lead status sync failed'); }
    };
    /** Delivered = done: once every shipped order of a lead is delivered, the lead closes as Completed, its SLA stops, and India + super admins are told. */
    const completeIfDelivered = async (leadId: string, lead: Rec | null, u: User | null) => {
      const l = lead ?? (await leadDb.get(leadId)); if (!l || ['COMPLETED', 'LOST', 'CLOSED'].includes(String(l.status))) return false;
      const os = await orders.byLead(leadId); if (!os.length || os.some((x) => x.indiaStatus !== 'DELIVERED')) return false;
      await setLeadStatus(leadId, l, 'COMPLETED'); await stopClock(leadId); await orders.setClosed(leadId, true);
      const unpaid = os.filter((x) => x.paymentStatus !== 'PAID').length;
      if (!(await wf.events(leadId)).some((e) => e.kind === 'COMPLETED')) await ev(leadId, 'COMPLETED', u, { from: 'DELIVERED', orders: os.length, unpaid });
      for (const x of os) await liveData({ type: 'order', id: x.id, leadId, closed: true, at: Date.now() });
      const supers = o.users.list().filter((x) => x.active && x.role === 'SUPER_ADMIN').map((x) => x.id);
      const rs = [...new Set([...(await indiaPeople(leadId)), ...supers].filter((x) => x && x !== u?.id && !!o.users.byId(x)?.active))];
      if (rs.length) await assign.notify(rs, { leadId, leadRef: (l.leadRef as string) ?? null, product: (l.productInterest as string) ?? null, kind: 'LEAD_COMPLETED', office: 'INDIA', byName: u?.name ?? null, detail: 'DELIVERED' });
      await liveData({ type: 'lead', id: leadId, leadId, completed: true, at: Date.now() });
      return true;
    };
    // One-off: leads already delivered before auto-close existed are closed as Completed now.
    const cbf = setTimeout(() => { void (async () => {
      if (!(await wf.once('delivered-close-v2'))) return;
      let n = 0;
      for (const l of await leadDb.list()) {
        const id = String(l.id);
        if (String(l.status) === 'DELIVERED' && !(await orders.byLead(id)).length) { await setLeadStatus(id, l, 'COMPLETED'); await stopClock(id); await ev(id, 'COMPLETED', null, { from: 'DELIVERED', backfill: true }); n++; continue; }
        if (await completeIfDelivered(id, l, null)) n++;
      }
      app.log.info({ n }, 'delivered-close backfill');
    })().catch((e) => app.log.warn(e, 'delivered-close backfill failed')); }, 8000);
    cbf.unref?.(); app.addHook('onClose', async () => clearTimeout(cbf));
    const applyOrder = async (u: User, ord: Order, lead: Rec | null, b: Rec, shipExtra: Rec = {}) => {
      const has = (k: string) => k in b, val = (k: string) => (has(k) ? (b[k] == null ? '' : String(b[k]).trim()) : ((ord as any)[k] ?? ''));
      if (ord.closedAt) throw bad('This order is delivered and closed; the super admin can reopen it', 409);
      const shipped = ord.production === 'SHIPPED';
      if (has('production')) {
        const p = String(b.production ?? '').toUpperCase();
        if (shipped && p !== 'SHIPPED') throw bad('This order is already shipped; production status can no longer change', 409);
        if (!shipped && p === 'SHIPPED') {
          if (!val('tracking') && !val('container')) throw bad('Add the tracking or container number before marking Shipped', 409);
          if (!val('etd')) throw bad('Add the ETD before marking Shipped', 409);
        }
      }
      const willShip = shipped || String(b.production ?? '').toUpperCase() === 'SHIPPED';
      if (has('indiaStatus') && String(b.indiaStatus ?? 'NONE').toUpperCase() !== 'NONE' && !willShip) throw bad('Transit and delivery unlock after China marks the order Shipped', 409);
      if (shipped && has('indiaStatus') && String(b.indiaStatus ?? '').toUpperCase() === 'NONE' && ord.indiaStatus !== 'NONE') throw bad('Shipment status cannot be reset', 409);
      const n = await orders.update(ord.id, b);
      const sh = await shipFor(n), sp: Rec = { ...shipExtra };
      for (const k of ['tracking', 'container', 'etd', 'eta'] as const) if (k in b) sp[k] = n[k];
      const newlyShipped = !shipped && n.production === 'SHIPPED';
      if (newlyShipped && shipRank(sh.status) < shipRank('IN_TRANSIT')) sp.status = 'IN_TRANSIT';
      if (has('indiaStatus') && n.indiaStatus !== ord.indiaStatus && IND_TO_SHIP[n.indiaStatus] && SHIP_TO_IND[String(sp.status ?? sh.status)] !== n.indiaStatus) sp.status = IND_TO_SHIP[n.indiaStatus];
      const nsh = Object.keys(sp).length ? await ships.update(sh.id, sp) : sh;
      // Timeline: shipped is its own milestone; other field changes are logged (payment/price ones India-only).
      const diff = (ks: string[]) => Object.fromEntries(ks.filter((k) => k in b && String((n as any)[k] ?? '') !== String((ord as any)[k] ?? '')).map((k) => [k, (n as any)[k]]));
      if (newlyShipped) { await ev(n.leadId, 'SHIPPED', u, { tracking: n.tracking, container: n.container, etd: n.etd, eta: n.eta }); await stopClock(n.leadId, 'CHINA'); }
      else { const pub = diff([...CHINA_KEYS, 'expectedShip']); if (Object.keys(pub).length) await ev(n.leadId, 'ORDER_UPDATE', u, { fields: pub }); }
      const indChanged = n.indiaStatus !== ord.indiaStatus && !!n.indiaStatus && n.indiaStatus !== 'NONE';
      const shipSt = indChanged ? n.indiaStatus : nsh.status, shipMoved = !newlyShipped && (nsh.status !== sh.status || indChanged);
      if (shipMoved) await ev(n.leadId, 'SHIPMENT_UPDATE', u, { status: shipSt });
      const priv = diff(['qty', 'agreedPrice', 'advance', 'paymentStatus']); if (Object.keys(priv).length) await ev(n.leadId, 'ORDER_UPDATE', u, { fields: priv }, 'INDIA');
      if (n.indiaStatus === 'DELIVERED' && ord.indiaStatus !== 'DELIVERED') await stopClock(n.leadId);
      if (newlyShipped) await setLeadStatus(n.leadId, lead, 'SHIPPING');
      if (n.indiaStatus === 'DELIVERED' && ord.indiaStatus !== 'DELIVERED') await setLeadStatus(n.leadId, lead, 'DELIVERED');
      if (n.indiaStatus === 'DELIVERED' && ord.indiaStatus !== 'DELIVERED') await completeIfDelivered(n.leadId, lead, u);
      const q = await quotes.get(n.quoteId), l = lead ?? (await leadOf(n.leadId));
      const changed = (keys: string[]) => Object.keys(b).some((k) => keys.includes(k) && String(b[k] ?? '') !== String((ord as any)[k] ?? '')) || Object.keys(shipExtra).some((k) => keys.includes(k));
      // Real-time notification for every status/payment change to India owner, China side and super admins (never the actor).
      const supers = o.users.list().filter((x) => x.active && x.role === 'SUPER_ADMIN').map((x) => x.id);
      const china = q ? await chinaPeople(q) : [], india = await indiaPeople(n.leadId);
      const notifyAll = async (ids: string[], kind: NotifKind, detail: string) => {
        const rs = [...new Set(ids.filter((x) => x && x !== u.id && !!o.users.byId(x)?.active))];
        if (rs.length) await assign.notify(rs, { leadId: n.leadId, leadRef: (l.leadRef as string) ?? null, product: (l.productInterest as string) ?? null, kind, office: officeOf(u.role) ?? 'INDIA', byName: u.name, detail });
      };
      if (newlyShipped) await notifyAll([...india, ...china, ...supers], 'ORDER_SHIPPED', 'SHIPPED');
      else if (n.production !== ord.production) await notifyAll([...india, ...china, ...supers], 'ORDER_UPDATE', `production:${n.production}`);
      if (shipMoved) await notifyAll([...india, ...china, ...supers], 'SHIPMENT_UPDATE', `ship:${shipSt}`);
      if (n.paymentStatus !== ord.paymentStatus) await notifyAll([...india, ...supers], 'ORDER_UPDATE', `payment:${n.paymentStatus}`);
      else if (!newlyShipped && n.production === ord.production && !shipMoved) {
        if (changed([...CHINA_KEYS, ...SHIP_CHINA_KEYS]) && officeOf(u.role) !== 'INDIA') await tell(india, l, 'ORDER_UPDATE', 'INDIA', u);
        if (changed(['qty', 'agreedPrice', 'advance'])) await notifyAll([...india, ...supers], 'ORDER_UPDATE', 'details');
      }
      return { n, sh: nsh };
    };
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/orders/:id', async (req) => {
      const u = req.user!, s = sides(u.role), b = req.body ?? {}, { ord, lead } = await orderOf(u, req.params.id);
      const bad1 = Object.keys(b).find((k) => !(INDIA_KEYS.includes(k) && s.india) && !(CHINA_KEYS.includes(k) && s.china));
      if (bad1) throw new Forbidden(INDIA_KEYS.includes(bad1) ? 'Only the India office updates this' : CHINA_KEYS.includes(bad1) ? 'Only the China office updates production and tracking' : `Unknown field ${bad1}`);
      const { n } = await applyOrder(u, ord, lead, b);
      return { data: await viewOrder(u, n, lead) };
    });
    // ---- Shipments (one per order). China: no customer; India: no supplier. ----
    const viewShip = async (u: User, sh: Shipment, lead: Rec | null) => {
      const s = sides(u.role), ord = await orders.get(sh.orderId), q = ord ? await quotes.get(ord.quoteId) : null;
      const base = { ...sh, leadRef: (lead?.leadRef as string) ?? ord?.leadRef ?? null, product: ord?.product ?? null, qty: ord?.qty ?? null, leadStatus: lead?.status ?? null,
        production: ord?.production ?? null, expectedShip: ord?.expectedShip ?? null, closed: !!ord?.closedAt, closedAt: ord?.closedAt ?? null };
      const payPending = ord ? ord.paymentStatus !== 'PAID' : false;
      const india = { paymentPending: payPending, customer: (lead?.clientName as string) ?? null, deliveryCity: (lead?.deliveryCity as string) ?? null };
      const china = { supplier: q?.supplierId ? (await quotes.supplier(q.supplierId))?.name ?? null : null };
      if (s.superAdmin) return { ...base, ...india, ...china };
      if (!s.india) delete (base as any).customsNote;
      return s.india ? { ...base, ...india } : { ...base, ...china };
    };
    const shipOf = async (u: User, id: string) => {
      const sh = await ships.get(id); if (!sh) throw Object.assign(new Error('Not found'), { status: 404 });
      const lead = (await readableLeads(u)).get(sh.leadId);
      if (!lead && !(sides(u.role).china && can(u, 'leads.all'))) throw Object.assign(new Error('Not found'), { status: 404 });
      return { sh, lead: lead ?? null };
    };
    api.get('/api/shipments', async (req) => {
      const u = req.user!, leads = await readableLeads(u), china = sides(u.role).china && can(u, 'leads.all');
      return { data: await Promise.all((await ships.all()).filter((x) => china || leads.has(x.leadId)).map((x) => viewShip(u, x, leads.get(x.leadId) ?? null))) };
    });
    api.get<{ Params: { id: string } }>('/api/shipments/:id', async (req) => { const { sh, lead } = await shipOf(req.user!, req.params.id); return { data: await viewShip(req.user!, sh, lead) }; });
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/shipments/:id', async (req) => {
      const u = req.user!, s = sides(u.role), b = { ...(req.body ?? {}) }, { sh, lead } = await shipOf(u, req.params.id);
      if ((await orders.get(sh.orderId))?.closedAt) throw bad('This shipment is delivered and closed; the super admin can reopen it', 409);
      for (const k of Object.keys(b)) {
        if (k === 'status') {
          const st = String(b.status ?? '').toUpperCase();
          if (!s.superAdmin && !((s.china && CHINA_SHIP_STATUS.includes(st)) || (s.india && INDIA_SHIP_STATUS.includes(st))))
            throw new Forbidden(s.china ? 'China updates booking and transit; India updates customs and delivery' : 'India updates customs and delivery; China updates booking and transit');
        } else if (SHIP_CHINA_KEYS.includes(k)) { if (!s.china) throw new Forbidden('Only the China office updates shipping details'); }
        else if (SHIP_INDIA_KEYS.includes(k)) { if (!s.india) throw new Forbidden('Only the India office updates customs and delivery'); }
        else throw bad(`Unknown field ${k}`);
      }
      // Status + tracking route through the gated order workflow; the rest is shipment-only detail.
      const ord = await orders.get(sh.orderId); if (!ord) throw bad('Order not found', 404);
      const op: Rec = {}, extra: Rec = {};
      for (const k of Object.keys(b)) if (['tracking', 'container', 'etd', 'eta'].includes(k)) op[k] = b[k]; else if (k !== 'status') extra[k] = b[k];
      if ('status' in b) {
        const st = String(b.status ?? '').toUpperCase(), shipped = ord.production === 'SHIPPED';
        if (s.china && !s.superAdmin && CHINA_SHIP_STATUS.includes(st) && st !== 'IN_TRANSIT' && shipped) throw bad('Already shipped; India now updates transit and delivery', 409);
        if (st === 'IN_TRANSIT' && !shipped && (s.china || s.superAdmin)) op.production = 'SHIPPED';
        else if (INDIA_SHIP_STATUS.includes(st) && (s.india || s.superAdmin)) {
          if (!shipped) throw bad('Transit and delivery unlock after China marks the order Shipped', 409);
          if (SHIP_TO_IND[st] !== ord.indiaStatus) op.indiaStatus = SHIP_TO_IND[st];
          extra.status = st;
        } else extra.status = st;
      }
      const { sh: n } = await applyOrder(u, ord, lead, op, extra);
      return { data: await viewShip(u, n, lead) };
    });
    // Permanently remove a lead with its quotes, orders, shipments, files, assignment and notifications (`leads.delete`).
    // An order still in progress blocks the delete (409 ORDER_IN_PROGRESS); only a super admin may override with ?force=1. Every delete is audited.
    const activeOrders = async (id: string) => (await orders.byLead(id)).filter((x) => x.indiaStatus !== 'DELIVERED');
    const purgeLead = async (u: { id: string; name?: string | null; role: string }, id: string, force: boolean) => {
      const lead = await leadDb.get(id); if (!lead) return { id, status: 404 as const, error: 'Not found' };
      const all = await orders.byLead(id), act = await activeOrders(id);
      if (act.length && !(force && u.role === 'SUPER_ADMIN'))
        return { id, status: 409 as const, code: 'ORDER_IN_PROGRESS', leadRef: (lead.leadRef as string) ?? null, activeOrders: act.length,
          error: `Lead ${(lead.leadRef as string) ?? id} has ${act.length} order(s) in progress` + (u.role === 'SUPER_ADMIN' ? ' — confirm to delete anyway' : ' — only a super admin can delete it') };
      for (const q of await quotes.list(id)) { uploads.removeAll(qKey(q.id)); await mediaSync(qKey(q.id), []); }
      await quotes.removeLead(id); await rejects.forgetLead(id); await ships.removeLead(id); await orders.removeLead(id); uploads.removeAll(id); await o.db.run('DELETE FROM lead_media WHERE owner_key = ?', id);
      await assign.forgetLead(id); await wf.forgetLead(id);
      await leadDb.remove(id);
      await o.db.run('INSERT INTO lead_delete_audit (lead_id, lead_ref, product, client_name, had_orders, active_orders, forced, deleted_by, deleted_by_name) VALUES (?,?,?,?,?,?,?,?,?)',
        id, (lead.leadRef as string) ?? null, (lead.productInterest as string) ?? null, (lead.clientName as string) ?? null, all.length, act.length, act.length > 0, u.id, u.name ?? null);
      return { id, status: 204 as const, leadRef: (lead.leadRef as string) ?? null };
    };
    api.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/api/records/leads/:id', async (req, reply) => {
      const id = await attLead(req);
      const r = await purgeLead(req.user! as any, id, req.query?.force === '1' || req.query?.force === 'true');
      if (r.status !== 204) return reply.code(r.status).send(r);
      return reply.code(204).send();
    });
    api.post<{ Body: { ids?: string[]; force?: boolean } }>('/api/leads/bulk-delete', async (req, reply) => {
      const u = req.user!; if (u.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin only' });
      const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body!.ids.map(String))].slice(0, 500) : [];
      if (!ids.length) return reply.code(400).send({ error: 'ids required' });
      const results = []; for (const id of ids) results.push(await purgeLead(u as any, id, req.body?.force === true));
      const deleted = results.filter((r) => r.status === 204).map((r) => r.id);
      for (const id of deleted) await liveData({ type: 'lead', id, leadId: id, deleted: true, at: Date.now() });
      return { deleted, failed: results.filter((r) => r.status !== 204) };
    });
    api.get<{ Querystring: { limit?: string } }>('/api/leads/delete-audit', async (req, reply) => {
      if (req.user!.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin only' });
      return { data: await o.db.all('SELECT * FROM lead_delete_audit ORDER BY deleted_at DESC, id DESC LIMIT ?', Math.min(500, Number(req.query?.limit) || 100)) };
    });
    // ---- Supplier directory (China + super admin). India never sees supplier identity. ----
    /** Per-supplier activity: quotes given, how many were accepted, orders placed, last quote date. */
    const supplierStats = async () => {
      const rs = await o.db.all(`SELECT q.supplier_id AS id, COUNT(*)::int AS quotes, COUNT(*) FILTER (WHERE q.status = 'ACCEPTED')::int AS accepted,
        COUNT(DISTINCT q.lead_id)::int AS leads, COUNT(o.id)::int AS orders, MAX(q.created_at) AS last_quote_at
        FROM quotes q LEFT JOIN orders o ON o.quote_id = q.id WHERE q.supplier_id IS NOT NULL GROUP BY q.supplier_id`);
      return new Map(rs.map((r) => [r.id as string, { quotes: r.quotes, accepted: r.accepted, leads: r.leads, orders: r.orders, lastQuoteAt: r.last_quote_at ?? null }]));
    };
    const noStats = { quotes: 0, accepted: 0, leads: 0, orders: 0, lastQuoteAt: null };
    api.get<{ Querystring: { q?: string } }>('/api/suppliers', async (req) => {
      chinaOnly(req.user!.role);
      const term = String(req.query?.q ?? '').trim().toLowerCase(), names = userNames(), st = await supplierStats();
      const list = (await quotes.suppliers()).filter((x) => !term || [x.name, x.contact, x.phone, x.wechat, x.city, x.notes].some((v) => v && v.toLowerCase().includes(term)));
      return { data: list.map((x) => ({ ...x, createdByName: (x.createdBy && names.get(x.createdBy)) || null, ...(st.get(x.id) ?? noStats) })) };
    });
    api.get<{ Params: { id: string } }>('/api/suppliers/:id', async (req, reply) => {
      chinaOnly(req.user!.role);
      const sup = await quotes.supplier(req.params.id); if (!sup) return reply.code(404).send({ error: 'Not found' });
      const names = userNames(), st = (await supplierStats()).get(sup.id) ?? noStats, s = sides(req.user!.role);
      const qs = await quotes.bySupplier(sup.id);
      const rows = await Promise.all(qs.map(async (q) => {
        const lead = await leadDb.get(q.leadId), ord = await orders.byQuote(q.id);
        return { id: q.id, leadId: q.leadId, leadRef: (lead?.leadRef as string) ?? null, leadStatus: (lead?.status as string) ?? null, product: q.product,
          unitPrice: q.unitPrice, currency: q.currency, moq: q.moq, leadTime: q.leadTime, status: q.status, createdAt: q.createdAt, createdByName: names.get(q.createdBy) ?? null,
          order: ord ? { id: ord.id, qty: ord.qty, production: ord.production, indiaStatus: ord.indiaStatus, createdAt: ord.createdAt, ...(s.india ? { agreedPrice: ord.agreedPrice } : {}) } : null };
      }));
      return { data: { ...sup, createdByName: (sup.createdBy && names.get(sup.createdBy)) || null, ...st, quotes: rows } };
    });
    api.post<{ Body: Record<string, unknown> }>('/api/suppliers', async (req, reply) => { chinaOnly(req.user!.role); return reply.code(201).send({ data: await quotes.addSupplier(req.body ?? {}, req.user!.id) }); });
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/suppliers/:id', async (req, reply) => {
      chinaOnly(req.user!.role);
      const sup = await quotes.updateSupplier(req.params.id, req.body ?? {});
      return sup ? { data: sup } : reply.code(404).send({ error: 'Not found' });
    });
    api.delete<{ Params: { id: string } }>('/api/suppliers/:id', async (req, reply) => {
      const role = req.user!.role; if (role !== 'SUPER_ADMIN' && role !== 'CHINA_ADMIN' && !can(req.user!, 'suppliers.edit')) throw new Forbidden('Only a China admin can delete suppliers');
      await quotes.deleteSupplier(req.params.id); return reply.code(204).send();
    });

    // ---- Customer directory (India + super admin; customers.view / customers.edit). China never sees customers. ----
    const custOnly = (role: Role) => { if (!sides(role).india) throw new Forbidden('Only the India office can see customers'); };
    let syncing: Promise<number> | null = null;
    const custSync = () => (syncing ??= customers.sync().finally(() => { syncing = null; }));
    void custSync().catch((e) => app.log.error(e)); // back-fill existing leads on boot
    api.get<{ Querystring: { q?: string } }>('/api/customers', async (req) => {
      custOnly(req.user!.role); await custSync();
      const term = String(req.query?.q ?? '').trim().toLowerCase(), st = await customers.stats(), names = userNames();
      const list = (await customers.list()).filter((x) => !term || [x.name, x.company, x.phone, x.whatsapp, x.email, x.city, x.state, x.gst, x.notes, ...x.tags].some((v) => v && v.toLowerCase().includes(term)));
      return { data: list.map((x) => ({ ...x, createdByName: (x.createdBy && names.get(x.createdBy)) || null, ...(st.get(x.id) ?? NO_STATS)
        , ...(can(req.user!, 'prices.inr') ? {} : { orderTotal: null, paid: null, due: null }) })) };
    });
    api.get<{ Params: { id: string } }>('/api/customers/:id', async (req, reply) => {
      const u = req.user!; custOnly(u.role);
      const c = await customers.get(req.params.id); if (!c) return reply.code(404).send({ error: 'Not found' });
      const names = userNames(), st = (await customers.stats(c.id)).get(c.id) ?? NO_STATS, inr = can(u, 'prices.inr');
      const leadRows = await o.db.all('SELECT id FROM leads WHERE customer_id = ? ORDER BY created_at DESC', c.id);
      const leads: Rec[] = [], quoteRows: Rec[] = [], orderRows: Rec[] = [], shipRows: Rec[] = [];
      for (const { id } of leadRows) {
        const l = await leadDb.get(id); if (!l) continue;
        const a = await assign.get(id), m = await wf.meta(id);
        leads.push({ id, leadRef: l.leadRef, product: l.productInterest, quantity: l.quantity, unit: l.unit, status: m?.closedAt ? 'CLOSED' : l.status, createdAt: l.createdAt,
          ownerName: (a?.assignedTo && names.get(a.assignedTo)) || (a?.raisedBy && names.get(a.raisedBy)) || null });
        for (const q of await quotes.list(id)) if (q.cq) quoteRows.push({ id: q.id, leadId: id, leadRef: l.leadRef, product: q.product, status: q.status, updatedAt: q.updatedAt,
          ...(inr ? { qty: q.cq.qty, unitPrice: q.cq.unitPrice, currency: 'INR', total: cqTotals(q.cq).total } : {}) });
        for (const x of await orders.byLead(id)) {
          orderRows.push({ id: x.id, leadId: id, leadRef: l.leadRef, product: x.product, qty: x.qty, paymentStatus: x.paymentStatus, production: x.production, indiaStatus: x.indiaStatus, createdAt: x.createdAt,
            ...(inr ? { agreedPrice: x.agreedPrice, advance: x.advance, total: x.qty * x.agreedPrice } : {}) });
          const sh = await ships.byOrder(x.id); if (sh) shipRows.push({ id: sh.id, leadId: id, leadRef: l.leadRef, ref: sh.ref, status: sh.status, mode: sh.mode, etd: sh.etd, eta: sh.eta, deliveredAt: sh.deliveredAt });
        }
      }
      return { data: { ...c, createdByName: (c.createdBy && names.get(c.createdBy)) || null, ...st, ...(inr ? {} : { orderTotal: null, paid: null, due: null }),
        leads, quotes: quoteRows, orders: orderRows, shipments: shipRows } };
    });
    const custErr = (e: unknown) => { if (e instanceof BadCustomer) throw bad(e.message); throw e; };
    api.post<{ Body: Record<string, unknown> }>('/api/customers', async (req, reply) => { custOnly(req.user!.role);
      return reply.code(201).send({ data: await customers.add(req.body ?? {}, req.user!.id).catch(custErr) }); });
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/customers/:id', async (req, reply) => {
      custOnly(req.user!.role);
      const c = await customers.update(req.params.id, req.body ?? {}).catch(custErr);
      return c ? { data: c } : reply.code(404).send({ error: 'Not found' });
    });
    api.post<{ Params: { id: string }; Body: { from?: string[] } }>('/api/customers/:id/merge', async (req, reply) => {
      custOnly(req.user!.role);
      const from = Array.isArray(req.body?.from) ? req.body!.from.map(String) : [];
      if (!from.length) throw bad('Pick customers to merge');
      const c = await customers.merge(req.params.id, from).catch(custErr);
      return c ? { data: c } : reply.code(404).send({ error: 'Not found' });
    });
    api.delete<{ Params: { id: string } }>('/api/customers/:id', async (req, reply) => {
      const role = req.user!.role; custOnly(role);
      if (role !== 'SUPER_ADMIN' && role !== 'INDIA_ADMIN') throw new Forbidden('Only an India admin can delete customers');
      if (await customers.leadCount(req.params.id)) throw bad('This customer has leads, merge it into another customer instead', 409);
      return (await customers.remove(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' });
    });
    /** The directory customer a lead is linked to (India + super admin), with its totals; null when unlinked. */
    api.get<{ Params: { id: string } }>('/api/leads/:id/customer', async (req, reply) => {
      const u = req.user!; custOnly(u.role);
      const lead = await leadDb.get(req.params.id); if (!lead) return reply.code(404).send({ error: 'Not found' });
      const cid = await customers.customerOf(req.params.id); const c = cid ? await customers.get(cid) : null;
      if (!c) return { data: null };
      const st = (await customers.stats(c.id)).get(c.id) ?? NO_STATS;
      return { data: { ...c, ...st, ...(can(u, 'prices.inr') ? {} : { orderTotal: null, paid: null, due: null }) } };
    });
    /** Re-link a lead to another customer (India side). */
    api.post<{ Params: { id: string }; Body: { customerId?: string } }>('/api/leads/:id/customer', async (req, reply) => {
      custOnly(req.user!.role);
      const lead = await leadDb.get(req.params.id); if (!lead) return reply.code(404).send({ error: 'Not found' });
      const c = await customers.get(String(req.body?.customerId ?? '')); if (!c) throw bad('Unknown customer');
      await customers.link(req.params.id, c.id); return { data: { leadId: req.params.id, customerId: c.id } };
    });

    // ---- Generic filtered records API (used by mobile and web) ----
    const objOf = (plural: string): ObjectName => {
      // Only leads live in this API now (Source Easy's own database); the old Twenty objects are gone.
      const obj = PLURAL_TO_OBJECT[plural];
      if (obj !== 'lead') throw Object.assign(new Error('Unknown object'), { status: 404 });
      return obj;
    };
    api.get<{ Params: { plural: string }; Querystring: Record<string, string> }>('/api/records/:plural', async (req) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      if (!canRead(role, obj)) throw new Forbidden(`${role} may not read ${obj}`);
      const filter: Record<string, string> = {};
      const q = { ...(req.query ?? {}) };
      let mine: string | undefined;
      if (obj === 'lead' && q.assignedTo) { mine = q.assignedTo === 'me' ? req.user!.id : String(q.assignedTo); delete q.assignedTo; }
      for (const [k, v] of Object.entries(q)) {
        if (!FILTERABLE[obj]?.includes(k)) throw Object.assign(new Error(`Cannot filter ${obj} by ${k}`), { status: 400 });
        filter[k] = String(v);
      }
      const [rows, ctx] = await Promise.all([leadDb.list(filter), ctxOf(role)]);
      let data = rows.map((r) => readFilter(obj, r, ctx)).filter((r): r is Rec => !!r);
      if (obj === 'lead') {
        const all = await assign.all(), names = userNames();
        data = await Promise.all(data.map((r) => decorate(r, all.get(String(r.id)), names)));
        if (mine) data = data.filter((r) => r.assignedTo === mine);
        const sc = await scope(req.user!); if (sc) data = data.filter((r) => sc.has(String(r.id)));
      }
      data = data.sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      return { data };
    });
    api.get<{ Params: { plural: string; id: string } }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      if (!canRead(role, obj)) throw new Forbidden(`${role} may not read ${obj}`);
      const r = await leadDb.get(req.params.id);
      let f = r && readFilter(obj, r, await ctxOf(role));
      if (f) { const sc = await scope(req.user!); if (sc && !sc.has(String(f.id))) f = null; }
      if (f) f = await decorate(f, await assign.get(String(f.id)), userNames());
      return f ? { data: f } : reply.code(404).send({ error: 'Not found' });
    });
    api.post<{ Params: { plural: string }; Body: Rec }>('/api/records/:plural', async (req, reply) => {
      const obj = objOf(req.params.plural);
      const body = { ...(req.body ?? {}) }, to = obj === 'lead' ? takeAssignee(body) : undefined;
      // Picking an existing customer (India side): fills empty contact fields from the customer, then links the lead.
      const pickedId = obj === 'lead' && typeof body.customerId === 'string' ? body.customerId : null; delete body.customerId;
      const picked = pickedId && sides(req.user!.role).india && can(req.user!, 'customers.view') ? await customers.get(pickedId) : null;
      if (picked) {
        body.clientName ||= picked.company ?? picked.name; body.contactName ||= picked.name;
        if (!(body.contactPhone as Rec)?.primaryPhoneNumber && typeof body.contactPhone !== 'string' && picked.phone) body.contactPhone = { primaryPhoneNumber: picked.phone };
        if (!(body.contactEmail as Rec)?.primaryEmail && typeof body.contactEmail !== 'string' && picked.email) body.contactEmail = { primaryEmail: picked.email };
        body.deliveryCity ||= picked.city;
      }
      const data = { ...writeCheck(req.user!.role, obj, 'create', body) };
      // The reference is always assigned here (incl. offline mobile leads when they sync), never by the client.
      if (obj === 'lead') { data.assignedOffice ??= CHINA_LEAD_STATUSES.includes(String(data.status)) ? 'CHINA' : 'INDIA'; data.office ??= 'INDIA'; }
      const leadRef = await nextRef();
      data.leadRef = leadRef;
      const r = await leadDb.create(data);
      if (picked) await customers.link(String(r.id), picked.id);
      void custSync().catch(() => undefined);
      {
        const actor = req.user!, office: Office = data.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA';
        await assign.set(String(r.id), { raisedBy: officeOf(actor.role) === 'CHINA' ? null : actor.id });
        await ev(String(r.id), 'CREATED', actor, { channel: data.sourceChannel ?? null });
        if (data.summary) await ev(String(r.id), 'SUMMARY', actor);
        // India staff creating an India lead own it unless they pick someone else.
        await handoff({ ...data, id: r.id }, actor, office, to !== undefined ? to : office === 'INDIA' && officeOf(actor.role) === 'INDIA' ? actor.id : undefined);
      }
      return reply.code(201).send({ data: { id: r.id, leadRef } });
    });
    api.patch<{ Params: { plural: string; id: string }; Body: Rec }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      const existing = await leadDb.get(req.params.id);
      if (!existing || !readFilter(obj, existing, await ctxOf(role))) return reply.code(404).send({ error: 'Not found' });
      if (obj === 'lead' && (await wf.meta(String(existing.id))).closedAt && role !== 'SUPER_ADMIN') throw new Forbidden('This lead is closed permanently');
      const body = { ...(req.body ?? {}) }, to = obj === 'lead' ? takeAssignee(body) : undefined;
      const data = Object.keys(body).length || to === undefined ? { ...writeCheck(role, obj, 'update', body, existing) } : {};
      // Handing a lead to China = assignedOffice CHINA. Moving it to a China stage (board drag, status change) implies that,
      // otherwise China would never see it (China only reads assignedOffice=CHINA leads).
      let deliverOrders: Order[] = [];
      if (obj === 'lead' && 'status' in data && data.status !== existing.status) { // board drag / status dropdown follow the shipping gates
        const os = await orders.byLead(String(existing.id)), shippedOs = os.filter((x) => x.production === 'SHIPPED');
        if (data.status === 'SHIPPING' && !shippedOs.length) throw bad('A lead moves to Shipping when China marks its order Shipped (with tracking/container no + ETD)', 409);
        if (data.status === 'DELIVERED') {
          if (!shippedOs.length) throw bad('Delivered unlocks after China marks the order Shipped', 409);
          if (!sides(role).india) throw new Forbidden('Only the India office marks an order delivered');
          deliverOrders = shippedOs.filter((x) => x.indiaStatus !== 'DELIVERED');
        }
        if (shippedOs.length && !['SHIPPING', 'DELIVERED', 'WON', 'LOST', 'COMPLETED'].includes(String(data.status))) throw bad('This lead has a shipped order and cannot go back to an earlier stage', 409);
      }
      if (obj === 'lead' && !('assignedOffice' in data) && existing.assignedOffice !== 'CHINA' && CHINA_LEAD_STATUSES.includes(String(data.status))) data.assignedOffice = 'CHINA';
      let target: Office | null = null;
      const a = obj === 'lead' ? await assign.get(String(existing.id)) : null;
      if (obj === 'lead') {
        const toChina = data.assignedOffice === 'CHINA' && existing.assignedOffice !== 'CHINA';
        const quotedByChina = data.status === 'QUOTED' && existing.status !== 'QUOTED' && (a?.ownerOffice ?? 'CHINA') === 'CHINA' && officeOf(role) === 'CHINA';
        target = toChina ? 'CHINA' : quotedByChina ? 'INDIA' : to !== undefined ? (a?.ownerOffice ?? ({ ...existing, ...data }.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA')) : null;
        if (target && to !== undefined) assertAssign(req.user!, existing, target, to);
      }
      const r = Object.keys(data).length ? await leadDb.update(req.params.id, data) : { id: req.params.id };
      if (obj === 'lead') {
        const id = String(existing.id);
        if ('status' in data && data.status !== existing.status) {
          await ev(id, 'STATUS', req.user!, { from: existing.status ?? null, to: data.status });
          if (['WON', 'LOST', 'DELIVERED', 'COMPLETED'].includes(String(data.status))) await stopClock(id);
        }
        if ('summary' in data && data.summary !== existing.summary) await ev(id, 'SUMMARY', req.user!);
      }
      if (target) await handoff({ ...existing, ...data }, req.user!, target, to);
      for (const x of deliverOrders) await applyOrder(req.user!, x, { ...existing, ...data }, { indiaStatus: 'DELIVERED' });
      if (obj === 'lead' && data.status === 'DELIVERED') await completeIfDelivered(String(existing.id), null, req.user!);
      return { data: { id: r.id ?? req.params.id } };
    });

    /** Who may hand a lead to `office`/`to`: any staff may send to the other office (member or queue); within an office only admins reassign others, staff may take it themselves. */
    const assertAssign = (actor: User, lead: Rec, office: Office, to: string | null) => {
      const s = sides(actor.role), mine = officeOf(actor.role);
      if (s.superAdmin) return;
      if (!s.india && lead.assignedOffice !== 'CHINA') throw new Forbidden('Lead is not assigned to China');
      if (office !== mine) return;
      if (s.admin || to === actor.id) return;
      throw new Forbidden('Only office admins can reassign within the office');
    };
    // Explicit send/return/reassign: { office: 'CHINA'|'INDIA', assignedTo?: userId|null, raisedBy?: userId (India admin/super admin, e.g. public enquiries) }
    api.post<{ Params: { id: string }; Body: { office?: string; assignedTo?: string | null; raisedBy?: string | null } }>('/api/leads/:id/assign', async (req, reply) => {
      const actor = req.user!, b = req.body ?? {};
      const lead = await leadDb.get(req.params.id);
      if (!lead || !readFilter('lead', lead, await ctxOf(actor.role))) return reply.code(404).send({ error: 'Not found' });
      const office = b.office === 'CHINA' || b.office === 'INDIA' ? b.office : ((await assign.get(String(lead.id)))?.ownerOffice ?? (lead.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA'));
      const to = 'assignedTo' in b ? (b.assignedTo ? String(b.assignedTo) : null) : undefined;
      assertAssign(actor, lead, office, to ?? null);
      if ('raisedBy' in b) {
        if (!(actor.role === 'SUPER_ADMIN' || actor.role === 'INDIA_ADMIN')) throw new Forbidden('Only India admins can set who raised a lead');
        const u = b.raisedBy ? o.users.byId(String(b.raisedBy)) : null;
        if (b.raisedBy && !indiaOwner(u)) return reply.code(400).send({ error: 'raisedBy must be an active India staff member' });
        await assign.set(String(lead.id), { raisedBy: u?.id ?? null });
      }
      if (office === 'CHINA' && lead.assignedOffice !== 'CHINA') {
        if (!sides(actor.role).india) throw new Forbidden('Only India can send a lead to China');
        const patch: Rec = { assignedOffice: 'CHINA', ...(CHINA_LEAD_STATUSES.includes(String(lead.status)) ? {} : { status: 'ASSIGNED' }) };
        await leadDb.update(String(lead.id), patch); Object.assign(lead, patch);
      }
      if (b.office || to !== undefined) await handoff(lead, actor, office, to);
      const f = readFilter('lead', lead, await ctxOf(actor.role))!;
      return { data: await decorate(f, await assign.get(String(lead.id)), userNames()) };
    });
    // India owner of a lead (public enquiries): India staff take an unowned lead themselves; India admin / super admin assign or reassign any India member.
    // The owner becomes the raiser (return-to-raiser, rejections), the India assignee + SLA holder while India holds it, and gets a bell notification.
    api.post<{ Params: { id: string }; Body: { userId?: string } }>('/api/leads/:id/india-owner', async (req, reply) => {
      const actor = req.user!, lead = await leadDb.get(req.params.id);
      if (!lead || !readFilter('lead', lead, await ctxOf(actor.role))) return reply.code(404).send({ error: 'Not found' });
      const admin = actor.role === 'SUPER_ADMIN' || actor.role === 'INDIA_ADMIN';
      if (!admin && officeOf(actor.role) !== 'INDIA') throw new Forbidden('Only India staff can take a lead');
      const to = String(req.body?.userId || actor.id), u = o.users.byId(to);
      if (!indiaOwner(u)) return reply.code(400).send({ error: 'Owner must be an active India staff member' });
      if (!admin && to !== actor.id) throw new Forbidden('Only India admins can assign other India staff');
      const id = String(lead.id), prev = await assign.get(id);
      if (!admin && !noIndiaOwner(lead, prev)) return reply.code(409).send({ error: 'This lead already has an India owner', code: 'taken' });
      if (!admin) { // atomic claim: two staff tapping at once, only one wins
        const n = await o.db.run("UPDATE leads SET raised_by = ?, assigned_at = COALESCE(assigned_at, ?) WHERE id = ? AND raised_by IS NULL", to, new Date().toISOString(), id);
        if (!n) return reply.code(409).send({ error: 'This lead already has an India owner', code: 'taken' });
      }
      await assign.set(id, { raisedBy: to });
      const office: Office = (await assign.get(id))?.ownerOffice ?? (lead.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA');
      if (office === 'INDIA') await handoff(lead, actor, 'INDIA', to);
      else {
        await ev(id, 'REASSIGNED', actor, { office: 'INDIA', to: u!.name, raiser: true });
        if (to !== actor.id) await assign.notify([to], { leadId: id, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind: 'ASSIGNED', office: 'INDIA', byName: actor.name });
      }
      await liveData({ type: 'lead', id, leadId: id, at: Date.now() });
      return { data: await decorate(readFilter('lead', lead, await ctxOf(actor.role))!, await assign.get(id), userNames()) };
    });
    // Active members of an office, for the assignee picker (id, name, role only).
    api.get<{ Querystring: { office?: string } }>('/api/staff', async (req) => {
      const office = req.query?.office === 'CHINA' ? 'CHINA' : 'INDIA';
      const a = avatars.urls();
      return { data: staffOf(office).map((u) => ({ id: u.id, name: u.name, role: u.role, avatarUrl: a.get(u.id) ?? null })) };
    });
    // ---- Timeline, priority, SLA ----
    api.get<{ Params: { id: string } }>('/api/leads/:id/timeline', async (req) => {
      const id = await attLead(req), lead = (await leadDb.get(id))!, a = await assign.get(id);
      let events = await wf.events(id);
      if (!events.some((e) => e.kind === 'CREATED')) // older leads: synthesise the creation step
        events = [{ id: `created-${id}`, leadId: id, at: new Date(String(lead.createdAt ?? Date.now())).toISOString(), kind: 'CREATED', actorId: a?.raisedBy ?? null,
          actorName: (a?.raisedBy && o.users.byId(a.raisedBy)?.name) || null, actorOffice: a?.raisedBy ? 'INDIA' : null, data: { channel: lead.sourceChannel ?? null }, vis: 'ALL' }, ...events];
      return { data: { events: events.map((e) => viewEvent(req.user!.role, e)).filter(Boolean), progress: await stageOf(lead, a?.ownerOffice ?? null),
        priority: await wf.priority(id), sla: await slaView(id, userNames()), settings: await wf.sla() } };
    });
    // ---- Lost leads: reopen, copy to a new lead, close permanently, follow-up reminder (India office + super admin) ----
    const lostLead = async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const u = req.user!; if (!sides(u.role).india) throw new Forbidden('Only the India office or the super admin can do this');
      const lead = await leadDb.get(req.params.id); if (!lead) throw bad('Not found', 404);
      return { u, lead, id: String(lead.id), meta: await wf.meta(String(lead.id)) };
    };
    const fuDate = (v: unknown) => { if (v == null || v === '') return null; const d = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad('Follow-up date must be YYYY-MM-DD'); return d; };
    const leadOut = async (u: User, id: string) => { const r = await leadDb.get(id); const f = r && readFilter('lead', r, await ctxOf(u.role)); return f ? decorate(f, await assign.get(id), userNames()) : null; };
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/reopen', async (req) => {
      const { u, lead, id, meta } = await lostLead(req), b = req.body ?? {};
      if (meta.closedAt && u.role !== 'SUPER_ADMIN') throw new Forbidden('This lead was closed permanently; only the super admin can reopen it');
      if (lead.status === 'COMPLETED' && u.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can reopen a completed lead');
      if (!meta.closedAt && lead.status !== 'LOST' && lead.status !== 'COMPLETED') throw bad('Only lost, completed or closed leads can be reopened', 409);
      const to: Office = String(b.office ?? 'INDIA').toUpperCase() === 'CHINA' ? 'CHINA' : 'INDIA';
      if (meta.closedAt) await wf.reopenLead(id);
      const wasDone = lead.status === 'COMPLETED', shippedAny = wasDone && (await orders.byLead(id)).some((x) => x.production === 'SHIPPED');
      // A completed lead with shipped orders reopens back into Shipping (its orders/shipments reopen too); others restart.
      const ns = shippedAny ? 'SHIPPING' : to === 'CHINA' ? 'ASSIGNED' : 'NEW';
      if (wasDone) await orders.setClosed(id, false);
      await leadDb.update(id, shippedAny ? { status: ns } : { status: ns, assignedOffice: to });
      await ev(id, 'REOPENED', u, { office: to, orders: wasDone || undefined });
      if (wasDone) { for (const x of await orders.byLead(id)) await liveData({ type: 'order', id: x.id, leadId: id, closed: false, at: Date.now() }); await liveData({ type: 'lead', id, leadId: id, at: Date.now() }); }
      if (shippedAny) return { data: await leadOut(u, id) };
      await handoff({ ...lead, status: to === 'CHINA' ? 'ASSIGNED' : 'NEW' }, u, to, b.assignedTo === undefined ? undefined : (b.assignedTo as string | null));
      return { data: await leadOut(u, id) };
    });
    api.post<{ Params: { id: string } }>('/api/leads/:id/copy', async (req, reply) => {
      const { u, lead, id } = await lostLead(req);
      const keep = ['clientName', 'contactPhone', 'contactEmail', 'contactName', 'productInterest', 'quantity', 'unit', 'targetPrice', 'deliveryCity', 'referenceUrl', 'enquiryMessage', 'summary', 'sourceChannel'];
      const data: Rec = { status: 'NEW', assignedOffice: 'INDIA', office: 'INDIA' };
      for (const k of keep) if (lead[k] != null && lead[k] !== '') data[k] = lead[k];
      data.leadRef = await nextRef();
      const r = await leadDb.create(data); const nid = String(r.id);
      // Media: copy every file of the old lead.
      const files = uploads.list(id).map((a) => uploads.read(id, a.id)).filter(Boolean).map((x) => ({ name: x!.meta.name, mime: x!.meta.mime, data: x!.data }));
      if (files.length) { uploads.save(nid, files); await mediaSync(nid, uploads.list(nid)); }
      await assign.set(nid, { raisedBy: u.role === 'SUPER_ADMIN' ? (await assign.get(id))?.raisedBy ?? u.id : u.id });
      await wf.linkFrom(nid, id, (lead.leadRef as string) ?? null);
      await ev(nid, 'CREATED_FROM', u, { ref: lead.leadRef ?? null }); await ev(id, 'COPIED_TO', u, { ref: data.leadRef });
      if (await wf.priority(id)) await wf.setPriority(nid, true);
      await handoff({ ...data, id: nid }, u, 'INDIA', u.role === 'SUPER_ADMIN' ? undefined : u.id);
      return reply.code(201).send({ data: await leadOut(u, nid) });
    });
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/close-permanent', async (req) => {
      const { u, lead, id, meta } = await lostLead(req), b = req.body ?? {};
      if (meta.closedAt) throw bad('Already closed', 409);
      if (!['LOST', 'NEW', 'ASSIGNED', 'SOURCING', 'QUOTED', 'APPROVED'].includes(String(lead.status))) throw bad('Leads with an order cannot be closed', 409);
      const fu = fuDate(b.followUp);
      if (lead.status !== 'LOST') await leadDb.update(id, { status: 'LOST', ...(b.reason ? { winLossReason: String(b.reason).slice(0, 500) } : {}) });
      await wf.closeLead(id, u.id); await stopClock(id);
      await ev(id, 'CLOSED_PERMANENT', u, { reason: b.reason ? String(b.reason).slice(0, 300) : null, followUp: fu });
      if (fu) await wf.setFollowUp(id, fu, u.id);
      return { data: await leadOut(u, id) };
    });
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/follow-up', async (req) => {
      const { u, id } = await lostLead(req), fu = fuDate((req.body ?? {}).date);
      await wf.setFollowUp(id, fu, u.id); await ev(id, 'FOLLOW_UP_SET', u, { date: fu });
      return { data: await leadOut(u, id) };
    });
    api.post<{ Params: { id: string }; Body: { priority?: boolean } }>('/api/leads/:id/priority', async (req) => {
      const u = req.user!;
      if (!sides(u.role).india) throw new Forbidden('Only the India office or the super admin can set priority');
      const id = await attLead(req), on = !!req.body?.priority;
      if ((await wf.priority(id)) !== on) {
        const c = await wf.setPriority(id, on);
        await ev(id, 'PRIORITY', u, { on, ...(c ? { dueAt: c.dueAt } : {}) });
        const a = await assign.get(id), who = c?.assignee ?? (a?.assignedTo || null);
        const lead = (await leadDb.get(id))!;
        const recips = (who ? [who] : c ? queueWatchers(c.office) : []).filter((x) => x !== u.id);
        if (recips.length) await assign.notify(recips, { leadId: id, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind: 'PRIORITY', office: c?.office ?? a?.ownerOffice ?? 'INDIA', byName: u.name });
      }
      return { data: { priority: await wf.priority(id), sla: await slaView(id, userNames()) } };
    });
    api.get('/api/settings/sla', async () => ({ data: await wf.sla() }));
    api.put<{ Body: { normalMinutes?: number; priorityMinutes?: number; warnMinutes?: number } }>('/api/settings/sla', async (req) => {
      return { data: await wf.setSla(req.body ?? {}) };
    });
    api.get<{ Querystring: { days?: string } }>('/api/sla/report', async (req) => {
      const u = req.user!;
      const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30)), now = (o.now ?? Date.now)();
      const since = new Date(now - days * 864e5).toISOString(), names = userNames();
      const done = (await wf.runs(since)).map((r) => ({ ...r, open: false }));
      const open = (await wf.clocks()).map((c) => ({ ...c, endedAt: null, open: true, breached: c.breached || new Date(now).toISOString() > c.dueAt }));
      const all = [...done, ...open];
      const office = (['INDIA', 'CHINA'] as Office[]).map((of) => {
        const rs = all.filter((r) => r.office === of), closed = rs.filter((r) => !r.open);
        const onTime = closed.filter((r) => !r.breached).length;
        return { office: of, total: closed.length, onTime, breached: rs.filter((r) => r.breached).length, running: rs.filter((r) => r.open).length,
          onTimePct: closed.length ? Math.round((onTime / closed.length) * 100) : null };
      });
      const m = new Map<string, { id: string | null; name: string | null; office: Office; total: number; breached: number }>();
      for (const r of all) {
        const k = `${r.office}:${r.assignee ?? ''}`;
        const x = m.get(k) ?? { id: r.assignee, name: (r.assignee && names.get(r.assignee)) || null, office: r.office, total: 0, breached: 0 };
        x.total++; if (r.breached) x.breached++; m.set(k, x);
      }
      return { data: { days, office, members: [...m.values()].sort((a, b) => b.breached - a.breached || b.total - a.total), settings: await wf.sla() } };
    });
    api.get('/api/notifications', async (req) => assign.list(req.user!.id));
    // Mobile push device tokens (FCM). Registering a token moves it to the signed-in user.
    api.post<{ Body: { token?: string; platform?: string } }>('/api/devices', async (req, reply) => {
      const t = String(req.body?.token ?? '');
      if (!t || t.length > 4096) return reply.code(400).send({ error: 'token required' });
      await push.register(req.user!.id, t, String(req.body?.platform ?? 'android'));
      return { ok: true, push: push.enabled };
    });
    api.delete<{ Body: { token?: string } | null }>('/api/devices', async (req) => { await push.unregister(req.user!.id, req.body?.token ? String(req.body.token) : undefined); return { ok: true }; });
    // Real-time stream (Server-Sent Events). Sends `notification` events with the same privacy-safe payload as the list.
    api.get('/api/notifications/stream', async (req, reply) => {
      const uid = req.user!.id, unread0 = await assign.unreadOf(uid);
      const tokenV = req.headers.authorization ? (jwt.decode(req.headers.authorization.slice(7)) as { v?: number } | null)?.v : undefined;
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const send = (ev: string, data: unknown) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      res.write('retry: 3000\n\n');
      send('hello', { unread: unread0 });
      const off = assign.subscribe(uid, (n, unread) => send('notification', { notification: n, unread }));
      const offData = onLiveData((d) => send('change', d));
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      // Revocation (password/role change, disabled or removed user) arrives on Redis `se:revoke`: end this stream.
      const revoke = () => {
        const u = o.users.byId(uid);
        if (!u || !u.active || o.users.tokenVersion(uid) !== tokenV) { try { send('revoked', {}); } catch { /* closed */ } res.end(); close(); }
      };
      let set = revokeSubs.get(uid); if (!set) revokeSubs.set(uid, (set = new Set())); set.add(revoke);
      const close = () => { clearInterval(ping); off(); offData(); set!.delete(revoke); if (!set!.size) revokeSubs.delete(uid); };
      req.raw.on('close', close); res.on('error', close);
    });
    api.post<{ Params: { id: string } }>('/api/notifications/:id/read', async (req) => ({ ok: await assign.markRead(req.user!.id, req.params.id) }));
    api.post('/api/notifications/read-all', async (req) => ({ ok: await assign.markRead(req.user!.id) }));

    // ---- Super admin ----
    api.get('/api/backups', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Super admin only');
      return { data: o.backupLinks ?? [] };
    });

    // ---- User management (admins manage their own side) ----
    const assertManage = (actor: User, role: Role) => {
      if (!manageable(actor).includes(role)) throw new Forbidden(`${actor.role} cannot manage ${role} users`);
    };
    api.get('/api/users', async (req) => {
      const allowed = manageable(req.user!);
      if (!allowed.length) throw new Forbidden('Admins only');
      const a = avatars.urls();
      return { data: o.users.list().filter((u) => allowed.includes(u.role)).map((u) => ({ ...u, avatarUrl: a.get(u.id) ?? null })) };
    });
    api.post<{ Params: { id: string } }>('/api/users/:id/avatar', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Super admin only');
      if (!o.users.byId(req.params.id)) throw Object.assign(new Error('Not found'), { status: 404 });
      await avatars.set(req.params.id, await readImage(req)); return { data: { avatarUrl: avatarOf(req.params.id) } };
    });
    api.delete<{ Params: { id: string } }>('/api/users/:id/avatar', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Super admin only');
      await avatars.remove(req.params.id); return { data: { avatarUrl: null } };
    });
    api.post<{ Body: { email: string; name: string; role: Role; password: string; chatwootAgentId?: number } }>('/api/users', async (req, reply) => {
      const b = req.body ?? ({} as never);
      if (!isRole(b.role)) return reply.code(400).send({ error: 'Invalid role' });
      assertManage(req.user!, b.role);
      let u: User;
      try { u = await o.users.create(b.email ?? '', b.name ?? '', b.role, b.password ?? ''); }
      catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      return reply.code(201).send({ data: u });
    });
    // Losing the last active super admin would lock everyone out of user management.
    const lastSuper = (t: User, next: { role?: Role; active?: boolean } | 'delete') =>
      t.role === 'SUPER_ADMIN' && t.active && (next === 'delete' || (next.role && next.role !== 'SUPER_ADMIN') || next.active === false) &&
      o.users.activeSuperAdmins() <= 1;
    api.patch<{ Params: { id: string }; Body: { name?: string; email?: string; role?: Role; active?: boolean } }>('/api/users/:id', async (req, reply) => {
      const t = o.users.byId(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Not found' });
      const b = req.body ?? {};
      assertManage(req.user!, t.role);
      if (b.role) { if (!isRole(b.role)) return reply.code(400).send({ error: 'Invalid role' }); assertManage(req.user!, b.role); }
      if (b.email !== undefined && b.email.trim().toLowerCase() !== t.email && req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can change a login email');
      if (t.id === req.user!.id && ((b.role && b.role !== t.role) || b.active === false)) throw new Forbidden('You cannot change your own role or disable yourself');
      if (lastSuper(t, b)) return reply.code(409).send({ error: 'This is the last active super admin', code: 'last_super_admin' });
      let u: User | null;
      try { u = await o.users.update(t.id, { name: b.name, email: b.email, role: b.role, active: b.active }); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      return { data: u };
    });
    // Hard delete (super admin only). Leads/quotes keep their references; only the login goes.
    api.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can remove staff');
      const t = o.users.byId(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Not found' });
      if (t.id === req.user!.id) throw new Forbidden('You cannot remove yourself');
      if (lastSuper(t, 'delete')) return reply.code(409).send({ error: 'This is the last active super admin', code: 'last_super_admin' });
      await o.users.remove(t.id); await avatars.remove(t.id);
      await assign.forgetUser(t.id); await perms.forgetUser(t.id);
      return reply.code(204).send();
    });
    api.post<{ Params: { id: string }; Body: { password: string } }>('/api/users/:id/password', async (req, reply) => {
      const t = o.users.byId(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Not found' });
      assertManage(req.user!, t.role);
      try { await o.users.setPassword(t.id, req.body?.password ?? ''); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      return { ok: true };
    });

    // ---- Per-user permissions (super admin sets; the user and their managers can read) ----
    api.get('/api/permissions/catalog', async () => ({ data: PERMISSIONS }));
    api.get<{ Params: { id: string } }>('/api/users/:id/permissions', async (req) => {
      const u = req.user!, t = o.users.byId(req.params.id);
      if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
      if (u.id !== t.id && !manageable(u).includes(t.role)) throw new Forbidden('Not allowed');
      const names = userNames();
      return { data: { userId: t.id, role: t.role, editable: u.role === 'SUPER_ADMIN' && t.role !== 'SUPER_ADMIN', permissions: perms.matrix(t),
        audit: (await perms.audit(t.id, 50)).map((a) => ({ ...a, changedByName: (a.changedBy && names.get(a.changedBy)) || null })) } };
    });
    api.put<{ Params: { id: string }; Body: { permissions?: Record<string, boolean | null> } }>('/api/users/:id/permissions', async (req) => {
      const u = req.user!; if (u.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can change permissions');
      const t = o.users.byId(req.params.id); if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
      const ch = req.body?.permissions; if (!ch || typeof ch !== 'object') throw bad('permissions object required');
      const changed = await perms.set(t, ch, u.id);
      return { data: { changed, permissions: perms.matrix(t) } };
    });
    api.get<{ Querystring: { limit?: string } }>('/api/permissions/audit', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Super admin only');
      const names = userNames();
      return { data: (await perms.audit(undefined, Math.min(500, Number(req.query?.limit) || 100))).map((a) => ({ ...a, userName: names.get(a.userId) ?? null, changedByName: (a.changedBy && names.get(a.changedBy)) || null })) };
    });
    // ---- CSV export: re-reads the same role/permission-filtered endpoints as the app, so nothing hidden can leak. ----
    const EXPORTS: Record<string, string> = { leads: '/api/records/leads', quotes: '/api/quotes', orders: '/api/orders', shipments: '/api/shipments' };
    const cell = (v: unknown): string => { if (v == null) return ''; const x = typeof v === 'object' ? ((v as any).primaryEmail ?? (v as any).primaryPhoneNumber ?? (v as any).primaryLinkUrl ?? ((v as any).amountMicros != null ? `${(v as any).amountMicros / 1e6} ${(v as any).currencyCode ?? ''}`.trim() : JSON.stringify(v))) : String(v);
      return /[",\n\r]/.test(x) || /^[=+\-@]/.test(x) ? `"${(/^[=+\-@]/.test(x) ? "'" : '') + x.replace(/"/g, '""')}"` : x; };
    // ======================= Customer portal =======================
    // ---- Staff: manual provisioning (India admin / super admin with portal.logins.manage) ----
    const portalAdmin = (u: User) => {
      if (u.role !== 'SUPER_ADMIN' && u.role !== 'INDIA_ADMIN') throw new Forbidden('Only an India admin or the super admin can manage customer logins');
      need(u, 'portal.logins.manage');
    };
    const portalErr = (e: unknown) => { if (e instanceof PortalError) throw Object.assign(new Error(e.message), { status: e.status, appCode: e.code }); if (e instanceof BadCustomer) throw bad(e.message); throw e; };
    const staffActor = (u: User) => ({ id: u.id, kind: 'STAFF' as const });
    api.get<{ Querystring: { status?: string } }>('/api/portal-admin/login-requests', async (req) => {
      portalAdmin(req.user!); await custSync();
      const st = ['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query?.status)) ? String(req.query!.status) : undefined, names = userNames();
      const out = [];
      for (const r of await portal.requests(st)) {
        const lead = r.leadId ? await leadDb.get(r.leadId) : null;
        const suggested = r.customerId ?? (r.leadId ? await customers.customerOf(r.leadId) : null) ?? (await customers.match(r.phone, r.email, r.company));
        const c = suggested ? await customers.get(suggested) : null;
        const existing = (await portal.byPhone(r.phone)) ?? (c ? await portal.byCustomer(c.id) : null);
        out.push({ ...r, leadRef: (lead?.leadRef as string) ?? null, product: (lead?.productInterest as string) ?? null, decidedByName: (r.decidedBy && names.get(r.decidedBy)) || null,
          customer: c ? { id: c.id, name: c.name, company: c.company, phone: c.phone } : null, hasLogin: !!existing });
      }
      return { data: out };
    });
    api.post<{ Params: { id: string }; Body: { customerId?: string } }>('/api/portal-admin/login-requests/:id/approve', async (req) => {
      const u = req.user!; portalAdmin(u); await custSync();
      const r = await portal.requestById(req.params.id); if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
      if (r.status !== 'PENDING') throw bad('This request was already handled', 409);
      let cid = req.body?.customerId ? String(req.body.customerId) : (r.leadId ? await customers.customerOf(r.leadId) : null) ?? (await customers.match(r.phone, r.email, r.company));
      if (cid && !(await customers.get(cid))) throw bad('Unknown customer');
      if (!cid) cid = (await customers.add({ name: r.name, company: r.company, phone: r.phone, email: r.email }, u.id).catch(custErr)).id;
      const pw = tempPassword();
      const login = await o.db.tx(async (t) => {
        const l = await portal.create(cid!, { name: r.name, phone: r.phone, email: r.email }, pw, u.id, t);
        await portal.decide(r.id, 'APPROVED', u.id, { customerId: cid }, t);
        await portal.audit(staffActor(u), 'LOGIN_ISSUED', cid, { requestId: r.id }, t);
        return l;
      }).catch(portalErr);
      // The temporary password is returned once, for the team to pass on by hand; it is never stored in clear or shown again.
      return { data: { login: loginView(login), tempPassword: pw } };
    });
    api.post<{ Params: { id: string }; Body: { reason?: string } }>('/api/portal-admin/login-requests/:id/reject', async (req) => {
      const u = req.user!; portalAdmin(u);
      const reason = String(req.body?.reason ?? '').trim().slice(0, 500); if (!reason) throw bad('A reason is required');
      const r = await portal.requestById(req.params.id); if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
      await portal.decide(r.id, 'REJECTED', u.id, { reason }).catch(portalErr);
      await portal.audit(staffActor(u), 'LOGIN_REJECTED', r.id, { reason });
      return { data: await portal.requestById(r.id) };
    });
    const custOf = async (id: string) => { const c = await customers.get(id); if (!c) throw Object.assign(new Error('Not found'), { status: 404 }); return c; };
    api.get<{ Params: { id: string } }>('/api/customers/:id/portal-login', async (req) => {
      const u = req.user!; custOnly(u.role); const c = await custOf(req.params.id);
      const l = await portal.byCustomer(c.id), names = userNames();
      const audit = (u.role === 'SUPER_ADMIN' || (u.role === 'INDIA_ADMIN' && can(u, 'portal.logins.manage')))
        ? (await portal.auditFor(c.id)).map((a) => ({ at: a.at, action: a.action, by: a.actor_kind === 'STAFF' ? (names.get(a.actor_id) ?? null) : a.actor_kind === 'CUSTOMER' ? 'Customer' : null })) : [];
      return { data: { login: loginView(l), audit } };
    });
    api.post<{ Params: { id: string }; Body: { phone?: string; name?: string; email?: string } }>('/api/customers/:id/portal-login', async (req, reply) => {
      const u = req.user!; portalAdmin(u); const c = await custOf(req.params.id), b = req.body ?? {};
      const phone = String(b.phone ?? c.phone ?? '').trim(); if (!phoneKey(phone)) throw bad('A mobile number is required for a portal login');
      const pw = tempPassword();
      const login = await portal.create(c.id, { name: String(b.name ?? c.name), phone, email: b.email ?? c.email }, pw, u.id).catch(portalErr);
      await portal.audit(staffActor(u), 'LOGIN_ISSUED', c.id, {});
      return reply.code(201).send({ data: { login: loginView(login), tempPassword: pw } });
    });
    api.post<{ Params: { id: string } }>('/api/customers/:id/portal-login/reset', async (req) => {
      const u = req.user!; portalAdmin(u); const c = await custOf(req.params.id);
      const l = await portal.byCustomer(c.id); if (!l) throw Object.assign(new Error('This customer has no portal login'), { status: 404 });
      const pw = tempPassword(); const nl = await portal.setPassword(l.id, pw, true);
      await portal.audit(staffActor(u), 'PASSWORD_RESET', c.id, {});
      return { data: { login: loginView(nl), tempPassword: pw } };
    });
    api.post<{ Params: { id: string }; Body: { active?: boolean } }>('/api/customers/:id/portal-login/active', async (req) => {
      const u = req.user!; portalAdmin(u); const c = await custOf(req.params.id);
      const l = await portal.byCustomer(c.id); if (!l) throw Object.assign(new Error('This customer has no portal login'), { status: 404 });
      if (typeof req.body?.active !== 'boolean') throw bad('active must be true or false');
      const nl = await portal.setActive(l.id, req.body.active);
      await portal.audit(staffActor(u), req.body.active ? 'LOGIN_ENABLED' : 'LOGIN_DISABLED', c.id, {});
      return { data: { login: loginView(nl) } };
    });

    // ---- Customer realm (/api/portal/*): every read is scoped to the signed-in customer's own records ----
    const me2 = async (c: CustomerUser) => { const cust = await customers.get(c.customerId);
      return { name: c.name, phone: c.phone, email: c.email, mustChangePassword: c.mustChangePassword, company: cust?.company ?? null, city: cust?.city ?? null }; };
    api.get('/api/portal/me', async (req) => ({ data: await me2(req.customer!) }));
    api.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/api/portal/me/password', async (req, reply) => {
      const c = req.customer!, cur = String(req.body?.currentPassword ?? ''), nw = String(req.body?.newPassword ?? '');
      if (!(await portal.checkPassword(c.id, cur))) return reply.code(400).send({ error: 'Current password is wrong' });
      if (nw.length < PORTAL_MIN_PASSWORD) return reply.code(400).send({ error: `Use at least ${PORTAL_MIN_PASSWORD} characters` });
      if (nw === cur) return reply.code(400).send({ error: 'Choose a new password' });
      const nc = (await portal.setPassword(c.id, nw, false))!;
      await portal.audit({ id: c.id, kind: 'CUSTOMER' }, 'PASSWORD_CHANGED', c.customerId, {});
      return { token: portal.sign(nc), data: await me2(nc) };
    });
    const notFound = () => Object.assign(new Error('Not found'), { status: 404 });
    const ownLeadIds = async (c: CustomerUser) => (await o.db.all<{ id: string }>('SELECT id FROM leads WHERE customer_id = ? ORDER BY created_at DESC, id', c.customerId)).map((r) => r.id);
    const ownLead = async (c: CustomerUser, id: string) => {
      const r = await o.db.get('SELECT id FROM leads WHERE id = ? AND customer_id = ?', String(id), c.customerId); if (!r) throw notFound();
      const l = await leadDb.get(r.id); if (!l) throw notFound(); return l;
    };
    const PUBLISHED = new Set(['SENT', 'ACCEPTED', 'REJECTED']);
    /** Customer-safe DTO (an allowlist): never supplier, China staff, internal notes, cost prices, SLA or assignment. */
    const portalRequest = async (l: Rec, full: boolean) => {
      const id = String(l.id), a = await assign.get(id), meta = await wf.meta(id);
      const st = await stageOf(l, (a?.ownerOffice as Office) ?? null), cs = customerStage(st.stage, st.lost || !!meta?.closedAt || String(l.status) === 'CLOSED');
      const qs = await quotes.list(id), ref = (l.leadRef as string) ?? null;
      const base = { id, type: 'SOURCING' as const, reference: ref, product: l.productInterest ?? null, quantity: l.quantity ?? null, unit: l.unit ?? null,
        createdAt: l.createdAt, stage: cs.stage, stageIndex: cs.index, closed: cs.closed, quotesWaiting: qs.filter((q) => q.status === 'SENT' && q.cq).length };
      if (!full) return base;
      const tp = l.targetPrice as { amountMicros?: number | null; currencyCode?: string } | undefined;
      const quoteRows = [];
      for (const [i, q] of qs.entries()) {
        if (!PUBLISHED.has(q.status) || !q.cq) continue;
        let token = q.pdfToken; if (!token) { token = randomBytes(32).toString('base64url'); await quotes.setToken(q.id, token); }
        quoteRows.push({ id: q.id, label: `${ref ?? 'Quote'}-Q${i + 1}`, product: q.product, status: q.status, sentAt: q.sentAt, decidedAt: q.decidedAt,
          qty: q.cq.qty ?? null, unitPrice: q.cq.unitPrice ?? null, currency: 'INR', total: cqTotals(q.cq).total, moq: q.moq, leadTime: q.leadTime, validity: q.validity,
          pdfUrl: `/api/public/cq/${token}.pdf`, canDecide: q.status === 'SENT' });
      }
      const orderRows = [];
      for (const x of await orders.byLead(id)) {
        const sh = await ships.byOrder(x.id);
        orderRows.push({ id: x.id, product: x.product, qty: x.qty, value: x.qty * x.agreedPrice, currency: 'INR', paymentStatus: x.paymentStatus, createdAt: x.createdAt,
          shipment: sh ? { reference: sh.ref, status: sh.status, mode: sh.mode, etd: sh.etd, eta: sh.eta, tracking: sh.tracking, container: sh.container, deliveredAt: sh.deliveredAt } : null });
      }
      const mine = new Set((await o.db.all<{ file_id: string }>('SELECT file_id FROM portal_files WHERE lead_id = ?', id)).map((r) => r.file_id));
      return { ...base, deliveryCity: l.deliveryCity ?? null, message: l.enquiryMessage ?? null,
        targetPrice: tp?.amountMicros != null ? { amount: tp.amountMicros / 1e6, currency: tp.currencyCode || 'INR' } : null,
        files: uploads.list(id).filter((f) => mine.has(f.id)).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.createdAt })),
        quotes: quoteRows, orders: orderRows, timeline: await wf.customerEvents(id) };
    };
    api.get('/api/portal/requests', async (req) => {
      const c = req.customer!, out = [];
      for (const id of await ownLeadIds(c)) { const l = await leadDb.get(id); if (l) out.push(await portalRequest(l, false)); }
      return { data: out };
    });
    api.get<{ Params: { id: string } }>('/api/portal/requests/:id', async (req) => ({ data: await portalRequest(await ownLead(req.customer!, req.params.id), true) }));
    api.get<{ Params: { id: string; fid: string } }>('/api/portal/requests/:id/files/:fid', async (req, reply) => {
      const l = await ownLead(req.customer!, req.params.id), id = String(l.id);
      if (!(await o.db.get('SELECT 1 FROM portal_files WHERE lead_id = ? AND file_id = ?', id, req.params.fid))) throw notFound();
      const f = uploads.file(id, req.params.fid); if (!f) throw notFound();
      return reply.header('content-type', f.meta.mime).header('content-disposition', `inline; filename="${f.meta.name.replace(/[^\w.\- ]/g, '_')}"`)
        .header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(createReadStream(f.path));
    });
    api.post('/api/portal/requests', async (req, reply) => {
      const c = req.customer!;
      const b: Record<string, string> = {}; let files: Staged[] = [];
      if (req.isMultipart()) { const m = await readMultipart(req, MAX_FILES); if (m.err) return reply.code(m.err.status).send({ error: m.err.error, code: m.err.code }); Object.assign(b, m.fields); files = m.files; }
      else Object.assign(b, Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])));
      const reject = (code: number, body: unknown) => { uploads.discard(files); return reply.code(code).send(body); };
      const str = (k: string, max = 200) => (b[k] ?? '').trim().slice(0, max);
      const dayKey = `se:preq:${c.id}:${new Date().toISOString().slice(0, 10)}`;
      if (Number((await o.bus.get(dayKey)) ?? 0) >= 20) return reject(429, { error: 'Too many requests today, please contact Source Easy' });
      const product = str('product', 1000); if (!product) return reject(400, { error: 'Describe the product you need', code: 'required' });
      const ref = str('referenceUrl', 500); if (ref && !/^https?:\/\/[^\s]+$/i.test(ref)) return reject(400, { error: 'Reference link must start with http:// or https://', code: 'url' });
      const currency = ['USD', 'CNY', 'INR'].includes(str('currency', 3)) ? str('currency', 3) : 'INR';
      const price = Number(str('targetPrice', 20)), qty = Number(str('quantity', 12)), unit = UNITS.includes(str('unit', 12)) ? str('unit', 12) : 'pcs';
      await o.bus.incr(dayKey, 86400);
      const cust = await customers.get(c.customerId); if (!cust) return reject(404, { error: 'Not found' });
      const leadRef = await nextRef(), city = str('deliveryCity', 120) || cust.city || '', msg = str('message', 2000);
      const digits = String(c.phone).replace(/[^\d+]/g, '');
      const lead = await leadDb.create({
        name: `${cust.company || cust.name} — ${product}`.slice(0, 200), clientName: cust.company || cust.name, contactName: c.name, productInterest: product,
        ...(qty > 0 ? { quantity: qty, unit } : {}), ...(price > 0 ? { targetPrice: { amountMicros: Math.round(price * 1e6), currencyCode: currency } } : {}),
        contactPhone: { primaryPhoneNumber: digits }, ...(c.email || cust.email ? { contactEmail: { primaryEmail: c.email || cust.email } } : {}),
        ...(city ? { deliveryCity: city } : {}), ...(ref ? { referenceUrl: { primaryLinkUrl: ref } } : {}), ...(msg ? { enquiryMessage: msg } : {}),
        leadRef, attachmentCount: files.length, sourceChannel: 'PORTAL', status: 'NEW', assignedOffice: 'INDIA', office: 'INDIA',
      });
      const lid = String(lead.id);
      await o.db.run('UPDATE leads SET customer_id = ?, portal_user_id = ? WHERE id = ?', c.customerId, c.id, lid);
      if (files.length) {
        const list = uploads.commit(lid, files); await mediaSync(lid, list);
        for (const f of list) await o.db.run('INSERT INTO portal_files (lead_id, file_id) VALUES (?,?) ON CONFLICT DO NOTHING', lid, f.id);
      } else uploads.discard(files);
      await ev(lid, 'CREATED', null, { channel: 'PORTAL', files: files.length });
      await handoff({ ...lead, leadRef, productInterest: product }, null, 'INDIA', null);
      const admins = new Set(queueWatchers('INDIA'));
      const staff = o.users.list().filter((u) => u.active && officeOf(u.role) === 'INDIA' && !admins.has(u.id)).map((u) => u.id);
      if (staff.length) await assign.notify(staff, { leadId: lid, leadRef, product, kind: 'PORTAL_REQUEST', office: 'INDIA', byName: null });
      await liveData({ type: 'lead', id: lid, leadId: lid, created: true, at: Date.now() });
      await portal.audit({ id: c.id, kind: 'CUSTOMER' }, 'REQUEST_CREATED', c.customerId, { leadRef });
      return reply.code(201).send({ data: await portalRequest((await leadDb.get(lid))!, true) });
    });
    const ownQuote = async (c: CustomerUser, qid: string) => {
      const q = await quotes.get(String(qid)); if (!q) throw notFound();
      await ownLead(c, q.leadId); if (!PUBLISHED.has(q.status) || !q.cq) throw notFound();
      return q;
    };
    api.post<{ Params: { qid: string } }>('/api/portal/quotes/:qid/accept', async (req) => {
      const c = req.customer!, q = await ownQuote(c, req.params.qid);
      if (q.status !== 'SENT') throw bad('This quote was already decided', 409);
      await applyQuoteStatus(null, { id: `customer:${c.id}`, name: c.name }, q, { status: 'ACCEPTED' });
      await portal.audit({ id: c.id, kind: 'CUSTOMER' }, 'QUOTE_ACCEPTED', c.customerId, { quoteId: q.id });
      await liveData({ type: 'quote', id: q.id, leadId: q.leadId, at: Date.now() });
      return { data: await portalRequest((await leadDb.get(q.leadId))!, true) };
    });
    api.post<{ Params: { qid: string }; Body: { reasonCode?: string; reason?: string } }>('/api/portal/quotes/:qid/reject', async (req) => {
      const c = req.customer!, q = await ownQuote(c, req.params.qid);
      if (q.status !== 'SENT') throw bad('This quote was already decided', 409);
      await applyQuoteStatus(null, { id: `customer:${c.id}`, name: c.name }, q, { status: 'REJECTED', reasonCode: String(req.body?.reasonCode ?? 'OTHER'), reason: String(req.body?.reason ?? '').slice(0, 500) });
      await portal.audit({ id: c.id, kind: 'CUSTOMER' }, 'QUOTE_REJECTED', c.customerId, { quoteId: q.id });
      await liveData({ type: 'quote', id: q.id, leadId: q.leadId, at: Date.now() });
      return { data: await portalRequest((await leadDb.get(q.leadId))!, true) };
    });
    api.get('/api/portal/reject-reasons', async () => ({ data: REJECT_REASONS }));
    // Live updates: only "request X changed" for the customer's own requests (ids only; the app refetches through the scoped API).
    api.get('/api/portal/stream', async (req, reply) => {
      const c = req.customer!; let own = new Set(await ownLeadIds(c));
      reply.hijack(); const res = reply.raw;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const send = (e: string, d: unknown) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      res.write('retry: 3000\n\n'); send('hello', {});
      const off = onLiveData((d) => { const lid = d.leadId ? String(d.leadId) : null; if (lid && own.has(lid)) send('change', { type: 'request', id: lid }); });
      const ping = setInterval(() => { void (async () => {
        const now = await portal.byId(c.id);
        if (!now || !now.active || now.tokenVersion !== c.tokenVersion) { try { send('revoked', {}); } catch { /* closed */ } res.end(); close(); return; }
        own = new Set(await ownLeadIds(c)); res.write(': ping\n\n');
      })().catch(() => undefined); }, 25000);
      const close = () => { clearInterval(ping); off(); };
      req.raw.on('close', close); res.on('error', close);
    });

    api.get<{ Params: { kind: string } }>('/api/export/:kind', async (req, reply) => {
      const kind = req.params.kind.replace(/\.csv$/, ''), path = EXPORTS[kind];
      if (!path) throw Object.assign(new Error('Unknown export'), { status: 404 });
      const r = await app.inject({ method: 'GET', url: path, headers: { authorization: req.headers.authorization ?? '' } });
      if (r.statusCode !== 200) return reply.code(r.statusCode).send(r.json());
      const rows = (r.json().data ?? []) as Rec[], skip = new Set(['files', 'sla', 'rejection', 'canEdit']);
      const cols = [...new Set(rows.flatMap((x) => Object.keys(x)))].filter((c) => !skip.has(c));
      const csv = [cols.join(','), ...rows.map((x) => cols.map((c) => cell(x[c])).join(','))].join('\r\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="source-easy-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`)
        .header('cache-control', 'no-store').send('\ufeff' + csv);
    });
  });

  // Public Android app download. Files live on a persistent volume, not in the web build.
  const APK = 'source-easy.apk';
  if (o.downloadsDir) {
    const dir = o.downloadsDir;
    app.get('/download/version.json', async (_req, reply) => {
      const f = join(dir, 'version.json');
      if (!existsSync(f)) return reply.code(404).send({ error: 'No app published yet' });
      const v = JSON.parse(readFileSync(f, 'utf8'));
      const apk = join(dir, APK);
      return reply.header('cache-control', 'no-cache').send({ ...v, size: existsSync(apk) ? statSync(apk).size : v.size ?? null, url: `/download/${APK}` });
    });
    app.get(`/download/${APK}`, async (_req, reply) => {
      const f = join(dir, APK);
      if (!existsSync(f)) return reply.code(404).send({ error: 'No app published yet' });
      return reply
        .header('content-type', 'application/vnd.android.package-archive')
        .header('content-disposition', `attachment; filename="${APK}"`)
        .header('content-length', statSync(f).size)
        .header('cache-control', 'no-cache')
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(f));
    });
  }

  app.all('/api/*', async (_r, reply) => reply.code(404).send({ error: 'Not found' }));

  if (o.webDir && existsSync(o.webDir)) {
    await app.register(fastifyStatic, { root: o.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.method === 'GET' ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found' })));
  }
  return app;
}
