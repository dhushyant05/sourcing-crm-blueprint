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
    const badMail = await app.inject({ method: 'POST', url: '/api/public/catalog/enquire', payload: { name: 'Ravi', phone: '9000000000', phoneCode: '+91', email: 'not-an-email' } });
    expect(badMail.statusCode).toBe(400);
    const enq = await app.inject({ method: 'POST', url: `/api/public/catalog/products/${p.id}/enquire`, payload: { name: 'Ravi', phone: '9000000000', phoneCode: '+91', email: 'ravi@traders.example', company: 'Ravi Traders', quantity: 2000, message: 'Need a quote' } });
    expect(enq.statusCode).toBe(201);
    expect(enq.json().reference).toMatch(/^SE-\d{4}-\d{4}$/);
    const general = await app.inject({ method: 'POST', url: '/api/public/catalog/enquire', payload: { name: 'Meera', phone: '9000000001', phoneCode: '+91', email: 'meera@co.example', company: 'Meera Co', message: 'Need custom sourcing', requirement: 'Custom kitchen hardware' } });
    expect(general.statusCode).toBe(201);
    const viaId = await app.inject({ method: 'POST', url: '/api/public/catalog/enquire', payload: { productId: p.id, name: 'Arun', phone: '9000000002', phoneCode: '+91', email: 'arun@co.example', company: 'Arun Co', quantity: 50 } });
    expect(viaId.statusCode).toBe(201);
    const leads = (await call('ia', 'GET', '/api/records/leads')).json().data as any[];
    const lead = leads.find((l) => l.leadRef === enq.json().reference);
    expect(lead).toMatchObject({ sourceChannel: 'CATALOG', productInterest: p.title });
    const genLead = leads.find((l) => l.leadRef === general.json().reference);
    expect(genLead).toMatchObject({ sourceChannel: 'CATALOG', productInterest: 'Custom kitchen hardware' });
    const viaLead = leads.find((l) => l.leadRef === viaId.json().reference);
    expect(viaLead).toMatchObject({ sourceChannel: 'CATALOG', productInterest: p.title });
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

