// Phone-size (390x844) web screenshots, English + Chinese. Usage: npm run build && node scripts/mobile-screenshots.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../../docs/screenshots/mobile-web/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const lang of ['en', 'zh-CN']) {
    const p = lang === 'en' ? '' : 'zh-';
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:4320/app');
    await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('theme', 'light'); localStorage.setItem('se.lang', l); }, lang);
    await page.reload(); await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}${p}login.png` });
    await page.locator('button', { hasText: lang === 'en' ? 'Explore with demo data' : /演示/ }).first().click();
    const shot = async (hash, name, extra) => {
      await page.evaluate((h) => (location.hash = h), hash);
      await page.waitForTimeout(900);
      if (extra) await extra();
      await page.screenshot({ path: `${out}${p}${name}.png` });
    };
    await shot('/dashboard', 'dashboard');
    await shot('/leads', 'leads-board');
    await shot('/quotations', 'quotations');
    await shot('/quotations', 'quotation-price-form', async () => {
      await page.locator('tbody tr').first().click(); await page.waitForTimeout(500);
      await page.getByTestId('client-price-currency').selectOption('USD'); await page.fill('#client-price', '31.50');
    });
    await page.keyboard.press('Escape');
    await shot('/shipping', 'shipping');
    await shot('/dashboard', 'drawer', async () => { await page.locator('header button').first().click(); await page.waitForTimeout(400); });
    await page.close();
  }
} finally { await browser.close(); process.kill(-srv.pid); }
console.log('mobile screenshots ->', out);
