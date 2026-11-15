import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.js';

async function mtClient(e: Awaited<ReturnType<typeof setup>>) {
  const created = await e.call('sa', 'POST', '/api/users', { email: 'mt-cat@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await e.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt-cat@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any) =>
    e.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });
  return mt;
}

describe('category removal', () => {
  it('blocks hard delete while products use the category, offers reassign, deactivates, then deletes when empty', async () => {
    const e = await setup();
    const mt = await mtClient(e);

    const root = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Removal Root' })).json().data;
    const sub = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Removal Sub', parentId: root.id })).json().data;
    const extra = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Removal Extra' })).json().data;
    const dest = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Removal Dest' })).json().data;

    const product = (await mt('POST', '/api/products', {
      title: 'TEST QA removal bottle',
      categoryId: sub.id,
      extraCategoryIds: [extra.id],
    })).json().data;
    await mt('POST', `/api/products/${product.id}/publish`);

    const india = await e.call('is', 'DELETE', `/api/catalog/categories/${sub.id}`);
    expect(india.statusCode).toBe(403);

    const blockedRoot = await mt('DELETE', `/api/catalog/categories/${root.id}`);
    expect(blockedRoot.statusCode).toBe(409);
    expect(blockedRoot.json().code).toBe('not_empty');
    expect(blockedRoot.json().usage.children).toBe(1);

    const usageSub = (await mt('GET', `/api/catalog/categories/${sub.id}/usage`)).json().data;
    expect(usageSub.primaryProducts).toBe(1);
    expect(usageSub.empty).toBe(false);

    const blockedSub = await mt('DELETE', `/api/catalog/categories/${sub.id}`);
    expect(blockedSub.statusCode).toBe(409);
    expect(blockedSub.json().usage.primaryProducts).toBe(1);

    const moved = await mt('POST', `/api/catalog/categories/${sub.id}/reassign`, { categoryId: dest.id });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().moved).toBe(1);
    const afterMove = (await e.app.inject({ method: 'GET', url: `/api/products/${product.id}`, headers: { authorization: `Bearer ${e.tok.sa}` } })).json().data;
    expect(afterMove.categoryId).toBe(dest.id);

    const emptySub = (await mt('GET', `/api/catalog/categories/${sub.id}/usage`)).json().data;
    expect(emptySub.empty).toBe(true);
    const delSub = await mt('DELETE', `/api/catalog/categories/${sub.id}`);
    expect(delSub.statusCode).toBe(200);
    expect((await mt('GET', `/api/catalog/categories/${sub.id}/usage`)).statusCode).toBe(404);

    const usageExtra = (await mt('GET', `/api/catalog/categories/${extra.id}/usage`)).json().data;
    expect(usageExtra.extraProducts).toBe(1);
    const blockedExtra = await mt('DELETE', `/api/catalog/categories/${extra.id}`);
    expect(blockedExtra.statusCode).toBe(409);

    const cleared = await mt('POST', `/api/catalog/categories/${extra.id}/clear-extras`);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().cleared).toBe(1);
    const afterClear = (await e.app.inject({ method: 'GET', url: `/api/products/${product.id}`, headers: { authorization: `Bearer ${e.tok.sa}` } })).json().data;
    expect((afterClear.extraCategories ?? []).map((c: { id: string }) => c.id)).not.toContain(extra.id);

    const delExtra = await mt('DELETE', `/api/catalog/categories/${extra.id}`);
    expect(delExtra.statusCode).toBe(200);

    const deact = await mt('PATCH', `/api/catalog/categories/${root.id}`, { active: false });
    expect(deact.statusCode).toBe(200);
    expect(deact.json().data.active).toBe(false);
    const publicCats = (await e.app.inject({ method: 'GET', url: '/api/public/catalog/categories' })).json().data as { id: string }[];
    expect(publicCats.some((c) => c.id === root.id)).toBe(false);
    const hiddenListing = (await e.app.inject({ method: 'GET', url: `/api/public/catalog/products?category=${root.slug}` })).json();
    expect(hiddenListing.total ?? hiddenListing.data?.length ?? 0).toBe(0);

    // breadcrumb on the product still works after the primary was moved to dest (active)
    const pub = (await e.app.inject({ method: 'GET', url: `/api/public/catalog/products/${product.slug}` })).json().data;
    expect(pub.category?.id ?? pub.categoryId ?? pub.breadcrumb?.at?.(-1)?.id).toBeTruthy();

    const delRoot = await mt('DELETE', `/api/catalog/categories/${root.id}`);
    expect(delRoot.statusCode).toBe(200);

    const audit = await e.db.all('SELECT action FROM category_audit WHERE category_id = ? ORDER BY id', extra.id) as { action: string }[];
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['REMOVE_EXTRAS', 'DELETE']));
    const reassignAudit = await e.db.all('SELECT action FROM category_audit WHERE category_id = ?', sub.id) as { action: string }[];
    expect(reassignAudit.map((r) => r.action)).toEqual(expect.arrayContaining(['REASSIGN', 'DELETE']));
  });

  it('includes extra categories on the product list so the editor can remove them', async () => {
    const e = await setup();
    const mt = await mtClient(e);
    const main = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA List Main' })).json().data;
    const also = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA List Also' })).json().data;
    const product = (await mt('POST', '/api/products', {
      title: 'TEST QA list-extras mug',
      categoryId: main.id,
      extraCategoryIds: [also.id],
    })).json().data;
    const list = await mt('GET', '/api/products?q=TEST QA list-extras mug');
    expect(list.statusCode).toBe(200);
    const row = (list.json().data as any[]).find((x) => x.id === product.id);
    expect(row).toBeTruthy();
    expect((row.extraCategories as { id: string }[]).map((c) => c.id)).toEqual([also.id]);
  });

  it('audits removing an extra category from a product and lets Marketplace Team do it', async () => {
    const e = await setup();
    const mt = await mtClient(e);
    const main = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Extra Main' })).json().data;
    const also = (await mt('POST', '/api/catalog/categories', { name: 'TEST QA Extra Also' })).json().data;
    const product = (await mt('POST', '/api/products', {
      title: 'TEST QA extra-remove mug',
      categoryId: main.id,
      extraCategoryIds: [also.id],
    })).json().data;
    expect((product.extraCategories as { id: string }[]).map((c) => c.id)).toEqual([also.id]);

    const patched = await mt('PATCH', `/api/products/${product.id}`, { extraCategoryIds: [] });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.extraCategories).toEqual([]);

    const trail = await e.db.all(
      "SELECT action, before, after FROM product_audit WHERE product_id = ? AND action = 'CATEGORIES' ORDER BY id DESC",
      product.id,
    ) as { action: string; before: any; after: any }[];
    expect(trail.length).toBeGreaterThan(0);
    const row = trail[0];
    const after = typeof row.after === 'string' ? JSON.parse(row.after) : row.after;
    expect(after.removed).toEqual([also.id]);
  });
});
