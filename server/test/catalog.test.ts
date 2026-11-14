import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { setup, PW } from './portal-helpers.js';

const photo = () => sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 32, g: 120, b: 180 } } }).jpeg().toBuffer();

async function setupCatalog() {
  const env = await setup();
  const created = await env.call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any, headers: Record<string, string> = {}) =>
    env.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}`, ...headers } });
  return { ...env, mt, mtTok };
}

describe('catalog homepage flag', () => {
  it('stays off with no products, and only turns on when enabled and a product is published', async () => {
    const { app, call, mt } = await setupCatalog();
    const off = (await app.inject({ method: 'GET', url: '/api/public/catalog/status' })).json();
    expect(off).toMatchObject({ homepageEnabled: false, hasPublished: false, showMarketplace: false });
    expect((await call('ia', 'PATCH', '/api/catalog/settings', { homepageEnabled: true })).statusCode).toBe(403);
    const on = await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });
    expect(on.statusCode).toBe(200);
    expect(on.json().data.showMarketplace).toBe(false);
    const created = await mt('POST', '/api/products', { title: 'Draft widget', summary: 'Not live' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.status).toBe('DRAFT');
    expect((await mt('POST', `/api/products/${created.json().data.id}/publish`)).statusCode).toBe(403);
    expect((await call('is', 'POST', `/api/products/${created.json().data.id}/publish`)).statusCode).toBe(403);
    await call('ia', 'PATCH', `/api/products/${created.json().data.id}`, { priceMode: 'GET_QUOTE' });
    expect((await call('ia', 'POST', `/api/products/${created.json().data.id}/publish`)).statusCode).toBe(200);
    const live = (await app.inject({ method: 'GET', url: '/api/public/catalog/status' })).json();
    expect(live).toMatchObject({ homepageEnabled: true, hasPublished: true, showMarketplace: true });
  });
});

describe('sample seed is opt-in and reversible', () => {
  it('does not seed on boot, seeds once for super admin, and removes all samples in one action', async () => {
    const { app, call, mt } = await setupCatalog();
    const before = (await app.inject({ method: 'GET', url: '/api/public/catalog/products' })).json();
    expect(before.data).toEqual([]);
    expect((await mt('POST', '/api/catalog/samples/seed')).statusCode).toBe(403);
    expect((await call('ia', 'POST', '/api/catalog/samples/seed')).statusCode).toBe(403);
    const seed = await call('sa', 'POST', '/api/catalog/samples/seed');
    expect(seed.statusCode).toBe(201);
    expect(seed.json().data.products).toBeGreaterThanOrEqual(12);
    expect(seed.json().data.products).toBeLessThanOrEqual(20);
    expect((await call('sa', 'POST', '/api/catalog/samples/seed')).statusCode).toBe(409);
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });
    const list = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?limit=48' })).json();
    expect(list.total).toBe(seed.json().data.products);
    expect(list.data.every((p: any) => p.isSample)).toBe(true);
    expect(list.data.every((p: any) => !('supplierId' in p) && !p.supplier_id && !p.created_by)).toBe(true);
    const cats = (await app.inject({ method: 'GET', url: '/api/public/catalog/categories' })).json().data.map((c: any) => c.name);
    expect([...cats].sort((a: string, b: string) => a.localeCompare(b))).toEqual(cats);
    const banners = (await app.inject({ method: 'GET', url: '/api/public/catalog/banners' })).json();
    expect(banners.data.length).toBeGreaterThanOrEqual(3);
    const img = await app.inject({ method: 'GET', url: banners.data[0].imageUrl });
    expect(img.statusCode).toBe(200);
    expect(String(img.headers['content-type'])).toMatch(/image\//);
    const removed = await call('sa', 'POST', '/api/catalog/samples/remove');
    expect(removed.json().data.products).toBe(seed.json().data.products);
    expect((await app.inject({ method: 'GET', url: '/api/public/catalog/status' })).json().hasPublished).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/public/catalog/products' })).json().data).toEqual([]);
  });
});

describe('search, prices and enquire', () => {
  it('finds a product, converts currencies, and turns a request quote into a catalog lead', async () => {
    const { app, call } = await setupCatalog();
    await call('sa', 'POST', '/api/catalog/samples/seed');
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });
    const found = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?q=hex+bolts' })).json();
    expect(found.data.length).toBeGreaterThan(0);
    expect(found.data[0].title).toMatch(/Hex Bolts/i);
    const p = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${found.data[0].slug}` })).json().data;
    expect(p.price.amounts.USD.min).toBeCloseTo(0.08, 2);
    expect(p.price.amounts.INR.min).toBeGreaterThan(1);
    expect(p.price.amounts.CNY.min).toBeGreaterThan(0);
    const miss = await app.inject({ method: 'POST', url: `/api/public/catalog/products/${p.id}/enquire`, payload: { name: 'Ravi' } });
    expect(miss.statusCode).toBe(400);
    const enq = await app.inject({ method: 'POST', url: `/api/public/catalog/products/${p.id}/enquire`, payload: { name: 'Ravi', phone: '9000000000', phoneCode: '+91', company: 'Ravi Traders', quantity: 2000, message: 'Need a quote' } });
    expect(enq.statusCode).toBe(201);
    expect(enq.json().reference).toMatch(/^SE-\d{4}-\d{4}$/);
    const leads = (await call('ia', 'GET', '/api/records/leads')).json().data as any[];
    const lead = leads.find((l) => l.leadRef === enq.json().reference);
    expect(lead).toMatchObject({ sourceChannel: 'CATALOG', productInterest: p.title });
    expect(JSON.stringify(p)).not.toMatch(/supplier/i);
  });
});

