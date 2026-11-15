import { describe, expect, it } from 'vitest';
import { setup, PW } from './portal-helpers.js';
import { MIN_PASSWORD } from '../src/users.js';
import { PORTAL_MIN_PASSWORD } from '../src/portal.js';
import { ROLES } from '../src/roles.js';
import { manageableRoles } from '../src/roles.js';

async function env() {
  const e = await setup();
  const created = await e.call('sa', 'POST', '/api/users', { email: 'mt@x.in', name: 'Market', role: 'MARKETPLACE_TEAM', password: PW });
  if (created.statusCode !== 201) throw new Error(`create MT failed ${created.statusCode} ${created.body}`);
  const mtTok = (await e.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'mt@x.in', password: PW } })).json().token;
  const mt = (method: any, url: string, payload?: any, headers: Record<string, string> = {}) =>
    e.app.inject({ method, url, payload, headers: { authorization: `Bearer ${mtTok}`, ...headers } });
  return { ...e, mt, mtTok };
}

const signup = (app: any, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/public/supplier/signup', payload: body });

const loginAs = async (app: any, email: string, password: string) => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return r;
};

describe('supplier signup and verification', () => {
  it('keeps existing password minimums and does not offer SUPPLIER in the staff team picker', () => {
    expect(MIN_PASSWORD).toBe(1);
    expect(PORTAL_MIN_PASSWORD).toBe(8);
    expect(manageableRoles('SUPER_ADMIN')).not.toContain('SUPPLIER');
    expect(ROLES).toContain('SUPPLIER');
  });

  it('signs a supplier up as pending, blocks products until verified, and lets Marketplace Team verify or reject', async () => {
    const { app, mt, call, db } = await env();
    const short = await signup(app, { company: 'TEST Co', contactName: 'Li', email: 'sup-short@x.in', password: 'short' });
    expect(short.statusCode).toBe(400);
    expect(short.json().code).toBe('password');

    const created = await signup(app, {
      company: 'TEST - Source Easy QA Factory',
      contactName: 'TEST Supplier Contact',
      email: 'test-supplier@x.in',
      password: 'Testqa-tumbler1',
      phone: '+86 0000',
      catalogConsent: true,
      publicRegion: 'Zhejiang, China (TEST)',
      publicYears: 5,
      publicAbout: 'TEST catalog card only',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ company: 'TEST - Source Easy QA Factory', status: 'PENDING' });
    expect(created.json().data).not.toHaveProperty('supplierId');

    const signed = await loginAs(app, 'test-supplier@x.in', 'Testqa-tumbler1');
    expect(signed.statusCode).toBe(200);
    expect(signed.json().user.role).toBe('SUPPLIER');
    expect(signed.json().user.supplierStatus).toBe('PENDING');
    const tok = signed.json().token;
    const asSup = (method: string, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok}` } });

    expect((await asSup('GET', '/api/records/leads')).statusCode).toBe(403);
    expect((await asSup('GET', '/api/orders')).statusCode).toBe(403);
    expect((await asSup('GET', '/api/shipping-requests')).statusCode).toBe(403);
    expect((await asSup('GET', '/api/customers')).statusCode).toBe(403);
    expect((await asSup('POST', '/api/products', { title: 'Should not work yet' })).statusCode).toBe(403);

    expect((await call('ia', 'GET', '/api/supplier/applications')).statusCode).toBe(403);
    expect((await call('is', 'POST', `/api/supplier/applications/${created.json().data.id}/verify`)).statusCode).toBe(403);

    const list = (await mt('GET', '/api/supplier/applications?status=PENDING')).json().data as any[];
    const appn = list.find((x) => x.loginEmail === 'test-supplier@x.in');
    expect(appn).toBeTruthy();
    const noReason = await mt('POST', `/api/supplier/applications/${appn.id}/reject`, { reason: '' });
    expect(noReason.statusCode).toBe(400);

    const rejected = await mt('POST', `/api/supplier/applications/${appn.id}/reject`, { reason: 'TEST incomplete documents' });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.status).toBe('REJECTED');

    const afterReject = await loginAs(app, 'test-supplier@x.in', 'Testqa-tumbler1');
    expect(afterReject.json().user.supplierStatus).toBe('REJECTED');
    expect(afterReject.json().user.supplierRejectReason).toMatch(/incomplete/);
    const tok2 = afterReject.json().token;
    const asSup2 = (method: string, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok2}` } });
    expect((await asSup2('POST', '/api/products', { title: 'Still blocked' })).statusCode).toBe(403);
    expect((await asSup2('POST', '/api/supplier/me/resubmit')).statusCode).toBe(200);

    const verified = await mt('POST', `/api/supplier/applications/${appn.id}/verify`);
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.status).toBe('VERIFIED');

    const signed3 = await loginAs(app, 'test-supplier@x.in', 'Testqa-tumbler1');
    expect(signed3.json().user.supplierStatus).toBe('VERIFIED');
    const tok3 = signed3.json().token;
    const asSup3 = (method: string, url: string, payload?: any) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${tok3}` } });

    const product = await asSup3('POST', '/api/products', {
      title: 'TEST supplier own tumbler',
      moq: 100,
      supplierId: 'should-be-ignored-foreign',
      priceMode: 'TIERS',
      tiers: [{ minQty: 100, maxQty: null, unitPrice: 9 }],
    });
    expect(product.statusCode).toBe(201);
    expect(product.json().data.status).toBe('DRAFT');
    expect(product.json().data.supplierId).toBe(verified.json().data.supplierId);
    expect(product.json().data.priceMode).toBe('GET_QUOTE');
    expect(product.json().data.tiers ?? []).toEqual([]);

    expect((await asSup3('POST', `/api/products/${product.json().data.id}/publish`)).statusCode).toBe(403);

    const submitted = await asSup3('POST', `/api/products/${product.json().data.id}/submit-review`);
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().data.status).toBe('PENDING_REVIEW');

    const other = await mt('POST', '/api/products', { title: 'Other factory mug' });
    expect(other.statusCode).toBe(201);
    expect((await asSup3('GET', `/api/products/${other.json().data.id}`)).statusCode).toBe(404);
    const listed = (await asSup3('GET', '/api/products')).json().data as any[];
    expect(listed.every((p) => p.id === product.json().data.id || p.title.includes('TEST supplier'))).toBe(true);
    expect(listed.some((p) => p.id === other.json().data.id)).toBe(false);

    await mt('POST', `/api/products/${product.json().data.id}/publish`);
    const pub = (await app.inject({ method: 'GET', url: `/api/public/catalog/products/${product.json().data.slug}` })).json().data;
    expect(pub.supplier).toBeNull();
    expect(pub.supplierAvailable).toBe(true);
    expect(JSON.stringify(pub)).not.toMatch(/test-supplier@x\.in|\+86 0000|factory cost/i);

    expect((await asSup3('PATCH', `/api/products/${product.json().data.id}`, { title: 'Edited live' })).statusCode).toBe(409);

    // Super admin cannot create a SUPPLIER staff user from Team.
    const blocked = await call('sa', 'POST', '/api/users', { email: 'forged-supplier@x.in', name: 'Nope', role: 'SUPPLIER', password: PW });
    expect(blocked.statusCode).toBe(403);
    void db;
  });
});