describe('trending, related products and favourites', () => {
  it('ranks by deduped views and enquiries, filters bots, and keeps pins first', async () => {
    const { app, call, db } = await setupCatalog();
    await call('sa', 'POST', '/api/catalog/samples/seed');
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });
    const list = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?sort=newest&limit=48' })).json().data as any[];
    const a = list.find((p) => /Tea Towels/i.test(p.title));
    const b = list.find((p) => /Mailer Boxes/i.test(p.title));
    const pinned = list.find((p) => p.pinned);
    expect(a && b && pinned && !a.pinned && !b.pinned).toBeTruthy();

    const view = (id: string, headers: Record<string, string> = {}, ip = '10.9.0.1') =>
      app.inject({ method: 'GET', url: `/api/public/catalog/products/${id}`, remoteAddress: ip, headers: { 'user-agent': 'Mozilla/5.0 TestBrowser', ...headers } });

    // Same visitor, same day: one view.
    expect((await view(a.slug, {}, '10.9.0.2')).statusCode).toBe(200);
    expect((await view(a.slug, {}, '10.9.0.2')).statusCode).toBe(200);
    // Second human visitor.
    expect((await view(a.slug, {}, '10.9.0.3')).statusCode).toBe(200);
    // Bot views are ignored.
    expect((await view(b.slug, { 'user-agent': 'Googlebot/2.1' }, '10.9.0.4')).statusCode).toBe(200);
    expect((await view(b.slug, { 'user-agent': 'facebookexternalhit/1.1' }, '10.9.0.5')).statusCode).toBe(200);

    const enq = async (id: string, phone: string, ip: string) =>
      app.inject({ method: 'POST', url: `/api/public/catalog/products/${id}/enquire`, remoteAddress: ip,
        headers: { 'user-agent': 'Mozilla/5.0 TestBrowser' },
        payload: { name: 'Ravi', phone, phoneCode: '+91', company: 'Ravi Traders', quantity: 1000 } });
    expect((await enq(b.id, '9000000101', '10.8.0.1')).statusCode).toBe(201);
    expect((await enq(b.id, '9000000101', '10.8.0.1')).statusCode).toBe(201); // same visitor, same day — one score unit

    const trend = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?sort=trending&window=7&limit=48' })).json().data as any[];
    const ids = trend.map((p: any) => p.id);
    expect(trend[0].pinned).toBe(true); // manual pins still win
    expect(trend.filter((p: any) => p.pinned).every((p: any, i: number, arr: any[]) => ids.indexOf(p.id) < ids.indexOf(b.id))).toBe(true);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id)); // enquiry (weight 10) beats two views
    const rowB = trend.find((p: any) => p.id === b.id);
    expect(rowB.enquiryCount).toBe(1);
    expect(rowB.trending).toBe(true);
    const rowA = trend.find((p: any) => p.id === a.id);
    expect(rowA.viewCount).toBe(2);
    const rowBot = trend.find((p: any) => p.id === b.id);
    expect(rowBot.viewCount).toBe(0);

    // 30-day window includes an older view of A that the 7-day window does not.
    await db.run("INSERT INTO product_views (product_id, visitor_key, day, at) VALUES (?,?, (now() - interval '20 days')::date, now() - interval '20 days') ON CONFLICT DO NOTHING", a.id, 'old-visitor');
    const t30 = (await app.inject({ method: 'GET', url: `/api/public/catalog/products?sort=trending&window=30&limit=48` })).json().data as any[];
    expect(t30.find((p: any) => p.id === a.id).viewCount).toBe(3);
    const t7 = (await app.inject({ method: 'GET', url: `/api/public/catalog/products?sort=trending&window=7&limit=48` })).json().data as any[];
    expect(t7.find((p: any) => p.id === a.id).viewCount).toBe(2);
  }, 180_000);

  it('returns related products in the same category, preferring shared tags', async () => {
    const { app, call } = await setupCatalog();
    await call('sa', 'POST', '/api/catalog/samples/seed');
    const list = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?limit=48' })).json().data as any[];
    const bolts = list.find((p) => /Hex Bolts/i.test(p.title));
    const valve = list.find((p) => /Ball Valve/i.test(p.title));
    const lamp = list.find((p) => /LED Panel/i.test(p.title));
    await call('ia', 'PATCH', `/api/products/${bolts.id}`, { tags: ['hardware', 'stainless', 'fastener'] });
    await call('ia', 'PATCH', `/api/products/${valve.id}`, { tags: ['hardware', 'stainless', 'valve'] });
    await call('ia', 'PATCH', `/api/products/${lamp.id}`, { tags: ['lighting', 'led'] });
    const rel = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${bolts.slug}/related` })).json().data as any[];
    expect(rel.find((p) => p.id === bolts.id)).toBeUndefined();
    expect(rel.some((p) => p.id === valve.id)).toBe(true);
    expect(rel.findIndex((p) => p.id === valve.id)).toBeLessThan(rel.findIndex((p) => p.id === lamp.id) === -1 ? 99 : rel.findIndex((p) => p.id === lamp.id));
    expect(rel.every((p) => p.category?.slug === 'hardware' || (p.tags || []).includes('stainless'))).toBe(true);
  }, 180_000);

  it('lets a signed-in customer save and remove favourites, and rejects guests', async () => {
    const { app, call, customer } = await setupCatalog();
    await call('sa', 'POST', '/api/catalog/samples/seed');
    const p = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?limit=1' })).json().data[0];
    expect((await app.inject({ method: 'GET', url: '/api/portal/catalog/favorites' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: `/api/portal/catalog/favorites/${p.id}` })).statusCode).toBe(401);
    const { token } = await customer('Meera', '9222222211', 'Meera Co');
    const auth = { authorization: `Bearer ${token}` };
    const saved = await app.inject({ method: 'PUT', url: `/api/portal/catalog/favorites/${p.id}`, headers: auth });
    expect(saved.statusCode).toBe(201);
    const again = await app.inject({ method: 'PUT', url: `/api/portal/catalog/favorites/${p.id}`, headers: auth });
    expect(again.statusCode).toBe(201); // idempotent
    const ids = (await app.inject({ method: 'GET', url: '/api/portal/catalog/favorites/ids', headers: auth })).json().data as string[];
    expect(ids).toContain(p.id);
    const list = (await app.inject({ method: 'GET', url: '/api/portal/catalog/favorites', headers: auth })).json().data as any[];
    expect(list[0].id).toBe(p.id);
    expect((await app.inject({ method: 'DELETE', url: `/api/portal/catalog/favorites/${p.id}`, headers: auth })).statusCode).toBe(204);
    const empty = (await app.inject({ method: 'GET', url: '/api/portal/catalog/favorites/ids', headers: auth })).json().data as string[];
    expect(empty).not.toContain(p.id);
    expect((await app.inject({ method: 'PUT', url: '/api/portal/catalog/favorites/not-a-product', headers: auth })).statusCode).toBe(404);
  }, 180_000);
});

describe('seo pages, sitemap and robots', () => {
  it('serves robots.txt, a sitemap of published products, and prerendered product meta', async () => {
    const { app, call } = await setupCatalog();
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(200);
    expect(robots.headers['content-type']).toMatch(/text\/plain/);
    expect(robots.body).toMatch(/Sitemap: https:\/\/sourceeasy.in\/sitemap.xml/);
    expect(robots.body).toMatch(/Allow: \/api\/public\//);
    expect(robots.body).toMatch(/Disallow: \/api\//);

    const emptyMap = await app.inject({ method: 'GET', url: '/sitemap.xml', headers: { host: 'sourceeasy.in', 'x-forwarded-proto': 'https' } });
    expect(emptyMap.statusCode).toBe(200);
    expect(emptyMap.body).toContain('https://sourceeasy.in/');
    expect(emptyMap.body).not.toContain('/p/');

    await call('sa', 'POST', '/api/catalog/samples/seed');
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });
    const map = await app.inject({ method: 'GET', url: '/sitemap.xml', headers: { host: 'sourceeasy.in', 'x-forwarded-proto': 'https' } });
    expect(map.statusCode).toBe(200);
    expect(map.headers['content-type']).toMatch(/xml/);
    expect(map.body).toContain('https://sourceeasy.in/p/stainless-hex-bolts-m8');
    expect(map.body).toContain('https://sourceeasy.in/c/hardware');

    const missing = await app.inject({ method: 'GET', url: '/p/does-not-exist' });
    expect(missing.statusCode).toBe(404);

    const page = await app.inject({ method: 'GET', url: '/p/stainless-hex-bolts-m8', headers: { host: 'sourceeasy.in', 'x-forwarded-proto': 'https' } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/html/);
    expect(page.body).toContain('<title>Stainless Hex Bolts M8 — Source Easy</title>');
    expect(page.body).toContain('property="og:url" content="https://sourceeasy.in/p/stainless-hex-bolts-m8"');
    expect(page.body).toContain('property="og:image"');
    expect(page.body).toContain('application/ld+json');
    expect(page.body).toContain('"@type":"Product"');
    expect(page.body).toContain('Stainless Hex Bolts M8');
    const cat = await app.inject({ method: 'GET', url: '/c/hardware', headers: { host: 'sourceeasy.in' } });
    expect(cat.statusCode).toBe(200);
    expect(cat.body).toContain('Hardware — Source Easy');
  }, 180_000);
});
