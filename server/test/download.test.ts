import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { testEnv } from './fixtures.js';

describe('Android app download', () => {
  it('serves the APK with the Android MIME type and attachment disposition, plus version.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-dl-'));
    const app = await buildApp({ ...(await testEnv()), jwtSecret: 'x'.repeat(40), downloadsDir: dir });
    expect((await app.inject({ url: '/download/source-easy.apk' })).statusCode).toBe(404);
    writeFileSync(join(dir, 'source-easy.apk'), Buffer.alloc(2048, 1));
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ version: '0.2.0', build: 3, published: '2026-11-01' }));
    const r = await app.inject({ url: '/download/source-easy.apk' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(r.headers['content-disposition']).toBe('attachment; filename="source-easy.apk"');
    expect(r.rawPayload.length).toBe(2048);
    const v = (await app.inject({ url: '/download/version.json' })).json();
    expect(v).toMatchObject({ version: '0.2.0', build: 3, size: 2048, url: '/download/source-easy.apk' });
  });
});
