import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG, form, pngOf, setup } from './portal-helpers.js';

describe('storage manager (super admin)', () => {
  const start = async () => {
    const t = await setup();
    const up = (url: string, files: { name: string; data: Buffer; type?: string }[], who = 'sa', fields: Record<string, string> = {}) => {
      const f = form(fields, files); return t.app.inject({ method: 'POST', url, payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${t.tok[who]}` } });
    };
    await t.enquire('Lead One', '9000000001', 'Lamps Co');
    const lead = (await t.db.get('SELECT id FROM leads LIMIT 1')).id as string;
    const list = (qs = '') => t.call('sa', 'GET', `/api/storage${qs}`).then((r) => r.json().data);
    return { ...t, up, lead, list };
  };
  const del = (call: any, f: any, extra: Record<string, unknown> = {}) => call('sa', 'POST', '/api/storage/delete', { items: [{ key: f.key, id: f.id, size: f.size, places: f.places.length }], confirm: true, ...extra });

  it('super admin only; real disk figures; largest first, filters, search, pagination; preview is authorised', async () => {
    const { call, app, up, lead, list } = await start();
    expect((await app.inject({ method: 'GET', url: '/api/storage' })).statusCode).toBe(401);
    for (const who of ['ia', 'is', 'ca', 'cs']) {
      expect((await call(who, 'GET', '/api/storage')).statusCode).toBe(403);
      expect((await call(who, 'POST', '/api/storage/delete', { items: [{ key: lead, id: 'x' }], confirm: true })).statusCode).toBe(403);
    }
    expect((await up(`/api/leads/${lead}/attachments`, [{ name: 'small.png', data: PNG, type: 'image/png' }, { name: 'big.png', data: pngOf(10, 10, 200_000), type: 'image/png' },
      { name: 'spec.pdf', data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5000)]), type: 'application/pdf' }])).statusCode).toBeLessThan(300);
    const d = await list();
    expect(d.disk.total).toBeGreaterThan(0); expect(d.disk.free).toBeGreaterThan(0); expect(d.disk.used).toBeGreaterThan(0);
    expect(d.uploads.files).toBe(3); expect(d.items.map((x: any) => x.name)).toEqual(['big.png', 'spec.pdf', 'small.png']);
    expect(d.items[0].places).toEqual([expect.objectContaining({ kind: 'LEAD_ATTACHMENT', recordId: lead })]);
    expect((await list('?type=document')).items.map((x: any) => x.name)).toEqual(['spec.pdf']);
    expect((await list('?q=small')).total).toBe(1);
    const p = await list('?limit=1&offset=1'); expect(p.total).toBe(3); expect(p.items.map((x: any) => x.name)).toEqual(['spec.pdf']);
    const f = d.items[0];
    const prev = await call('sa', 'GET', `/api/storage/files/${f.key}/${f.id}`);
    expect(prev.statusCode).toBe(200); expect(prev.headers['content-type']).toBe('image/png'); expect(prev.headers['x-content-type-options']).toBe('nosniff');
    expect((await call('ia', 'GET', `/api/storage/files/${f.key}/${f.id}`)).statusCode).toBe(403);
    for (const bad of ['..%2F..%2Fetc/passwd', `${f.key}/..%2Fmanifest.json`, '.staging/x', `${f.key}/manifest.json`]) expect((await call('sa', 'GET', `/api/storage/files/${bad}`)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('delete really unlinks the file, updates the lead attachment list + count, audits, needs confirm and an unchanged size/place count', async () => {
    const { call, up, lead, list, uploadsDir, db } = await start();
    await up(`/api/leads/${lead}/attachments`, [{ name: 'big.png', data: pngOf(10, 10, 300_000), type: 'image/png' }, { name: 'keep.png', data: PNG, type: 'image/png' }]);
    const f = (await list()).items[0], path = join(uploadsDir, f.key, f.id);
    expect(existsSync(path)).toBe(true);
    expect((await call('sa', 'POST', '/api/storage/delete', { items: [{ key: f.key, id: f.id, size: f.size, places: 1 }] })).json().code).toBe('confirm');
    expect((await del(call, { ...f, size: f.size + 1 })).json().data.results[0].code).toBe('stale');
    expect((await del(call, { ...f, places: [] })).json().data.results[0].code).toBe('stale');
    const r = (await del(call, f, { reason: 'free space' })).json().data;
    expect(r.results[0]).toMatchObject({ ok: true, freed: f.size }); expect(r.freed).toBe(f.size);
    expect(existsSync(path)).toBe(false);
    expect((await call('sa', 'GET', `/api/leads/${lead}/attachments`)).json().data.map((x: any) => x.name)).toEqual(['keep.png']);
    expect((await db.get('SELECT attachment_count FROM leads WHERE id = ?', lead)).attachment_count).toBe(1);
    expect((await db.get('SELECT count(*)::int n FROM lead_media WHERE id = ?', f.id)).n).toBe(0);
    const audit = (await call('sa', 'GET', '/api/storage/deletions')).json().data;
    expect(audit[0]).toMatchObject({ file_id: f.id, reason: 'free space' }); expect(Number(audit[0].size)).toBe(f.size);
    expect((await del(call, f)).json().data.results[0].code).toBe('not_found'); // idempotent
    expect((await list()).uploads.files).toBe(1);
  });

  it('never touches anything outside manifests: staging, dotfiles, symlinks, unlisted files, traversal ids', async () => {
    const { call, up, lead, list, uploadsDir } = await start();
    await up(`/api/leads/${lead}/attachments`, [{ name: 'a.png', data: PNG, type: 'image/png' }]);
    const outside = join(uploadsDir, '..', `secret-${Date.now()}.env`); writeFileSync(outside, 'TOP=SECRET');
    mkdirSync(join(uploadsDir, 'evil'), { recursive: true });
    symlinkSync(outside, join(uploadsDir, 'evil', 'link1'));
    writeFileSync(join(uploadsDir, 'evil', 'manifest.json'), JSON.stringify([{ id: 'link1', name: 'x', mime: 'image/png', size: 1 }, { id: '../../x', name: 'y', mime: 'image/png', size: 1 }]));
    symlinkSync(join(uploadsDir, lead), join(uploadsDir, 'linked-dir'));
    writeFileSync(join(uploadsDir, lead, 'unlisted-file'), 'x');
    const d = await list();
    expect(d.uploads.files).toBe(1); expect(d.items.every((x: any) => x.key === lead)).toBe(true);
    for (const it of [{ key: 'evil', id: 'link1' }, { key: '..', id: 'etc' }, { key: lead, id: '../manifest.json' }, { key: lead, id: 'unlisted-file' }, { key: '.staging', id: 'x' }, { key: 'linked-dir', id: d.items[0].id }]) {
      const r = (await call('sa', 'POST', '/api/storage/delete', { items: [{ ...it, size: 1, places: 1 }], confirm: true })).json().data.results[0];
      expect(r.ok).toBe(false);
    }
    expect(existsSync(outside)).toBe(true); expect(existsSync(join(uploadsDir, lead, 'unlisted-file'))).toBe(true);
  });

  it('shipping file shared with the customer: both places listed, customer timeline line, file gone from portal; staff-only file has no customer line', async () => {
    const { call, as, app, customer, list, uploadsDir, tok } = await start();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const f0 = form({ kind: 'FREIGHT_ONLY', goods: 'Lamps', pickupCity: 'Yiwu', destCity: 'Chennai' }, [{ name: 'invoice.png', data: pngOf(5, 5, 50_000), type: 'image/png' }]);
    const r = (await app.inject({ method: 'POST', url: '/api/portal/shipping-requests', payload: f0.payload, headers: { ...f0.headers, authorization: `Bearer ${A.token}` } })).json().data;
    const sf = form({}, [{ name: 'rates.png', data: PNG, type: 'image/png' }]);
    await app.inject({ method: 'POST', url: `/api/shipping-requests/${r.id}/files`, payload: sf.payload, headers: { ...sf.headers, authorization: `Bearer ${tok.is}` } });
    const items = (await list('?owner=SHIPPING')).items, inv = items.find((x: any) => x.name === 'invoice.png');
    expect(inv.places.map((p: any) => p.kind)).toEqual(['SHIPPING_FILE', 'CUSTOMER_PORTAL']);
    const ok = (await del(call, inv)).json().data.results[0]; expect(ok.ok).toBe(true);
    expect(existsSync(join(uploadsDir, inv.key, inv.id))).toBe(false);
    const pv = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data;
    expect(pv.files ?? []).toEqual([]); expect(pv.timeline.at(-1).text).toBe('A file was removed by Source Easy');
    expect(JSON.stringify(pv)).not.toContain('invoice.png');
    expect((await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}/files/${inv.id}`)).statusCode).toBe(404);
    const staff = (await list('?owner=SHIPPING')).items.find((x: any) => x.name === 'rates.png');
    expect(staff.places.map((p: any) => p.kind)).toEqual(['SHIPPING_FILE']);
    const before = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data.timeline.length;
    expect((await del(call, staff)).json().data.results[0].ok).toBe(true);
    expect((await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data.timeline.length).toBe(before);
  });

  it('greeting artwork: blocked while published, allowed after unpublish (reference cleared, file unlinked)', async () => {
    const { call, app, list, uploadsDir, tok } = await start();
    const f = form({}, [{ name: 'g.png', data: pngOf(800, 400, 100_000), type: 'image/png' }]);
    const g = (await app.inject({ method: 'POST', url: '/api/greetings/upload', payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${tok.sa}` } })).json().data;
    expect((await call('sa', 'POST', `/api/greetings/${g.id}/publish`, {})).statusCode).toBe(200);
    const it0 = (await list('?owner=GREETING')).items[0];
    expect(it0.blocked).toBe('published_greeting'); expect(it0.places.map((p: any) => p.kind)).toContain('GREETING_DESKTOP');
    expect((await del(call, it0)).json().data.results[0].code).toBe('published_greeting');
    expect(existsSync(join(uploadsDir, it0.key, it0.id))).toBe(true);
    expect((await call('sa', 'POST', `/api/greetings/${g.id}/unpublish`, {})).statusCode).toBe(200);
    const it1 = (await list('?owner=GREETING')).items[0]; expect(it1.blocked).toBeNull();
    expect((await del(call, it1)).json().data.results[0].ok).toBe(true);
    expect(existsSync(join(uploadsDir, it1.key, it1.id))).toBe(false);
    const gs = (await call('sa', 'GET', `/api/greetings/${g.id}`)).json().data; expect(gs.imageDesktop ?? null).toBeNull();
  });

  it('bulk delete mixes results; a concurrent upload to the same record is kept', async () => {
    const { call, up, lead, list } = await start();
    await up(`/api/leads/${lead}/attachments`, [{ name: 'a.png', data: PNG, type: 'image/png' }, { name: 'b.png', data: pngOf(3, 3, 1000), type: 'image/png' }]);
    const items = (await list()).items;
    const [r] = await Promise.all([
      call('sa', 'POST', '/api/storage/delete', { items: [...items.map((f: any) => ({ key: f.key, id: f.id, size: f.size, places: f.places.length })), { key: lead, id: 'nope' }], confirm: true }),
      up(`/api/leads/${lead}/attachments`, [{ name: 'new.png', data: PNG, type: 'image/png' }]),
    ]);
    expect(r.json().data.results.map((x: any) => x.ok)).toEqual([true, true, false]);
    expect((await call('sa', 'GET', `/api/leads/${lead}/attachments`)).json().data.map((x: any) => x.name)).toEqual(['new.png']);
  });

  it('older-than-days: upload-age cutoff on server time, boundary, validation, unknown ages never old, combines with filters/pagination, never deletes by itself', async () => {
    const { call, up, lead, list, uploadsDir } = await start();
    await up(`/api/leads/${lead}/attachments`, ['old.png', 'edge.png', 'new.png', 'bad.png', 'future.png', 'none.png', 'oldpdf.pdf'].map((n) => ({ name: n, data: n.endsWith('.pdf') ? Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100)]) : PNG, type: n.endsWith('.pdf') ? 'application/pdf' : 'image/png' })));
    const mf = join(uploadsDir, lead, 'manifest.json'), m = JSON.parse(readFileSync(mf, 'utf8')), D = 86_400_000, now = Date.now();
    const at: Record<string, string | undefined> = { 'old.png': new Date(now - 10 * D).toISOString(), 'edge.png': new Date(now - 3 * D + 120_000).toISOString(), 'new.png': new Date(now).toISOString(),
      'bad.png': 'not-a-date', 'future.png': new Date(now + 5 * D).toISOString(), 'none.png': undefined, 'oldpdf.pdf': new Date(now - 30 * D).toISOString() };
    for (const a of m) { if (at[a.name] === undefined) delete a.createdAt; else a.createdAt = at[a.name]; }
    writeFileSync(mf, JSON.stringify(m));
    const names = (d: any) => d.items.map((x: any) => x.name).sort();
    const d3 = await list('?olderThanDays=3');
    expect(names(d3)).toEqual(['old.png', 'oldpdf.pdf']); // edge (3 days minus 2 min) is NOT older than 3 days
    expect(d3.unknownAge).toBe(3); expect(d3.olderThanDays).toBe(3);
    expect(Date.parse(d3.serverTime) - Date.parse(d3.cutoff)).toBe(3 * D);
    expect(d3.items.find((x: any) => x.name === 'old.png').ageDays).toBe(10);
    expect((await list('?olderThanDays=2')).items.map((x: any) => x.name)).toContain('edge.png');
    expect(names(await list('?olderThanDays=3&type=image'))).toEqual(['old.png']);
    expect(names(await list('?olderThanDays=3&q=pdf'))).toEqual(['oldpdf.pdf']);
    const pg = await list('?olderThanDays=3&limit=1'); expect(pg.total).toBe(2); expect(pg.items).toHaveLength(1);
    expect((await list('?olderThanDays=3650')).total).toBe(0);
    for (const bad of ['0', '-1', '1.5', 'abc', '3651', '1e3', '99999']) expect((await call('sa', 'GET', `/api/storage?olderThanDays=${bad}`)).statusCode).toBe(400);
    expect((await list()).uploads.files).toBe(7); // filtering deleted nothing
    // Deleting still needs the explicit per-file confirm payload; an age query alone deletes nothing.
    expect((await call('sa', 'POST', '/api/storage/delete', { olderThanDays: 3, confirm: true })).statusCode).toBe(400);
    const f = d3.items.find((x: any) => x.name === 'old.png');
    const dr = (await del(call, f)).json().data.results[0]; expect(dr.code ?? 'ok').toBe('ok');
    expect(existsSync(join(uploadsDir, f.key, f.id))).toBe(false);
    expect((await list()).uploads.files).toBe(6);
  });
});
