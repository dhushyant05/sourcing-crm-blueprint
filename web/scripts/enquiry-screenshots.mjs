// Enquiry form (desktop + phone, EN), success screen, and staff lead detail with attachments, against the real
// server running on a mock Twenty. Usage: npm run build && node scripts/enquiry-screenshots.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const out = new URL('../../docs/screenshots/enquiry/', import.meta.url).pathname;
const demo = new URL('../public/demo/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const PORT = 8097, URL0 = `http://127.0.0.1:${PORT}`;
const srv = spawn('npx', ['tsx', 'scripts/demo-server.ts'], { cwd: new URL('../../server/', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const fill = async (page) => {
  await page.fill('#eq-name', 'Anita Sharma'); await page.fill('#eq-biz', 'Sharma Home Decor');
  await page.fill('#eq-phone', '98765 43210'); await page.fill('#eq-email', 'anita@sharmadecor.in');
  await page.fill('#eq-product', 'Bamboo cutting boards, 3 sizes (S/M/L) with juice groove, logo laser-engraved');
  await page.fill('#eq-qty', '1200'); await page.fill('#eq-price', '180'); await page.fill('#eq-city', 'Chennai');
  await page.fill('#eq-ref', 'https://www.alibaba.com/product-detail/bamboo-board');
  await page.fill('#eq-msg', 'Need samples first. Packing: 1 pc per shrink pack, 20 per carton.');
  await page.setInputFiles('[data-testid=file-input]', [
    { name: 'board-front.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${demo}bamboo-board-1.jpg`) },
    { name: 'board-back.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${demo}bamboo-board-2.jpg`) },
    { name: 'spec-sheet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%demo\n') }]);
};
try {
  for (const [dev, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: dev === 'phone' ? 2 : 1, isMobile: dev === 'phone', hasTouch: dev === 'phone' });
    await page.goto(`${URL0}/`); await page.evaluate(() => localStorage.setItem('se.lang', 'en')); await page.reload();
    await page.waitForTimeout(800);
    const form = page.locator('#contact form');
    const shot = async (path) => { await page.addStyleTag({ content: 'header{position:absolute!important}' }); await page.waitForTimeout(200); const sel = (await page.locator('[data-testid=enquiry-ref]').count()) ? '[data-testid=enquiry-done]' : '#contact form'; const b = await page.locator(sel).boundingBox(); const y = await page.evaluate(() => scrollY); await page.screenshot({ path, fullPage: true, clip: { x: Math.max(0, b.x - 16), y: b.y + y - 16, width: Math.min(b.width + 32, vp.width - Math.max(0, b.x - 16)), height: b.height + 32 } }); };
    await shot(`${out}${dev}-form-empty.png`);
    await fill(page); await page.waitForTimeout(300);
    await shot(`${out}${dev}-form-filled.png`);
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await page.waitForSelector('[data-testid=enquiry-ref]'); await page.waitForTimeout(300);
    await shot(`${out}${dev}-success.png`);
    await page.close();
  }
  // Staff view: India / super admin sees the enquiry photos & documents in the lead panel.
  for (const [dev, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: dev === 'phone' ? 2 : 1, isMobile: dev === 'phone' });
    await page.goto(`${URL0}/app`); await page.evaluate(() => localStorage.setItem('se.lang', 'en')); await page.reload();
    await page.fill('input[type=email]', 'india@sourceeasy.in'); await page.fill('input[type=password]', 'demo-password-1');
    await page.locator('button.btn-primary').first().click(); await page.waitForTimeout(1500);
    await page.goto(`${URL0}/app#/leads`); await page.waitForTimeout(1500);
    await page.getByText('Mehta Kitchenware').first().click(); await page.waitForTimeout(2000);
    await page.evaluate(() => [...document.querySelectorAll('h3')].find((x) => /Photos/.test(x.textContent))?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}${dev}-lead-attachments.png` });
    await page.close();
  }
} finally {
  await browser.close();
  try { process.kill(-srv.pid); } catch {}
}
console.log('saved to', out);
