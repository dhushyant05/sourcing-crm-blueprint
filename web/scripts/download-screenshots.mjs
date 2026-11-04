// Android download buttons + /download page (desktop + phone, EN/中文).
// Usage: npm run build && DOWNLOADS_DIR=/tmp/dl node scripts/download-screenshots.mjs  (publish an APK there first with infra/app-servers/publish-apk.sh)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../../docs/screenshots/download/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const PORT = 8097, U = `http://127.0.0.1:${PORT}`;
const srv = spawn('npx', ['tsx', 'scripts/demo-server.ts'], { cwd: new URL('../../server/', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const [dev, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ph = dev === 'phone';
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: ph ? 2 : 1, isMobile: ph, hasTouch: ph });
    const go = async (path, lang) => { await page.goto(`${U}${path}`); await page.evaluate((l) => localStorage.setItem('se.lang', l), lang); await page.reload(); await page.waitForTimeout(1200); };
    await go('/', 'en');
    await page.screenshot({ path: `${out}${dev}-landing-hero.png` });
    await page.locator('footer').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}${dev}-landing-footer.png` });
    await go('/app', 'en');
    await page.screenshot({ path: `${out}${dev}-login.png`, fullPage: true });
    for (const lang of ['en', 'zh-CN']) { await go('/download', lang); await page.screenshot({ path: `${out}${dev}-download-${lang}.png`, fullPage: true }); }
    await page.close();
  }
} finally { await browser.close(); try { process.kill(-srv.pid); } catch {} }
console.log('saved to', out);
