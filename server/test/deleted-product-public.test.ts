import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.js';

async function setupCatalog() {
  const env = await setup();
  const created = await env.call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any, headers: Record<string, string> = {}) =>
    env.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}`, ...headers } });
  return { ...env, mt, mtTok };
}

function ids(body: any): string[] {
  return (body.data ?? []).map((p: any) => p.id);
}

describe('deleted and unpublished products stay off the public catalog immediately', () => {
  it('removes a published product from lists, related, sitemap and /p/:slug with no-store 404s', async () => {
    const { app, mt } = await setupCatalog();
    const cat = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Stay Public' })).json().data;
    const keep = await mt('POST', '/api/products', { title: 'Keep live widget', summary: 'Stays published', categoryId: cat.id, moq: 10 });
    const gone = await mt('POST', '/api/products', { title: 'Soon deleted widget', summary: 'Will be deleted', categoryId: cat.id, moq: 10 });
    expect(keep.statusCode).toBe(201);
    expect(gone.statusCode).toBe(201);
    const keepId = keep.json().data.id;
    const goneId = gone.json().data.id;
    const goneSlug = gone.json().data.slug;
    const keepSlug = keep.json().data.slug;
    expect((await mt('POST', `/api/products/${keepId}/publish`, {})).statusCode).toBe(200);
    expect((await mt('POST', `/api/products/${goneId}/publish`, {})).statusCode).toBe(200);

    const liveList = await app.inject({ method: 'GET', url: '/api/public/catalog/products?limit=48' });
    expect(liveList.statusCode).toBe(200);
    expect(String(liveList.headers['cache-control'])).toMatch(/no-store/);
    expect(ids(liveList.json()).sort()).toEqual([goneId, keepId].sort());

    const livePage = await app.inject({ method: 'GET', url: `/p/${goneSlug}` });
    expect(livePage.statusCode).toBe(200);
    expect(String(livePage.headers['cache-control'])).toMatch(/no-cache/);
    expect(livePage.body).toContain('Soon deleted widget');

    const sitemapLive = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sitemapLive.statusCode).toBe(200);
    expect(String(sitemapLive.headers['cache-control'])).toMatch(/no-cache/);
    expect(sitemapLive.body).toContain(`/p/${goneSlug}`);

    const unpub = await mt('POST', `/api/products/${goneId}/unpublish`, {});
    expect(unpub.statusCode).toBe(200);
    const unpublished = await app.inject({ method: 'GET', url: `/api/public/catalog/products/${goneSlug}` });
    expect(unpublished.statusCode).toBe(404);
    expect(String(unpublished.headers['cache-control'])).toMatch(/no-store/);
    expect(unpublished.json().error).toMatch(/no longer available/i);
    expect(ids((await app.inject({ method: 'GET', url: '/api/public/catalog/products?limit=48' })).json())).toEqual([keepId]);
    expect((await app.inject({ method: 'GET', url: `/p/${goneSlug}` })).statusCode).toBe(404);

    expect((await mt('POST', `/api/products/${goneId}/publish`, {})).statusCode).toBe(200);
    expect((await mt('POST', `/api/products/${goneId}/delete`, { confirm: true })).statusCode).toBe(200);

    const api = await app.inject({ method: 'GET', url: `/api/public/catalog/products/${goneSlug}` });
    expect(api.statusCode).toBe(404);
    expect(String(api.headers['cache-control'])).toMatch(/no-store/);
    expect(api.json().error).toMatch(/no longer available/i);

    const page = await app.inject({ method: 'GET', url: `/p/${goneSlug}` });
    expect(page.statusCode).toBe(404);
    expect(String(page.headers['cache-control'])).toMatch(/no-store/);
    expect(page.body).toContain('This product is no longer available');
    expect(page.body).toContain('noindex');
    expect(page.body).not.toContain('Soon deleted widget — Source Easy');

    for (const path of [
      '/api/public/catalog/products?limit=48',
      '/api/public/catalog/products?sort=newest&limit=48',
      '/api/public/catalog/products?sort=trending&limit=48',
      `/api/public/catalog/products?category=${cat.slug}`,
    ]) {
      const r = await app.inject({ method: 'GET', url: path });
      expect(r.statusCode).toBe(200);
      expect(ids(r.json())).not.toContain(goneId);
      expect(ids(r.json())).toContain(keepId);
    }
    expect(ids((await app.inject({ method: 'GET', url: '/api/public/catalog/products?clearance=1&limit=48' })).json())).toEqual([]);
    expect(ids((await app.inject({ method: 'GET', url: '/api/public/catalog/products?q=Soon+deleted&limit=48' })).json())).toEqual([]);

    const related = await app.inject({ method: 'GET', url: `/api/public/catalog/products/${keepSlug}/related` });
    expect(related.statusCode).toBe(200);
    expect(String(related.headers['cache-control'])).toMatch(/no-store/);
    expect(ids(related.json())).not.toContain(goneId);

    const goneRelated = await app.inject({ method: 'GET', url: `/api/public/catalog/products/${goneSlug}/related` });
    expect(goneRelated.statusCode).toBe(404);
    expect(String(goneRelated.headers['cache-control'])).toMatch(/no-store/);

    const sitemap = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sitemap.body).not.toContain(`/p/${goneSlug}`);
    expect(sitemap.body).toContain(`/p/${keepSlug}`);
  });

  it('hides deactivated categories from public lists and /c/:slug', async () => {
    const { app, mt } = await setupCatalog();
    const cat = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Hidden Cat' })).json().data;
    expect((await mt('PATCH', `/api/catalog/categories/${cat.id}`, { active: false })).statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/public/catalog/categories' });
    expect(list.statusCode).toBe(200);
    expect(String(list.headers['cache-control'])).toMatch(/no-store/);
    expect((list.json().data ?? []).some((c: any) => c.id === cat.id)).toBe(false);
    const page = await app.inject({ method: 'GET', url: `/c/${cat.slug}` });
    expect(page.statusCode).toBe(404);
    expect(String(page.headers['cache-control'])).toMatch(/no-store/);
    expect(page.body).toContain('This category is no longer available');
    const sitemap = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sitemap.body).not.toContain(`/c/${cat.slug}`);
  });
});
