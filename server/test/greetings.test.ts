import { describe, expect, it } from 'vitest';
import { PNG, form, pngOf, setup } from './portal-helpers.js';

const BIGPNG = pngOf(2000, 1000, 10 * 1024 * 1024 + 10); // over the 10 MB limit
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

  it('image-only greeting: one upload (PNG/JPEG/WebP ≤ 10 MB, decode-size checked) creates a ready draft for every surface', async () => {
    const { app, call, as, customer, tok } = await setup();
    const send = (who: string, data: Buffer, name = 'diwali.png', type = 'image/png') => { const f = form({}, [{ name, data, type }]);
      return app.inject({ method: 'POST', url: '/api/greetings/upload', payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${tok[who]}` } }); };
    // ACL unchanged: no greetings.manage → 403; India admin manages but cannot publish.
    for (const who of ['is', 'cs', 'ca']) expect((await send(who, pngOf(1200, 600))).statusCode).toBe(403);
    // > 2 MB (old limit) is accepted now.
    const big = pngOf(4000, 2000, 6 * 1024 * 1024);
    const r = await send('ia', big); expect(r.statusCode).toBe(201);
    const g = r.json().data;
    expect(g).toMatchObject({ layout: 'IMAGE', status: 'DRAFT', heading: null, message: null, altText: 'Source Easy greeting', surfaces: ['PUBLIC', 'PORTAL', 'APP'], problems: [] });
    expect(new Date(g.endsAt).getTime() - Date.now()).toBeGreaterThan(5 * 365 * 864e5); // live until unpublished
    expect((await call('ia', 'POST', `/api/greetings/${g.id}/publish`)).statusCode).toBe(403);
    expect((await call('sa', 'POST', `/api/greetings/${g.id}/publish`)).json().data.status).toBe('PUBLISHED');
    // Delivered everywhere with the single image (desktop URL; mobile falls back to it on every client).
    const pub = (await app.inject({ method: 'GET', url: '/api/public/greetings' })).json().data[0];
    expect(pub).toMatchObject({ id: g.id, layout: 'IMAGE', imageMobile: null }); expect(pub.imageDesktop).toContain(`/api/public/greetings/${g.id}/image/desktop`);
    const img = await app.inject({ method: 'GET', url: pub.imageDesktop });
    expect(img.statusCode).toBe(200); expect(img.headers['content-type']).toBe('image/png'); expect(img.rawPayload.length).toBe(big.length);
    const A = await customer('Asha', '9876543210', 'Asha Traders');
    expect((await as(A.token, 'GET', '/api/portal/greetings?surface=APP')).json().data.map((x: any) => x.id)).toContain(g.id);
    // JPEG and WebP (VP8X) headers are read too.
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x05, 0xdc, 0x07, 0xd0, 3]), Buffer.alloc(3 * 1024 * 1024)]); // 2000×1500
    expect((await send('sa', jpg, 'a.jpg', 'image/jpeg')).statusCode).toBe(201);
    const webp = Buffer.alloc(40); webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1'); webp.writeUIntLE(1919, 24, 3); webp.writeUIntLE(1079, 27, 3);
    expect((await send('sa', webp, 'a.webp', 'image/webp')).statusCode).toBe(201);
    // Rejected: over 10 MB, too many pixels / too long a side, unreadable header, non-raster.
    expect((await send('sa', BIGPNG)).statusCode).toBe(413);
    expect((await send('sa', pngOf(9000, 100))).json().code).toBe('dimensions');
    expect((await send('sa', pngOf(7000, 7000))).json().code).toBe('dimensions');
    expect((await send('sa', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).json().code).toBe('type');
    expect((await send('sa', SVG, 'x.svg', 'image/svg+xml')).statusCode).toBe(415);
    expect((await send('sa', Buffer.from('GIF89a........'), 'x.gif', 'image/gif')).statusCode).toBe(415);
    // Replace image on a draft accepts large images too; a live greeting must be unpublished first.
    const d = (await send('sa', pngOf(1000, 500))).json().data;
    const f = form({}, [{ name: 'n.png', data: pngOf(3000, 1500, 3 * 1024 * 1024), type: 'image/png' }]);
    expect((await app.inject({ method: 'POST', url: `/api/greetings/${d.id}/image/desktop`, payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${tok.sa}` } })).statusCode).toBe(200);
    const f2 = form({}, [{ name: 'n.png', data: pngOf(1000, 500), type: 'image/png' }]);
    expect((await app.inject({ method: 'POST', url: `/api/greetings/${g.id}/image/desktop`, payload: f2.payload, headers: { ...f2.headers, authorization: `Bearer ${tok.sa}` } })).json().code).toBe('published');
  });
});
