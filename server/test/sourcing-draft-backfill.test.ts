import { describe, expect, it } from 'vitest';
import { isTestSourcingRecord } from '../src/catalog-from-sourcing.js';
import { setup, PW, SUP } from './portal-helpers.js';

describe('isTestSourcingRecord', () => {
  it('flags known QA refs and TEST-named records, but not ordinary product names', () => {
    expect(isTestSourcingRecord({ leadRef: 'SE-2611-0109', productInterest: 'tumbler' }, { product: 'tumbler' } as any)).toBe(true);
    expect(isTestSourcingRecord({ leadRef: 'SE-2611-0002', name: 'Test – Test', productInterest: 'Test' }, { product: 'test' } as any)).toBe(true);
    expect(isTestSourcingRecord({ productInterest: 'TEST QA sourced tumbler' }, { product: 'TEST QA sourced tumbler 500ml' } as any)).toBe(true);
    expect(isTestSourcingRecord({ productInterest: 'wedding gown' }, { product: 'wedding gown no.1' } as any)).toBe(false);
    expect(isTestSourcingRecord({ productInterest: 'stainless steel insulated cup' }, { product: 'Stainless steel insulated cup' } as any)).toBe(false);
  });
});

async function historicalPriced(call: any, db: any, fields: { productInterest: string; product: string; name?: string; summary?: string; clientName?: string; unitPrice?: number }) {
  const lead = (await call('is', 'POST', '/api/records/leads', {
    name: fields.name ?? 'L',
    clientName: fields.clientName ?? 'Secret Customer Ltd',
    contactName: 'Priya Secret',
    productInterest: fields.productInterest,
    quantity: 200,
    unit: 'pcs',
    summary: fields.summary ?? 'Historical priced request.',
  })).json().data;
  expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
  const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
    newSupplier: { ...SUP, name: 'Secret Factory Backfill' },
    product: fields.product,
    unitPrice: fields.unitPrice ?? 3.5,
    currency: 'CNY',
    moq: '200 pcs',
    leadTime: '20 days',
    notes: fields.summary ?? 'FOB Ningbo.',
  })).json().data;
  // Simulate a historical return to India (including LOST) without running the live QUOTED hook.
  await db.run("UPDATE leads SET status = 'LOST', owner_office = 'INDIA' WHERE id = ?", lead.id);
  return { lead, q };
}

describe('sourcing draft backfill', () => {
  it('creates unpublished drafts for historical priced quotes, skips TEST records and existing drafts, and stays idempotent', async () => {
    const { app, call, db } = await setup();
    const createdMt = await call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
    expect(createdMt.statusCode).toBe(201);
    const mtTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
    const mt = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });

    const real = await historicalPriced(call, db, {
      productInterest: 'wedding gown', product: 'wedding gown no.1', name: 'Gown enquiry',
    });
    const testNamed = await historicalPriced(call, db, {
      productInterest: 'Test', product: 'test', name: 'Test – Test', summary: 'TEST record only',
    });
    const alreadyLead = (await call('is', 'POST', '/api/records/leads', {
      name: 'L', clientName: 'Secret Customer Ltd', contactName: 'Priya Secret',
      productInterest: 'bike lcd screen', quantity: 200, unit: 'pcs', summary: 'Already drafted.',
    })).json().data;
    expect((await call('is', 'POST', `/api/leads/${alreadyLead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
    const alreadyQ = (await call('cs', 'POST', `/api/leads/${alreadyLead.id}/quotes`, {
      newSupplier: { ...SUP, name: 'Secret Factory Already' }, product: 'motorcycle navigation system',
      unitPrice: 8, currency: 'USD', moq: '200 pcs', leadTime: '15 days', notes: 'FOB.',
    })).json().data;
    expect((await call('cs', 'PATCH', `/api/records/leads/${alreadyLead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const already = { lead: alreadyLead, q: alreadyQ };
    const existing = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === already.q.id);
    expect(existing).toBeTruthy();
    const renamed = await mt('PATCH', `/api/products/${existing.id}`, { title: 'Keep this team title' });
    expect(renamed.statusCode).toBe(200);

    // No draft yet for the historical LOST quote or the TEST record.
    const before = (await mt('GET', '/api/products?fromSourcing=1')).json().data as any[];
    expect(before.find((p) => p.sourceQuoteId === real.q.id)).toBeFalsy();
    expect(before.find((p) => p.sourceQuoteId === testNamed.q.id)).toBeFalsy();

    const deniedMt = await mt('POST', '/api/catalog/sourcing-drafts/backfill', { confirm: true });
    expect(deniedMt.statusCode).toBe(403);
    expect((await call('cs', 'POST', '/api/catalog/sourcing-drafts/backfill', { confirm: true })).statusCode).toBe(403);
    expect((await call('sa', 'POST', '/api/catalog/sourcing-drafts/backfill', {})).statusCode).toBe(400);

    const dry = await call('sa', 'POST', '/api/catalog/sourcing-drafts/backfill', { dryRun: true });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().dryRun).toBe(true);
    expect(dry.json().data.created.some((r: any) => r.quoteId === real.q.id)).toBe(true);
    expect(dry.json().data.skipped.some((r: any) => r.quoteId === testNamed.q.id && r.reason === 'test_record')).toBe(true);
    expect(dry.json().data.skipped.some((r: any) => r.quoteId === already.q.id && r.reason === 'already_exists')).toBe(true);
    // Dry run must not write.
    expect((await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === real.q.id)).toBeFalsy();

    const run = await call('sa', 'POST', '/api/catalog/sourcing-drafts/backfill', { confirm: true });
    expect(run.statusCode).toBe(200);
    const data = run.json().data;
    expect(data.created.some((r: any) => r.quoteId === real.q.id && r.status === 'UNPUBLISHED')).toBe(true);
    expect(data.skipped.some((r: any) => r.quoteId === testNamed.q.id && r.reason === 'test_record')).toBe(true);
    expect(data.skipped.some((r: any) => r.quoteId === already.q.id && r.reason === 'already_exists')).toBe(true);
    const blob = JSON.stringify(data);
    expect(blob).not.toMatch(/Secret Customer|Priya Secret|Secret Factory/i);

    const draft = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === real.q.id);
    expect(draft).toBeTruthy();
    expect(draft.status).toBe('UNPUBLISHED');
    expect(draft.title).toBe('wedding gown no.1');
    expect(draft.referenceCost).toEqual({ amount: 3.5, currency: 'CNY' });
    expect(JSON.stringify(draft)).not.toMatch(/Secret Customer|Priya Secret/i);
    expect(draft.supplierId ?? null).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${draft.slug}` })).statusCode).toBe(404);
    const pub = (await app.inject({ method: 'GET', url: '/api/public/catalog/products?q=wedding+gown&limit=48' })).json();
    expect((pub.data ?? []).some((p: any) => p.id === draft.id)).toBe(false);

    const kept = (await mt('GET', `/api/products/${existing.id}`)).json().data;
    expect(kept.title).toBe('Keep this team title');

    const again = await call('sa', 'POST', '/api/catalog/sourcing-drafts/backfill', { confirm: true });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.created).toEqual([]);
    expect(again.json().data.skipped.some((r: any) => r.quoteId === real.q.id && r.reason === 'already_exists')).toBe(true);
  });
});
