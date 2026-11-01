import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import jwt from 'jsonwebtoken';
import { existsSync } from 'node:fs';
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
}

declare module 'fastify' { interface FastifyRequest { user?: User } }

export async function buildApp(o: AppOptions) {
  const app = Fastify({ logger: o.logger ?? false, trustProxy: true, bodyLimit: 1 << 20 });
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
      const data = writeCheck(req.user!.role, obj, 'create', req.body ?? {});
      const r = await o.twenty.create(OBJECTS[obj], data);
      return reply.code(201).send({ data: { id: r.id } });
    });
    api.patch<{ Params: { plural: string; id: string }; Body: Rec }>('/api/records/:plural/:id', async (req, reply) => {
      const obj = objOf(req.params.plural), role = req.user!.role;
      const existing = await o.twenty.get(OBJECTS[obj], req.params.id);
      if (!existing || !readFilter(obj, existing, await ctxOf(role))) return reply.code(404).send({ error: 'Not found' });
      const data = writeCheck(role, obj, 'update', req.body ?? {}, existing);
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

  app.all('/api/*', async (_r, reply) => reply.code(404).send({ error: 'Not found' }));

  if (o.webDir && existsSync(o.webDir)) {
    await app.register(fastifyStatic, { root: o.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.method === 'GET' ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found' })));
  }
  return app;
}
