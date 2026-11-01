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
    expect(Array.isArray(c.files)).toBe(true); // the lead panel renders quote files from this response
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
    expect(pdf.rawPayload.toString('latin1')).not.toMatch(/Fortune|72995/);
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
    // shipment auto-created with the order, ref = lead ref + -S1, role-filtered
    const is1 = (await call('is', 'GET', '/api/shipments')).json().data;
    expect(is1).toHaveLength(1);
    expect(is1[0]).toMatchObject({ ref: `${lead.leadRef}-S1`, orderId: o.id, status: 'PENDING', customer: expect.anything() });
    expect(is1[0].supplier).toBeUndefined();
    const cs1 = (await call('cs', 'GET', '/api/shipments')).json().data[0];
    expect(cs1.supplier).toBe('Secret Factory'); expect(cs1.customer).toBeUndefined();
    expect((await call('is', 'PATCH', `/api/shipments/${cs1.id}`, { tracking: 'X' })).statusCode).toBe(403);
    expect((await call('cs', 'PATCH', `/api/shipments/${cs1.id}`, { status: 'DELIVERED' })).statusCode).toBe(403);
    expect((await call('cs', 'PATCH', `/api/shipments/${cs1.id}`, { mode: 'SEA', carrier: 'Maersk', status: 'BOOKED' })).json().data).toMatchObject({ mode: 'SEA', carrier: 'Maersk', status: 'BOOKED' });
    expect((await notifs(call, 'is')).some((n) => n.kind === 'SHIPMENT_UPDATE')).toBe(true);
    const co = (await call('cs', 'GET', '/api/orders')).json().data[0];
    expect(co).toMatchObject({ supplier: { name: 'Secret Factory' }, unitPrice: 12, qty: 100 });
    expect(co.agreedPrice).toBeUndefined(); expect(co.customer).toBeUndefined();
    expect((await call('cs', 'PATCH', `/api/orders/${o.id}`, { advance: 1 })).statusCode).toBe(403);
    expect((await call('is', 'PATCH', `/api/orders/${o.id}`, { tracking: 'X' })).statusCode).toBe(403);
    // Gates: India transit locked before Shipped; Shipped needs tracking/container + ETD; lead can't be dragged to Shipping/Delivered early.
    expect((await call('is', 'PATCH', `/api/orders/${o.id}`, { indiaStatus: 'IN_TRANSIT' })).statusCode).toBe(409);
    expect((await call('is', 'PATCH', `/api/shipments/${cs1.id}`, { status: 'CUSTOMS' })).statusCode).toBe(409);
    expect((await call('is', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'SHIPPING' })).statusCode).toBe(409);
    expect((await call('is', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'DELIVERED' })).statusCode).toBe(409);
    expect((await call('cs', 'PATCH', `/api/orders/${o.id}`, { production: 'SHIPPED' })).statusCode).toBe(409);
    expect((await call('cs', 'PATCH', `/api/orders/${o.id}`, { production: 'SHIPPED', tracking: 'MSKU123' })).statusCode).toBe(409);
    const up = (await call('cs', 'PATCH', `/api/orders/${o.id}`, { production: 'SHIPPED', tracking: 'MSKU123', container: 'CNT9', etd: '2026-12-02', eta: '2026-12-25' })).json().data;
    expect(up).toMatchObject({ production: 'SHIPPED', tracking: 'MSKU123' });
    expect((await notifs(call, 'is')).some((n) => n.kind === 'ORDER_SHIPPED')).toBe(true);
    expect((await call('is', 'GET', `/api/records/leads/${lead.id}`)).json().data.status).toBe('SHIPPING');
    expect((await call('is', 'GET', `/api/shipments/${cs1.id}`)).json().data).toMatchObject({ status: 'IN_TRANSIT', tracking: 'MSKU123', etd: '2026-12-02' });
    expect((await call('cs', 'PATCH', `/api/orders/${o.id}`, { production: 'READY' })).statusCode).toBe(409);
    expect((await call('cs', 'PATCH', `/api/shipments/${cs1.id}`, { status: 'BOOKED' })).statusCode).toBe(409);
    expect((await call('is', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(409);
    expect((await call('is', 'PATCH', `/api/shipments/${cs1.id}`, { status: 'OUT_FOR_DELIVERY' })).json().data.status).toBe('OUT_FOR_DELIVERY');
    expect((await call('is', 'GET', `/api/orders/${o.id}`)).json().data.indiaStatus).toBe('OUT_FOR_DELIVERY');
    const io = (await call('is', 'PATCH', `/api/orders/${o.id}`, { indiaStatus: 'DELIVERED', paymentStatus: 'PAID' })).json().data;
    expect(io).toMatchObject({ indiaStatus: 'DELIVERED', tracking: 'MSKU123', leadStatus: 'DELIVERED' });
    const sh = (await call('is', 'GET', `/api/shipments/${cs1.id}`)).json().data;
    expect(sh).toMatchObject({ tracking: 'MSKU123', container: 'CNT9', eta: '2026-12-25', status: 'DELIVERED', carrier: 'Maersk' });
    expect((await call('sa', 'DELETE', `/api/records/leads/${lead.id}`)).statusCode).toBe(204);
    expect((await call('sa', 'GET', '/api/orders')).json().data).toHaveLength(0);
    expect((await call('sa', 'GET', '/api/shipments')).json().data).toHaveLength(0);
  });
  it('rejection returns the lead to India; revise loops to China; close makes it LOST', async () => {
    const { call, ids } = await setup();
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'Secret Cust', productInterest: 'P' })).json().data;
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'USD' })).json().data;
    await call('is', 'PUT', `/api/quotes/${q.id}/customer`, { qty: 1, unitPrice: 10 });
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'REJECTED' })).statusCode).toBe(400);
    expect((await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'REJECTED', reasonCode: 'OTHER' })).statusCode).toBe(400);
    const r = (await call('is', 'POST', `/api/quotes/${q.id}/status`, { status: 'REJECTED', reasonCode: 'PRICE', reason: 'Too expensive' })).json().data;
    expect(r.status).toBe('REJECTED'); expect(r.leadStatus).not.toBe('LOST');
    let l = (await call('is', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(l).toMatchObject({ ownerOffice: 'INDIA', raisedBy: ids.is, rejection: { count: 1, actionNeeded: true, last: { reasonCode: 'PRICE' } } });
    expect((await notifs(call, 'cs')).some((n) => n.kind === 'QUOTE_REJECTED')).toBe(true);
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/rejection/revise`, {})).statusCode).toBe(403);
    l = (await call('is', 'POST', `/api/leads/${lead.id}/rejection/revise`, { targetPrice: 8, notes: 'Need cheaper' })).json().data;
    expect(l).toMatchObject({ ownerOffice: 'CHINA', assignedTo: ids.cs, status: 'SOURCING', rejection: { actionNeeded: false, revising: true } });
    expect((await notifs(call, 'cs')).some((n) => n.kind === 'REVISE_REQUESTED')).toBe(true);
    const cl = (await call('cs', 'GET', `/api/records/leads/${lead.id}`)).json().data;
    expect(cl.clientName).toBeUndefined(); expect(cl.rejection.last).toMatchObject({ targetPrice: 8, notes: 'Need cheaper', reasonText: 'Too expensive' });
    const q2 = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 0.8, currency: 'USD' })).json().data;
    expect((await call('cs', 'GET', `/api/leads/${lead.id}/quotes`)).json().data).toHaveLength(2);
    await call('is', 'PUT', `/api/quotes/${q2.id}/customer`, { qty: 1, unitPrice: 9 });
    await call('is', 'POST', `/api/quotes/${q2.id}/status`, { status: 'REJECTED', reasonCode: 'LEAD_TIME' });
    expect((await call('is', 'POST', `/api/leads/${lead.id}/rejection/close`, {})).json().data).toMatchObject({ status: 'LOST', winLossReason: 'LEAD_TIME', rejection: { count: 2, actionNeeded: false } });
    expect((await call('is', 'POST', `/api/leads/${lead.id}/rejection/close`, {})).statusCode).toBe(400);
  });
});

describe('notification stream', () => {
  it('pushes a notification to a connected user and rejects unauthenticated clients', async () => {
    const { app, call, ids } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as any).port;
    expect((await fetch(`http://127.0.0.1:${port}/api/notifications/stream`)).status).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'cs@x.in', password: PW } });
    const t = login.json().token;
    const ac = new AbortController();
    const r = await fetch(`http://127.0.0.1:${port}/api/notifications/stream`, { headers: { authorization: `Bearer ${t}` }, signal: ac.signal });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const rd = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    const until = async (s: string) => { while (!buf.includes(s)) { const { value } = await rd.read(); buf += dec.decode(value); } };
    await until('event: hello');
    const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'Secret Client', productInterest: 'Bottles' })).json().data;
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    await until('event: notification');
    expect(buf).toContain(lead.leadRef); expect(buf).not.toContain('Secret Client');
    ac.abort(); await app.close();
  });
});
