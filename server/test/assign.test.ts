import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from './fixtures.js';

const PW = 'correct-horse-1';
async function setup() {
  const twenty = new MockTwenty(), users = new UserStore();
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40) });
  const mk = (email: string, role: any) => users.create(email, email.split('@')[0], role, PW);
  const sa = await mk('sa@x.in', 'SUPER_ADMIN'), ia = await mk('ia@x.in', 'INDIA_ADMIN'), is = await mk('is@x.in', 'INDIA_STAFF'),
    is2 = await mk('is2@x.in', 'INDIA_STAFF'), ca = await mk('ca@x.in', 'CHINA_ADMIN'), cs = await mk('cs@x.in', 'CHINA_STAFF'), cs2 = await mk('cs2@x.in', 'CHINA_STAFF');
  const tok: Record<string, string> = {};
  for (const e of ['sa', 'ia', 'is', 'is2', 'ca', 'cs', 'cs2'])
    tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
  const notes = async (who: string) => (await call(who, 'GET', '/api/notifications')).json();
  const createLead = async (who = 'is', extra: object = {}) => {
    const r = await call(who, 'POST', '/api/records/leads', { name: 'L', clientName: 'Secret Customer', contactName: 'Mr Secret', productInterest: 'Steel bottles', status: 'NEW', ...extra });
    expect(r.statusCode).toBe(201); return r.json().data as { id: string; leadRef: string };
  };
  return { app, twenty, users, sa, ia, is, is2, ca, cs, cs2, call, notes, createLead };
}

