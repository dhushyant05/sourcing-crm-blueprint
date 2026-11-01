import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from './fixtures.js';

const PW = 'correct-horse-1';
async function setup() {
  const twenty = new MockTwenty(), users = new UserStore();
  let t = Date.parse('2026-11-02T00:00:00Z');
  const clock = { now: () => t, add: (min: number) => { t += min * 60e3; } };
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'sew-')), now: clock.now, slaTickMs: 0 });
  const ids: Record<string, string> = {};
  for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['is', 'INDIA_STAFF'], ['ia', 'INDIA_ADMIN'], ['cs', 'CHINA_STAFF'], ['ca', 'CHINA_ADMIN']] as const) ids[e] = (await users.create(`${e}@x.in`, e, r, PW)).id;
  const tok: Record<string, string> = {};
  for (const e of Object.keys(ids)) tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: any) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
  const notifs = async (who: string) => (await call(who, 'GET', '/api/notifications')).json().data as any[];
  return { app, call, ids, clock, notifs };
}

describe('timeline + SLA + priority', () => {
  it('logs the whole workflow, role-filtered, with SLA clocks per office', async () => {
    const { app, call, ids, clock, notifs } = await setup();
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'Acme Customer', productInterest: 'Bottles' })).json().data;
    let tl = (await call('is', 'GET', `/api/leads/${lead.id}/timeline`)).json().data;
    expect(tl.events.map((e: any) => e.kind)).toEqual(['CREATED', 'ASSIGNED']);
    expect(tl.sla).toMatchObject({ office: 'INDIA', assignee: ids.is });
    expect(tl.progress.stage).toBe('NEW');
    expect(Date.parse(tl.sla.dueAt) - Date.parse(tl.sla.startedAt)).toBe(5 * 3600e3);

    clock.add(60);
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    tl = (await call('cs', 'GET', `/api/leads/${lead.id}/timeline`)).json().data;
    expect(tl.sla.office).toBe('CHINA');
    expect(tl.progress.stage).toBe('CHINA');

    // priority: India only; 2h clock, assignee notified
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/priority`, { priority: true })).statusCode).toBe(403);
    const p = (await call('is', 'POST', `/api/leads/${lead.id}/priority`, { priority: true })).json().data;
    expect(p.priority).toBe(true);
    expect(Date.parse(p.sla.dueAt) - Date.parse(p.sla.startedAt)).toBe(2 * 3600e3);
    expect((await notifs('cs')).some((n) => n.kind === 'PRIORITY')).toBe(true);
    const list = (await call('is', 'GET', '/api/records/leads')).json().data;
    expect(list[0]).toMatchObject({ id: lead.id, priority: true });

    // 80% warning to assignee, then breach to China admins + super admin
    clock.add(100); expect(await app.slaTick()).toEqual({ warn: 1, breach: 0 });
    expect((await notifs('cs')).some((n) => n.kind === 'SLA_WARN')).toBe(true);
    clock.add(30); expect(await app.slaTick()).toEqual({ warn: 0, breach: 1 });
    expect(await app.slaTick()).toEqual({ warn: 0, breach: 0 });
    expect((await notifs('ca')).some((n) => n.kind === 'SLA_BREACH')).toBe(true);
    expect((await notifs('sa')).some((n) => n.kind === 'SLA_BREACH')).toBe(true);
    expect((await notifs('ia')).some((n) => n.kind === 'SLA_BREACH')).toBe(false);

    await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { newSupplier: { name: 'Secret Factory' }, product: 'SB', unitPrice: 2, currency: 'USD' });
    await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' });
    const q = (await call('is', 'GET', `/api/leads/${lead.id}/quotes`)).json().data[0];
    await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 100, unitPrice: 250, currency: 'INR' });
    await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' });
    await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'REJECTED', reason: 'Found cheaper elsewhere' });

    const ind = (await call('is', 'GET', `/api/leads/${lead.id}/timeline`)).json().data;
    const chi = (await call('cs', 'GET', `/api/leads/${lead.id}/timeline`)).json().data;
    const kinds = ind.events.map((e: any) => e.kind);
    for (const k of ['PRIORITY', 'SLA_BREACH', 'QUOTE_ADDED', 'STATUS', 'RETURNED', 'CQ_PREPARED', 'CQ_SENT', 'CQ_REJECTED']) expect(kinds).toContain(k);
    expect(ind.sla).toBeNull(); // India clock stopped when the customer quote was sent
    expect(JSON.stringify(ind.events)).not.toContain('Secret Factory');
    expect(JSON.stringify(chi.events)).not.toContain('Acme');
    expect(chi.events.map((e: any) => e.kind)).not.toContain('CQ_PREPARED');
    expect(chi.events.find((e: any) => e.kind === 'CQ_REJECTED').data.reason).toBe('Found cheaper elsewhere'); // China sees why, to revise
    expect(JSON.stringify(chi.events)).toContain('Secret Factory');
    expect(chi.events.find((e: any) => e.kind === 'ASSIGNED').actorName).toBe('is');
    expect(ind.progress).toMatchObject({ stage: 'DECIDED', lost: true });

    const rep = (await call('ia', 'GET', '/api/sla/report')).json().data;
    const china = rep.office.find((x: any) => x.office === 'CHINA'), india = rep.office.find((x: any) => x.office === 'INDIA');
    expect(china).toMatchObject({ total: 1, breached: 1, onTimePct: 0 });
    expect(india.total).toBe(2); expect(india.breached).toBe(0);
    expect(rep.members.find((m: any) => m.id === ids.cs)).toMatchObject({ breached: 1 });
    expect((await call('is', 'GET', '/api/sla/report')).statusCode).toBe(403);
  });

  it('super admin configures SLA minutes; running clocks follow', async () => {
    const { call } = await setup();
    expect((await call('ia', 'PUT', '/api/settings/sla', { normalMinutes: 1 })).statusCode).toBe(403);
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'C', productInterest: 'P' })).json().data;
    expect((await call('sa', 'PUT', '/api/settings/sla', { normalMinutes: 3, priorityMinutes: 1 })).json().data).toEqual({ normalMinutes: 3, priorityMinutes: 1 });
    const tl = (await call('is', 'GET', `/api/leads/${lead.id}/timeline`)).json().data;
    expect(Date.parse(tl.sla.dueAt) - Date.parse(tl.sla.startedAt)).toBe(3 * 60e3);
    expect((await call('sa', 'PUT', '/api/settings/sla', { normalMinutes: 0 })).json().data.normalMinutes).toBe(3);
  });
});
