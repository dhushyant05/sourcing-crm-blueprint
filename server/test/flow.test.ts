import { describe, expect, it } from 'vitest';
import { freightFlow, sourcingFlow } from '../src/portal.js';

const keys = (f: ReturnType<typeof sourcingFlow>) => f.steps.map((s) => s.key);
const state = (f: ReturnType<typeof sourcingFlow>) => Object.fromEntries(f.steps.map((s) => [s.key, s.state]));

describe('sourcingFlow', () => {
  it('starts at Enquiry and maps later customer-visible statuses only', () => {
    const t0 = '2026-01-01T00:00:00.000Z';
    const enquiry = sourcingFlow({ createdAt: t0, quotes: [], orders: [] });
    expect(keys(enquiry)).toEqual(['enquiry', 'quoted', 'accepted', 'order', 'payment', 'shipped', 'transit', 'arrived', 'delivered']);
    expect(enquiry.steps.map((s) => s.label)).toEqual(['Enquiry', 'Quoted', 'Accepted', 'Order confirmed', 'Payment', 'Shipped', 'In transit', 'Arrived', 'Delivered']);
    expect(state(enquiry)).toMatchObject({ enquiry: 'done', quoted: 'current', accepted: 'upcoming' });
    expect(enquiry.steps[0].at).toBe(t0);
    expect(enquiry.outcome).toBeNull();

    const quoted = sourcingFlow({ createdAt: t0, quotes: [{ status: 'SENT', sentAt: '2026-01-02T00:00:00.000Z' }], orders: [] });
    expect(state(quoted)).toMatchObject({ enquiry: 'done', quoted: 'done', accepted: 'current' });
    expect(quoted.steps[1].at).toBe('2026-01-02T00:00:00.000Z');

    const accepted = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED', sentAt: '2026-01-02T00:00:00.000Z', decidedAt: '2026-01-03T00:00:00.000Z' }], orders: [] });
    expect(state(accepted)).toMatchObject({ accepted: 'done', order: 'current', payment: 'upcoming' });

    const ordered = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED' }], orders: [{ createdAt: '2026-01-04T00:00:00.000Z', paymentStatus: 'PENDING' }] });
    expect(state(ordered)).toMatchObject({ order: 'done', payment: 'current', shipped: 'upcoming' });
    expect(ordered.steps.find((s) => s.key === 'order')!.at).toBe('2026-01-04T00:00:00.000Z');
    expect(ordered.steps.find((s) => s.key === 'payment')!.at).toBeNull();

    const paid = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED' }], orders: [{ createdAt: '2026-01-04T00:00:00.000Z', paymentStatus: 'PARTIAL' }] });
    expect(state(paid)).toMatchObject({ payment: 'done', shipped: 'current' });

    const booked = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED' }], orders: [{ paymentStatus: 'PAID' }], shipment: { status: 'BOOKED' } });
    expect(state(booked)).toMatchObject({ shipped: 'done', transit: 'current', arrived: 'upcoming' });

    const transit = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED' }], orders: [{ paymentStatus: 'PAID' }], shipment: { status: 'IN_TRANSIT' } });
    expect(state(transit)).toMatchObject({ shipped: 'done', transit: 'done', arrived: 'current' });

    const arrived = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED' }], orders: [{ paymentStatus: 'PAID' }], shipment: { status: 'CUSTOMS' } });
    expect(state(arrived)).toMatchObject({ arrived: 'done', delivered: 'current' });

    const delivered = sourcingFlow({ createdAt: t0, quotes: [{ status: 'ACCEPTED' }], orders: [{ paymentStatus: 'PAID' }], shipment: { status: 'DELIVERED', deliveredAt: '2026-02-01T00:00:00.000Z' } });
    expect(state(delivered)).toEqual({ enquiry: 'done', quoted: 'done', accepted: 'done', order: 'done', payment: 'done', shipped: 'done', transit: 'done', arrived: 'done', delivered: 'done' });
    expect(delivered.steps.find((s) => s.key === 'delivered')!.at).toBe('2026-02-01T00:00:00.000Z');
    expect(delivered.outcome).toBeNull();
  });

  it('marks rejected and cancelled clearly and does not advance later steps', () => {
    const rejected = sourcingFlow({ createdAt: '2026-01-01T00:00:00.000Z', quotes: [{ status: 'REJECTED', decidedAt: '2026-01-02T00:00:00.000Z' }], orders: [] });
    expect(rejected.outcome).toBe('rejected');
    expect(state(rejected)).toMatchObject({ enquiry: 'done', quoted: 'done', accepted: 'upcoming', order: 'upcoming' });
    expect(rejected.steps.some((s) => s.state === 'current')).toBe(false);

    const cancelled = sourcingFlow({ createdAt: '2026-01-01T00:00:00.000Z', quotes: [{ status: 'SENT' }], orders: [], lost: true });
    expect(cancelled.outcome).toBe('cancelled');
    expect(state(cancelled)).toMatchObject({ quoted: 'done', accepted: 'upcoming' });
    expect(cancelled.steps.some((s) => s.state === 'current')).toBe(false);
  });
});

describe('freightFlow', () => {
  it('maps freight-only statuses Submitted → Delivered', () => {
    const t0 = '2026-03-01T00:00:00.000Z';
    expect(freightFlow({ createdAt: t0, status: 'SUBMITTED' }).steps.map((s) => s.label)).toEqual(['Submitted', 'Quoted', 'Accepted', 'Booked', 'In transit', 'Arrived', 'Delivered']);
    expect(state(freightFlow({ createdAt: t0, status: 'UNDER_REVIEW' }))).toMatchObject({ submitted: 'done', quoted: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'NEEDS_INFO' }))).toMatchObject({ submitted: 'done', quoted: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'QUOTED', quotes: [{ status: 'SENT', createdAt: '2026-03-02T00:00:00.000Z' }] }))).toMatchObject({ quoted: 'done', accepted: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'ACCEPTED', quotes: [{ status: 'ACCEPTED', decidedAt: '2026-03-03T00:00:00.000Z' }] }))).toMatchObject({ accepted: 'done', booked: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'PENDING' }))).toMatchObject({ accepted: 'done', booked: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'BOOKED' }))).toMatchObject({ booked: 'done', transit: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'ACCEPTED', tracking: { stage: 'IN_TRANSIT' } }))).toMatchObject({ booked: 'done', transit: 'done', arrived: 'current' });
    expect(state(freightFlow({ createdAt: t0, status: 'ARRIVED' }))).toMatchObject({ arrived: 'done', delivered: 'current' });
    const done = freightFlow({ createdAt: t0, status: 'DELIVERED', tracking: { stage: 'DELIVERED', deliveredAt: '2026-03-10T00:00:00.000Z' } });
    expect(done.steps.every((s) => s.state === 'done')).toBe(true);
    expect(done.steps.find((s) => s.key === 'delivered')!.at).toBe('2026-03-10T00:00:00.000Z');
  });

  it('shows cancelled and rejected without advancing later steps', () => {
    const cancelled = freightFlow({ createdAt: '2026-03-01T00:00:00.000Z', status: 'CANCELLED' });
    expect(cancelled.outcome).toBe('cancelled');
    expect(cancelled.steps.some((s) => s.state === 'current')).toBe(false);
    const rejected = freightFlow({ createdAt: '2026-03-01T00:00:00.000Z', status: 'REJECTED', quotes: [{ status: 'SENT' }] });
    expect(rejected.outcome).toBe('rejected');
    expect(state(rejected)).toMatchObject({ quoted: 'done', accepted: 'upcoming' });
  });
});
