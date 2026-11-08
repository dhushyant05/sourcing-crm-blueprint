import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from './portal-helpers.js';

describe('customer app download (separate from the staff app)', () => {
  it('serves its own manifest and APK; 404 until published; staff APK untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dl-'));
    const { app } = await setup({ downloadsDir: dir });
    expect((await app.inject({ method: 'GET', url: '/download/customer/version.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/download/source-easy-customer.apk' })).statusCode).toBe(404);
    mkdirSync(join(dir, 'customer'));
    writeFileSync(join(dir, 'customer', 'source-easy-customer.apk'), Buffer.from('PKapk'));
    writeFileSync(join(dir, 'customer', 'version.json'), JSON.stringify({ version: '1.0.1', build: 2, sha256: 'a'.repeat(64), secretField: 'x' }));
    const v = (await app.inject({ method: 'GET', url: '/download/customer/version.json' })).json();
    expect(v).toEqual({ version: '1.0.1', build: 2, sha256: 'a'.repeat(64), minBuild: null, notes: null, size: 5, url: '/download/source-easy-customer.apk' });
    const a = await app.inject({ method: 'GET', url: '/download/source-easy-customer.apk' });
    expect(a.statusCode).toBe(200); expect(a.headers['content-type']).toBe('application/vnd.android.package-archive'); expect(a.body).toBe('PKapk');
    expect((await app.inject({ method: 'GET', url: '/download/version.json' })).statusCode).toBe(404); // staff manifest is separate
  });
});
