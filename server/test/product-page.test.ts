import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.js';

async function setupEnv() {
  const env = await setup();
  const created = await env.call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any, headers: Record<string, string> = {}) =>
    env.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}`, ...headers } });
  return { ...env, mt, mtTok };
}

async function tree(mt: any) {
  const home = (await mt('POST', '/api/catalog/categories', { name: 'Home & Garden' })).json().data;
  const acc = (await mt('POST', '/api/catalog/categories', { name: 'Drinkware & Accessories', parentId: home.id })).json().data;
  const drink = (await mt('POST', '/api/catalog/categories', { name: 'Drinkware', parentId: acc.id })).json().data;
  const tumblers = (await mt('POST', '/api/catalog/categories', { name: 'Stainless Steel Tumblers', parentId: drink.id })).json().data;
  return { home, acc, drink, tumblers };
}

describe('hierarchical categories and product details', () => {
  it('nests categories, shows breadcrumbs, and lists descendants when a parent is selected', async () => {
    const { app, mt, call } = await setupEnv();
    const { home, acc, drink, tumblers } = await tree(mt);
    expect(tumblers.parentId).toBe(drink.id);
    const cyc = await mt('PATCH', `/api/catalog/categories/${home.id}`, { parentId: tumblers.id });
    expect(cyc.statusCode).toBe(400);

    const created = await mt('POST', '/api/products', {
      title: '500ml steel tumbler',
      summary: 'Double-wall travel mug',
      categoryId: tumblers.id,
      moq: 200,
      unit: 'pcs',
      leadTime: '15 days',
      capacity: '50,000 pcs / month',
      packaging: '1 pc inner box, 24 pcs carton',
      customization: 'Logo and colour options',
      samplePolicy: 'Paid samples available',
      specs: [{ key: 'Material', value: 'Stainless steel' }, { key: 'Capacity', value: '500ml' }],
      priceMode: 'TIERS',
      baseCurrency: 'USD',
      tiers: [
        { minQty: 200, maxQty: 499, unitPrice: 3.2 },
        { minQty: 500, maxQty: null, unitPrice: 2.8 },
      ],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.capacity).toBe('50,000 pcs / month');
    expect(created.json().data.specs).toMatchObject({ Material: 'Stainless steel', Capacity: '500ml' });
    expect(created.json().data.tiers.length).toBe(2);
    await mt('POST', `/api/products/${created.json().data.id}/publish`);
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });

    const detail = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}` })).json().data;
    expect(detail.breadcrumbs.map((c: any) => c.name)).toEqual(['Home & Garden', 'Drinkware & Accessories', 'Drinkware', 'Stainless Steel Tumblers']);
    expect(detail.capacity).toBe('50,000 pcs / month');
    expect(detail.packaging).toMatch(/carton/);
    expect(detail.customization).toMatch(/Logo/);
    expect(detail.samplePolicy).toMatch(/Paid samples/);
    expect(detail.moq).toBe(200);
    expect(detail.tiers[1].minQty).toBe(500);
    expect(detail.supplier).toBeNull();
    expect(detail.supplierAvailable).toBe(false);

    const underHome = (await app.inject({ method: 'GET', url: `/api/public/catalog/products?category=${home.slug}` })).json();
    expect(underHome.data.some((p: any) => p.id === created.json().data.id)).toBe(true);
    const underTumbler = (await app.inject({ method: 'GET', url: `/api/public/catalog/products?category=${tumblers.slug}` })).json();
    expect(underTumbler.data).toHaveLength(1);

    const cats = (await app.inject({ method: 'GET', url: '/api/public/catalog/categories' })).json().data as any[];
    const siblings = cats.filter((c) => c.parentId === acc.id).map((c: any) => c.name);
    expect([...siblings].sort((a, b) => a.localeCompare(b))).toEqual(siblings);
    void acc;
  });
});

