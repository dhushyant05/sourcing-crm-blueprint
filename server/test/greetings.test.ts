import { describe, expect, it } from 'vitest';
import { PNG, form, setup } from './portal-helpers.js';

const BIGPNG = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('greetings', () => {
  it('permissions, safe content, upload rules, publish gate, live window and delivery', async () => {
    const { app, db, call, as, customer, ids, tok } = await setup();
    const up = (who: string, id: string, kind: string, name: string, data: Buffer, type: string) => { const f = form({}, [{ name, data, type }]);
      return app.inject({ method: 'POST', url: `/api/greetings/${id}/image/${kind}`, payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${tok[who]}` } }); };
    // Only explicit permission holders manage; publishing is a separate permission (India admin has manage, not publish).
    for (const who of ['is', 'cs', 'ca']) expect((await call(who, 'GET', '/api/greetings')).statusCode).toBe(403);
    const now = Date.now(), ist = (ms: number) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 16); // local IST "YYYY-MM-DDTHH:mm"
    expect((await call('ia', 'POST', '/api/greetings', { name: 'x', linkPath: 'https://evil.example' })).json().code).toBe('invalid');
    expect((await call('ia', 'POST', '/api/greetings', { name: 'x', linkPath: '//evil.example' })).json().code).toBe('invalid');
    expect((await call('ia', 'POST', '/api/greetings', { name: 'x', startsAt: ist(now), endsAt: ist(now - 3600e3) })).json().code).toBe('invalid');
    const cr = await call('ia', 'POST', '/api/greetings', { name: 'Diwali 2026 (internal)', layout: 'FESTIVE', theme: 'GOLD', heading: 'Happy <b>Diwali</b>!', message: 'Warm wishes\u0007 from Source Easy',
      surfaces: ['PUBLIC', 'PORTAL', 'APP'], startsAt: ist(now - 60e3), endsAt: ist(now + 864e5), priority: 5, linkPath: '/portal', linkLabel: 'Open portal' });
    expect(cr.statusCode).toBe(201);
    const g = cr.json().data;
    expect(g).toMatchObject({ status: 'DRAFT', heading: 'Happy bDiwali/b!', message: 'Warm wishes from Source Easy', surfaces: ['PUBLIC', 'PORTAL', 'APP'] });
    expect(Math.abs(new Date(g.startsAt).getTime() - (now - 60e3))).toBeLessThan(60e3); // IST input stored as the right instant
    // Upload: raster only, ≤ 2 MB, sniffed; SVG refused; China cannot.
    expect((await up('ia', g.id, 'desktop', 'x.svg', SVG, 'image/svg+xml')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await up('ia', g.id, 'desktop', 'fake.png', Buffer.from('<html>'), 'image/png')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await up('ia', g.id, 'desktop', 'big.png', BIGPNG, 'image/png')).statusCode).toBe(413);
    expect((await up('cs', g.id, 'desktop', 'a.png', PNG, 'image/png')).statusCode).toBe(403);
    expect((await up('ia', g.id, 'banner', 'a.png', PNG, 'image/png')).statusCode).toBe(400);
    expect((await up('ia', g.id, 'desktop', 'a.png', PNG, 'image/png')).statusCode).toBe(200);
    // Drafts are never delivered; images of drafts are not public.
    expect((await app.inject({ method: 'GET', url: '/api/public/greetings' })).json().data).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/public/greetings/${g.id}/image/desktop` })).statusCode).toBe(404);
    // Publish needs the publish permission + complete content (alt text for artwork).
    expect((await call('ia', 'POST', `/api/greetings/${g.id}/publish`)).statusCode).toBe(403);
    expect((await call('sa', 'POST', `/api/greetings/${g.id}/publish`)).json().code).toBe('incomplete');
    await call('ia', 'PATCH', `/api/greetings/${g.id}`, { altText: 'Diyas and rangoli' });
    // Super admin grants publish to the India admin explicitly.
    expect((await call('sa', 'PUT', `/api/users/${ids.ia}/permissions`, { permissions: { 'greetings.publish': true } })).statusCode).toBe(200);
    const pub = await call('ia', 'POST', `/api/greetings/${g.id}/publish`);
    expect(pub.statusCode).toBe(200); expect(pub.json().data).toMatchObject({ status: 'PUBLISHED', version: 2 });
    expect((await call('ia', 'PATCH', `/api/greetings/${g.id}`, { heading: 'x' })).json().code).toBe('published');
    // Public feed: customer-safe DTO only.
    const pf = await app.inject({ method: 'GET', url: '/api/public/greetings' });
    expect(pf.headers['cache-control']).toContain('max-age=60');
    const item = pf.json().data[0];
    expect(item).toMatchObject({ id: g.id, version: 2, layout: 'FESTIVE', theme: 'GOLD', alt: 'Diyas and rangoli', link: { path: '/portal', label: 'Open portal' }, dismissible: true });
    expect(JSON.stringify(item)).not.toMatch(/internal|createdBy|Staff/);
    const img = await app.inject({ method: 'GET', url: item.imageDesktop });
    expect(img.statusCode).toBe(200); expect(img.headers['content-type']).toBe('image/png'); expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(String(img.headers['content-security-policy'])).toContain("default-src 'none'");
    expect((await app.inject({ method: 'GET', url: '/api/public/greetings?surface=PORTAL' })).statusCode).toBe(400);
    // Portal / app feeds require a customer token.
    expect((await app.inject({ method: 'GET', url: '/api/portal/greetings' })).statusCode).toBe(401);
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    expect((await as(A.token, 'GET', '/api/portal/greetings?surface=APP')).json().data.map((x: any) => x.id)).toEqual([g.id]);
    // Expiry is server-side: a greeting whose window ended is not delivered. Unpublish removes it immediately.
    const old = (await call('sa', 'POST', '/api/greetings', { name: 'old', heading: 'Old', startsAt: ist(now - 2 * 864e5), endsAt: ist(now + 3600e3) })).json().data;
    await call('sa', 'POST', `/api/greetings/${old.id}/publish`);
    expect((await app.inject({ method: 'GET', url: '/api/public/greetings' })).json().data.map((x: any) => x.id)).toEqual([g.id, old.id]); // priority order
    await db.run("UPDATE greetings SET ends_at = now() - interval '1 minute' WHERE id = ?", old.id);
    expect((await app.inject({ method: 'GET', url: '/api/public/greetings' })).json().data.map((x: any) => x.id)).toEqual([g.id]);
    expect((await call('ia', 'POST', `/api/greetings/${g.id}/unpublish`)).json().data.status).toBe('UNPUBLISHED');
    expect((await app.inject({ method: 'GET', url: '/api/public/greetings' })).json().data).toEqual([]);
    expect((await app.inject({ method: 'GET', url: item.imageDesktop })).statusCode).toBe(404);
    // Audit trail.
    const audit = (await call('ia', 'GET', `/api/greetings/${g.id}`)).json().data.audit.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['CREATED', 'IMAGE_UPLOADED', 'EDITED', 'PUBLISHED', 'UNPUBLISHED']));
    expect((await call('ia', 'DELETE', `/api/greetings/${g.id}`)).statusCode).toBe(204);
    await app.close();
  });
});
