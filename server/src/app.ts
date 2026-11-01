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
import { QuoteStore, type Quote } from './quotes.js';
import { AssignStore, type Assignment, type Office } from './assign.js';

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
}

declare module 'fastify' { interface FastifyRequest { user?: User } }

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
  const officeOf = (r: Role): Office | null => (r.startsWith('INDIA') ? 'INDIA' : r.startsWith('CHINA') ? 'CHINA' : null);
  const staffOf = (office: Office) => o.users.list().filter((u) => u.active && officeOf(u.role) === office);
  const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
  /** Adds raisedBy/assignedTo (+ names) to a filtered lead. Only staff names/ids, never customer data. */
  const decorate = (rec: Rec, a: Assignment | null | undefined, names: Map<string, string>) => ({
    ...rec, raisedBy: a?.raisedBy ?? null, raisedByName: (a?.raisedBy && names.get(a.raisedBy)) || null,
    assignedTo: a?.assignedTo ?? null, assignedToName: (a?.assignedTo && names.get(a.assignedTo)) || null,
    ownerOffice: a?.ownerOffice ?? (rec.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA'),
  });
  const userNames = () => new Map(o.users.list().map((u) => [u.id, u.name]));
  /**
   * Hands a lead to an office. `to` = specific member, null = office queue, undefined = default
   * (China: queue; India: the India member who raised it, else queue). Notifies the new owner, or the office admins for a queue.
   */
  const handoff = (lead: Rec, actor: User | null, office: Office, to: string | null | undefined) => {
    const leadId = String(lead.id), prev = assign.get(leadId);
    if (to) {
      const u = o.users.byId(to);
      if (!u || !u.active || officeOf(u.role) !== office) throw bad(`Assignee must be an active ${office} staff member`);
    }
    if (to === undefined) {
      const r = prev?.raisedBy ? o.users.byId(prev.raisedBy) : null;
      to = office === 'INDIA' && r?.active && officeOf(r.role) === 'INDIA' ? r.id : null;
    }
    const returned = office === 'INDIA' && prev?.ownerOffice === 'CHINA';
    const changed = prev?.ownerOffice !== office || (prev?.assignedTo ?? null) !== to;
    assign.set(leadId, { ownerOffice: office, assignedTo: to });
    if (changed) {
      const recips = (to ? [to] : staffOf(office).filter((u) => u.role.endsWith('ADMIN')).map((u) => u.id)).filter((id) => id !== actor?.id);
      assign.notify(recips, { leadId, leadRef: (lead.leadRef as string) ?? null, product: (lead.productInterest as string) ?? null,
        kind: !to ? 'QUEUE' : returned ? 'RETURNED' : 'ASSIGNED', office, byName: actor?.name ?? null });
    }
  };
  /** Body field `assignedTo` ('' / null = office queue). Stripped before the Twenty write. */
  const takeAssignee = (body: Rec): string | null | undefined => {
    if (!('assignedTo' in body)) return undefined;
    const v = body.assignedTo; delete body.assignedTo;
    return v ? String(v) : null;
  };

  app.setErrorHandler((err: any, _req, reply) => {
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
  const me = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, language: u.language ?? null, capabilities: capabilities(u.role) });

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
    if (lead?.id) handoff({ ...lead, leadRef, productInterest: product }, null, 'INDIA', null); // India queue; India admins are notified
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
      await o.users.setPassword(req.user!.id, req.body.newPassword ?? '');
      return { token: sign(o.users.byId(req.user!.id)!) };
    });

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
        validity: q.validity, notes: q.notes, createdAt: q.createdAt, updatedAt: q.updatedAt };
      const client = { clientPrice: q.clientPrice, clientCurrency: q.clientCurrency, clientNotes: q.clientNotes };
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
      const list = quotes.list(q.leadId);
      return { data: viewQuote(req.user!, n, list.findIndex((x) => x.id === n.id), await leadRefOf(q.leadId)) };
    });
    api.delete<{ Params: { qid: string } }>('/api/quotes/:qid', async (req, reply) => {
      const q = await quoteOf(req);
      if (!canEditQuote(req.user!.role, req.user!.id, q)) throw new Forbidden('Only the China staff who added this quote (or a China admin) can delete it');
      quotes.remove(q.id); uploads.removeAll(qKey(q.id));
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
    // Super admin only: permanently remove a lead with its quotes, files, assignment and notifications (e.g. test data).
    api.delete<{ Params: { id: string } }>('/api/records/leads/:id', async (req, reply) => {
      if (req.user!.role !== 'SUPER_ADMIN') throw new Forbidden('Only the super admin can delete leads');
      const id = await attLead(req);
      for (const q of quotes.list(id)) uploads.removeAll(qKey(q.id));
      quotes.removeLead(id); uploads.removeAll(id); assign.forgetLead(id);
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
      data = data.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
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
      if (target) handoff({ ...existing, ...data }, req.user!, target, to);
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
        if (b.raisedBy && (!u || officeOf(u.role) !== 'INDIA')) return reply.code(400).send({ error: 'raisedBy must be an India staff member' });
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
      return { data: staffOf(office).map((u) => ({ id: u.id, name: u.name, role: u.role })) };
    });
    api.get('/api/notifications', async (req) => assign.list(req.user!.id));
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
      return { data: o.users.list().filter((u) => allowed.includes(u.role)) };
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
      o.users.remove(t.id);
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