describe('supplier card privacy', () => {
  it('shows supplier details only to paid members of a consenting supplier, and never leaks factory identity otherwise', async () => {
    const { app, mt, call, db, customer } = await setupEnv();
    const secret = (await call('cs', 'POST', '/api/suppliers', {
      name: 'Ningbo Secret Factory', contact: 'Mr Wang', phone: '+86 13800001111', wechat: 'wx_secret', city: 'Ningbo', notes: 'factory cost is 1.10',
    })).json().data;
    const profile = await mt('PATCH', `/api/catalog/suppliers/${secret.id}`, {
      catalogConsent: true, publicRegion: 'Zhejiang, China', publicYears: 12, publicVerified: true, publicAbout: 'Catalog partner',
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().data).toMatchObject({ name: 'Ningbo Secret Factory', catalogConsent: true, publicRegion: 'Zhejiang, China', contact: 'Mr Wang', phone: '+86 13800001111', wechat: 'wx_secret', city: 'Ningbo' });

    expect((await call('is', 'GET', '/api/catalog/suppliers')).statusCode).toBe(403);
    expect((await call('ia', 'GET', '/api/catalog/suppliers')).statusCode).toBe(403);
    expect((await mt('GET', '/api/catalog/suppliers')).statusCode).toBe(200);

    const created = await mt('POST', '/api/products', {
      title: 'Gym steel bottle', categoryId: null, supplierId: secret.id, moq: 100, priceMode: 'GET_QUOTE',
    });
    expect(created.json().data.supplierId).toBe(secret.id);
    expect(created.json().data.catalogSupplier.name).toBe('Ningbo Secret Factory');
    await mt('POST', `/api/products/${created.json().data.id}/publish`);

    const india = (await call('is', 'GET', `/api/products/${created.json().data.id}`)).json().data;
    expect(india.supplierId).toBeUndefined();
    expect(india.catalogSupplier).toBeUndefined();

    const anon = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}` })).json().data;
    expect(anon.supplier).toBeNull();
    expect(anon.supplierAvailable).toBe(true);
    expect(anon).not.toHaveProperty('supplierId');
    expect(JSON.stringify(anon)).not.toMatch(/wx_secret|\+86|Mr Wang|factory cost|1\.10|supplier_id|Ningbo Secret Factory/i);

    const staffTok = (await call('sa', 'GET', '/api/me')).headers; // just to have made a call
    void staffTok;
    const asStaff = (await app.inject({
      method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}`,
      headers: { authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sa@x.in', password: PW } })).json().token}` },
    })).json().data;
    expect(asStaff.supplier).toBeNull();
    expect(asStaff.supplierAvailable).toBe(true);

    const unpaid = await customer('Meera', '9000000101', 'Meera Co');
    const unpaidView = (await app.inject({
      method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}`,
      headers: { authorization: `Bearer ${unpaid.token}` },
    })).json().data;
    expect(unpaidView.supplier).toBeNull();
    expect(unpaidView.supplierAvailable).toBe(true);

    await db.run(`INSERT INTO memberships (id, customer_id, status, starts_at) VALUES (?, ?, 'ACTIVE', now())`, randomUUID(), unpaid.customerId);
    const paidView = (await app.inject({
      method: 'GET', url: `/api/public/catalog/products/${created.json().data.slug}`,
      headers: { authorization: `Bearer ${unpaid.token}` },
    })).json().data;
    expect(paidView.supplier).toMatchObject({
      company: 'Ningbo Secret Factory', region: 'Zhejiang, China', years: 12, verified: true, about: 'Catalog partner',
    });
    expect(JSON.stringify(paidView.supplier)).not.toMatch(/wx_secret|\+86|Mr Wang|factory cost|phone|wechat|contact/i);
    expect(paidView).not.toHaveProperty('supplierId');

    // India staff cannot attach a supplier by posting supplierId.
    const blocked = await call('is', 'POST', '/api/products', { title: 'India hidden supplier', supplierId: secret.id });
    expect(blocked.statusCode).toBe(201);
    expect(blocked.json().data.supplierId).toBeUndefined();
    const raw = await db.get<{ supplier_id: string | null }>('SELECT supplier_id FROM products WHERE id = ?', blocked.json().data.id);
    expect(raw?.supplier_id).toBeNull();
  });
});


describe('merchandising fields', () => {
  it('saves variations, lead times, packing and sample price, and applies Source Easy protections on the public page', async () => {
    const { app, mt, call } = await setupEnv();
    const created = await mt('POST', '/api/products', {
      title: 'TEST merchandising tumbler',
      summary: 'Short summary',
      moq: 200,
      unit: 'pcs',
      leadTime: '15 days',
      priceMode: 'TIERS',
      baseCurrency: 'USD',
      tiers: [
        { minQty: 200, maxQty: 499, unitPrice: 3.2 },
        { minQty: 500, maxQty: null, unitPrice: 2.8 },
      ],
      merchandising: {
        variations: [
          { name: 'Colour', options: [{ label: 'Black', hex: '#111111' }, { label: 'White', hex: '#f5f5f5' }] },
          { name: 'Capacity', options: [{ label: '500ml' }, { label: '750ml' }] },
        ],
        customizations: [
          { label: 'Logo', moq: 200, note: 'Laser or print' },
          { label: 'Packaging', moq: 500, note: 'Custom carton' },
          { label: 'Graphic', moq: 300, note: 'Printed wrap' },
        ],
        samplePrice: { amount: 12.5, currency: 'USD', leadTime: '5–7 days' },
        leadTimes: [
          { minQty: 200, maxQty: 499, time: '15 days' },
          { minQty: 500, maxQty: null, time: '20 days' },
        ],
        shipping: { origin: 'Ningbo, China', estimate: '18–25 days by sea to India', note: 'TEST freight is quoted by Source Easy.' },
        industryAttributes: [{ key: 'Material', value: 'Stainless steel' }, { key: 'Capacity', value: '500ml' }],
        otherAttributes: [{ key: 'Feature', value: 'TEST LED display' }],
        packing: { sellingUnits: 'Single item', singlePackageSize: '8 × 8 × 25 cm', grossWeight: '0.35 kg', packageType: 'TEST colour box' },
        description: 'TEST description for the Source Easy QA tumbler.',
        reviewsNote: 'TEST: no buyer reviews yet.',
      },
    });
    expect(created.statusCode).toBe(201);
    const saved = created.json().data;
    expect(saved.merchandising.variations).toHaveLength(2);
    expect(saved.merchandising.variations[0].options[0]).toMatchObject({ label: 'Black', hex: '#111111' });
    expect(saved.merchandising.samplePrice).toMatchObject({ amount: 12.5, currency: 'USD', leadTime: '5–7 days' });
    expect(saved.merchandising.protections).toEqual([]);
    await mt('POST', `/api/products/${saved.id}/publish`);
    await call('sa', 'PATCH', '/api/catalog/settings', { homepageEnabled: true });

    const pub = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${saved.slug}` })).json().data;
    expect(pub.merchandising.variations[1].options.map((o: any) => o.label)).toEqual(['500ml', '750ml']);
    expect(pub.merchandising.customizations).toHaveLength(3);
    expect(pub.merchandising.leadTimes[1]).toMatchObject({ minQty: 500, maxQty: null, time: '20 days' });
    expect(pub.merchandising.packing.singlePackageSize).toMatch(/8/);
    expect(pub.merchandising.description).toMatch(/TEST description/);
    expect(pub.merchandising.protections.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(pub.merchandising.protections)).toMatch(/Source Easy quote first/);
    expect(JSON.stringify(pub)).not.toMatch(/Trade Assurance|alibaba\.com|factory cost/i);
    expect(pub.supplier).toBeNull();

    const patched = await mt('PATCH', `/api/products/${saved.id}`, {
      merchandising: { ...saved.merchandising, samplePrice: { amount: 15, currency: 'USD', leadTime: '7 days' } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.merchandising.samplePrice.amount).toBe(15);
    expect(patched.json().data.merchandising.variations).toHaveLength(2);
  });
});
