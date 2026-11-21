import { describe, expect, it } from 'vitest';
import { setup, SUP } from './portal-helpers.js';
import { buildQuoteReference, assertSafeQuoteReference, formatQuoteReference, suggestedQuoteId } from '../src/chat.js';
import { quoteCarton, type Quote } from '../src/quotes.js';
import { allowedFor, ROLE_DEFAULTS } from '../src/permissions.js';

const baseQuote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1', leadId: 'l1', supplierId: 'sup-secret', product: 'Steel bottle', unitPrice: 1.25, currency: 'USD',
  moq: '500', leadTime: '20 days', validity: null, notes: 'Supplier secret notes',
  clientPrice: 199, clientCurrency: 'INR', clientNotes: 'do not leak',
  createdBy: 'u', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  shipCost: 40, shipCurrency: 'USD', shipTerm: 'FOB', shipMode: 'SEA', shipPort: 'Ningbo', shipTransit: '18d',
  cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 35, cartonUnits: 12, cartonGrossKg: 10, cartonNetKg: 9,
  cq: { qty: 500, unitPrice: 199, gstPct: 18, shipCost: 20, shipTerm: 'CIF', shipMode: 'SEA', port: 'Chennai', transit: '20d', otherCharges: 0, otherLabel: null, validity: null, terms: null },
  status: 'DRAFT', sentAt: null, decidedAt: null, rejectReason: null, pdfToken: null, revision: 0, revRequest: null,
  ...over,
});

describe('quote reference redaction', () => {
  it('includes only fields that both offices may see', () => {
    const q = baseQuote();
    const ref = buildQuoteReference('SE-2511-0001', q, 0, quoteCarton(q), { id: 'cov', name: 'secret-factory.jpg', mime: 'image/jpeg', size: 10, createdAt: '' } as any);
    const safe = assertSafeQuoteReference(ref);
    expect(safe.quoteLabel).toBe('SE-2511-0001-Q1');
    expect(safe.product).toBe('Steel bottle');
    expect(safe.moq).toBe('500');
    expect(safe.carton?.totalCbm).toBe(1.764);
    expect(safe.hasCoverPhoto).toBe(true);
    const text = formatQuoteReference(safe);
    expect(text).toContain('Steel bottle');
    expect(text).not.toMatch(/Arora|199|1\.25|Ningbo Secret|Wang|wx_secret|INR|USD|do not leak|secret-factory/i);
    expect(() => assertSafeQuoteReference({ ...ref, supplierName: 'Ningbo Secret Factory' })).toThrow(/private field/);
    expect(() => assertSafeQuoteReference({ ...ref, unitPrice: 1.25 })).toThrow(/private field/);
    expect(() => assertSafeQuoteReference({ ...ref, clientName: 'Arora' })).toThrow(/private field/);
    expect(suggestedQuoteId([baseQuote({ id: 'a', updatedAt: '2026-11-01T00:00:00Z' }), baseQuote({ id: 'b', updatedAt: '2026-11-03T00:00:00Z' })])).toBe('b');
  });
});

describe('chat privacy cannot be overridden', () => {
  it('never lets China hold customer-field permissions or India hold supplier-field ones', () => {
    expect(allowedFor('CHINA_STAFF', 'chat.see_customer_fields')).toBe(false);
    expect(allowedFor('CHINA_ADMIN', 'customers.view')).toBe(false);
    expect(allowedFor('INDIA_STAFF', 'chat.see_supplier_fields')).toBe(false);
    expect(allowedFor('INDIA_ADMIN', 'suppliers.view')).toBe(false);
    expect(allowedFor('MARKETPLACE_TEAM', 'chat.see_supplier_fields')).toBe(true);
    expect(allowedFor('MARKETPLACE_TEAM', 'chat.see_customer_fields')).toBe(false);
    expect(ROLE_DEFAULTS.INDIA_STAFF).toContain('chat.view_own');
    expect(ROLE_DEFAULTS.CHINA_STAFF).toContain('chat.start');
  });
});

