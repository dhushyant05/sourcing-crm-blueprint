import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { setup, PW, form, pngOf } from './portal-helpers.js';
import { photoGroups, DEFAULT_TRUST, DEFAULT_PROMO } from '../src/catalog.js';

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
    expect(off.trust).toEqual(DEFAULT_TRUST);
    expect(off.promo).toEqual(DEFAULT_PROMO);
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
    const first = list.data[0];
    expect(first.images.length).toBe(4);
    expect(new Set(first.images.map((i: any) => i.id)).size).toBe(4);
    expect(first.images.every((i: any) => i.url && i.cardUrl)).toBe(true);
    const detail = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${first.slug}` })).json().data;
    expect(detail.images.length).toBe(4);
    expect(detail.publishedAt).toBeTruthy();
    const banners = (await app.inject({ method: 'GET', url: '/api/public/catalog/banners' })).json();
    expect(banners.data.length).toBeGreaterThanOrEqual(3);
    const img = await app.inject({ method: 'GET', url: banners.data[0].imageUrl });
    expect(img.statusCode).toBe(200);
    expect(String(img.headers['content-type'])).toMatch(/image\//);
    const removed = await call('sa', 'POST', '/api/catalog/samples/remove');
    expect(removed.json().data.products).toBe(seed.json().data.products);
    expect((await app.inject({ method: 'GET', url: '/api/public/catalog/status' })).json().hasPublished).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/public/catalog/products' })).json().data).toEqual([]);
  }, 180_000);
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
    expect(p.images.length).toBe(4);
  }, 180_000);
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
    expect(up.json().data).toHaveLength(1);
    expect(up.json().data[0].cardUrl).toBeTruthy();

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

describe('photo groups, cover and reorder', () => {
  it('groups original/card/gallery as one photo and supports cover, reorder and group delete', async () => {
    expect(photoGroups([
      { fileId: 'o1', kind: 'ORIGINAL', groupId: 'g1', sort: 0, isCover: true },
      { fileId: 'c1', kind: 'CARD', groupId: 'g1', sort: 0 },
      { fileId: 'g1f', kind: 'GALLERY', groupId: 'g1', sort: 0 },
      { fileId: 'o2', kind: 'ORIGINAL', groupId: 'g2', sort: 1 },
      { fileId: 'c2', kind: 'CARD', groupId: 'g2', sort: 1 },
    ])).toHaveLength(2);

    const { mt, app, call } = await setupCatalog();
    const created = await mt('POST', '/api/products', { title: 'Multi photo tray', summary: 'Gallery test', moq: 100, unit: 'pcs' });
    const id = created.json().data.id;
    const upload = async () => {
      const buf = await photo();
      const B = '----img' + Math.random().toString(16).slice(2);
      const payload = Buffer.concat([
        Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="shot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        buf,
        Buffer.from(`\r\n--${B}--\r\n`),
      ]);
      return mt('POST', `/api/products/${id}/images`, payload, { 'content-type': `multipart/form-data; boundary=${B}` });
    };
    expect((await upload()).statusCode).toBe(201);
    expect((await upload()).statusCode).toBe(201);
    expect((await upload()).statusCode).toBe(201);
    let imgs = (await mt('GET', `/api/products/${id}`)).json().data.images;
    expect(imgs).toHaveLength(3);
    const ids = imgs.map((i: any) => i.id);
    const re = await mt('PATCH', `/api/products/${id}/images`, { order: [ids[2], ids[0], ids[1]], cover: ids[2] });
    expect(re.statusCode).toBe(200);
    expect(re.json().data[0].id).toBe(ids[2]);
    expect(re.json().data[0].cover).toBe(true);
    const del = await mt('DELETE', `/api/products/${id}/images/${ids[0]}`);
    expect(del.statusCode).toBe(200);
    imgs = (await mt('GET', `/api/products/${id}`)).json().data.images;
    expect(imgs).toHaveLength(2);
    expect(imgs.find((i: any) => i.id === ids[0])).toBeUndefined();

    await call('ia', 'PATCH', `/api/products/${id}`, { priceMode: 'GET_QUOTE' });
    await call('ia', 'POST', `/api/products/${id}/publish`);
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });
    const pub = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}` })).json().data;
    expect(pub.images).toHaveLength(2);
    expect(pub.images[0].cover).toBe(true);
  });
});

describe('festival greetings stay off the product banner', () => {
  it('delivers live greetings only on /api/public/greetings, never as catalog banner slides', async () => {
    const { app, call, tok } = await setupCatalog();
    const f = form({}, [{ name: 'diwali.png', data: pngOf(1200, 600), type: 'image/png' }]);
    const up = await app.inject({ method: 'POST', url: '/api/greetings/upload', payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${tok.sa}` } });
    expect(up.statusCode).toBe(201);
    const id = up.json().data.id;
    expect((await call('sa', 'POST', `/api/greetings/${id}/publish`)).statusCode).toBe(200);
    const live = (await app.inject({ method: 'GET', url: '/api/public/greetings' })).json().data as any[];
    expect(live.some((g) => g.id === id)).toBe(true);
    const banners = (await app.inject({ method: 'GET', url: '/api/public/catalog/banners' })).json().data as any[];
    expect(banners.every((b) => b.source === 'banner' && !String(b.id).startsWith('gr-'))).toBe(true);
    expect(banners.some((b) => b.id === id || b.id === `gr-${id}`)).toBe(false);
  });
});
