import { describe, expect, it } from 'vitest';
import { setup, PW, SUP } from './portal-helpers.js';

async function env() {
  const e = await setup();
  const created = await e.call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await e.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any, headers: Record<string, string> = {}) =>
    e.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}`, ...headers } });
  return { ...e, mt, mtTok };
}

async function pricedLead(call: any) {
  const lead = (await call('is', 'POST', '/api/records/leads', {
    name: 'L', clientName: 'Secret Customer Ltd', contactName: 'Priya Secret', productInterest: 'TEST QA sourced tumbler',
    quantity: 500, unit: 'pcs', summary: 'Double-wall steel tumbler, 500ml, for the catalog.', enquiryMessage: 'Please quote for Priya at Secret Customer Ltd',
  })).json().data;
  expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
  const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
    newSupplier: { ...SUP, name: 'Secret Factory TEST' }, product: 'TEST QA sourced tumbler 500ml',
    unitPrice: 4.2, currency: 'USD', moq: '500 pcs', leadTime: '18 days', notes: 'FOB Ningbo, plain carton.',
  })).json().data;
  return { lead, q };
}

describe('sourcing quotes become unpublished marketplace drafts', () => {
  it('creates one unpublished draft when China marks the request QUOTED, hides factory cost and the customer, and publishes only after selling prices are set unconverted', async () => {
    const { app, call, mt } = await env();
    const { lead, q } = await pricedLead(call);

    // Adding the quote while the lead is still in China does not publish a draft yet.
    expect((await mt('GET', '/api/products?fromSourcing=1')).json().data.filter((p: any) => p.sourceQuoteId === q.id)).toEqual([]);

    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);

    const list = (await mt('GET', '/api/products?fromSourcing=1')).json().data as any[];
    const draft = list.find((p) => p.sourceQuoteId === q.id);
    expect(draft).toBeTruthy();
    expect(draft.status).toBe('UNPUBLISHED');
    expect(draft.title).toBe('TEST QA sourced tumbler 500ml');
    expect(draft.summary).toMatch(/FOB Ningbo/);
    expect(draft.moq).toBe(500);
    expect(draft.leadTime).toBe('18 days');
    expect(draft.fromSourcing).toBe(true);
    expect(draft.sourceLabel).toBe('From sourcing request');
    expect(draft.sourceLeadRef).toBeTruthy();
    expect(draft.sourceHref).toContain(lead.id);
    expect(draft.referenceCost).toEqual({ amount: 4.2, currency: 'USD' });
    expect(draft.priceMode).toBe('GET_QUOTE');
    const blob = JSON.stringify(draft);
    expect(blob).not.toMatch(/Secret Customer|Priya Secret|enquiryMessage/i);
    expect(draft.supplierId ?? null).toBeNull();

    // Idempotent: quoting again does not create a second draft.
    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const again = (await mt('GET', '/api/products?fromSourcing=1')).json().data.filter((p: any) => p.sourceQuoteId === q.id);
    expect(again).toHaveLength(1);

    // Public APIs must not see the unpublished draft or the factory cost, even by slug or id.
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${draft.slug}` })).statusCode).toBe(404);
    const pubList = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?q=TEST+QA+sourced&limit=48' })).json();
    expect((pubList.data ?? []).some((p: any) => p.id === draft.id)).toBe(false);

    // Cannot publish without a selling price.
    const blocked = await mt('POST', `/api/products/${draft.id}/publish`, {});
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/selling price/i);

    // A later China price update before the team edits refreshes the reference cost.
    expect((await call('cs', 'PATCH', `/api/quotes/${q.id}`, { unitPrice: 4.8 })).statusCode).toBe(200);
    const refreshed = (await mt('GET', `/api/products/${draft.id}`)).json().data;
    expect(refreshed.referenceCost).toEqual({ amount: 4.8, currency: 'USD' });
    expect(refreshed.sourceUpdatePending).toBe(false);

    // Team sets independent USD, RMB and INR selling prices — no conversion.
    const saved = await mt('PATCH', `/api/products/${draft.id}`, {
      priceMode: 'RANGE', priceUsd: 9.5, priceCny: 68, priceInr: 790,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.price.amounts).toMatchObject({
      USD: { min: 9.5, max: 9.5 },
      CNY: { min: 68, max: 68 },
      INR: { min: 790, max: 790 },
    });
    expect(saved.json().data.sourceTeamEditedAt).toBeTruthy();

    // A later China update is flagged, not applied over the team's title/prices.
    await mt('PATCH', `/api/products/${draft.id}`, { title: 'TEST QA sourced tumbler 500ml (edited)' });
    expect((await call('cs', 'PATCH', `/api/quotes/${q.id}`, { unitPrice: 5.1, product: 'Should not overwrite title' })).statusCode).toBe(200);
    const flagged = (await mt('GET', `/api/products/${draft.id}`)).json().data;
    expect(flagged.title).toBe('TEST QA sourced tumbler 500ml (edited)');
    expect(flagged.sourceUpdatePending).toBe(true);
    expect(flagged.referenceCost).toEqual({ amount: 5.1, currency: 'USD' });
    expect(flagged.price.amounts.USD.min).toBe(9.5);

    const pub = await mt('POST', `/api/products/${draft.id}/publish`, {});
    expect(pub.statusCode).toBe(200);
    const live = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${draft.slug}` })).json().data;
    expect(live.price.amounts).toMatchObject({
      USD: { min: 9.5, max: 9.5 },
      CNY: { min: 68, max: 68 },
      INR: { min: 790, max: 790 },
    });
    const liveJson = JSON.stringify(live);
    expect(liveJson).not.toMatch(/5\.1|referenceCost|sourceLead|Secret Customer|Priya Secret|factory/i);
    expect(live).not.toHaveProperty('referenceCost');
    expect(live).not.toHaveProperty('sourceQuoteId');
    expect(live).not.toHaveProperty('supplierId');

    // A currency with no entered amount stays empty — no converted fallback.
    const onlyUsd = await mt('POST', '/api/products', { title: 'TEST USD only price', priceMode: 'RANGE', priceUsd: 3, baseCurrency: 'USD' });
    await mt('POST', `/api/products/${onlyUsd.json().data.id}/publish`, {});
    const usdOnly = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${onlyUsd.json().data.slug}` })).json().data;
    expect(usdOnly.price.amounts.USD.min).toBe(3);
    expect(usdOnly.price.amounts.INR.min).toBeNull();
    expect(usdOnly.price.amounts.CNY.min).toBeNull();

    // Discard does not touch the sourcing quote.
    const { lead: lead2, q: q2 } = await pricedLead(call);
    expect((await call('cs', 'PATCH', `/api/records/leads/${lead2.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const d2 = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q2.id);
    expect((await mt('POST', `/api/products/${d2.id}/discard-source`, {})).statusCode).toBe(200);
    expect((await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q2.id)).toBeFalsy();
    const still = (await call('cs', 'GET', `/api/leads/${lead2.id}/quotes`)).json().data.find((x: any) => x.id === q2.id);
    expect(still.unitPrice).toBe(4.2);
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${d2.slug}` })).statusCode).toBe(404);

    // Supplier and China staff must not see customer details; China selling prices stay hidden.
    const chinaView = (await call('cs', 'GET', `/api/products/${draft.id}`)).json().data;
    expect(chinaView.price?.amounts ?? null).toBeNull();
    expect(JSON.stringify(chinaView)).not.toMatch(/Secret Customer|Priya/);
    expect(chinaView.referenceCost?.amount).toBe(5.1);
  });

  it('also creates the draft when China returns the lead to India without changing the status first', async () => {
    const { call, mt } = await env();
    const { lead, q } = await pricedLead(call);
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/assign`, { office: 'INDIA' })).statusCode).toBe(200);
    const draft = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q.id);
    expect(draft).toBeTruthy();
    expect(draft.status).toBe('UNPUBLISHED');
  });
});