describe('native lead chat', () => {
  it('creates one thread per lead, posts a redacted quote card, and keeps a personal inbox', async () => {
    const { call, as, ids, enquire, customer } = await setup();
    const e = await enquire('Arora Home Store', '9000000002', 'Arora Home');
    const lead = (await call('ia', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === e.reference);
    await call('ia', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA', assignedTo: ids.cs });
    const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
      newSupplier: SUP, product: 'Steel bottle', unitPrice: '1.25', currency: 'USD', moq: '500',
      cartonLengthCm: '40', cartonWidthCm: '30', cartonHeightCm: '35', cartonUnits: '12',
    })).json().data;

    expect((await call('ia', 'GET', '/api/chat/status')).json().data.enabled).toBe(true);
    const first = await call('ia', 'POST', `/api/leads/${lead.id}/chat`);
    expect(first.statusCode).toBe(200);
    const convId = first.json().data.id;
    expect(convId).toBeTruthy();
    expect(first.json().data.created).toBe(true);
    expect(JSON.stringify(first.json().data)).not.toMatch(/Arora Home Store/);

    const again = await call('cs', 'POST', `/api/leads/${lead.id}/chat`);
    expect(again.json().data.id).toBe(convId);
    expect(again.json().data.created).toBe(false);

    const indiaCard = await call('ia', 'POST', `/api/leads/${lead.id}/chat/quote-reference`, { quoteId: q.id });
    expect(indiaCard.statusCode).toBe(200);
    const card = indiaCard.json().data.quoteReference;
    expect(card.quoteLabel).toBe(`${lead.leadRef}-Q1`);
    expect(card.product).toBe('Steel bottle');
    expect(card.moq).toBe('500');
    expect(JSON.stringify(indiaCard.json())).not.toMatch(/Arora Home Store|1\.25|199|Ningbo Secret|Wang|wx_secret|unitPrice|supplierName/i);

    const chinaView = await call('cs', 'GET', `/api/leads/${lead.id}/chat`);
    const chinaCard = chinaView.json().data.messages.find((m: any) => m.kind === 'quote_reference').quoteReference;
    expect(chinaCard.quoteLabel).toBe(card.quoteLabel);
    expect(chinaView.json().data.clientName).toBeNull();
    expect(JSON.stringify(chinaView.json())).not.toMatch(/Arora Home Store|1\.25|Ningbo Secret|Wang|wx_secret/i);

    const msg = await call('cs', 'POST', `/api/leads/${lead.id}/chat/messages`, { content: 'MOQ looks right', quoteId: q.id });
    expect(msg.statusCode).toBe(200);
    expect(msg.json().data.content).toBe('MOQ looks right');
    expect(msg.json().data.quoteTag.quoteLabel).toBe(`${lead.leadRef}-Q1`);
    expect(msg.json().data.senderName).toBe('Staff cs');

    const inboxes = (await call('ia', 'GET', '/api/chat/inboxes')).json().data;
    const mine = inboxes.find((i: any) => i.kind === 'PERSONAL');
    expect(mine).toBeTruthy();
    const threads = (await call('ia', 'GET', `/api/chat/inboxes/${mine.id}/conversations`)).json().data;
    expect(threads.some((t: any) => t.id === convId)).toBe(true);

    const cust = await customer('Ravi', '9111111111', 'Ravi Co');
    expect((await as(cust.token, 'GET', `/api/leads/${lead.id}/chat`)).statusCode).toBe(401);
  });

  it('does not let China staff open a lead that is still in India', async () => {
    const { call, enquire } = await setup();
    const e = await enquire('Mehta', '9000000003', 'Mehta Kitchen');
    const lead = (await call('ia', 'GET', '/api/records/leads')).json().data.find((l: any) => l.leadRef === e.reference);
    expect((await call('cs', 'GET', `/api/leads/${lead.id}/chat`)).statusCode).toBe(404);
    expect((await call('cs', 'POST', `/api/leads/${lead.id}/chat`)).statusCode).toBe(404);
  });

  it('applies custom role defaults and per-person overrides immediately, without unlocking privacy', async () => {
    const { call, ids, app } = await setup();
    const created = await call('sa', 'POST', '/api/chat/roles', { name: 'China desk', permissions: { 'chat.manage_canned': true, 'chat.view_team': true, 'chat.see_customer_fields': true } });
    expect(created.statusCode).toBe(201);
    const roleId = created.json().data.id;
    await call('sa', 'POST', `/api/users/${ids.cs}/custom-role`, { roleId });

    const matrix = (await call('sa', 'GET', `/api/users/${ids.cs}/permissions`)).json().data.permissions;
    const canned = matrix.find((p: any) => p.key === 'chat.manage_canned');
    expect(canned.effective).toBe(true);
    expect(canned.default).toBe(true);
    const customer = matrix.find((p: any) => p.key === 'chat.see_customer_fields');
    expect(customer.locked).toBe(true);
    expect(customer.effective).toBe(false);

    // Per-person revoke applies immediately.
    await call('sa', 'PUT', `/api/users/${ids.cs}/permissions`, { permissions: { 'chat.manage_canned': false } });
    const after = (await call('sa', 'GET', `/api/users/${ids.cs}/permissions`)).json().data.permissions.find((p: any) => p.key === 'chat.manage_canned');
    expect(after.effective).toBe(false);
    expect(after.override).toBe(false);

    // China still cannot create a canned reply now, and cannot be granted customer fields.
    expect((await call('cs', 'POST', '/api/chat/canned', { title: 'Hi', body: 'Hello' })).statusCode).toBe(403);
    const denied = await call('sa', 'PUT', `/api/users/${ids.cs}/permissions`, { permissions: { 'chat.see_customer_fields': true } });
    expect(denied.statusCode).toBe(403);
  });
});
