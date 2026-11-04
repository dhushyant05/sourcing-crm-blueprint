// Shared lead reference (SE-YYMM-NNNN): China lead detail (ref + photos, no customer), India lead detail, quotation.
// Usage: npm run build && node scripts/ref-screenshots.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../../docs/screenshots/reference/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const PORT = 8097, U = `http://127.0.0.1:${PORT}`;
const srv = spawn('npx', ['tsx', 'scripts/demo-server.ts'], { cwd: new URL('../../server/', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const login = async (email, lang = 'en') => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${U}/app`); await page.evaluate((l) => localStorage.setItem('se.lang', l), lang); await page.reload();
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'demo-password-1');
  await page.locator('button.btn-primary').first().click(); await page.waitForTimeout(1500);
  return page;
};
const photos = (page) => page.evaluate(() => [...document.querySelectorAll('h3')].find((x) => /Photos|照片/.test(x.textContent))?.scrollIntoView({ block: 'center' }));
try {
  for (const lang of ['en', 'zh']) {
    const page = await login('china@sourceeasy.in', lang);
    await page.goto(`${U}/app#/leads`); await page.waitForTimeout(1500);
    await page.getByText(/^SE-\d{4}-\d{4}$/).first().click(); await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}china-lead-detail-${lang}.png` });
    await photos(page); await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}china-lead-photos-${lang}.png` });
    await page.close();
  }
  {
    const page = await login('india@sourceeasy.in');
    await page.goto(`${U}/app#/leads`); await page.waitForTimeout(1500);
    await page.getByText('Mehta Kitchenware').first().click(); await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}india-lead-detail.png` });
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
    await page.goto(`${U}/app#/quotations`); await page.waitForTimeout(1500);
    await page.fill('header input', 'SE-2610-0002'); await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}india-quotations-list.png` });
    await page.getByText('QT-1', { exact: true }).first().click(); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}india-quotation-detail.png` });
    await page.close();
  }
} finally { await browser.close(); try { process.kill(-srv.pid); } catch {} }
console.log('saved to', out);
