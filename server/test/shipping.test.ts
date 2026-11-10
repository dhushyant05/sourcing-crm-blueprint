import { describe, expect, it } from 'vitest';
import { PNG, form, setup, acceptFq } from './portal-helpers.js';

describe('shipping requests (SH-YYMM-NNNN)', () => {
  it('freight-only: own customer, India queue, more-info loop, freight quote must be accepted before booking, customer-safe view', async () => {
    const { app, call, as, sse, customer, tok } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const B = await customer('Bala', '9988776655', 'Bala Exports');
    const post = (token: string, fields: Record<string, string>, files: { name: string; data: Buffer; type?: string }[] = [], url = '/api/portal/shipping-requests') => {
      const f = form(fields, files); return app.inject({ method: 'POST', url, payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${token}` } });
    };
    // Validation + ownership never from the body.
    expect((await post(A.token, { kind: 'FREIGHT_ONLY', goods: 'x', destCity: 'Chennai', pickupCity: 'Yiwu', customerId: B.customerId })).statusCode).toBe(400);
    expect((await post(A.token, { kind: 'FREIGHT_ONLY', goods: 'x', pickupCity: 'Yiwu' })).json().code).toBe('required');
    expect((await post(A.token, { kind: 'FREIGHT_ONLY', goods: 'x', destCity: 'Chennai' })).json().code).toBe('required');
    expect((await post(A.token, { kind: 'FREIGHT_ONLY', goods: 'x', destCity: 'Chennai', pickupCity: 'Yiwu', quantity: '-3' })).json().code).toBe('invalid');
    const cr = await post(A.token, { kind: 'FREIGHT_ONLY', goods: '200 cartons of LED bulbs', quantity: '200', unit: 'ctn', packages: '200', weightKg: '1800', cbm: '6.5',
      shipperName: 'My Yiwu supplier', shipperPhone: '+86 139', pickupCity: 'Yiwu', pickupAddress: 'Futian market 3', destCity: 'Chennai', destAddress: 'Parrys', destPincode: '600001', mode: 'sea' },
      [{ name: 'invoice.png', data: PNG, type: 'image/png' }]);
    expect(cr.statusCode).toBe(201);
    const r = cr.json().data;
    expect(r.reference).toMatch(/^SH-\d{4}-\d{4}$/);
    expect(r).toMatchObject({ kind: 'FREIGHT_ONLY', status: 'SUBMITTED', quantity: 200, weightKg: 1800, cbm: 6.5, mode: 'SEA', destPincode: '600001', canCancel: true });
    expect(r.files.map((f: any) => f.name)).toEqual(['invoice.png']);
    expect(r.timeline.map((e: any) => e.text)).toEqual(['Shipping request received']);
    const r2 = (await post(B.token, { kind: 'FREIGHT_ONLY', goods: 'B goods', destCity: 'Delhi', pickupCity: 'Shenzhen' })).json().data;
    expect(Number(r2.reference.slice(-4))).toBe(Number(r.reference.slice(-4)) + 1); // own sequential series
    // Isolation.
    expect((await as(B.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).statusCode).toBe(404);
    expect((await as(B.token, 'GET', `/api/portal/shipping-requests/${r.id}/files/${r.files[0].id}`)).statusCode).toBe(404);
    expect((await as(B.token, 'POST', `/api/portal/shipping-requests/${r.id}/cancel`)).statusCode).toBe(404);
    expect((await as(A.token, 'GET', '/api/portal/shipping-requests')).json().data.map((x: any) => x.reference)).toEqual([r.reference]);
    expect((await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}/files/${r.files[0].id}`)).statusCode).toBe(200);
    // Staff: India only; China never.
    for (const who of ['ca', 'cs']) {
      expect((await call(who, 'GET', '/api/shipping-requests')).statusCode).toBe(403);
      expect((await call(who, 'GET', `/api/shipping-requests/${r.id}`)).statusCode).toBe(403);
    }
    expect((await as(A.token, 'GET', '/api/shipping-requests')).statusCode).toBe(401);
    expect((await call('is', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'SHIP_REQUEST' && n.leadRef === r.reference)).toBe(true);
    for (const who of ['is', 'ia', 'sa']) {
      const listed = (await call(who, 'GET', '/api/shipping-requests')).json().data as { id: string; status: string; assignedTo: string | null }[];
      expect(listed.some((x) => x.id === r.id && x.status === 'SUBMITTED' && !x.assignedTo)).toBe(true);
    }
    const staff = (await call('is', 'GET', `/api/shipping-requests/${r.id}`)).json().data;
    expect(staff).toMatchObject({ ref: r.reference, customer: { id: A.customerId }, status: 'SUBMITTED', shipperName: 'My Yiwu supplier' });
    // India staff claims → under review; staff adds an internal note + file (never shown to the customer).
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/assign`, {})).json().data.status).toBe('UNDER_REVIEW');
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/assign`, { userId: 'someone-else' })).statusCode).toBe(403);
    await call('is', 'PATCH', `/api/shipping-requests/${r.id}`, { internalNote: 'secret-margin-note', incoterm: 'fob' });
    const sf = form({}, [{ name: 'internal-rates.png', data: PNG, type: 'image/png' }]);
    await app.inject({ method: 'POST', url: `/api/shipping-requests/${r.id}/files`, payload: sf.payload, headers: { ...sf.headers, authorization: `Bearer ${tok.is}` } });
    // Booking or accepting without a customer-accepted freight quote is refused.
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).json().code).toBe('freight_quote_required');
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/accept`)).json().code).toBe('freight_quote_required');
    // More info needed → customer answers with a file → back to review.
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/needs-info`, {})).statusCode).toBe(400);
    await call('is', 'POST', `/api/shipping-requests/${r.id}/needs-info`, { question: 'Please send the packing list' });
    let d = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data;
    expect(d).toMatchObject({ status: 'NEEDS_INFO', question: 'Please send the packing list', canReply: true });
    const rep = await post(A.token, { message: 'attached' }, [{ name: 'packing.png', data: PNG, type: 'image/png' }], `/api/portal/shipping-requests/${r.id}/reply`);
    expect(rep.statusCode).toBe(200);
    expect(rep.json().data.status).toBe('UNDER_REVIEW');
    expect((await post(A.token, { message: 'again' }, [], `/api/portal/shipping-requests/${r.id}/reply`)).statusCode).toBe(409);
    expect((await call('is', 'GET', '/api/notifications')).json().data.some((n: any) => n.kind === 'SHIP_REQUEST_UPDATE' && n.leadRef === r.reference)).toBe(true);
    // Freight quote F1 (with an internal cost) → customer declines → back to India; F2 → accepted.
    expect((await call('cs', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 1 })).statusCode).toBe(403);
    const f1 = (await call('is', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 85000, internalCost: 61000, mode: 'SEA', transit: '25 days', validUntil: '2026-12-31', customerNote: 'Door delivery included' })).json().data;
    expect(f1.status).toBe('QUOTED');
    d = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data;
    expect(d.freightQuotes).toHaveLength(1);
    expect(d.freightQuotes[0]).toMatchObject({ label: `${r.reference}-F1`, amount: 85000, currency: 'INR', note: 'Door delivery included', canDecide: true });
    const txt = JSON.stringify(d);
    for (const secret of ['61000', 'internalCost', 'secret-margin', 'internal-rates', 'Staff is', 'assignedTo', 'rejectReason']) expect(txt).not.toContain(secret);
    expect(d.files.map((f: any) => f.name).sort()).toEqual(['invoice.png', 'packing.png']);
    const q1 = d.freightQuotes[0].id;
    expect((await acceptFq(as, B.token, q1)).statusCode).toBe(404);
    expect((await as(A.token, 'POST', `/api/portal/freight-quotes/${q1}/reject`, { reasonCode: 'NOPE' })).statusCode).toBe(400);
    expect((await as(A.token, 'POST', `/api/portal/freight-quotes/${q1}/reject`, { reasonCode: 'PRICE', reason: 'too high' })).json().data.status).toBe('UNDER_REVIEW');
    expect((await acceptFq(as, A.token, q1)).statusCode).toBe(409);
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).json().code).toBe('freight_quote_required');
    await call('is', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 78000 });
    const q2 = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data.freightQuotes.find((q: any) => q.status === 'SENT').id;
    const acc = (await acceptFq(as, A.token, q2)).json().data;
    expect(acc).toMatchObject({ status: 'ACCEPTED', canCancel: false });
    expect((await as(A.token, 'POST', `/api/portal/shipping-requests/${r.id}/cancel`)).statusCode).toBe(409);
    // Now China books (India cannot book; China has no access to India's staff routes); stages move forward only; tracking is customer-visible. SSE announces own changes only.
    expect((await call('cs', 'POST', `/api/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).statusCode).toBe(403);
    expect((await call('is', 'POST', `/api/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).json().code).toBe('china_books');
    const s = await sse(A.token, async () => {
      expect((await call('cs', 'POST', `/api/china/shipping-requests/${r.id}/stage`, { status: 'BOOKED', carrier: 'COSCO', container: 'CSNU1234567', etd: '2026-11-20', eta: '2026-12-15' })).json().data.status).toBe('BOOKED');
      await call('is', 'PATCH', `/api/shipping-requests/${r2.id}`, { internalNote: 'b only' });
    });
    expect(s.text).toContain(`"id":"${r.id}"`); expect(s.text).not.toContain(r2.id);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${r.id}/stage`, { status: 'IN_TRANSIT' })).statusCode).toBe(200);
    expect((await call('cs', 'POST', `/api/china/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).statusCode).toBe(409);
    d = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data;
    expect(d.tracking).toMatchObject({ stage: 'IN_TRANSIT', carrier: 'COSCO', container: 'CSNU1234567', etd: '2026-11-20', eta: '2026-12-15' });
    expect(d.timeline.map((e: any) => e.text)).toEqual(['Shipping request received', 'Being reviewed by Source Easy', 'More information needed: Please send the packing list',
      'You sent more information', 'Freight quote F1 ready for you', 'Freight quote F1 declined', 'Freight quote F2 ready for you', 'Freight quote F2 accepted', 'Shipment Booked', 'Shipment In transit']);
    // Staff timeline has everything incl. internal events.
    const ev = (await call('is', 'GET', `/api/shipping-requests/${r.id}`)).json().data.events.map((e: any) => e.kind);
    expect(ev).toEqual(expect.arrayContaining(['SR_ASSIGNED', 'SR_EDITED', 'SR_FILE']));
    await app.close();
  });

  it('sourced: only from the customer\'s own portal-visible orders, one per order, tracking from the shipment; reject needs a reason', async () => {
    const { app, call, as, customer, orderFor } = await setup();
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    const B = await customer('Bala', '9988776655', 'Bala Exports');
    const aLead = (await as(A.token, 'GET', '/api/portal/requests')).json().data[0];
    const bLead = (await as(B.token, 'GET', '/api/portal/requests')).json().data[0];
    const { order: ao } = await orderFor(A.token, aLead.id);
    const { order: bo } = await orderFor(B.token, bLead.id);
    expect((await as(A.token, 'GET', '/api/portal/shippable-orders')).json().data.map((x: any) => x.id)).toEqual([ao.id]);
    // B's order (other customer) is "unknown"; so is an order on an internally-linked but unshared lead.
    expect((await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'SOURCED', orderId: bo.id, destCity: 'Chennai' })).statusCode).toBe(404);
    await call('ia', 'POST', `/api/leads/${aLead.id}/portal-share`, { shared: false });
    expect((await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'SOURCED', orderId: ao.id, destCity: 'Chennai' })).statusCode).toBe(404);
    await call('ia', 'POST', `/api/leads/${aLead.id}/portal-share`, { shared: true });
    // Freight-only cannot smuggle an order link.
    expect((await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'FREIGHT_ONLY', orderId: ao.id, goods: 'x', destCity: 'C', pickupCity: 'Y' })).statusCode).toBe(201);
    const fo = (await as(A.token, 'GET', '/api/portal/shipping-requests')).json().data[0];
    expect((await call('ia', 'GET', `/api/shipping-requests/${fo.id}`)).json().data).toMatchObject({ orderId: null, leadId: null });
    const cr = await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'SOURCED', orderId: ao.id, destCity: 'Chennai', destPincode: '600001' });
    expect(cr.statusCode).toBe(201);
    const r = cr.json().data;
    expect(r).toMatchObject({ kind: 'SOURCED', leadReference: aLead.reference, goods: ao.product, quantity: 100 });
    expect((await as(A.token, 'POST', '/api/portal/shipping-requests', { kind: 'SOURCED', orderId: ao.id, destCity: 'Chennai' })).json().code).toBe('exists');
    expect((await call('ia', 'POST', `/api/shipping-requests/${r.id}/freight-quotes`, { amount: 10 })).statusCode).toBe(409);
    expect((await call('ia', 'POST', `/api/shipping-requests/${r.id}/stage`, { status: 'BOOKED' })).statusCode).toBe(409);
    expect((await call('ia', 'POST', `/api/shipping-requests/${r.id}/accept`)).json().data.status).toBe('ACCEPTED');
    // Tracking comes from the order's Shipment (China books it in the existing Shipping flow).
    const sh = (await call('ia', 'GET', '/api/shipments')).json().data.find((x: any) => x.orderId === ao.id);
    await call('cs', 'PATCH', `/api/shipments/${sh.id}`, { status: 'BOOKED', container: 'MSCU7654321' });
    const d = (await as(A.token, 'GET', `/api/portal/shipping-requests/${r.id}`)).json().data;
    expect(d.tracking).toMatchObject({ stage: 'BOOKED', container: 'MSCU7654321' });
    expect(JSON.stringify(d)).not.toMatch(/Ningbo|wx_secret|supplier/i);
    // Reject needs a reason; the reason stays internal.
    expect((await call('ia', 'POST', `/api/shipping-requests/${fo.id}/reject`, {})).statusCode).toBe(400);
    await call('ia', 'POST', `/api/shipping-requests/${fo.id}/reject`, { reason: 'restricted-goods-internal' });
    const fd = (await as(A.token, 'GET', `/api/portal/shipping-requests/${fo.id}`)).json().data;
    expect(fd.status).toBe('REJECTED'); expect(JSON.stringify(fd)).not.toContain('restricted-goods-internal');
    expect(fd.timeline.at(-1).text).toBe('Request declined by Source Easy');
    // A customer with shipping requests cannot be deleted silently.
    expect((await call('ia', 'DELETE', `/api/customers/${A.customerId}`)).statusCode).toBe(409);
    await app.close();
  });
});
