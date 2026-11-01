import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import jwt from 'jsonwebtoken';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import multipart from '@fastify/multipart';
import { RefCounter } from './refs.js';
import { MAX_FILES, MAX_STAFF_FILES, MAX_VIDEO_BYTES, UploadStore, type Staged } from './uploads.js';
import { capabilities, isRole, manageableRoles, sides, type Role } from './roles.js';
import { canRead, CHINA_LEAD_STATUSES, FILTERABLE, Forbidden, OBJECTS, PLURAL_TO_OBJECT, readFilter, writeCheck, type Ctx, type ObjectName, type Rec } from './policy.js';
import type { TwentyLike } from './twenty.js';
import type { UserStore, User } from './users.js';
import { QuoteStore, QUOTE_STATUSES, cqTotals, type Quote } from './quotes.js';
import { OrderStore, INDIA_KEYS, CHINA_KEYS, type Order } from './orders.js';
import { customerQuotePdf } from './pdf.js';
import { AvatarStore, BadImage, AVATAR_MAX_BYTES } from './avatars.js';
import { RejectStore, REJECT_REASONS } from './rejections.js';
import { ShipmentStore, SHIP_CHINA_KEYS, SHIP_INDIA_KEYS, CHINA_SHIP_STATUS, INDIA_SHIP_STATUS, shipRank, type Shipment } from './shipments.js';
import { AssignStore, type Assignment, type Office } from './assign.js';
import { WorkflowStore, type LeadEvent, type EventKind, type Vis } from './workflow.js';

export interface AppOptions {
  twenty: TwentyLike;
  users: UserStore;
  jwtSecret: string;
  jwtTtl?: string;
  webDir?: string;
  backupLinks?: { label: string; url: string }[];
  logger?: boolean;
  /** Private folder for enquiry attachments (default: in-memory temp dir for tests). */
  uploadsDir?: string;
  /** Persistent folder holding source-easy.apk + version.json (published by infra/app-servers/publish-apk.sh). */
  downloadsDir?: string;
  /** Lead reference counter (SE-YYMM-NNNN). Default: in-memory (tests). */
  refs?: RefCounter;
  /** Clock for SLA (tests). */
  now?: () => number;
  /** SLA checker interval in ms (default 30 s; 0 = off, call app.slaTick() manually). */
  slaTickMs?: number;
}

declare module 'fastify' { interface FastifyRequest { user?: User } interface FastifyInstance { slaTick: () => Promise<{ warn: number; breach: number }> } }

