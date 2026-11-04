// Public landing page, desktop (1440) + phone (390), EN + 中文. Usage: npm run build && node scripts/landing-screenshots.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../../docs/screenshots/landing/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const srv = spawn('npx', ['vite', 'preview', '--port', '4321', '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const [dev, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    for (const lang of ['en', 'zh-CN']) {
      const p = `${lang === 'en' ? '' : 'zh-'}${dev}`;
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: dev === 'phone' ? 2 : 1, isMobile: dev === 'phone' });
      await page.goto('http://localhost:4321/');
      await page.evaluate((l) => localStorage.setItem('se.lang', l), lang);
      await page.reload(); await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}${p}-hero.png` });
      await page.screenshot({ path: `${out}${p}-full.png`, fullPage: true });
      await page.locator('#contact').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}${p}-contact.png` });
      await page.close();
    }
  }
} finally { await browser.close(); process.kill(-srv.pid); }
console.log('landing screenshots ->', out);
