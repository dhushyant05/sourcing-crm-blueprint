import { describe, expect, it } from 'vitest';
import { matchOrCreateSupplier } from '../src/catalog-from-sourcing.js';
import { setup, PW, SUP } from './portal-helpers.js';

async function env() {
  const e = await setup();
  const created = await e.call('sa', 'POST', '/api/users', { email: 'mt-sup@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await e.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt-sup@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any) =>
    e.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });
  return { ...e, mt, mtTok };
}

async function pricedLead(call: any, name = 'Secret Factory Link') {
  const lead = (await call('is', 'POST', '/api/records/leads', {
    name: 'L', clientName: 'Secret Customer Ltd', contactName: 'Priya Secret', productInterest: 'tumbler',
    quantity: 100, unit: 'pcs', summary: 'For the catalog.',
  })).json().data;
  expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
  const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
    newSupplier: { ...SUP, name }, product: 'TEST QA supplier tumbler',
    unitPrice: 4.2, currency: 'USD', moq: '100 pcs', leadTime: '10 days', notes: 'Factory only.',
  })).json().data;
  expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
  return { lead, q };
}

describe('sourced drafts link to the actual quote supplier', () => {
  it('auto-links the quote supplier, shows details to SA and MT, hides them from India, and keeps the public card consent-only', async () => {
    const { app, call, mt, db } = await env();
    const { q } = await pricedLead(call, 'Ningbo Link Factory');

    const list = (await mt('GET', '/api/products?fromSourcing=1')).json().data as any[];
    const draft = list.find((p) => p.sourceQuoteId === q.id);
    expect(draft).toBeTruthy();
    expect(draft.supplierId).toBe(q.supplierId);
    expect(draft.catalogSupplier).toMatchObject({
      name: 'Ningbo Link Factory', contact: 'Mr Wang', phone: '+86 138', wechat: 'wx_secret', city: 'Ningbo',
    });

    const sa = (await call('sa', 'GET', `/api/products/${draft.id}`)).json().data;
    expect(sa.supplierId).toBe(q.supplierId);
    expect(sa.catalogSupplier.contact).toBe('Mr Wang');
    expect(sa.catalogSupplier.city).toBe('Ningbo');

    const china = (await call('cs', 'GET', `/api/products/${draft.id}`)).json().data;
    expect(china.supplierId).toBe(q.supplierId);
    expect(china.catalogSupplier.name).toBe('Ningbo Link Factory');

    for (const role of ['is', 'ia'] as const) {
      const hidden = (await call(role, 'GET', `/api/products/${draft.id}`)).json().data;
      expect(hidden.supplierId).toBeUndefined();
      expect(hidden.catalogSupplier).toBeUndefined();
      expect(JSON.stringify(hidden)).not.toMatch(/Mr Wang|wx_secret|\+86 138|Ningbo Link Factory/i);
    }
    const indiaList = (await call('ia', 'GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.id === draft.id);
    expect(indiaList.supplierId).toBeUndefined();
    expect(indiaList.catalogSupplier).toBeUndefined();

    // Staff can change the linked supplier.
    const other = (await mt('POST', '/api/catalog/suppliers', { name: 'Replacement Catalog Factory', publicRegion: 'Shenzhen' })).json().data;
    const changed = await mt('PATCH', `/api/products/${draft.id}`, { supplierId: other.id });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.supplierId).toBe(other.id);
    expect(changed.json().data.catalogSupplier.name).toBe('Replacement Catalog Factory');

    // Get quote publishes with no selling price; public API never includes contacts or factory cost.
    const pub = await mt('POST', `/api/products/${draft.id}/publish`, {});
    expect(pub.statusCode).toBe(200);
    const live = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${draft.slug}` })).json().data;
    expect(live.price.mode).toBe('GET_QUOTE');
    expect(live.price.amounts).toBeNull();
    expect(live.supplier).toBeNull();
    expect(live).not.toHaveProperty('supplierId');
    expect(JSON.stringify(live)).not.toMatch(/4\.2|Mr Wang|wx_secret|\+86|referenceCost|Secret Customer|Priya Secret/i);
    expect((await mt('POST', `/api/products/${draft.id}/unpublish`, {})).statusCode).toBe(200);

    // A later quote with the same factory name reuses the existing supplier (dedup).
    const first = await matchOrCreateSupplier(db, { name: 'Dedup Factory', city: 'Yiwu', contact: 'Li' }, 'tester');
    const second = await matchOrCreateSupplier(db, { name: 'dedup factory', city: 'Yiwu', contact: 'Other' }, 'tester');
    expect(second).toBe(first);
    const otherCity = await matchOrCreateSupplier(db, { name: 'Dedup Factory', city: 'Ningbo' }, 'tester');
    expect(otherCity).toBe(first); // name match is enough when a same-name row already exists
  });

  it('fills a missing supplier on a team-edited draft, flags a conflicting choice, and links historical drafts via the SA endpoint', async () => {
    const { call, mt, db } = await env();
    const { q } = await pricedLead(call, 'Flag Factory');
    const draft = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q.id);

    // Simulate a historical unlinked draft the team already edited.
    const other = (await mt('POST', '/api/catalog/suppliers', { name: 'Team Chosen Factory' })).json().data;
    await mt('PATCH', `/api/products/${draft.id}`, { title: 'Edited by the team', supplierId: other.id });
    expect((await mt('GET', `/api/products/${draft.id}`)).json().data.supplierId).toBe(other.id);

    const dryFlag = await call('sa', 'POST', '/api/catalog/sourcing-drafts/link-suppliers', { dryRun: true });
    expect(dryFlag.statusCode).toBe(200);
    expect(dryFlag.json().data.flagged.some((r: any) => r.productId === draft.id)).toBe(true);
    expect((await mt('GET', `/api/products/${draft.id}`)).json().data.supplierId).toBe(other.id);

    const runFlag = await call('sa', 'POST', '/api/catalog/sourcing-drafts/link-suppliers', { confirm: true });
    expect(runFlag.statusCode).toBe(200);
    const flagged = (await mt('GET', `/api/products/${draft.id}`)).json().data;
    expect(flagged.supplierId).toBe(other.id);
    expect(flagged.sourceUpdatePending).toBe(true);
    expect(flagged.title).toBe('Edited by the team');

    // A second historical draft with a missing supplier_id is filled even if the team edited the title.
    const { q: q2 } = await pricedLead(call, 'Fill Factory');
    const draft2 = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q2.id);
    await mt('PATCH', `/api/products/${draft2.id}`, { title: 'Team title only' });
    await db.run('UPDATE products SET supplier_id = NULL, source_update_pending = false WHERE id = ?', draft2.id);
    const filled = await call('sa', 'POST', '/api/catalog/sourcing-drafts/link-suppliers', { confirm: true });
    expect(filled.statusCode).toBe(200);
    expect(filled.json().data.filled.some((r: any) => r.productId === draft2.id)).toBe(true);
    const after = (await mt('GET', `/api/products/${draft2.id}`)).json().data;
    expect(after.supplierId).toBe(q2.supplierId);
    expect(after.catalogSupplier.name).toBe('Fill Factory');
    expect(after.title).toBe('Team title only');

    expect((await mt('POST', '/api/catalog/sourcing-drafts/link-suppliers', { confirm: true })).statusCode).toBe(403);
  });

  it('blocks publishing a fixed-price sourced draft until one currency is set', async () => {
    const { call, mt } = await env();
    const { q } = await pricedLead(call, 'Range Factory');
    const draft = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === q.id);
    expect((await mt('PATCH', `/api/products/${draft.id}`, { priceMode: 'RANGE' })).statusCode).toBe(200);
    const blocked = await mt('POST', `/api/products/${draft.id}/publish`, {});
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/selling price/i);
    expect((await mt('PATCH', `/api/products/${draft.id}`, { priceUsd: 11 })).statusCode).toBe(200);
    const pub = await mt('POST', `/api/products/${draft.id}/publish`, {});
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.status).toBe('PUBLISHED');
  });
});
