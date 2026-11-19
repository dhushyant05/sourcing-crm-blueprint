import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { setup, PW, SUP, form } from './portal-helpers.js';

const png = (w: number, h: number, r: number, g: number, b: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function upload(as: any, token: string, url: string, name: string, data: Buffer) {
  const f = form({}, [{ name, data, type: 'image/png' }]);
  const r = await as(token, 'POST', url, f.payload, f.headers);
  expect(r.statusCode, r.body).toBe(201);
  return r.json().data;
}

describe('quote carton dimensions and per-quote photos', () => {
  it('saves carton maths, lets China reorder/cover photos, shows packing to India without supplier leaks, and copies them onto an unedited sourced draft', async () => {
    const { app, call, as, tok } = await setup();
    const createdMt = await call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
    expect(createdMt.statusCode).toBe(201);
    const mtTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
    const mt = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });

    const lead = (await call('is', 'POST', '/api/records/leads', {
      name: 'TEST carton flask', clientName: 'Secret Customer Ltd', contactName: 'Priya Secret',
      productInterest: 'TEST QA carton flask', quantity: 100, unit: 'pcs', summary: 'TEST packing quote.',
    })).json().data;
    expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);

    expect((await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
      product: 'TEST QA carton flask', unitPrice: 3.5, currency: 'USD', moq: '100 pcs', cartonLengthCm: 0,
    })).statusCode).toBe(400);

    const created = await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
      newSupplier: SUP, product: 'TEST QA carton flask', unitPrice: 3.5, currency: 'USD', moq: '100 pcs', leadTime: '15 days',
      cartonLengthCm: 50, cartonWidthCm: 40, cartonHeightCm: 30, cartonUnits: 20, cartonGrossKg: 12.5, cartonNetKg: 11,
    });
    expect(created.statusCode, created.body).toBe(201);
    const q = created.json().data;
    expect(q.packing).toMatchObject({
      lengthCm: 50, widthCm: 40, heightCm: 30, unitsPerCarton: 20, grossKg: 12.5, netKg: 11,
      cbmPerCarton: 0.06, cartonCount: 5, totalCbm: 0.3, totalGrossKg: 62.5, totalNetKg: 55,
    });
    expect(q.supplier.name).toBe(SUP.name);

    const red = await png(32, 32, 200, 20, 20);
    const green = await png(32, 32, 20, 200, 20);
    let view = await upload(as, tok.cs, `/api/quotes/${q.id}/files`, 'Ningbo-Secret-red.png', red);
    view = await upload(as, tok.cs, `/api/quotes/${q.id}/files`, 'Ningbo-Secret-green.png', green);
    expect(view.files).toHaveLength(2);
    expect(view.files[0].isCover).toBe(true);
    expect(view.files[0].name).toMatch(/Secret-red/);
    const [first, second] = view.files;

    const reordered = await call('cs', 'PATCH', `/api/quotes/${q.id}/files`, { order: [second.id, first.id], cover: second.id });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const ordered = reordered.json().data.files;
    expect(ordered.map((f: any) => f.id)).toEqual([second.id, first.id]);
    expect(ordered[0].isCover).toBe(true);
    expect(ordered[1].isCover).toBe(false);

    expect((await call('is', 'PATCH', `/api/quotes/${q.id}/files`, { cover: first.id })).statusCode).toBe(403);

    const india = (await call('is', 'GET', `/api/leads/${lead.id}/quotes`)).json().data[0];
    expect(india.packing).toMatchObject({ cbmPerCarton: 0.06, cartonCount: 5, totalCbm: 0.3, totalGrossKg: 62.5 });
    expect(india.supplier).toBeUndefined();
    expect(india.supplierId).toBeUndefined();
    const txt = JSON.stringify(india);
    for (const secret of ['Ningbo Secret', 'Mr Wang', 'wx_secret', '+86', 'Secret-red', 'Secret-green']) expect(txt).not.toContain(secret);
    expect(india.files[0].name).toMatch(/^SE-\d{4}-\d{4}-Q1-1\.png$/);
    expect(india.files[0].isCover).toBe(true);

    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const list = (await mt('GET', '/api/products?fromSourcing=1')).json().data as any[];
    const draft = list.find((p) => p.sourceQuoteId === q.id);
    expect(draft).toBeTruthy();
    const staff = (await mt('GET', `/api/products/${draft.id}`)).json().data;
    expect(staff.merchandising.packing).toMatchObject({
      cartonLengthCm: 50, cartonWidthCm: 40, cartonHeightCm: 30, unitsPerCarton: 20,
      grossWeightKg: 12.5, netWeightKg: 11, cbmPerCarton: 0.06, cartonCount: 5, totalCbm: 0.3, totalGrossKg: 62.5, showPublic: true,
    });
    expect(staff.images.length).toBeGreaterThanOrEqual(2);
    expect(staff.images[0].isCover ?? staff.images[0].cover).toBeTruthy();

    // Default: packing is public. Turning the flag off hides dims and weight on the public page.
    expect((await mt('POST', `/api/products/${draft.id}/publish`)).statusCode).toBe(200);
    const pubOn = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${staff.slug}` })).json().data;
    expect(pubOn.merchandising.packing.cbmPerCarton).toBe(0.06);
    expect(pubOn.merchandising.packing.grossWeightKg).toBe(12.5);
    expect(JSON.stringify(pubOn)).not.toMatch(/Secret Customer|Priya Secret|Ningbo Secret|factory cost|4\.2|3\.5/i);
    expect(pubOn.referenceCost).toBeFalsy();

    const hidden = await mt('PATCH', `/api/products/${draft.id}`, {
      merchandising: { ...staff.merchandising, packing: { ...staff.merchandising.packing, showPublic: false } },
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    const pubOff = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${staff.slug}` })).json().data;
    expect(pubOff.merchandising.packing).toBeNull();

    // Team-edited drafts keep their packing when the quote is later changed.
    expect((await call('cs', 'PATCH', `/api/quotes/${q.id}`, { cartonLengthCm: 60, cartonWidthCm: 40, cartonHeightCm: 30, cartonUnits: 20, cartonGrossKg: 12.5, cartonNetKg: 11 })).statusCode).toBe(200);
    const after = (await mt('GET', `/api/products/${draft.id}`)).json().data;
    expect(after.merchandising.packing.cartonLengthCm).toBe(50);
    expect(after.sourceUpdatePending).toBe(true);
  });
});
