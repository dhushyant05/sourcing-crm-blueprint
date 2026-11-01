import { describe, expect, it } from 'vitest';
import { TwentyRest } from '../src/twenty.js';

function fake() {
  const calls: { method: string; url: string; body?: any }[] = [];
  const f = (async (url: string, init: any) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url, body });
    const plural = url.split('/rest/')[1].split(/[/?]/)[0];
    const rec = plural === 'quotations' ? { id: 'q1', costCurrency: 'CNY', unitCost: 1 } : { id: 't1', seRole: 'CHINA_STAFF', email: 'a@b.c' };
    const one = plural.replace(/s$/, '');
    const data = init.method === 'GET' && !url.includes(`${plural}/`) ? { [plural]: [rec] }
      : init.method === 'POST' ? { [`create${one[0].toUpperCase()}${one.slice(1)}`]: rec }
      : init.method === 'PATCH' ? { [`update${one[0].toUpperCase()}${one.slice(1)}`]: rec } : { [one]: rec };
    return new Response(JSON.stringify({ data, pageInfo: { hasNextPage: false } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, t: new TwentyRest('http://tw', 'k', f) };
}

describe('Twenty reserved field renames', () => {
  it('maps quotation currency <-> costCurrency', async () => {
    const { t, calls } = fake();
    expect(await t.create('quotations', { currency: 'CNY', unitCost: 1 })).toEqual({ id: 'q1', currency: 'CNY', unitCost: 1 });
    expect(calls[0].body).toEqual({ costCurrency: 'CNY', unitCost: 1 });
    expect((await t.get('quotations', 'q1'))?.currency).toBe('CNY');
    expect((await t.list('quotations'))[0]).not.toHaveProperty('costCurrency');
  });
  it('maps teamMember role <-> seRole, including filters and updates', async () => {
    const { t, calls } = fake();
    expect((await t.list('teamMembers', { role: 'CHINA_STAFF' }))[0].role).toBe('CHINA_STAFF');
    expect(decodeURIComponent(calls[0].url)).toContain('seRole[eq]');
    await t.update('teamMembers', 't1', { role: 'SUPER_ADMIN' });
    expect(calls[1].body).toEqual({ seRole: 'SUPER_ADMIN' });
  });
  it('leaves other objects alone', async () => {
    const { t, calls } = fake();
    await t.create('leads', { currency: 'USD' });
    expect(calls[0].body).toEqual({ currency: 'USD' });
  });
});
