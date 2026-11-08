import { describe, expect, it } from 'vitest';
import { PNG, acceptFq, form, setup } from './portal-helpers.js';

describe('super-admin shipping request delete (soft)', () => {
  const start = async () => {
    const t = await setup();
    const A = await t.customer('Asha', '9876543210', 'Asha Traders');
    const f = form({ kind: 'FREIGHT_ONLY', goods: 'Lamps', pickupCity: 'Yiwu', destCity: 'Chennai' }, [{ name: 'invoice.png', data: PNG, type: 'image/png' }]);
    const r = (await t.app.inject({ method: 'POST', url: '/api/portal/shipping-requests', payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${A.token}` } })).json().data;
    const full = (await t.call('sa', 'GET', `/api/shipping-requests/${(r.id ?? r.request?.id)}`)).json().data;
    return { ...t, A, r: full };
  };
  const del = (call: any, r: any, b: Record<string, unknown> = {}) => call('sa', 'DELETE', `/api/shipping-requests/${r.id}`, { reason: 'Duplicate request', confirm: true, ref: r.ref, ...b });

  it('super admin only; needs confirm + matching ref + reason; hides it everywhere; keeps history, files and audit', async () => {
    const { call, as, A, r, db, uploadsDir } = await start();
    for (const who of ['ia', 'is', 'ca', 'cs']) expect((await call(who, 'DELETE', `/api/shipping-requests/${r.id}`, { reason: 'x', confirm: true, ref: r.ref })).statusCode).toBe(403);
    expect((await del(call, r, { confirm: false })).json().code).toBe('confirm');
    expect((await del(call, r, { ref: 'SH-0000-0000' })).json().code).toBe('confirm');
    expect((await del(call, r, { reason: '' })).statusCode).toBe(400);
    const fid = (await call('sa', 'GET', `/api/shipping-requests/${r.id}`)).json().data.files[0].id;
    expect((await del(call, r)).json().data).toMatchObject({ deleted: true, ref: r.ref });
    // Hidden: staff list/detail/files, customer list/detail/files, updates.
    expect((await call('sa', 'GET', '/api/shipping-requests')).json().data.some((x: any) => x.id === r.id)).toBe(false);
    for (const u of [`/api/shipping-requests/${r.id}`, `/api/shipping-requests/${r.id}/files/${fid}`]) expect((await call('sa', 'GET', u)).statusCode).toBe(404);
    expect((await as(A.token, 'GET', '/api/portal/shipping-requests')).json().data).toEqual([]);
    for (const u of [`/api/portal/shipping-requests/${r.id}`, `/api/portal/shipping-requests/${r.id}/files/${fid}`]) expect((await as(A.token, 'GET', u)).statusCode).toBe(404);
    expect((await call('is', 'PATCH', `/api/shipping-requests/${r.id}`, { internalNote: 'x' })).statusCode).toBe(404);
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 1 })).statusCode).toBe(404);
    expect((await del(call, r)).statusCode).toBe(404);
    // Kept: row, events (staff-only delete line, never shown to the customer), file on disk.
    const row = await db.get('SELECT deleted_at, deleted_by, delete_reason FROM shipping_requests WHERE id = ?', r.id);
    expect(row.deleted_at).toBeTruthy(); expect(row.delete_reason).toBe('Duplicate request');
    const ev = await db.get("SELECT customer_visible FROM shipping_request_events WHERE request_id = ? AND kind = 'SR_DELETED'", r.id); expect(ev.customer_visible).toBe(false);
    const { existsSync } = await import('node:fs'); const { join } = await import('node:path');
    expect(existsSync(join(uploadsDir, `sr_${r.id}`, fid))).toBe(true);
    const st = (await call('sa', 'GET', '/api/storage?owner=SHIPPING')).json().data.items[0];
    expect(st.places.map((p: any) => p.kind)).toEqual(['DELETED_SHIPPING_FILE']);
  });

  it('blocked once accepted or booked (clear reason); delete vs accept race never leaves a deleted accepted request', async () => {
    const { call, as, A, r } = await start();
    await call('is', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 50000 });
    const q = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data.freightQuotes[0];
    const [d, a] = await Promise.all([del(call, r), acceptFq(as, A.token, q.id)]);
    expect([d.statusCode, a.statusCode].filter((c) => c === 200)).toHaveLength(1);
    const row = (await call('sa', 'GET', `/api/shipping-requests/${r.id}`));
    if (d.statusCode === 200) expect(row.statusCode).toBe(404);
    else {
      expect(row.json().data.status).toBe('ACCEPTED'); expect(d.json().code).toBe('blocked'); expect(d.json().error).toMatch(/revert that acceptance/);
      expect((await call('cs', 'POST', `/api/china/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).json().data.status).toBe('BOOKED');
      const b = await del(call, r); expect(b.json().code).toBe('blocked'); expect(b.json().error).toMatch(/never deleted/);
      expect((await call('sa', 'GET', `/api/shipping-requests/${r.id}`)).json().data.status).toBe('BOOKED');
    }
  });

  it('accept after delete fails; China never sees a deleted request', async () => {
    const { call, as, A, r } = await start();
    await call('is', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 50000 });
    const q = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data.freightQuotes[0];
    expect((await del(call, r)).statusCode).toBe(200);
    expect((await acceptFq(as, A.token, q.id)).statusCode).toBe(404);
    expect((await as(A.token, 'POST', `/api/portal/freight-quotes/${q.id}/accept`, { version: 1, amount: 50000, currency: 'INR' })).statusCode).toBe(404);
    expect((await as(A.token, 'GET', `/api/portal/freight-quotes/${q.id}/pdf`)).statusCode).toBe(404);
    const china = await call('cs', 'GET', '/api/china/shipping-requests');
    expect(JSON.stringify(china.json())).not.toContain(r.id);
  });
});