export async function buildApp(o: AppOptions) {
  const app = Fastify({ logger: o.logger ?? false, trustProxy: true, bodyLimit: 1 << 20 });
  const refs = o.refs ?? new RefCounter();
  let seeded: Promise<void> | null = null;
  /** Next shared lead reference. First call also syncs the counter with refs already stored in Twenty. */
  const nextRef = async () => {
    seeded ??= o.twenty.list(OBJECTS.lead).then((ls) => ls.forEach((l) => refs.seen(l.leadRef)));
    await seeded;
    return refs.next();
  };
  /** Child records inherit the lead's reference: sourcing request & shipment via leadId, quotation via its sourcing request. */
  const inheritRef = async (obj: ObjectName, data: Rec): Promise<string | undefined> => {
    const ref = async (plural: string, id: unknown) => (id ? (await o.twenty.get(plural, String(id)))?.leadRef as string | undefined : undefined);
    if (obj === 'sourcingRequest') return ref(OBJECTS.lead, data.leadId);
    if (obj === 'quotation') return ref(OBJECTS.sourcingRequest, data.sourcingRequestId);
    if (obj === 'shippingOrder') return (await ref(OBJECTS.lead, data.leadId)) ?? (await ref(OBJECTS.quotation, data.quotationId));
    return undefined;
  };
  const fails = new Map<string, { n: number; until: number }>();

  // ---- Lead ownership (raisedBy / assignedTo) + notifications ----
  const assign = new AssignStore(o.users.database);
  const quotes = new QuoteStore(o.users.database);
  const orders = new OrderStore(o.users.database);
  const ships = new ShipmentStore(o.users.database);
  const rejects = new RejectStore(o.users.database);
  /** Shipment fields from the customer quote (falls back to China's shipping offer). */
  const shipFrom = (q: Quote | null) => ({ mode: q?.cq?.shipMode ?? q?.shipMode ?? null, incoterm: q?.cq?.shipTerm ?? q?.shipTerm ?? null,
    port: q?.cq?.port ?? q?.shipPort ?? null, transit: q?.cq?.transit ?? q?.shipTransit ?? null });
  const orderShipStatus = (x: Order) => (x.indiaStatus !== 'NONE' && x.indiaStatus ? x.indiaStatus : x.production === 'SHIPPED' ? 'IN_TRANSIT' : 'PENDING');
  const shipFor = (x: Order) => ships.byOrder(x.id) ?? ships.create({ orderId: x.id, leadId: x.leadId, leadRef: x.leadRef, ...shipFrom(quotes.get(x.quoteId)),
    tracking: x.tracking, container: x.container, etd: x.etd, eta: x.eta, status: orderShipStatus(x), createdAt: x.createdAt });
  // Backfill: every order made before shipments existed gets its shipment now.
  for (const x of orders.all().reverse()) shipFor(x);
  const wf = new WorkflowStore(o.users.database, o.now ?? Date.now);
  const officeOf = (r: Role): Office | null => (r.startsWith('INDIA') ? 'INDIA' : r.startsWith('CHINA') ? 'CHINA' : null);
  const staffOf = (office: Office) => o.users.list().filter((u) => u.active && officeOf(u.role) === office);
  const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
  /** Adds raisedBy/assignedTo (+ names) to a filtered lead. Only staff names/ids, never customer data. */
  const decorate = (rec: Rec, a: Assignment | null | undefined, names: Map<string, string>) => ({
    ...rec, raisedBy: a?.raisedBy ?? null, raisedByName: (a?.raisedBy && names.get(a.raisedBy)) || null,
    assignedTo: a?.assignedTo ?? null, assignedToName: (a?.assignedTo && names.get(a.assignedTo)) || null,
    ownerOffice: a?.ownerOffice ?? (rec.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA'),
    rejection: rec.id ? rejects.summary(String(rec.id), names) : null,
    priority: wf.priority(String(rec.id)), sla: slaView(String(rec.id), names),
  });
  const slaView = (leadId: string, names?: Map<string, string>) => {
    const c = wf.clock(leadId);
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
  const handoff = (lead: Rec, actor: User | null, office: Office, to: string | null | undefined) => {
    const leadId = String(lead.id), prev = assign.get(leadId);
    if (to) {
      const u = o.users.byId(to);
      if (!u || !u.active || (officeOf(u.role) !== office && !(office === 'INDIA' && u.role === 'SUPER_ADMIN'))) throw bad(`Assignee must be an active ${office} staff member`);
    }
    // Remember who raised the lead when nobody was recorded (public enquiries, older leads):
    // the India member/super admin who sends it to China, or the India member it gets assigned to.
    if (!prev?.raisedBy) {
      const by = office === 'CHINA' && indiaOwner(actor) ? actor!.id : office === 'INDIA' && to ? to : null;
      if (by) assign.set(leadId, { raisedBy: by });
    }
    if (to === undefined) {
      const r = prev?.raisedBy ? o.users.byId(prev.raisedBy) : null;
      to = office === 'INDIA' && indiaOwner(r) ? r!.id : null;
    }
    const returned = office === 'INDIA' && prev?.ownerOffice === 'CHINA';
    const changed = prev?.ownerOffice !== office || (prev?.assignedTo ?? null) !== to;
    assign.set(leadId, { ownerOffice: office, assignedTo: to });
    if (changed) {
      const toName = to ? o.users.byId(to)?.name ?? null : null;
      ev(leadId, returned ? 'RETURNED' : prev?.ownerOffice === office ? 'REASSIGNED' : !to ? 'QUEUED' : 'ASSIGNED', actor, { office, to: toName });
      // Each handoff to another office starts that office's SLA clock; a reassignment within the office keeps it running.
      if (prev?.ownerOffice !== office || wf.clock(leadId)) wf.start(leadId, office, to);
    }
    if (changed) {
      const recips = (to ? [to] : queueWatchers(office)).filter((id) => id !== actor?.id);
      assign.notify(recips, { leadId, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null,
        kind: !to ? 'QUEUE' : returned ? 'RETURNED' : 'ASSIGNED', office, byName: actor?.name ?? null });
    }
  };
  const stopClock = (leadId: string, office?: Office) => wf.stop(leadId, office);
  /** SLA watcher: 80% → the clock's assignee (or the office queue watchers); breach → office admins + super admin (+ assignee), logged on the timeline. */
  const slaTick = async () => {
    const { warn, breach } = wf.tick();
    for (const [c, kind] of [...warn.map((c) => [c, 'SLA_WARN'] as const), ...breach.map((c) => [c, 'SLA_BREACH'] as const)]) {
      const lead = await o.twenty.get(OBJECTS.lead, c.leadId).catch(() => null);
      if (!lead) { wf.forgetLead(c.leadId); continue; }
      const owner = c.assignee && o.users.byId(c.assignee)?.active ? [c.assignee] : [];
      const recips = kind === 'SLA_WARN' ? (owner.length ? owner : queueWatchers(c.office)) : [...new Set([...queueWatchers(c.office), ...owner])];
      if (kind === 'SLA_BREACH') wf.log(c.leadId, 'SLA_BREACH', null, { office: c.office, dueAt: c.dueAt, assignee: (c.assignee && o.users.byId(c.assignee)?.name) || null, priority: c.priority });
      assign.notify(recips, { leadId: c.leadId, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind, office: c.office, byName: null });
    }
    return { warn: warn.length, breach: breach.length };
  };
  const tickMs = o.slaTickMs ?? 30000;
  if (tickMs > 0) {
    const t = setInterval(() => { slaTick().catch((e) => app.log.warn(e, 'sla tick failed')); }, tickMs);
    t.unref?.(); app.addHook('onClose', async () => clearInterval(t));
  }
  app.decorate('slaTick', slaTick);
  /** Workflow stage for the progress bar. */
  const STAGES = ['NEW', 'CHINA', 'SOURCING', 'QUOTED', 'CQ_SENT', 'DECIDED', 'ORDER', 'SHIPPED', 'DELIVERED'] as const;
  const stageOf = (lead: Rec, owner: Office | null) => {
    const qs = quotes.list(String(lead.id)), ords = orders.all().filter((x) => x.leadId === lead.id), st = String(lead.status ?? 'NEW');
    const lost = st === 'LOST' || (qs.some((q) => q.status === 'REJECTED') && !qs.some((q) => q.status === 'ACCEPTED' || q.status === 'SENT'));
    let stage: (typeof STAGES)[number] = 'NEW';
    if (st === 'DELIVERED' || ords.some((x) => x.indiaStatus === 'DELIVERED')) stage = 'DELIVERED';
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
  /** Body field `assignedTo` ('' / null = office queue). Stripped before the Twenty write. */
  const takeAssignee = (body: Rec): string | null | undefined => {
    if (!('assignedTo' in body)) return undefined;
    const v = body.assignedTo; delete body.assignedTo;
    return v ? String(v) : null;
  };

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof BadImage || err?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(400).send({ error: err instanceof BadImage ? err.message : 'Image must be 5 MB or smaller' });
    const status = err instanceof Forbidden ? 403 : err.status ?? err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: status >= 500 && status !== 502 ? 'Internal error' : err.message });
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  const sign = (u: User) => jwt.sign({ sub: u.id, role: u.role, v: o.users.tokenVersion(u.id) }, o.jwtSecret, { expiresIn: (o.jwtTtl ?? '12h') as any });

  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Not signed in' });
    try {
      const p = jwt.verify(h.slice(7), o.jwtSecret) as { sub: string; v: number };
      const u = o.users.byId(p.sub);
      // Role always comes from the DB, never from the token; token is revoked on password/role change.
      if (!u || !u.active || o.users.tokenVersion(u.id) !== p.v) return reply.code(401).send({ error: 'Session expired' });
      req.user = u;
    } catch { return reply.code(401).send({ error: 'Session expired' }); }
  }
  const ctxOf = async (role: Role): Promise<Ctx> => ({ role });
  const avatars = new AvatarStore(o.users.database);
  const avatarOf = (id: string) => avatars.urls().get(id) ?? null;
  const me = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, language: u.language ?? null, avatarUrl: avatarOf(u.id), capabilities: capabilities(u.role) });
  // Public by design (an <img> cannot send a bearer token); ids are random UUIDs and pictures are low-sensitivity.
  app.get<{ Params: { id: string } }>('/api/avatars/:id', async (req, reply) => {
    const a = avatars.get(req.params.id); if (!a) return reply.code(404).send({ error: 'Not found' });
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
    const key = `${req.ip}|${email.toLowerCase()}`, f = fails.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) return reply.code(429).send({ error: 'Too many attempts, try again in a few minutes' });
    const u = await o.users.verify(email, password);
    if (!u) { fails.set(key, { n: (f?.n ?? 0) + 1, until: Date.now() + 10 * 60e3 }); return reply.code(401).send({ error: 'Invalid email or password' }); }
    fails.delete(key);
    return { token: sign(u), user: me(u) };
  });

  // Public website enquiry -> a NEW lead for the India office. No auth; honeypot + per-IP rate limit (5/hour).
  // Accepts multipart/form-data (with up to 5 attachments, 10 MB each) or plain JSON.
  const uploads = new UploadStore(o.uploadsDir ?? `${process.env.TMPDIR ?? '/tmp'}/se-uploads-${process.pid}`);
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
  const enq = new Map<string, number[]>();
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
    const now = Date.now(), hits = (enq.get(req.ip) ?? []).filter((t) => now - t < 3600e3);
    if (hits.length >= 5) return reject(429, { error: 'Too many enquiries, please try again later' });

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
    hits.push(now); enq.set(req.ip, hits);

    const leadRef = await nextRef();
    const company = str('company', 160), msg = str('message', 2000), city = str('deliveryCity', 120);
    const lead = await o.twenty.create('leads', {
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
    if (files.length && lead?.id) uploads.commit(String(lead.id), files); else uploads.discard(files);
    if (lead?.id) { ev(String(lead.id), 'CREATED', null, { channel: 'WEBSITE', files: files.length }); handoff({ ...lead, leadRef, productInterest: product }, null, 'INDIA', null); } // India queue; India admins are notified
    return reply.code(201).send({ ok: true, reference: leadRef, attachments: files.length });
  });

  app.register(async (api) => {
    api.addHook('preHandler', auth);
    api.get('/api/me', async (req) => me(req.user!));
    // Per-user UI language (devices also keep their own choice).
    api.patch<{ Body: { language?: string } }>('/api/me', async (req, reply) => {
      try { return me(o.users.setLanguage(req.user!.id, String(req.body?.language ?? ''))); }
      catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    });
    api.post<{ Body: { currentPassword: string; newPassword: string } }>('/api/me/password', async (req, reply) => {
      if (!(await o.users.verify(req.user!.email, req.body?.currentPassword ?? ''))) return reply.code(400).send({ error: 'Current password is wrong' });
      try { await o.users.setPassword(req.user!.id, String(req.body.newPassword ?? '')); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      // All other sessions are revoked (token version bumped); this device gets a fresh token.
      return { token: sign(o.users.byId(req.user!.id)!) };
    });
    api.post('/api/me/avatar', async (req) => { await avatars.set(req.user!.id, await readImage(req)); return me(req.user!); });
    api.delete('/api/me/avatar', async (req) => { avatars.remove(req.user!.id); return me(req.user!); });
    // Names + pictures of active staff, to show avatars next to names (timeline, notifications…).
    api.get('/api/people', async () => { const a = avatars.urls(); return { data: o.users.list().filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, avatarUrl: a.get(u.id) ?? null })) }; });

    // ---- Enquiry attachments: only for a lead the user can read. Never a public URL. ----
    const attLead = async (req: FastifyRequest<{ Params: { id: string } }>) => {
      // Product photos/documents: any side that can read the lead (China only sees China-assigned leads).
      const role = req.user!.role;
      const r = await o.twenty.get(OBJECTS.lead, req.params.id);
      if (!r || !readFilter('lead', r, await ctxOf(role))) throw Object.assign(new Error('Not found'), { status: 404 });
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
    const syncCount = async (leadId: string, n: number) => {
      try { await o.twenty.update(OBJECTS.lead, leadId, { attachmentCount: n }); } catch (e) { app.log.warn(e, 'attachmentCount sync failed'); }
    };
    api.post<{ Params: { id: string } }>('/api/leads/:id/attachments', async (req, reply) => {
      const id = await attWrite(req);
      if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart/form-data expected' });
      const m = await readMultipart(req, MAX_STAFF_FILES);
      if (m.err) return reply.code(m.err.status).send({ error: m.err.error, code: m.err.code });
      if (uploads.list(id).length + m.files.length > 30) { uploads.discard(m.files); return reply.code(413).send({ error: 'Up to 30 files per lead', code: 'count' }); }
      const list = uploads.commit(id, m.files);
      await syncCount(id, list.length);
      ev(id, 'MEDIA_ADDED', req.user!, { count: m.files.length });
      return reply.code(201).send({ data: list });
    });
    api.delete<{ Params: { id: string; fid: string } }>('/api/leads/:id/attachments/:fid', async (req, reply) => {
      const id = await attWrite(req);
      const rest = uploads.remove(id, req.params.fid);
      if (!rest) return reply.code(404).send({ error: 'Not found' });
      await syncCount(id, rest.length);
      return { data: rest };
    });

    // ---- Supplier quotes on a lead (China writes; India reads a redacted view + adds its selling price) ----
    const qKey = (id: string) => `q_${id.replace(/-/g, '')}`.slice(0, 64);
    const quoteOf = async (req: FastifyRequest<{ Params: { qid: string } }>) => {
      const q = quotes.get(req.params.qid);
      if (!q) throw Object.assign(new Error('Not found'), { status: 404 });
      await attLead({ ...req, params: { id: q.leadId } } as any); // 404 unless this user can read the lead
      return q;
    };
    const canEditQuote = (role: Role, uid: string, q: Quote) => role === 'SUPER_ADMIN' || role === 'CHINA_ADMIN' || (role === 'CHINA_STAFF' && q.createdBy === uid);
    /** China + super admin: everything. India: no supplier id/identity/contact, neutral file names. */
    const viewQuote = (u: { role: Role; id: string }, q: Quote, i: number, ref: string | null) => {
      const role = u.role;
      const s = sides(role), names = userNames();
      const files = uploads.list(qKey(q.id));
      const base = { id: q.id, leadId: q.leadId, product: q.product, unitPrice: q.unitPrice, currency: q.currency, moq: q.moq, leadTime: q.leadTime,
        validity: q.validity, notes: q.notes, createdAt: q.createdAt, updatedAt: q.updatedAt,
        shipCost: q.shipCost, shipCurrency: q.shipCurrency, shipTerm: q.shipTerm, shipMode: q.shipMode, shipPort: q.shipPort, shipTransit: q.shipTransit,
        status: q.status, sentAt: q.sentAt, decidedAt: q.decidedAt, rejectReason: q.rejectReason, orderId: orders.byQuote(q.id)?.id ?? null };
      const client = { clientPrice: q.clientPrice, clientCurrency: q.clientCurrency, clientNotes: q.clientNotes, cq: q.cq, cqTotals: q.cq ? cqTotals(q.cq) : null,
        pdfUrl: q.pdfToken ? `/api/public/cq/${q.pdfToken}.pdf` : null };
      if (s.china) {
        const sup = q.supplierId ? quotes.supplier(q.supplierId) : null;
        return { ...base, ...(s.india ? client : {}), supplierId: q.supplierId, supplier: sup, createdBy: q.createdBy, createdByName: names.get(q.createdBy) ?? null, canEdit: canEditQuote(role, u.id, q), files };
      }
      return { ...base, ...client, label: `${ref ?? 'Quote'}-Q${i + 1}`,
        files: files.map((f, k) => ({ ...f, name: `${ref ?? 'quote'}-Q${i + 1}-${k + 1}${(/\.[A-Za-z0-9]{1,5}$/.exec(f.name)?.[0] ?? '').toLowerCase()}` })) };
    };
    const leadRefOf = async (id: string) => { try { return ((await o.twenty.get(OBJECTS.lead, id)) as any)?.leadRef ?? null; } catch { return null; } };
    const chinaOnly = (role: Role) => { if (!sides(role).china) throw new Forbidden('Only the China office can do this'); };
    api.get<{ Params: { id: string } }>('/api/leads/:id/quotes', async (req) => {
      const id = await attLead(req), ref = await leadRefOf(id);
      return { data: quotes.list(id).map((q, i) => viewQuote(req.user!, q, i, ref)) };
    });
    api.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/leads/:id/quotes', async (req, reply) => {
      chinaOnly(req.user!.role);
      const id = await attLead(req);
      if (quotes.count(id) >= 50) return reply.code(413).send({ error: 'Up to 50 quotes per lead' });
      let body = { ...(req.body ?? {}) } as Record<string, unknown>;
      if (body.newSupplier && typeof body.newSupplier === 'object') body.supplierId = quotes.addSupplier(body.newSupplier as any, req.user!.id).id;
      const q = quotes.create(id, body, req.user!.id);
      const list = quotes.list(id);
      ev(id, 'QUOTE_ADDED', req.user!, { n: list.findIndex((x) => x.id === q.id) + 1, supplier: q.supplierId ? quotes.supplier(q.supplierId)?.name ?? null : null });
      return reply.code(201).send({ data: viewQuote(req.user!, q, list.findIndex((x) => x.id === q.id), await leadRefOf(id)) });
    });
    api.patch<{ Params: { qid: string }; Body: Record<string, unknown> }>('/api/quotes/:qid', async (req) => {
      const q = await quoteOf(req), role = req.user!.role, s = sides(role), b = { ...(req.body ?? {}) };
      const clientKeys = ['clientPrice', 'clientCurrency', 'clientNotes'];
      let n = q;
      if (clientKeys.some((k) => k in b)) {
        if (!s.india) throw new Forbidden('Only the India office sets the customer price');
        n = quotes.setClient(q.id, Object.fromEntries(clientKeys.filter((k) => k in b).map((k) => [k, b[k]])));
      }
      const chinaKeys = Object.keys(b).filter((k) => !clientKeys.includes(k));
      if (chinaKeys.length) {
        if (!canEditQuote(role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can edit it');
        if (b.newSupplier && typeof b.newSupplier === 'object') b.supplierId = quotes.addSupplier(b.newSupplier as any, req.user!.id).id;
        delete b.newSupplier; for (const k of clientKeys) delete b[k];
        n = quotes.update(q.id, b);
      }
      const list = quotes.list(q.leadId), qn = list.findIndex((x) => x.id === n.id) + 1;
      if (chinaKeys.length) ev(q.leadId, 'QUOTE_EDITED', req.user!, { n: qn });
      if (clientKeys.some((k) => k in (req.body ?? {}))) ev(q.leadId, 'CQ_PREPARED', req.user!, { n: qn, edit: true }, 'INDIA');
      return { data: viewQuote(req.user!, n, list.findIndex((x) => x.id === n.id), await leadRefOf(q.leadId)) };
    });
    api.delete<{ Params: { qid: string } }>('/api/quotes/:qid', async (req, reply) => {
      const q = await quoteOf(req);
      if (!canEditQuote(req.user!.role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can delete it');
      quotes.remove(q.id); uploads.removeAll(qKey(q.id)); { const x = orders.byQuote(q.id); if (x) ships.removeOrder(x.id); } orders.removeQuote(q.id);
      return reply.code(204).send();
    });
    api.post<{ Params: { qid: string } }>('/api/quotes/:qid/files', async (req, reply) => {
      const q = await quoteOf(req);
      if (!canEditQuote(req.user!.role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can add files');
      if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart/form-data expected' });
      const m = await readMultipart(req, MAX_STAFF_FILES);
      if (m.err) return reply.code(m.err.status).send({ error: m.err.error, code: m.err.code });
      if (uploads.list(qKey(q.id)).length + m.files.length > 30) { uploads.discard(m.files); return reply.code(413).send({ error: 'Up to 30 files per quote', code: 'count' }); }
      uploads.commit(qKey(q.id), m.files);
      const list = quotes.list(q.leadId);
      return reply.code(201).send({ data: viewQuote(req.user!, q, list.findIndex((x) => x.id === q.id), await leadRefOf(q.leadId)) });
    });
    api.get<{ Params: { qid: string; fid: string } }>('/api/quotes/:qid/files/:fid', async (req, reply) => {
      const q = await quoteOf(req);
      const all = uploads.list(qKey(q.id)), k = all.findIndex((a) => a.id === req.params.fid);
      const f = uploads.file(qKey(q.id), req.params.fid);
      if (!f) return reply.code(404).send({ error: 'Not found' });
      if (sides(req.user!.role).china) return sendFile(req, reply, f);
      const ref = await leadRefOf(q.leadId), i = quotes.list(q.leadId).findIndex((x) => x.id === q.id);
      return sendFile(req, reply, f, `${ref ?? 'quote'}-Q${i + 1}-${k + 1}${(/\.[A-Za-z0-9]{1,5}$/.exec(f.meta.name)?.[0] ?? '').toLowerCase()}`);
    });
    api.delete<{ Params: { qid: string; fid: string } }>('/api/quotes/:qid/files/:fid', async (req, reply) => {
      const q = await quoteOf(req);
      if (!canEditQuote(req.user!.role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can remove files');
      if (!uploads.remove(qKey(q.id), req.params.fid)) return reply.code(404).send({ error: 'Not found' });
      return reply.code(204).send();
    });
    // ---- All quotes across leads (role-filtered) ----
    const readableLeads = async (role: Role) => {
      const [rows, ctx] = await Promise.all([o.twenty.list(OBJECTS.lead, {}), ctxOf(role)]);
      const all = assign.all(), names = userNames(), m = new Map<string, Rec>();
      for (const r of rows) { const f = readFilter('lead', r, ctx); if (f) m.set(String(f.id), decorate(f, all.get(String(f.id)), names)); }
      return m;
    };
    const quoteRow = (u: { role: Role; id: string }, q: Quote, lead: Rec, keepFiles = false) => {
      const i = quotes.list(q.leadId).findIndex((x) => x.id === q.id);
      const v: any = viewQuote(u, q, i, (lead.leadRef as string) ?? null);
      if (!keepFiles) delete v.files; // the all-quotes list omits files; single-quote responses keep them (the lead panel renders them)
      return { ...v, label: `${lead.leadRef ?? 'Quote'}-Q${i + 1}`, leadRef: lead.leadRef ?? null, leadStatus: lead.status ?? null, ownerOffice: lead.ownerOffice,
        assignedTo: lead.assignedTo ?? null, assignedToName: lead.assignedToName ?? null, raisedBy: lead.raisedBy ?? null };
    };
    api.get<{ Querystring: { status?: string; office?: string; mine?: string } }>('/api/quotes', async (req) => {
      const u = req.user!, leads = await readableLeads(u.role), q = req.query ?? {};
      let rows = quotes.all().filter((x) => leads.has(x.leadId)).map((x) => quoteRow(u, x, leads.get(x.leadId)!));
      if (q.status) rows = rows.filter((r) => r.status === String(q.status).toUpperCase());
      if (q.office) rows = rows.filter((r) => r.ownerOffice === String(q.office).toUpperCase());
      if (q.mine === '1' || q.mine === 'true') rows = rows.filter((r) => r.assignedTo === u.id || r.raisedBy === u.id || (r as any).createdBy === u.id);
      return { data: rows };
    });
    const indiaOnly = (role: Role) => { if (!sides(role).india) throw new Forbidden('Only the India office can do this'); };
    const leadOf = async (id: string) => (await o.twenty.get(OBJECTS.lead, id)) as Rec;
    const refresh = async (u: User, q: Quote) => { const l = await leadOf(q.leadId); return quoteRow(u, quotes.get(q.id)!, decorate(l, assign.get(q.leadId), userNames()), true); };
    /** Notify about a lead-level event (quote decided, order created/updated). */
    const tell = (recips: (string | null | undefined)[], lead: Rec, kind: 'QUOTE_ACCEPTED' | 'QUOTE_REJECTED' | 'ORDER_NEW' | 'ORDER_UPDATE' | 'SHIPMENT_UPDATE' | 'ORDER_SHIPPED' | 'LEAD_CLOSED', office: Office, actor: User) => {
      const ids = [...new Set(recips.filter((x): x is string => !!x && x !== actor.id && !!o.users.byId(x)?.active))];
      if (ids.length) assign.notify(ids, { leadId: String(lead.id), leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind, office, byName: actor.name });
    };
    /** India side of a lead: its raiser/assignee, else India admins + super admin. China side: who quoted, else China assignee, else China admins. */
    const indiaPeople = (leadId: string) => { const a = assign.get(leadId); const p = [a?.ownerOffice === 'INDIA' ? a?.assignedTo : null, a?.raisedBy].filter(Boolean) as string[]; return p.length ? p : queueWatchers('INDIA'); };
    const chinaPeople = (q: Quote) => { const a = assign.get(q.leadId); const p = [q.createdBy, a?.ownerOffice === 'CHINA' ? a?.assignedTo : null].filter((x) => x && officeOf(o.users.byId(x)?.role as Role) === 'CHINA') as string[]; return p.length ? p : queueWatchers('CHINA'); };
    api.put<{ Params: { qid: string }; Body: Record<string, unknown> }>('/api/quotes/:qid/customer', async (req) => {
      indiaOnly(req.user!.role); const q = await quoteOf(req);
      const n = quotes.setCustomer(q.id, req.body ?? {});
      ev(q.leadId, 'CQ_PREPARED', req.user!, { n: quotes.list(q.leadId).findIndex((x) => x.id === q.id) + 1, edit: !!q.cq }, 'INDIA');
      return { data: await refresh(req.user!, n) };
    });
    api.post<{ Params: { qid: string } }>('/api/quotes/:qid/pdf', async (req) => {
      indiaOnly(req.user!.role); const q = await quoteOf(req);
      if (!q.cq) throw bad('Prepare the customer quote first');
      if (!q.pdfToken) quotes.setToken(q.id, randomBytes(32).toString('base64url'));
      return { data: await refresh(req.user!, q) };
    });
    api.post<{ Params: { qid: string }; Body: { status?: string; reason?: string } }>('/api/quotes/:qid/status', async (req) => {
      const u = req.user!; indiaOnly(u.role); const q = await quoteOf(req), b = req.body ?? {};
      const st = String(b.status ?? '').toUpperCase() as Quote['status'];
      if (!QUOTE_STATUSES.includes(st)) throw bad('status must be DRAFT, SENT, ACCEPTED or REJECTED');
      if (st !== 'DRAFT' && !q.cq) throw bad('Prepare the customer quote first');
      const rcode = String((b as Rec).reasonCode ?? (st === 'REJECTED' && String(b.reason ?? '').trim() ? 'OTHER' : '')).toUpperCase();
      if (st === 'REJECTED' && !REJECT_REASONS.includes(rcode as any)) throw bad('A reason is required when the customer rejects');
      if (st === 'REJECTED' && rcode === 'OTHER' && !String(b.reason ?? '').trim()) throw bad('A reason is required when the customer rejects');
      if (st === 'DRAFT' && orders.byQuote(q.id)) throw bad('This quote already has an order');
      quotes.setStatus(q.id, st, st === 'REJECTED' ? (String(b.reason ?? '').trim() || rcode) : b.reason);
      const lead = await leadOf(q.leadId), qn = quotes.list(q.leadId).findIndex((x) => x.id === q.id) + 1;
      if (st !== q.status && st !== 'DRAFT') {
        ev(q.leadId, st === 'SENT' ? 'CQ_SENT' : st === 'ACCEPTED' ? 'CQ_ACCEPTED' : 'CQ_REJECTED', u, { n: qn, ...(st === 'REJECTED' ? { reasonCode: rcode, reason: String(b.reason ?? '').trim().slice(0, 500) } : {}) });
        stopClock(q.leadId, 'INDIA'); // sending (or closing) the customer quote is India's next action
      }
      if (st === 'ACCEPTED') {
        const p = rejects.pending(q.leadId); if (p) rejects.resolve(p.id, 'REVISE', u.id, {});
        const patch: Rec = { status: 'WON' };
        await o.twenty.update(OBJECTS.lead, q.leadId, patch); Object.assign(lead, patch);
        tell(chinaPeople(q), lead, 'QUOTE_ACCEPTED', 'CHINA', u);
      }
      if (st === 'REJECTED') {
        // Not LOST yet: back to the India owner (raiser) with "Rejected – action needed".
        rejects.add(q.leadId, q.id, rcode, b.reason, u.id);
        handoff(lead, u, 'INDIA', undefined);
        tell(chinaPeople(q), lead, 'QUOTE_REJECTED', 'CHINA', u);
      }
      return { data: await refresh(u, q) };
    });
    // ---- Customer rejection follow-up (India): request a revised quote from China, or close as LOST ----
    const rejLead = async (u: User, id: string) => {
      if (!sides(u.role).india) throw new Forbidden('Only the India office handles customer rejections');
      const lead = await leadOf(id); if (!lead) throw Object.assign(new Error('Not found'), { status: 404 });
      const p = rejects.pending(id); if (!p) throw bad('This lead has no open customer rejection');
      return { lead, p };
    };
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/rejection/revise', async (req) => {
      const u = req.user!, { lead, p } = await rejLead(u, req.params.id), b = req.body ?? {};
      rejects.resolve(p.id, 'REVISE', u.id, { targetPrice: b.targetPrice, targetCurrency: b.targetCurrency, notes: b.notes });
      const q = quotes.get(p.quoteId), maker = q?.createdBy ? o.users.byId(q.createdBy) : null;
      const to = maker && maker.active && officeOf(maker.role) === 'CHINA' ? maker.id : null;
      const patch: Rec = { assignedOffice: 'CHINA', status: 'SOURCING' };
      await o.twenty.update(OBJECTS.lead, String(lead.id), patch); Object.assign(lead, patch);
      ev(String(lead.id), 'REVISE_REQUESTED', u, { reasonCode: p.reasonCode, reason: p.reasonText ?? null, targetPrice: b.targetPrice ?? null, targetCurrency: b.targetCurrency ?? null, notes: b.notes ?? null });
      handoff(lead, u, 'CHINA', to);
      const recips = (to ? [to] : queueWatchers('CHINA')).filter((x) => x !== u.id);
      assign.notify(recips, { leadId: String(lead.id), leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind: 'REVISE_REQUESTED', office: 'CHINA', byName: u.name });
      return { data: decorate(readFilter('lead', lead, await ctxOf(u.role))!, assign.get(String(lead.id)), userNames()) };
    });
    api.post<{ Params: { id: string }; Body: Rec }>('/api/leads/:id/rejection/close', async (req) => {
      const u = req.user!, { lead, p } = await rejLead(u, req.params.id);
      rejects.resolve(p.id, 'CLOSED', u.id, { notes: (req.body ?? {}).notes });
      const patch: Rec = { status: 'LOST', winLossReason: [p.reasonCode, p.reasonText].filter(Boolean).join(': ').slice(0, 500) };
      await o.twenty.update(OBJECTS.lead, String(lead.id), patch); Object.assign(lead, patch);
      ev(String(lead.id), 'LEAD_CLOSED', u, { reasonCode: p.reasonCode, reason: p.reasonText ?? null }); stopClock(String(lead.id));
      const q = quotes.get(p.quoteId); if (q) tell(chinaPeople(q), lead, 'LEAD_CLOSED', 'CHINA', u);
      return { data: decorate(readFilter('lead', lead, await ctxOf(u.role))!, assign.get(String(lead.id)), userNames()) };
    });
    // Public, unguessable link (32 random bytes) so the customer can open the PDF from WhatsApp/email.
    app.get<{ Params: { token: string } }>('/api/public/cq/:token', async (req, reply) => {
      const q = quotes.byToken(req.params.token.replace(/\.pdf$/, ''));
      if (!q?.cq) return reply.code(404).send({ error: 'Not found' });
      const lead = (await o.twenty.get(OBJECTS.lead, q.leadId)) as any;
      const i = quotes.list(q.leadId).findIndex((x) => x.id === q.id), ref = lead?.leadRef ?? 'SE', label = `${ref}-Q${i + 1}`;
      const photos = uploads.list(qKey(q.id)).filter((f) => /^image\/(png|jpe?g)$/.test(f.mime)).map((f) => uploads.file(qKey(q.id), f.id)?.path).filter((p): p is string => !!p);
      const pdf = await customerQuotePdf({ ref, label, product: q.product, customer: lead?.clientName ?? null, cq: q.cq, moq: q.moq, leadTime: q.leadTime,
        date: new Date(q.sentAt ?? q.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }), photos });
      return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="Quotation-${label}.pdf"`)
        .header('Cache-Control', 'private, no-store').header('X-Robots-Tag', 'noindex').send(pdf);
    });

    // ---- Orders (v1) ----
    const viewOrder = (u: User, ord: Order, lead: Rec | null) => {
      const s = sides(u.role), q = quotes.get(ord.quoteId);
      const base = { id: ord.id, leadId: ord.leadId, quoteId: ord.quoteId, leadRef: ord.leadRef, product: ord.product, qty: ord.qty, expectedShip: ord.expectedShip,
        production: ord.production, tracking: ord.tracking, container: ord.container, etd: ord.etd, eta: ord.eta, indiaStatus: ord.indiaStatus,
        createdAt: ord.createdAt, updatedAt: ord.updatedAt, leadStatus: lead?.status ?? null, shipmentId: ships.byOrder(ord.id)?.id ?? null, shipmentRef: ships.byOrder(ord.id)?.ref ?? null };
      const india = { agreedPrice: ord.agreedPrice, advance: ord.advance, paymentStatus: ord.paymentStatus, total: ord.qty * ord.agreedPrice,
        customer: lead?.clientName ?? null, assignedToName: (lead as any)?.assignedToName ?? null };
      const china = { supplier: q?.supplierId ? quotes.supplier(q.supplierId) : null, unitPrice: q?.unitPrice ?? null, currency: q?.currency ?? null,
        shipCost: q?.shipCost ?? null, shipCurrency: q?.shipCurrency ?? null };
      if (s.superAdmin) return { ...base, ...india, ...china };
      return s.india ? { ...base, ...india } : { ...base, ...china };
    };
    const orderOf = async (u: User, id: string) => {
      const ord = orders.get(id); if (!ord) throw Object.assign(new Error('Not found'), { status: 404 });
      const lead = (await readableLeads(u.role)).get(ord.leadId);
      if (!lead && !sides(u.role).china) throw Object.assign(new Error('Not found'), { status: 404 });
      return { ord, lead: lead ?? null };
    };
    api.post<{ Params: { qid: string }; Body: Record<string, unknown> }>('/api/quotes/:qid/order', async (req, reply) => {
      const u = req.user!; indiaOnly(u.role); const q = await quoteOf(req);
      if (q.status !== 'ACCEPTED') throw bad('Only an accepted quote can become an order');
      if (orders.byQuote(q.id)) throw bad('This quote already has an order', 409);
      const lead = await leadOf(q.leadId), b = req.body ?? {};
      const ord = orders.create({ leadId: q.leadId, quoteId: q.id, leadRef: (lead.leadRef as string) ?? null, product: q.product },
        { qty: q.cq?.qty, agreedPrice: q.cq?.unitPrice, ...b }, u.id);
      shipFor(ord);
      tell(chinaPeople(q), lead, 'ORDER_NEW', 'CHINA', u);
      ev(q.leadId, 'ORDER_CREATED', u, { qty: ord.qty });
      return reply.code(201).send({ data: viewOrder(u, ord, decorate(lead, assign.get(q.leadId), userNames())) });
    });
    api.get('/api/orders', async (req) => {
      const u = req.user!, leads = await readableLeads(u.role), china = sides(u.role).china;
      return { data: orders.all().filter((x) => china || leads.has(x.leadId)).map((x) => viewOrder(u, x, leads.get(x.leadId) ?? null)) };
    });
    api.get<{ Params: { id: string } }>('/api/orders/:id', async (req) => { const { ord, lead } = await orderOf(req.user!, req.params.id); return { data: viewOrder(req.user!, ord, lead) }; });
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
      try { await o.twenty.update(OBJECTS.lead, leadId, { status: ls }); if (lead) lead.status = ls; }
      catch (e) { app.log.error({ err: e, leadId, ls }, 'lead status sync failed'); }
    };
    const applyOrder = async (u: User, ord: Order, lead: Rec | null, b: Rec, shipExtra: Rec = {}) => {
      const has = (k: string) => k in b, val = (k: string) => (has(k) ? (b[k] == null ? '' : String(b[k]).trim()) : ((ord as any)[k] ?? ''));
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
      const n = orders.update(ord.id, b);
      const sh = shipFor(n), sp: Rec = { ...shipExtra };
      for (const k of ['tracking', 'container', 'etd', 'eta'] as const) if (k in b) sp[k] = n[k];
      const newlyShipped = !shipped && n.production === 'SHIPPED';
      if (newlyShipped && shipRank(sh.status) < shipRank('IN_TRANSIT')) sp.status = 'IN_TRANSIT';
      if (has('indiaStatus') && n.indiaStatus !== ord.indiaStatus && IND_TO_SHIP[n.indiaStatus] && SHIP_TO_IND[String(sp.status ?? sh.status)] !== n.indiaStatus) sp.status = IND_TO_SHIP[n.indiaStatus];
      const nsh = Object.keys(sp).length ? ships.update(sh.id, sp) : sh;
      // Timeline: shipped is its own milestone; other field changes are logged (payment/price ones India-only).
      const diff = (ks: string[]) => Object.fromEntries(ks.filter((k) => k in b && String((n as any)[k] ?? '') !== String((ord as any)[k] ?? '')).map((k) => [k, (n as any)[k]]));
      if (newlyShipped) { ev(n.leadId, 'SHIPPED', u, { tracking: n.tracking, container: n.container, etd: n.etd, eta: n.eta }); stopClock(n.leadId, 'CHINA'); }
      else { const pub = diff([...CHINA_KEYS, 'expectedShip']); if (Object.keys(pub).length) ev(n.leadId, 'ORDER_UPDATE', u, { fields: pub }); }
      if (nsh.status !== sh.status && !newlyShipped) ev(n.leadId, 'SHIPMENT_UPDATE', u, { status: nsh.status });
      const priv = diff(['qty', 'agreedPrice', 'advance', 'paymentStatus']); if (Object.keys(priv).length) ev(n.leadId, 'ORDER_UPDATE', u, { fields: priv }, 'INDIA');
      if (n.indiaStatus === 'DELIVERED' && ord.indiaStatus !== 'DELIVERED') stopClock(n.leadId);
      if (newlyShipped) await setLeadStatus(n.leadId, lead, 'SHIPPING');
      if (n.indiaStatus === 'DELIVERED' && ord.indiaStatus !== 'DELIVERED') await setLeadStatus(n.leadId, lead, 'DELIVERED');
      const q = quotes.get(n.quoteId), l = lead ?? (await leadOf(n.leadId));
      const changed = (keys: string[]) => Object.keys(b).some((k) => keys.includes(k) && String(b[k] ?? '') !== String((ord as any)[k] ?? '')) || Object.keys(shipExtra).some((k) => keys.includes(k));
      if (newlyShipped) tell(indiaPeople(n.leadId), l, 'ORDER_SHIPPED', 'INDIA', u);
      else if (changed([...CHINA_KEYS, ...SHIP_CHINA_KEYS]) && officeOf(u.role) !== 'INDIA') tell(indiaPeople(n.leadId), l, nsh !== sh ? 'SHIPMENT_UPDATE' : 'ORDER_UPDATE', 'INDIA', u);
      if (changed([...INDIA_KEYS, ...SHIP_INDIA_KEYS]) && officeOf(u.role) !== 'CHINA' && q) tell(chinaPeople(q), l, has('indiaStatus') ? 'SHIPMENT_UPDATE' : 'ORDER_UPDATE', 'CHINA', u);
      return { n, sh: nsh };
    };
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/orders/:id', async (req) => {
      const u = req.user!, s = sides(u.role), b = req.body ?? {}, { ord, lead } = await orderOf(u, req.params.id);
      const bad1 = Object.keys(b).find((k) => !(INDIA_KEYS.includes(k) && s.india) && !(CHINA_KEYS.includes(k) && s.china));
      if (bad1) throw new Forbidden(INDIA_KEYS.includes(bad1) ? 'Only the India office updates this' : CHINA_KEYS.includes(bad1) ? 'Only the China office updates production and tracking' : `Unknown field ${bad1}`);
      const { n } = await applyOrder(u, ord, lead, b);
      return { data: viewOrder(u, n, lead) };
    });
    // ---- Shipments (one per order). China: no customer; India: no supplier. ----
    const viewShip = (u: User, sh: Shipment, lead: Rec | null) => {
      const s = sides(u.role), ord = orders.get(sh.orderId), q = ord ? quotes.get(ord.quoteId) : null;
      const base = { ...sh, leadRef: (lead?.leadRef as string) ?? ord?.leadRef ?? null, product: ord?.product ?? null, qty: ord?.qty ?? null, leadStatus: lead?.status ?? null,
        production: ord?.production ?? null, expectedShip: ord?.expectedShip ?? null };
      const india = { customer: (lead?.clientName as string) ?? null, deliveryCity: (lead?.deliveryCity as string) ?? null };
      const china = { supplier: q?.supplierId ? quotes.supplier(q.supplierId)?.name ?? null : null };
      if (s.superAdmin) return { ...base, ...india, ...china };
      if (!s.india) delete (base as any).customsNote;
      return s.india ? { ...base, ...india } : { ...base, ...china };
    };
    const shipOf = async (u: User, id: string) => {
      const sh = ships.get(id); if (!sh) throw Object.assign(new Error('Not found'), { status: 404 });
      const lead = (await readableLeads(u.role)).get(sh.leadId);
      if (!lead && !sides(u.role).china) throw Object.assign(new Error('Not found'), { status: 404 });
      return { sh, lead: lead ?? null };
    };
    api.get('/api/shipments', async (req) => {
      const u = req.user!, leads = await readableLeads(u.role), china = sides(u.role).china;
      return { data: ships.all().filter((x) => china || leads.has(x.leadId)).map((x) => viewShip(u, x, leads.get(x.leadId) ?? null)) };
    });
    api.get<{ Params: { id: string } }>('/api/shipments/:id', async (req) => { const { sh, lead } = await shipOf(req.user!, req.params.id); return { data: viewShip(req.user!, sh, lead) }; });
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/shipments/:id', async (req) => {
      const u = req.user!, s = sides(u.role), b = { ...(req.body ?? {}) }, { sh, lead } = await shipOf(u, req.params.id);
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
      const ord = orders.get(sh.orderId); if (!ord) throw bad('Order not found', 404);
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
      return { data: viewShip(u, n, lead) };
    });
    // Super admin only: permanently remove a lead with its quotes, files, assignment and notifications (e.g. test data).
    api.delete<{ Params: { id: string } }>('/api/records/leads/:id', async (req, reply) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can delete leads');
      const id = await attLead(req);
      for (const q of quotes.list(id)) uploads.removeAll(qKey(q.id));
      quotes.removeLead(id); rejects.forgetLead(id); ships.removeLead(id); orders.removeLead(id); uploads.removeAll(id); assign.forgetLead(id); wf.forgetLead(id);
      if (!o.twenty.remove) return reply.code(501).send({ error: 'Not supported' });
      await o.twenty.remove(OBJECTS.lead, id);
      return reply.code(204).send();
    });
    api.get('/api/suppliers', async (req) => { chinaOnly(req.user!.role); return { data: quotes.suppliers() }; });
    api.post<{ Body: Record<string, unknown> }>('/api/suppliers', async (req, reply) => { chinaOnly(req.user!.role); return reply.code(201).send({ data: quotes.addSupplier(req.body ?? {}, req.user!.id) }); });
    api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/suppliers/:id', async (req, reply) => {
      chinaOnly(req.user!.role);
      const sup = quotes.updateSupplier(req.params.id, req.body ?? {});
      return sup ? { data: sup } : reply.code(404).send({ error: 'Not found' });
    });
    api.delete<{ Params: { id: string } }>('/api/suppliers/:id', async (req, reply) => {
      const role = req.user!.role; if (role !== 'SUPER_ADMIN' && role !== 'CHINA_ADMIN') throw new Forbidden('Only a China admin can delete suppliers');
      quotes.deleteSupplier(req.params.id); return reply.code(204).send();
    });

    // ---- Generic filtered records API (used by mobile and web) ----
    const objOf = (plural: string): ObjectName => {
      const obj = PLURAL_TO_OBJECT[plural];
      if (!obj) throw Object.assign(new Error('Unknown object'), { status: 404 });
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
      const [rows, ctx] = await Promise.all([o.twenty.list(OBJECTS[obj], filter), ctxOf(role)]);
      let data = rows.map((r) => readFilter(obj, r, ctx)).filter((r): r is Rec => !!r);
      if (obj === 'lead') {
        const all = assign.all(), names = userNames();
        data = data.map((r) => decorate(r, all.get(String(r.id)), names));
        if (mine) data = data.filter((r) => r.assignedTo === mine);
      }
      data = data.sort((a, b) => Number(!!b.priority) - Number(!!a.priority) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      return { data };
    });
    api.get<{ Params: { plural: string; id: string } }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      if (!canRead(role, obj)) throw new Forbidden(`${role} may not read ${obj}`);
      const r = await o.twenty.get(OBJECTS[obj], req.params.id);
      let f = r && readFilter(obj, r, await ctxOf(role));
      if (f && obj === 'lead') f = decorate(f, assign.get(String(f.id)), userNames());
      return f ? { data: f } : reply.code(404).send({ error: 'Not found' });
    });
    api.post<{ Params: { plural: string }; Body: Rec }>('/api/records/:plural', async (req, reply) => {
      const obj = objOf(req.params.plural);
      const body = { ...(req.body ?? {}) }, to = obj === 'lead' ? takeAssignee(body) : undefined;
      const data = { ...writeCheck(req.user!.role, obj, 'create', body) };
      // The reference is always assigned here (incl. offline mobile leads when they sync), never by the client.
      if (obj === 'lead') { data.assignedOffice ??= CHINA_LEAD_STATUSES.includes(String(data.status)) ? 'CHINA' : 'INDIA'; data.office ??= 'INDIA'; }
      const leadRef = obj === 'lead' ? await nextRef() : await inheritRef(obj, data);
      if (leadRef) data.leadRef = leadRef;
      const r = await o.twenty.create(OBJECTS[obj], data);
      if (obj === 'lead') {
        const actor = req.user!, office: Office = data.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA';
        assign.set(String(r.id), { raisedBy: officeOf(actor.role) === 'CHINA' ? null : actor.id });
        ev(String(r.id), 'CREATED', actor, { channel: data.sourceChannel ?? null });
        if (data.summary) ev(String(r.id), 'SUMMARY', actor);
        // India staff creating an India lead own it unless they pick someone else.
        handoff({ ...data, id: r.id }, actor, office, to !== undefined ? to : office === 'INDIA' && officeOf(actor.role) === 'INDIA' ? actor.id : undefined);
      }
      return reply.code(201).send({ data: { id: r.id, ...(leadRef ? { leadRef } : {}) } });
    });
    api.patch<{ Params: { plural: string; id: string }; Body: Rec }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      const existing = await o.twenty.get(OBJECTS[obj], req.params.id);
      if (!existing || !readFilter(obj, existing, await ctxOf(role))) return reply.code(404).send({ error: 'Not found' });
      const body = { ...(req.body ?? {}) }, to = obj === 'lead' ? takeAssignee(body) : undefined;
      const data = Object.keys(body).length || to === undefined ? { ...writeCheck(role, obj, 'update', body, existing) } : {};
      // Handing a lead to China = assignedOffice CHINA. Moving it to a China stage (board drag, status change) implies that,
      // otherwise China would never see it (China only reads assignedOffice=CHINA leads).
      let deliverOrders: Order[] = [];
      if (obj === 'lead' && 'status' in data && data.status !== existing.status) { // board drag / status dropdown follow the shipping gates
        const os = orders.all().filter((x) => x.leadId === String(existing.id)), shippedOs = os.filter((x) => x.production === 'SHIPPED');
        if (data.status === 'SHIPPING' && !shippedOs.length) throw bad('A lead moves to Shipping when China marks its order Shipped (with tracking/container no + ETD)', 409);
        if (data.status === 'DELIVERED') {
          if (!shippedOs.length) throw bad('Delivered unlocks after China marks the order Shipped', 409);
          if (!sides(role).india) throw new Forbidden('Only the India office marks an order delivered');
          deliverOrders = shippedOs.filter((x) => x.indiaStatus !== 'DELIVERED');
        }
        if (shippedOs.length && !['SHIPPING', 'DELIVERED', 'WON', 'LOST'].includes(String(data.status))) throw bad('This lead has a shipped order and cannot go back to an earlier stage', 409);
      }
      if (obj === 'lead' && !('assignedOffice' in data) && existing.assignedOffice !== 'CHINA' && CHINA_LEAD_STATUSES.includes(String(data.status))) data.assignedOffice = 'CHINA';
      if (('leadId' in data || 'sourcingRequestId' in data || 'quotationId' in data) && obj !== 'lead') {
        const leadRef = await inheritRef(obj, { ...existing, ...data });
        if (leadRef) data.leadRef = leadRef;
      }
      let target: Office | null = null;
      const a = obj === 'lead' ? assign.get(String(existing.id)) : null;
      if (obj === 'lead') {
        const toChina = data.assignedOffice === 'CHINA' && existing.assignedOffice !== 'CHINA';
        const quotedByChina = data.status === 'QUOTED' && existing.status !== 'QUOTED' && (a?.ownerOffice ?? 'CHINA') === 'CHINA' && officeOf(role) === 'CHINA';
        target = toChina ? 'CHINA' : quotedByChina ? 'INDIA' : to !== undefined ? (a?.ownerOffice ?? ({ ...existing, ...data }.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA')) : null;
        if (target && to !== undefined) assertAssign(req.user!, existing, target, to);
      }
      const r = Object.keys(data).length ? await o.twenty.update(OBJECTS[obj], req.params.id, data) : { id: req.params.id };
      if (obj === 'lead') {
        const id = String(existing.id);
        if ('status' in data && data.status !== existing.status) {
          ev(id, 'STATUS', req.user!, { from: existing.status ?? null, to: data.status });
          if (['WON', 'LOST', 'DELIVERED'].includes(String(data.status))) stopClock(id);
        }
        if ('summary' in data && data.summary !== existing.summary) ev(id, 'SUMMARY', req.user!);
      }
      if (target) handoff({ ...existing, ...data }, req.user!, target, to);
      for (const x of deliverOrders) await applyOrder(req.user!, x, { ...existing, ...data }, { indiaStatus: 'DELIVERED' });
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
      const lead = await o.twenty.get('leads', req.params.id);
      if (!lead || !readFilter('lead', lead, await ctxOf(actor.role))) return reply.code(404).send({ error: 'Not found' });
      const office = b.office === 'CHINA' || b.office === 'INDIA' ? b.office : (assign.get(String(lead.id))?.ownerOffice ?? (lead.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA'));
      const to = 'assignedTo' in b ? (b.assignedTo ? String(b.assignedTo) : null) : undefined;
      assertAssign(actor, lead, office, to ?? null);
      if ('raisedBy' in b) {
        if (!(actor.role === 'SUPER_ADMIN' || actor.role === 'INDIA_ADMIN')) throw new Forbidden('Only India admins can set who raised a lead');
        const u = b.raisedBy ? o.users.byId(String(b.raisedBy)) : null;
        if (b.raisedBy && !indiaOwner(u)) return reply.code(400).send({ error: 'raisedBy must be an active India staff member' });
        assign.set(String(lead.id), { raisedBy: u?.id ?? null });
      }
      if (office === 'CHINA' && lead.assignedOffice !== 'CHINA') {
        if (!sides(actor.role).india) throw new Forbidden('Only India can send a lead to China');
        const patch: Rec = { assignedOffice: 'CHINA', ...(CHINA_LEAD_STATUSES.includes(String(lead.status)) ? {} : { status: 'ASSIGNED' }) };
        await o.twenty.update('leads', String(lead.id), patch); Object.assign(lead, patch);
      }
      if (b.office || to !== undefined) handoff(lead, actor, office, to);
      const f = readFilter('lead', lead, await ctxOf(actor.role))!;
      return { data: decorate(f, assign.get(String(lead.id)), userNames()) };
    });
    // Active members of an office, for the assignee picker (id, name, role only).
    api.get<{ Querystring: { office?: string } }>('/api/staff', async (req) => {
      const office = req.query?.office === 'CHINA' ? 'CHINA' : 'INDIA';
      const a = avatars.urls();
      return { data: staffOf(office).map((u) => ({ id: u.id, name: u.name, role: u.role, avatarUrl: a.get(u.id) ?? null })) };
    });
    // ---- Timeline, priority, SLA ----
    api.get<{ Params: { id: string } }>('/api/leads/:id/timeline', async (req) => {
      const id = await attLead(req), lead = (await o.twenty.get(OBJECTS.lead, id))!, a = assign.get(id);
      let events = wf.events(id);
      if (!events.some((e) => e.kind === 'CREATED')) // older leads: synthesise the creation step
        events = [{ id: `created-${id}`, leadId: id, at: new Date(String(lead.createdAt ?? Date.now())).toISOString(), kind: 'CREATED', actorId: a?.raisedBy ?? null,
          actorName: (a?.raisedBy && o.users.byId(a.raisedBy)?.name) || null, actorOffice: a?.raisedBy ? 'INDIA' : null, data: { channel: lead.sourceChannel ?? null }, vis: 'ALL' }, ...events];
      return { data: { events: events.map((e) => viewEvent(req.user!.role, e)).filter(Boolean), progress: stageOf(lead, a?.ownerOffice ?? null),
        priority: wf.priority(id), sla: slaView(id, userNames()), settings: wf.sla() } };
    });
    api.post<{ Params: { id: string }; Body: { priority?: boolean } }>('/api/leads/:id/priority', async (req) => {
      const u = req.user!;
      if (!sides(u.role).india) throw new Forbidden('Only the India office or the super admin can set priority');
      const id = await attLead(req), on = !!req.body?.priority;
      if (wf.priority(id) !== on) {
        const c = wf.setPriority(id, on);
        ev(id, 'PRIORITY', u, { on, ...(c ? { dueAt: c.dueAt } : {}) });
        const a = assign.get(id), who = c?.assignee ?? (a?.assignedTo || null);
        const lead = (await o.twenty.get(OBJECTS.lead, id))!;
        const recips = (who ? [who] : c ? queueWatchers(c.office) : []).filter((x) => x !== u.id);
        if (recips.length) assign.notify(recips, { leadId: id, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null, kind: 'PRIORITY', office: c?.office ?? a?.ownerOffice ?? 'INDIA', byName: u.name });
      }
      return { data: { priority: wf.priority(id), sla: slaView(id, userNames()) } };
    });
    api.get('/api/settings/sla', async () => ({ data: wf.sla() }));
    api.put<{ Body: { normalMinutes?: number; priorityMinutes?: number } }>('/api/settings/sla', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can change SLA hours');
      return { data: wf.setSla(req.body ?? {}) };
    });
    api.get<{ Querystring: { days?: string } }>('/api/sla/report', async (req) => {
      const u = req.user!;
      if (!sides(u.role).admin) throw new Forbidden('Admins only');
      const days = Math.min(365, Math.max(1, Number(req.query?.days) || 30)), now = (o.now ?? Date.now)();
      const since = new Date(now - days * 864e5).toISOString(), names = userNames();
      const done = wf.runs(since).map((r) => ({ ...r, open: false }));
      const open = wf.clocks().map((c) => ({ ...c, endedAt: null, open: true, breached: c.breached || new Date(now).toISOString() > c.dueAt }));
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
      return { data: { days, office, members: [...m.values()].sort((a, b) => b.breached - a.breached || b.total - a.total), settings: wf.sla() } };
    });
    api.get('/api/notifications', async (req) => assign.list(req.user!.id));
    // Real-time stream (Server-Sent Events). Sends `notification` events with the same privacy-safe payload as the list.
    api.get('/api/notifications/stream', (req, reply) => {
      const uid = req.user!.id;
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const send = (ev: string, data: unknown) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      res.write('retry: 3000\n\n');
      send('hello', { unread: assign.unreadOf(uid) });
      const off = assign.subscribe(uid, (n, unread) => send('notification', { notification: n, unread }));
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      const close = () => { clearInterval(ping); off(); };
      req.raw.on('close', close); res.on('error', close);
    });
    api.post<{ Params: { id: string } }>('/api/notifications/:id/read', async (req) => ({ ok: assign.markRead(req.user!.id, req.params.id) }));
    api.post('/api/notifications/read-all', async (req) => ({ ok: assign.markRead(req.user!.id) }));

    // ---- Super admin ----
    api.get('/api/backups', async (req) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Super admin only');
      return { data: o.backupLinks ?? [] };
    });

    // ---- User management (admins manage their own side) ----
    const assertManage = (actor: User, role: Role) => {
      if (!manageableRoles(actor.role).includes(role)) throw new Forbidden(`${actor.role} cannot manage ${role} users`);
    };
    api.get('/api/users', async (req) => {
      const allowed = manageableRoles(req.user!.role);
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
      avatars.remove(req.params.id); return { data: { avatarUrl: null } };
    });
    api.post<{ Body: { email: string; name: string; role: Role; password: string; chatwootAgentId?: number } }>('/api/users', async (req, reply) => {
      const b = req.body ?? ({} as never);
      if (!isRole(b.role)) return reply.code(400).send({ error: 'Invalid role' });
      assertManage(req.user!, b.role);
      let u: User;
      try { u = await o.users.create(b.email ?? '', b.name ?? '', b.role, b.password ?? ''); }
      catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      // Keep the Twenty Team Member record (linked by email) in sync; best effort.
      try {
        const tm = await o.twenty.list('teamMembers', { email: u.email });
        const data = { name: u.name, email: u.email, role: u.role, ...(b.chatwootAgentId ? { chatwootAgentId: b.chatwootAgentId } : {}) };
        if (tm[0]) await o.twenty.update('teamMembers', String(tm[0].id), data); else await o.twenty.create('teamMembers', data);
      } catch (e) { req.log.warn(e, 'team member sync failed'); }
      return reply.code(201).send({ data: u });
    });
    // Losing the last active super admin would lock everyone out of user management.
    const lastSuper = (t: User, next: { role?: Role; active?: boolean } | 'delete') =>
      t.role === 'SUPER_ADMIN' && t.active && (next === 'delete' || (next.role && next.role !== 'SUPER_ADMIN') || next.active === false) &&
      o.users.activeSuperAdmins() <= 1;
    const syncTeamMember = async (req: { log: { warn: (...a: unknown[]) => void } }, oldEmail: string, u: User) => {
      try {
        const tm = await o.twenty.list('teamMembers', { email: oldEmail });
        if (tm[0]) await o.twenty.update('teamMembers', String(tm[0].id), { name: u.name, email: u.email, role: u.role });
      } catch (e) { req.log.warn(e, 'team member sync failed'); }
    };
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
      try { u = o.users.update(t.id, { name: b.name, email: b.email, role: b.role, active: b.active }); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      if (u && (u.name !== t.name || u.email !== t.email || u.role !== t.role)) await syncTeamMember(req, t.email, u);
      return { data: u };
    });
    // Hard delete (super admin only). Leads/quotes keep their references; only the login goes.
    api.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can remove staff');
      const t = o.users.byId(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Not found' });
      if (t.id === req.user!.id) throw new Forbidden('You cannot remove yourself');
      if (lastSuper(t, 'delete')) return reply.code(409).send({ error: 'This is the last active super admin', code: 'last_super_admin' });
      o.users.remove(t.id); avatars.remove(t.id);
      assign.forgetUser(t.id);
      return reply.code(204).send();
    });
    api.post<{ Params: { id: string }; Body: { password: string } }>('/api/users/:id/password', async (req, reply) => {
      const t = o.users.byId(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Not found' });
      assertManage(req.user!, t.role);
      try { await o.users.setPassword(t.id, req.body?.password ?? ''); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
      return { ok: true };
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
