import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from './fixtures.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EXE = Buffer.from('MZ\x90\x00binary');
function form(files: { name: string; data: Buffer }[]) {
  const B = '----se' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const f of files) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), f.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${B}` } };
}
const PW = 'correct-horse-1';
async function setup() {
  const twenty = new MockTwenty(), users = new UserStore();
  const app = await buildApp({ twenty, users, jwtSecret: 'x'.repeat(40), uploadsDir: mkdtempSync(join(tmpdir(), 'seq-')) });
  for (const [e, r] of [['sa', 'SUPER_ADMIN'], ['is', 'INDIA_STAFF'], ['ca', 'CHINA_ADMIN'], ['cs', 'CHINA_STAFF'], ['cs2', 'CHINA_STAFF']] as const) await users.create(`${e}@x.in`, e, r, PW);
  const tok: Record<string, string> = {};
  for (const e of ['sa', 'is', 'ca', 'cs', 'cs2']) tok[e] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${e}@x.in`, password: PW } })).json().token;
  const call = (who: string, method: any, url: string, payload?: any, headers: Record<string, string> = {}) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok[who]}`, ...headers } });
  const lead = (await call('is', 'POST', '/api/records/leads', { name: 'L', clientName: 'Secret Customer', productInterest: 'Steel bottles' })).json().data;
  return { app, twenty, call, lead };
}
const SUP = { name: 'Ningbo Secret Factory', contact: 'Mr Wang', phone: '+86 138', wechat: 'wx_secret', city: 'Ningbo' };

describe('supplier quotes on a lead', () => {
  it('China adds a quote with a new supplier + photos; India sees product/price/files but no supplier identity', async () => {
    const { call, lead } = await setup();
    expect((await call('cs', 'GET', `/api/leads/${lead.id}/quotes`)).statusCode).toBe(404); // not with China yet
    expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
    expect((await call('is', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'USD' })).statusCode).toBe(403);
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 'abc', currency: 'USD' })).statusCode).toBe(400);
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'x', unitPrice: 1, currency: 'EUR' })).statusCode).toBe(400);
    const r = await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { newSupplier: SUP, product: 'SB-500 bottle', unitPrice: '12.5', currency: 'RMB', moq: '1000 pcs', leadTime: '15 days', validity: '30 days', notes: 'FOB Ningbo' });
    expect(r.statusCode).toBe(201);
    const q = r.json().data;
    expect(q).toMatchObject({ product: 'SB-500 bottle', unitPrice: 12.5, currency: 'CNY', moq: '1000 pcs', supplier: { name: SUP.name, wechat: 'wx_secret' } });
    expect(q.clientPrice).toBeUndefined(); // China never sees the customer price
    const f = form([{ name: 'Ningbo-Secret-catalog.png', data: PNG }]);
    const up2 = await call('cs', 'POST', `/api/quotes/${q.id}/files`, f.payload, f.headers);
    expect(up2.statusCode).toBe(201);
    const bad = form([{ name: 'x.exe', data: EXE }]);
    expect((await call('cs', 'POST', `/api/quotes/${q.id}/files`, bad.payload, bad.headers)).statusCode).toBe(415);
    expect((await call('is', 'POST', `/api/quotes/${q.id}/files`, f.payload, f.headers)).statusCode).toBe(403);

    const india = (await call('is', 'GET', `/api/leads/${lead.id}/quotes`)).json().data;
    expect(india).toHaveLength(1);
    expect(india[0]).toMatchObject({ product: 'SB-500 bottle', unitPrice: 12.5, currency: 'CNY', moq: '1000 pcs', leadTime: '15 days', validity: '30 days' });
    const txt = JSON.stringify(india);
    for (const secret of ['Ningbo Secret', 'Mr Wang', 'wx_secret', '+86', 'supplierId', 'createdBy', 'Secret-catalog']) expect(txt).not.toContain(secret);
    expect(india[0].files[0].name).toMatch(/^SE-\d{4}-\d{4}-Q1-1\.png$/);
    const dl = await call('is', 'GET', `/api/quotes/${q.id}/files/${india[0].files[0].id}`);
    expect(dl.statusCode).toBe(200);
    expect(String(dl.headers['content-disposition'])).not.toContain('Secret');
    expect((await call('is', 'GET', '/api/suppliers')).statusCode).toBe(403);
    expect((await call('cs', 'GET', '/api/suppliers')).json().data[0].name).toBe(SUP.name);

    // India adds its own INR selling price; cannot touch China fields. China cannot set the customer price.
    expect((await call('is', 'PATCH', `/api/quotes/${q.id}`, { unitPrice: 1 })).statusCode).toBe(403);
    expect((await call('cs', 'PATCH', `/api/quotes/${q.id}`, { clientPrice: 1 })).statusCode).toBe(403);
    const c = (await call('is', 'PATCH', `/api/quotes/${q.id}`, { clientPrice: '210', clientNotes: 'Incl. GST' })).json().data;
    expect(c).toMatchObject({ clientPrice: 210, clientCurrency: 'INR', clientNotes: 'Incl. GST' });
    expect(JSON.stringify((await call('cs', 'GET', `/api/leads/${lead.id}/quotes`)).json())).not.toContain('Incl. GST');
    const sa = (await call('sa', 'GET', `/api/leads/${lead.id}/quotes`)).json().data[0];
    expect(sa).toMatchObject({ clientPrice: 210, supplier: { name: SUP.name } });

    // Mark quoted -> returns to the India raiser (existing flow)
    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    expect((await call('is', 'GET', '/api/notifications')).json().data[0].kind).toBe('RETURNED');
  });

  it('only the author or a China admin edits/deletes; delete removes files; super admin can delete the lead', async () => {
    const { call, lead, twenty } = await setup();
    await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' });
    const sup = (await call('cs', 'POST', '/api/suppliers', SUP)).json().data;
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { supplierId: sup.id, product: 'A', unitPrice: 2, currency: 'USD' })).json().data;
    expect((await call('cs2', 'PATCH', `/api/quotes/${q.id}`, { unitPrice: 3 })).statusCode).toBe(403);
    expect((await call('cs2', 'DELETE', `/api/quotes/${q.id}`)).statusCode).toBe(403);
    expect((await call('cs', 'PATCH', `/api/quotes/${q.id}`, { unitPrice: 3, currency: 'INR' })).json().data).toMatchObject({ unitPrice: 3, currency: 'INR', product: 'A' });
    expect((await call('ca', 'PATCH', `/api/quotes/${q.id}`, { moq: '50' })).json().data.moq).toBe('50');
    expect((await call('cs', 'DELETE', `/api/quotes/${q.id}`)).statusCode).toBe(204);
    expect((await call('cs', 'GET', `/api/leads/${lead.id}/quotes`)).json().data).toHaveLength(0);
    await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, { product: 'B', unitPrice: 1, currency: 'USD' });
    expect((await call('is', 'DELETE', `/api/records/leads/${lead.id}`)).statusCode).toBe(403);
    expect((await call('sa', 'DELETE', `/api/records/leads/${lead.id}`)).statusCode).toBe(204);
    expect(twenty.db.leads.find((x: any) => x.id === lead.id)).toBeUndefined();
  });
});
