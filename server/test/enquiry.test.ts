import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { UserStore } from '../src/users.js';
import { MockTwenty } from './fixtures.js';

describe('public enquiry', () => {
  it('creates a website lead, ignores bots, rate-limits', async () => {
    const twenty = new MockTwenty();
    const app = await buildApp({ twenty, users: new UserStore(), jwtSecret: 'x'.repeat(40) });
    const post = (body: object) => app.inject({ method: 'POST', url: '/api/public/enquiry', payload: body });
    expect((await post({ name: 'A' })).statusCode).toBe(400);
    expect((await post({ name: 'Bot', product: 'x', phone: '1', website: 'spam' })).statusCode).toBe(202);
    const before = (await twenty.list('leads')).length;
    const r = await post({ name: 'Ravi', company: 'Ravi Traders', phone: '+919000000000', product: 'LED bulbs', quantity: '2000' });
    expect(r.statusCode).toBe(201);
    const leads = await twenty.list('leads');
    expect(leads.length).toBe(before + 1);
    expect(leads.at(-1)).toMatchObject({ clientName: 'Ravi Traders', sourceChannel: 'WEBSITE', status: 'NEW', quantity: 2000 });
    for (let i = 0; i < 4; i++) await post({ name: 'R', product: 'p', email: 'r@x.in' });
    expect((await post({ name: 'R', product: 'p', email: 'r@x.in' })).statusCode).toBe(429);
  });
});
