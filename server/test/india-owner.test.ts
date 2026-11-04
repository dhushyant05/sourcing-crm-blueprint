import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

const PW = 'correct-horse-1';
describe('India owner for public enquiries', () => {
  it('unowned public lead: staff takes it, admin reassigns, raiser + SLA + bell follow, China still available', async () => {
    const { db, bus, users } = await testEnv();
    const app = await buildApp({ db, bus, users, jwtSecret: 'x'.repeat(40) });
    const ids: Record<string, string> = {}, tok: Record<string, string> = {};
    for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['ia', 'INDIA_ADMIN'], ['is', 'INDIA_STAFF'], ['is2', 'INDIA_STAFF'], ['cs', 'CHINA_STAFF']] as const) {
      ids[e] = (await users.create(`${e}@x.in`, e, r as any, PW)).id;
      tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
    }
    const call = (who: string, method: any, url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
    const pub = await app.inject({ method: 'POST', url: '/api/public/enquiry', payload: { name: 'Web Buyer', phone: '9876543210', product: 'Mugs' } });
    expect(pub.statusCode).toBe(201);
    const id = (await call('is', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === pub.json().reference).id;
    const get = async (w = 'ia') => (await call(w, 'GET', `/api/records/leads/${id}`)).json().data;
    expect(await get('is')).toMatchObject({ unassignedIndia: true, raisedBy: null, assignedTo: null });

    expect((await call('cs', 'POST', `/api/leads/${id}/india-owner`, {})).statusCode).toBe(404);
    expect((await call('is', 'POST', `/api/leads/${id}/india-owner`, { userId: ids.is2 })).statusCode).toBe(403);
    const take = await call('is', 'POST', `/api/leads/${id}/india-owner`, {});
    expect(take.statusCode).toBe(200);
    expect(take.json().data).toMatchObject({ unassignedIndia: false, raisedBy: ids.is, assignedTo: ids.is, ownerOffice: 'INDIA' });
    expect(take.json().data.sla?.assignee).toBe(ids.is);
    expect((await call('is2', 'POST', `/api/leads/${id}/india-owner`, {})).json().code).toBe('taken');

    const re = await call('ia', 'POST', `/api/leads/${id}/india-owner`, { userId: ids.is2 });
    expect(re.json().data).toMatchObject({ raisedBy: ids.is2, assignedTo: ids.is2 });
    const n = (await call('is2', 'GET', '/api/notifications')).json().data[0];
    expect(n).toMatchObject({ kind: 'ASSIGNED', leadId: id, byName: 'ia' });

    // China still available afterwards; quoting returns to the new India owner.
    expect((await call('is2', 'POST', `/api/leads/${id}/assign`, { office: 'CHINA', assignedTo: ids.cs })).statusCode).toBe(200);
    expect((await call('cs', 'PATCH', `/api/records/leads/${id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    expect(await get()).toMatchObject({ assignedTo: ids.is2, ownerOffice: 'INDIA' });
    // Super admin can reassign while China holds it too.
    expect((await call('sa', 'POST', `/api/leads/${id}/india-owner`, { userId: ids.is })).json().data.raisedBy).toBe(ids.is);
  });
});