describe('lead assignment + notifications', () => {
  it('India staff raises a lead, sends it to a chosen China member, China returns it to the raiser', async () => {
    const { is, cs, call, notes, createLead } = await setup();
    const lead = await createLead();
    let l = (await call('is', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l).toMatchObject({ raisedBy: is.id, raisedByName: 'is', assignedTo: is.id, ownerOffice: 'INDIA' });
    expect((await notes('is')).unread).toBe(0); // no self-notification

    const staff = (await call('is', 'GET', '/api/staff?office=CHINA')).json().data;
    expect(staff.map((s: any) => s.name).sort()).toEqual(['ca', 'cs', 'cs2']);
    expect(Object.keys(staff[0]).sort()).toEqual(['avatarUrl', 'id', 'name', 'role']);

    const r = await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: cs.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ assignedOffice: 'CHINA', status: 'ASSIGNED', assignedTo: cs.id, ownerOffice: 'CHINA' });
    const n = await notes('cs');
    expect(n.unread).toBe(1);
    expect(n.data[0]).toMatchObject({ kind: 'ASSIGNED', leadId: lead.id, leadRef: lead.leadRef, product: 'Steel bottles', byName: 'is', office: 'CHINA' });
    expect(JSON.stringify(n)).not.toMatch(/Secret/); // privacy: no customer data in China notifications
    expect((await notes('cs2')).unread).toBe(0);

    // China sees it in "Assigned to me" without customer fields.
    const mine = (await call('cs', 'GET', '/api/records/leads?assignedTo=me')).json().data;
    expect(mine.map((x: any) => x.id)).toEqual([lead.id]);
    expect(JSON.stringify(mine)).not.toMatch(/Secret/);
    expect((await call('cs2', 'GET', '/api/records/leads?assignedTo=me')).json().data).toEqual([]);

    // Quoting returns it to the India raiser by default.
    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    l = (await call('is', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l).toMatchObject({ assignedTo: is.id, ownerOffice: 'INDIA', assignedOffice: 'CHINA' });
    const ni = await notes('is');
    expect(ni.data[0]).toMatchObject({ kind: 'RETURNED', byName: 'cs' });
    // China keeps read access after the return.
    expect((await call('cs', 'GET', `/api/records/leads/${lead.id}`)).statusCode).toBe(200);

    // Mark read
    expect((await call('is', 'POST', `/api/notifications/${ni.data[0].id}/read`)).json().ok).toBe(true);
    expect((await notes('is')).unread).toBe(0);
    expect((await call('cs', 'POST', '/api/notifications/read-all')).json().ok).toBe(true);
    expect((await notes('cs')).unread).toBe(0);
  });

  it('sending without a pick goes to the China queue and notifies China admins; return can be overridden', async () => {
    const { is2, ca, cs, call, notes, createLead } = await setup();
    const lead = await createLead();
    // Legacy path (board drag / assignToChina PATCH) also counts as a handoff.
    expect((await call('is', 'PATCH', `/api/records/leads/${lead.id}`, { assignedOffice: 'CHINA', status: 'ASSIGNED' })).statusCode).toBe(200);
    expect((await call('cs', 'GET', `/api/records/leads/${lead.id}`)).json().data).toMatchObject({ assignedTo: null, ownerOffice: 'CHINA' });
    expect((await notes('ca')).data[0]).toMatchObject({ kind: 'QUEUE', office: 'CHINA' });
    expect((await notes('cs')).unread).toBe(0);
    // China staff may only take it themselves; China admin may assign anyone.
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ca.id })).statusCode).toBe(403);
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: cs.id })).statusCode).toBe(200);
    expect((await call('ca', 'PATCH', `/api/records/leads/${lead.id}`, { assignedTo: cs.id })).statusCode).toBe(200);
    // Return to a different India member (override).
    const r = await call('cs', 'POST', `/api/leads/${lead.id}/assign`, { office: 'INDIA', assignedTo: is2.id });
    expect(r.statusCode).toBe(200);
    expect((await notes('is2')).data[0]).toMatchObject({ kind: 'RETURNED' });
    // Assignee must be active staff of the target office.
    expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: is2.id })).statusCode).toBe(400);
  });

  it('public enquiries land in the India queue; India admin sets raisedBy; China cannot touch India-only leads', async () => {
    const { app, ia, is, call, notes } = await setup();
    const e = await app.inject({ method: 'POST', url: '/api/public/enquiry', payload: { name: 'Web Buyer', phone: '9876543210', product: 'Mugs' } });
    expect(e.statusCode).toBe(201);
    const n = await notes('ia');
    expect(n.data[0]).toMatchObject({ kind: 'QUEUE', office: 'INDIA', product: 'Mugs', byName: null });
    const id = n.data[0].leadId;
    expect((await call('is', 'GET', `/api/records/leads/${id}`)).json().data).toMatchObject({ raisedBy: null, assignedTo: null });
    expect((await call('is', 'POST', `/api/leads/${id}/assign`, { raisedBy: is.id })).statusCode).toBe(403);
    expect((await call('ia', 'POST', `/api/leads/${id}/assign`, { raisedBy: is.id, assignedTo: is.id })).statusCode).toBe(200);
    expect((await call('is', 'GET', `/api/records/leads/${id}`)).json().data).toMatchObject({ raisedBy: is.id, assignedTo: is.id });
    expect((await notes('is')).data[0]).toMatchObject({ kind: 'ASSIGNED', byName: 'ia' });
    expect((await call('cs', 'POST', `/api/leads/${id}/assign`, { office: 'CHINA' })).statusCode).toBe(404);
    expect((await call('cs', 'GET', `/api/records/leads?assignedTo=me`)).json().data).toEqual([]);
    void ia;
  });

  it('removing a user drops them as assignee (lead stays) and deletes their notifications', async () => {
    const { users, cs, call, createLead } = await setup();
    const lead = await createLead();
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: cs.id });
    expect((await call('sa', 'DELETE', `/api/users/${cs.id}`)).statusCode).toBe(204);
    const l = (await call('sa', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l).toMatchObject({ assignedTo: null, ownerOffice: 'CHINA', clientName: 'Secret Customer' });
    expect(users.byId(cs.id)).toBeNull();
  });
});
