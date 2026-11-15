import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { canReviewSuppliers, ownView, reviewView, SupplierAccountError, SupplierAccountStore } from './supplier-accounts.js';

export function registerPublicSupplier(app: FastifyInstance, accounts: SupplierAccountStore) {
  app.post('/api/public/supplier/signup', async (req, reply) => {
    try {
      const { profile } = await accounts.signup((req.body ?? {}) as Record<string, unknown>);
      return reply.code(201).send({ data: ownView(profile) });
    } catch (e) {
      if (e instanceof SupplierAccountError) return reply.code(e.status).send({ error: e.message, ...(e.appCode ? { code: e.appCode } : {}) });
      throw e;
    }
  });
}

export function registerStaffSupplier(api: FastifyInstance, accounts: SupplierAccountStore) {
  const catcher = async (req: FastifyRequest, reply: FastifyReply, fn: () => Promise<unknown>) => {
    try { return await fn(); }
    catch (e) {
      if (e instanceof SupplierAccountError) return reply.code(e.status).send({ error: e.message, ...(e.appCode ? { code: e.appCode } : {}) });
      throw e;
    }
  };

  api.get('/api/supplier/me', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (u.role !== 'SUPPLIER') return reply.code(403).send({ error: 'Only a supplier login can view this profile' });
    const row = await accounts.byUser(u.id);
    if (!row) return reply.code(404).send({ error: 'Supplier profile not found' });
    return { data: ownView(row) };
  }));

  api.patch('/api/supplier/me', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (u.role !== 'SUPPLIER') return reply.code(403).send({ error: 'Only a supplier login can update this profile' });
    return { data: ownView(await accounts.updateOwn(u.id, (req.body ?? {}) as Record<string, unknown>)) };
  }));

  api.post('/api/supplier/me/resubmit', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (u.role !== 'SUPPLIER') return reply.code(403).send({ error: 'Only a supplier login can resubmit' });
    return { data: ownView(await accounts.resubmit(u.id)) };
  }));

  api.get<{ Querystring: { status?: string } }>('/api/supplier/applications', async (req, reply) => {
    const u = req.user!;
    if (!canReviewSuppliers(u)) return reply.code(403).send({ error: 'Only the Marketplace Team or super admin can review suppliers' });
    const rows = await accounts.list(req.query?.status);
    return { data: rows.map(reviewView) };
  });

  api.patch<{ Params: { id: string } }>('/api/supplier/applications/:id', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (!canReviewSuppliers(u)) return reply.code(403).send({ error: 'Only the Marketplace Team or super admin can review suppliers' });
    return { data: reviewView(await accounts.updateByStaff(req.params.id, u.id, (req.body ?? {}) as Record<string, unknown>)) };
  }));

  api.post<{ Params: { id: string } }>('/api/supplier/applications/:id/accept', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (!canReviewSuppliers(u)) return reply.code(403).send({ error: 'Only the Marketplace Team or super admin can review suppliers' });
    return { data: reviewView(await accounts.accept(req.params.id, u.id)) };
  }));

  api.post<{ Params: { id: string }; Body: { reason?: string } }>('/api/supplier/applications/:id/decline', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (!canReviewSuppliers(u)) return reply.code(403).send({ error: 'Only the Marketplace Team or super admin can review suppliers' });
    return { data: reviewView(await accounts.decline(req.params.id, u.id, req.body?.reason)) };
  }));

  api.post<{ Params: { id: string }; Body: { verified?: boolean } }>('/api/supplier/applications/:id/verify', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (!canReviewSuppliers(u)) return reply.code(403).send({ error: 'Only the Marketplace Team or super admin can review suppliers' });
    const on = req.body?.verified !== false;
    return { data: reviewView(await accounts.setVerified(req.params.id, u.id, on)) };
  }));

  // Older clients used /reject; keep it as an alias for decline (reason optional).
  api.post<{ Params: { id: string }; Body: { reason?: string } }>('/api/supplier/applications/:id/reject', async (req, reply) => catcher(req, reply, async () => {
    const u = req.user!;
    if (!canReviewSuppliers(u)) return reply.code(403).send({ error: 'Only the Marketplace Team or super admin can review suppliers' });
    return { data: reviewView(await accounts.decline(req.params.id, u.id, req.body?.reason)) };
  }));
}
