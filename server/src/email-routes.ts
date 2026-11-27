/** HTTP routes for the email channel: provider inbound webhook, super-admin status, staff notification preferences. */
import type { FastifyInstance } from 'fastify';
import type { User } from './users.js';
import { EmailChannel, parseInbound, secretMatches } from './email-channel.js';

export const INBOUND_BODY_LIMIT = 25 * 1024 * 1024;

export function registerPublicEmail(app: FastifyInstance, email: EmailChannel) {
  app.post('/api/email/inbound', { bodyLimit: INBOUND_BODY_LIMIT }, async (req, reply) => {
    const st = email.status;
    // Disabled: look like the route does not exist.
    if (!st.enabled || !email.config.inboundSecret) return reply.code(404).send({ error: 'Not found' });
    if (!secretMatches(email.config.inboundSecret, req.headers as Record<string, unknown>)) return reply.code(401).send({ error: 'Unauthorized' });
    const m = parseInbound(req.body);
    if (!m) return reply.code(422).send({ error: 'Unrecognised email payload' });
    const out = await email.receive(m);
    // 200 even for ignored / duplicate mail so providers do not retry forever.
    return { ok: true, status: out.status, side: out.side ?? null, conversationId: out.conversationId ?? null };
  });
}

export function registerStaffEmail(api: FastifyInstance, email: EmailChannel, deps: {
  linkSupplierLead: (u: User, conversationId: string, leadId: string | null) => Promise<void>;
}) {
  api.get('/api/email/status', async (req, reply) => {
    if (req.user!.role !== 'SUPER_ADMIN') return reply.code(403).send({ error: 'Super admin only' });
    return { data: email.status };
  });
  api.get('/api/me/notification-prefs', async (req) => {
    const p = await email.prefs(req.user!.id);
    return { data: { ...p, emailConfigured: email.status.outboundReady && !!email.config.notifyFrom } };
  });
  api.put<{ Body: { chatEmail?: boolean } }>('/api/me/notification-prefs', async (req, reply) => {
    const v = req.body?.chatEmail;
    if (typeof v !== 'boolean') return reply.code(400).send({ error: 'chatEmail must be true or false' });
    const p = await email.setPrefs(req.user!.id, { chatEmail: v });
    return { data: { ...p, emailConfigured: email.status.outboundReady && !!email.config.notifyFrom } };
  });
  api.post<{ Params: { id: string }; Body: { leadId?: string | null } }>('/api/email/conversations/:id/link', async (req) => {
    await deps.linkSupplierLead(req.user!, req.params.id, req.body?.leadId ? String(req.body.leadId) : null);
    return { data: { ok: true, linkedLeadId: req.body?.leadId ?? null } };
  });
}
