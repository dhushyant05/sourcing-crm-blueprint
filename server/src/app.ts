import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import jwt from 'jsonwebtoken';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import multipart from '@fastify/multipart';
import { RefCounter } from './refs.js';
import { MAX_FILE_BYTES, MAX_FILES, UploadStore, validateFile } from './uploads.js';
import { capabilities, isRole, manageableRoles, type Role } from './roles.js';
import { canRead, FILTERABLE, Forbidden, OBJECTS, PLURAL_TO_OBJECT, readFilter, writeCheck, type Ctx, type ObjectName, type Rec } from './policy.js';
import type { TwentyLike } from './twenty.js';
import type { UserStore, User } from './users.js';

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
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 40, fieldSize: 4000 } });
  const enq = new Map<string, number[]>();
  const UNITS = ['pcs', 'kg', 'ton', 'm', 'sqm', 'sets', 'cartons', 'containers'];
  app.post('/api/public/enquiry', async (req, reply) => {
    const b: Record<string, string> = {}; const files: { name: string; mime: string; data: Buffer }[] = [];
    if (req.isMultipart()) {
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            const data = await part.toBuffer();
            if (!data.length) continue;
            const mime = validateFile(part.filename ?? '', data);
            if (!mime) return reply.code(415).send({ error: `File type not allowed: ${part.filename}`, code: 'type' });
            files.push({ name: part.filename ?? 'file', mime, data });
          } else b[part.fieldname] = String(part.value ?? '');
        }
      } catch (e: any) {
        if (e?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'Each file must be 10 MB or smaller', code: 'size' });
        if (e?.code === 'FST_FILES_LIMIT') return reply.code(413).send({ error: 'Up to 5 files', code: 'count' });
        throw e;
      }
    } else Object.assign(b, Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])));
    const str = (k: string, max = 200) => (b[k] ?? '').trim().slice(0, max);
    if (str('website')) return reply.code(202).send({ ok: true }); // bot filled the hidden field
    const now = Date.now(), hits = (enq.get(req.ip) ?? []).filter((t) => now - t < 3600e3);
    if (hits.length >= 5) return reply.code(429).send({ error: 'Too many enquiries, please try again later' });

    const name = str('name', 120), email = str('email', 160), product = str('product', 1000);
    const code = str('phoneCode', 6) || '+91';
    let digits = str('phone', 40).replace(/[\s\-().]/g, '');
    if (digits.startsWith(code)) digits = digits.slice(code.length);
    if (!name || !product || !digits) return reply.code(400).send({ error: 'Name, mobile number and product are required', code: 'required' });
    if (!/^\+\d{1,4}$/.test(code) || !/^\d{6,14}$/.test(digits) || (code === '+91' && !/^[6-9]\d{9}$/.test(digits)))
      return reply.code(400).send({ error: 'Invalid mobile number', code: 'phone' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'Invalid email', code: 'email' });
    const ref = str('referenceUrl', 500);
    if (ref && !/^https?:\/\/[^\s]+$/i.test(ref)) return reply.code(400).send({ error: 'Reference link must start with http:// or https://', code: 'url' });
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
      sourceChannel: 'WEBSITE', status: 'NEW', assignedOffice: 'INDIA', office: 'INDIA',
    });
    if (files.length && lead?.id) uploads.save(String(lead.id), files);
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
    api.get<{ Params: { id: string; fid: string } }>('/api/leads/:id/attachments/:fid', async (req, reply) => {
      const f = uploads.read(await attLead(req), req.params.fid);
      if (!f) return reply.code(404).send({ error: 'Not found' });
      const inline = /^image\/(jpeg|png|webp)$|^application\/pdf$/.test(f.meta.mime);
      reply.header('content-type', f.meta.mime).header('cache-control', 'private, no-store')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.meta.name)}`);
      return reply.send(f.data);
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
      for (const [k, v] of Object.entries(req.query ?? {})) {
        if (!FILTERABLE[obj]?.includes(k)) throw Object.assign(new Error(`Cannot filter ${obj} by ${k}`), { status: 400 });
        filter[k] = String(v);
      }
      const [rows, ctx] = await Promise.all([o.twenty.list(OBJECTS[obj], filter), ctxOf(role)]);
      const data = rows.map((r) => readFilter(obj, r, ctx)).filter((r): r is Rec => !!r)
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      return { data };
    });
    api.get<{ Params: { plural: string; id: string } }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      if (!canRead(role, obj)) throw new Forbidden(`${role} may not read ${obj}`);
      const r = await o.twenty.get(OBJECTS[obj], req.params.id);
      const f = r && readFilter(obj, r, await ctxOf(role));
      return f ? { data: f } : reply.code(404).send({ error: 'Not found' });
    });
    api.post<{ Params: { plural: string }; Body: Rec }>('/api/records/:plural', async (req, reply) => {
      const obj = objOf(req.params.plural);
      const data = { ...writeCheck(req.user!.role, obj, 'create', req.body ?? {}) };
      // The reference is always assigned here (incl. offline mobile leads when they sync), never by the client.
      const leadRef = obj === 'lead' ? await nextRef() : await inheritRef(obj, data);
      if (leadRef) data.leadRef = leadRef;
      const r = await o.twenty.create(OBJECTS[obj], data);
      return reply.code(201).send({ data: { id: r.id, ...(leadRef ? { leadRef } : {}) } });
    });
    api.patch<{ Params: { plural: string; id: string }; Body: Rec }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      const existing = await o.twenty.get(OBJECTS[obj], req.params.id);
      if (!existing || !readFilter(obj, existing, await ctxOf(role))) return reply.code(404).send({ error: 'Not found' });
      const data = { ...writeCheck(role, obj, 'update', req.body ?? {}, existing) };
      if (('leadId' in data || 'sourcingRequestId' in data || 'quotationId' in data) && obj !== 'lead') {
        const leadRef = await inheritRef(obj, { ...existing, ...data });
        if (leadRef) data.leadRef = leadRef;
      }
      const r = await o.twenty.update(OBJECTS[obj], req.params.id, data);
      return { data: { id: r.id ?? req.params.id } };
    });

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
    api.patch<{ Params: { id: string }; Body: { name?: string; role?: Role; active?: boolean } }>('/api/users/:id', async (req, reply) => {
      const t = o.users.byId(req.params.id);
      if (!t) return reply.code(404).send({ error: 'Not found' });
      assertManage(req.user!, t.role);
      if (req.body?.role) assertManage(req.user!, req.body.role);
      if (t.id === req.user!.id && (req.body?.role || req.body?.active === false)) throw new Forbidden('You cannot change your own role or disable yourself');
      try { return { data: o.users.update(t.id, req.body ?? {}) }; } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
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
