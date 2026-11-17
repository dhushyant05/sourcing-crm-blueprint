import { describe, expect, it } from 'vitest';
import { setup, PW, SUP } from './portal-helpers.js';

describe('staff product list pagination and sourced-draft publish', () => {
  it('pages every status including published products, hides discarded drafts, and publishes a sourced draft after any one selling price', async () => {
    const { app, call } = await setup();
    const createdMt = await call('sa', 'POST', '/api/users', { email: 'mt-page@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
    expect(createdMt.statusCode).toBe(201);
    const mtTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt-page@x.in', password: PW } })).json().token;
    const mt = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });

    const publishedIds: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const created = await mt('POST', '/api/products', { title: `LIVE MARKET item ${i}`, priceMode: 'RANGE', priceUsd: 10 + i });
      expect(created.statusCode).toBe(201);
      expect((await mt('POST', `/api/products/${created.json().data.id}/publish`)).statusCode).toBe(200);
      publishedIds.push(created.json().data.id);
    }
    for (let i = 1; i <= 30; i += 1) {
      const created = await mt('POST', '/api/products', { title: `Staff draft ${i}` });
      expect(created.statusCode).toBe(201);
    }

    const lead = (await call('is', 'POST', '/api/records/leads', {
      name: 'TEST QA publish pagination', clientName: 'Secret Customer Ltd', contactName: 'Priya Secret',
      productInterest: 'tumbler', quantity: 100, unit: 'pcs',
    })).json().data;
    expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
      newSupplier: { ...SUP, name: 'TEST QA Factory' }, product: 'TEST QA pagination tumbler',
      unitPrice: 4.2, currency: 'USD', moq: '100 pcs', leadTime: '10 days', notes: 'Factory only.',
    })).json().data;
    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const sourced = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q.id);
    expect(sourced).toBeTruthy();
    expect(sourced.status).toBe('UNPUBLISHED');

    const otherLead = (await call('is', 'POST', '/api/records/leads', {
      name: 'TEST QA discarded', clientName: 'Secret Customer Ltd', productInterest: 'cup', quantity: 10, unit: 'pcs',
    })).json().data;
    expect((await call('is', 'POST', `/api/leads/${otherLead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
    const q2 = (await call('cs', 'POST', `/api/leads/${otherLead.id}/quotes`, {
      newSupplier: { ...SUP, name: 'TEST QA Factory 2' }, product: 'TEST QA discarded cup',
      unitPrice: 1, currency: 'USD', moq: '10 pcs',
    })).json().data;
    expect((await call('cs', 'PATCH', `/api/records/leads/${otherLead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const discarded = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q2.id);
    expect((await mt('POST', `/api/products/${discarded.id}/discard-source`, {})).statusCode).toBe(200);

    const page1 = await mt('GET', '/api/products?limit=25&page=1');
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.data).toHaveLength(25);
    expect(p1.total).toBe(34);
    expect(p1.page).toBe(1);
    expect(p1.pageCount).toBeGreaterThanOrEqual(2);
    expect(p1.data.some((x: any) => publishedIds.includes(x.id))).toBe(false);
    expect(p1.data.some((x: any) => x.id === discarded.id)).toBe(false);

    const page2 = (await mt('GET', '/api/products?limit=25&page=2')).json();
    expect(page2.page).toBe(2);
    expect(page2.data.some((x: any) => publishedIds.includes(x.id))).toBe(true);
    expect(page2.data.some((x: any) => x.status === 'PUBLISHED')).toBe(true);
    expect(page2.data.some((x: any) => x.id === discarded.id)).toBe(false);

    const allPublished = (await mt('GET', '/api/products?status=PUBLISHED&limit=25')).json();
    expect(allPublished.data.every((x: any) => x.status === 'PUBLISHED')).toBe(true);
    expect(publishedIds.every((id) => allPublished.data.some((x: any) => x.id === id))).toBe(true);

    const search = (await mt('GET', `/api/products?q=${encodeURIComponent('LIVE MARKET item 2')}&limit=25`)).json();
    expect(search.total).toBe(1);
    expect(search.data[0].title).toBe('LIVE MARKET item 2');

    const discardedList = (await mt('GET', '/api/products?discarded=1')).json();
    expect(discardedList.data.some((x: any) => x.id === discarded.id)).toBe(true);
    expect((await mt('GET', '/api/products?fromSourcing=1')).json().data.some((x: any) => x.id === discarded.id)).toBe(false);

    // Default sourced drafts are Get quote and can be published with no selling price.
    expect(sourced.priceMode ?? sourced.price?.mode).toBe('GET_QUOTE');
    expect(sourced.publishBlockers ?? []).toEqual([]);
    const asQuote = await mt('POST', `/api/products/${sourced.id}/publish`, {});
    expect(asQuote.statusCode).toBe(200);
    const liveQuote = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${sourced.slug}` })).json().data;
    expect(liveQuote.price.mode).toBe('GET_QUOTE');
    expect(liveQuote.price.amounts).toBeNull();
    expect(JSON.stringify(liveQuote)).not.toMatch(/4\.2|referenceCost|sourceLead|Secret Customer|Priya Secret/i);
    expect((await mt('POST', `/api/products/${sourced.id}/unpublish`, {})).statusCode).toBe(200);

    // Fixed-price mode still needs one currency.
    const ranged = await mt('PATCH', `/api/products/${sourced.id}`, { priceMode: 'RANGE' });
    expect(ranged.statusCode).toBe(200);
    const blocked = await mt('POST', `/api/products/${sourced.id}/publish`, {});
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/selling price/i);
    expect(blocked.json().error).toMatch(/one currency/i);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${sourced.slug}` })).statusCode).toBe(404);

    const priced = await mt('PATCH', `/api/products/${sourced.id}`, { priceCny: 28 });
    expect(priced.statusCode).toBe(200);
    expect(priced.json().data.priceCny).toBe(28);
    expect(priced.json().data.publishBlockers ?? []).toEqual([]);

    const pub = await mt('POST', `/api/products/${sourced.id}/publish`, {});
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.status).toBe('PUBLISHED');
    const live = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${sourced.slug}` })).json().data;
    expect(live.price.amounts.CNY.min).toBe(28);
    expect(JSON.stringify(live)).not.toMatch(/4\.2|referenceCost|sourceLead|Secret Customer|Priya Secret/i);
    expect(live).not.toHaveProperty('referenceCost');

    expect((await mt('POST', `/api/products/${sourced.id}/unpublish`, {})).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${sourced.slug}` })).statusCode).toBe(404);

    const onlyInr = await call('sa', 'POST', '/api/products', { title: 'TEST QA SA inr only', priceMode: 'GET_QUOTE', priceInr: 199 });
    expect(onlyInr.statusCode).toBe(201);
    const saPub = await call('sa', 'POST', `/api/products/${onlyInr.json().data.id}/publish`, {});
    expect(saPub.statusCode).toBe(200);
    expect((await call('sa', 'POST', `/api/products/${onlyInr.json().data.id}/unpublish`, {})).statusCode).toBe(200);
  });
});
