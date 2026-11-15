import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.js';

describe('inline categories and extra category links', () => {
  it('lets Marketplace Team add a subcategory, blocks suppliers from creating, and lists a product in extra categories', async () => {
    const e = await setup();
    const created = await e.call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
    if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
    const mtTok = (await e.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
    const mt = (method: any, url: string, payload?: any) =>
      e.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });

    const home = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Home' })).json().data;
    const drink = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Drinkware', parentId: home.id })).json().data;
    const again = await mt('POST', '/api/catalog/categories', { name: 'TEST QA Drinkware', parentId: home.id });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.id).toBe(drink.id);

    const sub = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Steel Cups', parentId: drink.id })).json().data;
    expect(sub.slug).toMatch(/test-qa-steel-cups/);
    expect(sub.parentId).toBe(drink.id);

    const india = await e.call('is', 'POST', '/api/catalog/categories', { name: 'Should not work' });
    expect(india.statusCode).toBe(403);

    const product = await mt('POST', '/api/products', {
      title: 'TEST QA multi-category bottle',
      categoryId: sub.id,
      extraCategoryIds: [drink.id, home.id],
    });
    expect(product.statusCode).toBe(201);
    expect(product.json().data.categoryId).toBe(sub.id);
    expect((product.json().data.extraCategories as any[]).map((c) => c.id).sort()).toEqual([drink.id, home.id].sort());

    await mt('POST', `/api/products/${product.json().data.id}/publish`);
    const inHome = (await e.app.inject({ method: 'GET', url: `/api/public/catalog/products?category=${home.slug}` })).json().data as any[];
    expect(inHome.some((p) => p.id === product.json().data.id || p.slug === product.json().data.slug)).toBe(true);
    const inDrink = (await e.app.inject({ method: 'GET', url: `/api/public/catalog/products?category=${drink.slug}` })).json().data as any[];
    expect(inDrink.some((p) => p.slug === product.json().data.slug)).toBe(true);
  });
});
