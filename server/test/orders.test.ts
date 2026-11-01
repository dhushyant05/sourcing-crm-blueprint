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
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'seo-')) });
  const ids: Record<string, string> = {};
  for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['is', 'INDIA_STAFF'], ['is2', 'INDIA_STAFF'], ['cs', 'CHINA_STAFF']] as const) ids[e] = (await users.create(`${e}@x.in`, e, r, PW)).id;
  const tok: Record<string, string> = {};
  for (const e of Object.keys(ids)) tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: any) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}` } });
  return { app, twenty, call, ids };
}
const notifs = async (call: any, who: string) => (await call(who, 'GET', '/api/notifications')).json().data as any[];

describe('return to raiser', () => {
  it('a lead raised by the super admin returns to them; drag to QUOTED returns to the raiser', async () => {
    const { call, ids } = await setup();
    const lead = (await call('sa', 'POST', '/api/records/leads', { name: 'L', clientName: 'C', productInterest: 'P' })).json().data;
    await call('sa', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const r = await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' });
    expect(r.statusCode).toBe(200);
    const l = (await call('sa', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l).toMatchObject({ ownerOffice: 'INDIA', assignedTo: ids.sa, raisedBy: ids.sa });
  });
  it('an enquiry (no raiser) sent to China by India staff returns to that staff member', async () => {
    const { call, ids, twenty } = await setup();
    const lead = (await call('is2', 'POST', '/api/records/leads', { name: 'L', clientName: 'C', productInterest: 'P' })).json().data;
    // simulate an older lead with no raiser: clear it via the admin endpoint
    await call('sa', 'POST', `/api/leads/${lead.id}/assign`, { raisedBy: null });
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' });
    await call('cs', 'POST', `/api/leads/${lead.id}/assign`, { office: 'INDIA' });
    const l = (await call('is', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l).toMatchObject({ assignedTo: ids.is, raisedBy: ids.is });
    expect((await notifs(call, 'is')).some((n) => n.kind === 'RETURNED')).toBe(true);
    const mine = (await call('is', 'GET', '/api/records/leads?assignedTo=me')).json().data;
    expect(mine.map((x: any) => x.id)).toContain(lead.id);
    void twenty;
  });
});

describe('customer quote, PDF and orders', () => {
  it('runs the full flow with role separation', async () => {
    const { app, call, ids } = await setup();
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'Acme Customer', contactPhone: '+91 99999', productInterest: 'Steel bottles' })).json().data;
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { newSupplier: { name: 'Secret Factory' }, product: 'SB-500', unitPrice: 12, currency: 'CNY',
      shipCost: 800, shipTerm: 'fob', shipMode: 'SEA', shipPort: 'Ningbo', shipTransit: '20 days' })).json().data;
    expect(q).toMatchObject({ shipCost: 800, shipCurrency: 'CNY', shipTerm: 'FOB', shipMode: 'SEA', shipPort: 'Ningbo', status: 'DRAFT' });
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'USD', shipTerm: 'XYZ' })).statusCode).toBe(400);

    // all-quotes list
    const ci = (await call('cs', 'GET', '/api/quotes')).json().data;
    expect(ci[0]).toMatchObject({ label: `${lead.leadRef}-Q1`, supplier: { name: 'Secret Factory' } });
    expect(JSON.stringify(ci)).not.toContain('Acme');
    expect((await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 100 })).statusCode).toBe(400); // no price yet
    expect((await call('cs', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 100, unitPrice: 200 })).statusCode).toBe(403);
    const c = (await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 100, unitPrice: 200, gstPct: 18, shipCost: 1000, shipTerm: 'DDP', shipMode: 'SEA', port: 'Chennai', transit: '25 days', otherCharges: 500, otherLabel: 'Packing', validity: '15 days', terms: '50% advance' })).json().data;
    expect(c.cqTotals).toMatchObject({ subtotal: 20000, taxable: 21500, gst: 3870, total: 25370 });
    expect(c.clientPrice).toBe(200);
    const il = (await call('is', 'GET', '/api/quotes?status=DRAFT')).json().data;
    expect(il).toHaveLength(1);
    expect(JSON.stringify(il)).not.toContain('Secret Factory');
    expect(JSON.stringify((await call('cs', 'GET', '/api/quotes')).json())).not.toContain('Packing');

    const pdfR = (await call('is', 'POST', `/api/quotes/${q.id}/pdf`)).json().data;
    expect(pdfR.pdfUrl).toMatch(/^\/api\/public\/cq\/[A-Za-z0-9_-]{43}\.pdf$/);
    const pdf = await app.inject({ method: 'GET', url: pdfR.pdfUrl });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.toString('latin1')).not.toContain('Secret Factory');
    expect((await app.inject({ method: 'GET', url: '/api/public/cq/abc.pdf' })).statusCode).toBe(404);

    expect((await call('is', 'POST', `/api/quotes/${q.id}/order`, {})).statusCode).toBe(400); // not accepted
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'SENT' })).json().data.sentAt).toBeTruthy();
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'REJECTED' })).statusCode).toBe(400); // reason
    const acc = (await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'ACCEPTED' })).json().data;
    expect(acc).toMatchObject({ status: 'ACCEPTED', leadStatus: 'WON' });
    expect((await notifs(call, 'cs')).some((n) => n.kind === 'QUOTE_ACCEPTED')).toBe(true);

    const ord = (await call('is', 'POST', `/api/quotes/${q.id}/order`, { advance: 5000, paymentStatus: 'PARTIAL', expectedShip: '2026-12-01' }));
    expect(ord.statusCode).toBe(201);
    const o = ord.json().data;
    expect(o).toMatchObject({ qty: 100, agreedPrice: 200, advance: 5000, paymentStatus: 'PARTIAL', production: 'NEW', leadRef: lead.leadRef });
    expect(o.supplier).toBeUndefined();
    expect((await notifs(call, 'cs')).some((n) => n.kind === 'ORDER_NEW')).toBe(true);
    const co = (await call('cs', 'GET', '/api/orders')).json().data[0];
    expect(co).toMatchObject({ supplier: { name: 'Secret Factory' }, unitPrice: 12, qty: 100 });
    expect(co.agreedPrice).toBeUndefined(); expect(co.customer).toBeUndefined();
    expect((await call('cs', 'PATCH', `/api/orders/${o.id}`, { advance: 1 })).statusCode).toBe(403);
    expect((await call('is', 'PATCH', `/api/orders/${o.id}`, { tracking: 'X' })).statusCode).toBe(403);
    const up = (await call('cs', 'PATCH', `/api/orders/${o.id}`, { production: 'SHIPPED', tracking: 'MSKU123', container: 'CNT9', etd: '2026-12-02', eta: '2026-12-25' })).json().data;
    expect(up).toMatchObject({ production: 'SHIPPED', tracking: 'MSKU123' });
    expect((await notifs(call, 'is')).some((n) => n.kind === 'ORDER_UPDATE')).toBe(true);
    const io = (await call('is', 'PATCH', `/api/orders/${o.id}`, { indiaStatus: 'DELIVERED', paymentStatus: 'PAID' })).json().data;
    expect(io).toMatchObject({ indiaStatus: 'DELIVERED', tracking: 'MSKU123', leadStatus: 'DELIVERED' });
    expect((await call('sa', 'DELETE', `/api/records/leads/${lead.id}`)).statusCode).toBe(204);
    expect((await call('sa', 'GET', '/api/orders')).json().data).toHaveLength(0);
  });
  it('reject needs a reason and moves the lead to LOST', async () => {
    const { call, ids } = await setup();
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'C', productInterest: 'P' })).json().data;
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'USD' })).json().data;
    await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 1, unitPrice: 10 });
    const r = (await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'REJECTED', reason: 'Too expensive' })).json().data;
    expect(r).toMatchObject({ status: 'REJECTED', rejectReason: 'Too expensive', leadStatus: 'LOST' });
  });
});
