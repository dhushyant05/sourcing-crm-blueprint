import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { UploadStore } from '../src/uploads.js';
import { processProductImage, saveProductPhoto } from '../src/catalog.js';
import { setup, PW, SUP, form } from './portal-helpers.js';

const png = (w: number, h: number, r: number, g: number, b: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function upload(as: any, token: string, url: string, name: string, data: Buffer) {
  const f = form({}, [{ name, data, type: 'image/png' }]);
  const r = await as(token, 'POST', url, f.payload, f.headers);
  expect(r.statusCode, r.body).toBe(201);
  return r;
}

function photoCount(p: any) {
  const imgs = p.images ?? [];
  return imgs.length;
}

describe('each quote on a lead becomes its own marketplace draft', () => {
  it('keeps each draft limited to that quote’s own photos and details, and repair un-merges leaked sibling photos', async () => {
    const { app, call, as, tok, db, uploadsDir } = await setup();
    const createdMt = await call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
    expect(createdMt.statusCode).toBe(201);
    const mtTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
    const mt = (method: any, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}` } });

    const lead = (await call('is', 'POST', '/api/records/leads', {
      name: 'Kitchen bundle', clientName: 'Secret Customer Ltd', contactName: 'Priya Secret',
      productInterest: 'each 5 pcs', quantity: 5, unit: 'pcs', summary: 'Bundle enquiry for several kitchen items.',
    })).json().data;

    const leadA = await png(240, 240, 200, 20, 20);
    const leadB = await png(240, 200, 20, 200, 20);
    const leadC = await png(200, 240, 20, 20, 200);
    await upload(as, tok.is, `/api/leads/${lead.id}/attachments`, 'bundle-a.png', leadA);
    await upload(as, tok.is, `/api/leads/${lead.id}/attachments`, 'bundle-b.png', leadB);
    await upload(as, tok.is, `/api/leads/${lead.id}/attachments`, 'bundle-c.png', leadC);

    expect((await call('is', 'POST', `/api/leads/${lead.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);

    const products = [
      { product: 'air fryer', notes: 'Air fryer 5L, FOB Ningbo.', color: await png(320, 200, 240, 160, 40) },
      { product: 'Automatic Foam Soap Dispenser', notes: 'Sensor soap dispenser.', color: await png(300, 300, 40, 160, 240) },
      { product: 'juice mechine', notes: 'Citrus juicer.', color: await png(280, 220, 160, 40, 240) },
    ];
    const quotes = [];
    for (const p of products) {
      const q = (await call('cs', 'POST', `/api/leads/${lead.id}/quotes`, {
        newSupplier: { ...SUP, name: `Factory ${p.product}` }, product: p.product,
        unitPrice: 12, currency: 'CNY', moq: '5 pcs', leadTime: '20 days', notes: p.notes,
      })).json().data;
      await upload(as, tok.cs, `/api/quotes/${q.id}/files`, `${p.product}.png`, p.color);
      quotes.push(q);
    }
    expect((await call('cs', 'PATCH', `/api/records/leads/${lead.id}`, { status: 'QUOTED' })).statusCode).toBe(200);

    const list = (await mt('GET', '/api/products?fromSourcing=1')).json().data as any[];
    const drafts = quotes.map((q) => list.find((p) => p.sourceQuoteId === q.id));
    expect(drafts.every(Boolean)).toBe(true);
    expect(new Set(drafts.map((d) => d.id)).size).toBe(3);
    expect(drafts.map((d) => d.title)).toEqual(products.map((p) => p.product));
    expect(drafts.every((d) => d.status === 'UNPUBLISHED')).toBe(true);
    for (const d of drafts) {
      const full = (await mt('GET', `/api/products/${d.id}`)).json().data;
      expect(photoCount(full)).toBe(1);
      const siblings = products.map((p) => p.product).filter((t) => t !== d.title);
      for (const s of siblings) {
        expect(JSON.stringify({ title: full.title, summary: full.summary, specs: full.specs })).not.toContain(s);
      }
      expect((await app.inject({ method: 'GET', url: `/api/public/catalog/products/${full.slug}` })).statusCode).toBe(404);
    }
    const fryer = (await mt('GET', `/api/products/${drafts[0].id}`)).json().data;
    expect(fryer.summary).toMatch(/Air fryer 5L/);
    expect(photoCount(fryer)).toBe(1);

    // Simulate the pre-fix leak: copy the lead album onto the air fryer draft.
    const uploads = new UploadStore(uploadsDir);
    for (const meta of uploads.list(lead.id)) {
      const file = uploads.read(lead.id, meta.id);
      if (!file?.data) continue;
      const processed = await processProductImage(file.data);
      await saveProductPhoto({ db, uploads, perms: null as any }, fryer.id, processed, 'leaked', photoCount(fryer) + 1, false);
    }
    const leaked = (await mt('GET', `/api/products/${fryer.id}`)).json().data;
    expect(photoCount(leaked)).toBe(4);

    const soap = drafts[1];
    expect((await mt('PATCH', `/api/products/${soap.id}`, { title: 'Automatic Foam Soap Dispenser (edited)' })).statusCode).toBe(200);
    for (const meta of uploads.list(lead.id)) {
      const file = uploads.read(lead.id, meta.id);
      if (!file?.data) continue;
      const processed = await processProductImage(file.data);
      await saveProductPhoto({ db, uploads, perms: null as any }, soap.id, processed, 'leaked-edited', 10, false);
    }
    expect(photoCount((await mt('GET', `/api/products/${soap.id}`)).json().data)).toBe(4);

    expect((await mt('POST', '/api/catalog/sourcing-drafts/repair', { confirm: true })).statusCode).toBe(403);
    const dry = await call('sa', 'POST', '/api/catalog/sourcing-drafts/repair', { dryRun: true });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().dryRun).toBe(true);
    expect(dry.json().data.repaired.some((r: any) => r.productId === fryer.id && r.merged)).toBe(true);
    expect(dry.json().data.skipped.some((r: any) => r.productId === soap.id && r.reason === 'team_edited')).toBe(true);
    // Dry run must not change photos.
    expect(photoCount((await mt('GET', `/api/products/${fryer.id}`)).json().data)).toBe(4);

    const run = await call('sa', 'POST', '/api/catalog/sourcing-drafts/repair', { confirm: true });
    expect(run.statusCode).toBe(200);
    expect(run.json().data.repaired.some((r: any) => r.productId === fryer.id && r.merged && r.removed === 3)).toBe(true);
    expect(run.json().data.skipped.some((r: any) => r.productId === soap.id && r.reason === 'team_edited')).toBe(true);
    const fixed = (await mt('GET', `/api/products/${fryer.id}`)).json().data;
    expect(photoCount(fixed)).toBe(1);
    expect(fixed.status).toBe('UNPUBLISHED');
    const soapAfter = (await mt('GET', `/api/products/${soap.id}`)).json().data;
    expect(soapAfter.title).toBe('Automatic Foam Soap Dispenser (edited)');
    expect(photoCount(soapAfter)).toBe(4);
    const juice = (await mt('GET', `/api/products/${drafts[2].id}`)).json().data;
    expect(photoCount(juice)).toBe(1);
    expect(juice.title).toBe('juice mechine');

    // A later China update must not create a duplicate draft.
    expect((await call('cs', 'PATCH', `/api/quotes/${quotes[0].id}`, { unitPrice: 13 })).statusCode).toBe(200);
    const again = (await mt('GET', '/api/products?fromSourcing=1')).json().data.filter((p: any) => p.sourceQuoteId === quotes[0].id);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(fryer.id);
    expect(again[0].referenceCost).toEqual({ amount: 13, currency: 'CNY' });

    // A single-quote lead still gets the lead enquiry photo as well as the quote photo.
    const solo = (await call('is', 'POST', '/api/records/leads', {
      name: 'Solo', clientName: 'Secret Customer Ltd', productInterest: 'stainless cup', quantity: 100, unit: 'pcs',
    })).json().data;
    await upload(as, tok.is, `/api/leads/${solo.id}/attachments`, 'cup-lead.png', await png(220, 220, 90, 90, 90));
    expect((await call('is', 'POST', `/api/leads/${solo.id}/assign`, { office: 'CHINA' })).statusCode).toBe(200);
    const sq = (await call('cs', 'POST', `/api/leads/${solo.id}/quotes`, {
      newSupplier: { ...SUP, name: 'Cup Factory' }, product: 'stainless cup', unitPrice: 2, currency: 'USD', moq: '100 pcs', leadTime: '10 days', notes: 'Plain cup.',
    })).json().data;
    await upload(as, tok.cs, `/api/quotes/${sq.id}/files`, 'cup.png', await png(260, 180, 10, 10, 10));
    expect((await call('cs', 'PATCH', `/api/records/leads/${solo.id}`, { status: 'QUOTED' })).statusCode).toBe(200);
    const soloDraft = (await mt('GET', '/api/products?fromSourcing=1')).json().data.find((p: any) => p.sourceQuoteId === sq.id);
    expect(photoCount((await mt('GET', `/api/products/${soloDraft.id}`)).json().data)).toBe(2);
  });
});