describe('marketplace team isolation and delete', () => {
  it('can add and soft-delete products, cannot see leads, and only super admin can restore', async () => {
    const { call, mt, app } = await setupCatalog();
    expect((await mt('GET', '/api/records/leads')).statusCode).toBe(403);
    expect((await mt('GET', '/api/customers')).statusCode).toBe(403);
    expect((await mt('GET', '/api/orders')).statusCode).toBe(403);
    expect((await mt('GET', '/api/shipping-requests')).statusCode).toBe(403);
    const created = await mt('POST', '/api/products', { title: 'Cotton Apron', summary: 'Staff upload', moq: 200, unit: 'pcs' });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    const buf = await photo();
    const B = '----img' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="apron.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${B}--\r\n`),
    ]);
    const up = await mt('POST', `/api/products/${id}/images`, payload, { 'content-type': `multipart/form-data; boundary=${B}` });
    expect(up.statusCode).toBe(201);

    // Prices are India-only; China and Marketplace Team responses omit selling prices.
    await call('ia', 'PATCH', `/api/products/${id}`, { priceMode: 'RANGE', priceMin: 2, priceMax: 3, baseCurrency: 'USD' });
    const china = (await call('cs', 'GET', `/api/products/${id}`)).json().data;
    expect(china.price.amounts).toBeNull();
    expect(china.priceMin).toBeUndefined();
    const team = (await mt('GET', `/api/products/${id}`)).json().data;
    expect(team.price.amounts.USD.min).toBe(2);

    expect((await mt('POST', `/api/products/${id}/delete`, {})).statusCode).toBe(400);
    const del = await mt('POST', `/api/products/${id}/delete`, { confirm: true });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.status).toBe('DELETED');
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}` })).statusCode).toBe(404);
    expect((await mt('POST', `/api/products/${id}/restore`)).statusCode).toBe(403);
    expect((await call('ia', 'POST', `/api/products/${id}/restore`)).statusCode).toBe(403);
    const restored = await call('sa', 'POST', `/api/products/${id}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.status).toBe('UNPUBLISHED');
    const audit = (await mt('GET', `/api/products/${id}/audit`)).json().data as any[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'DELETE', 'RESTORE']));
  });
});
