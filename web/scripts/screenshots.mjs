// Usage: npm run build && npm run screenshots   (uses system Chrome; set CHROME_PATH to override)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const out = new URL('../../docs/screenshots/', import.meta.url).pathname;
const srv = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
    await page.goto('http://localhost:4319/app');
    await page.evaluate((t) => { localStorage.setItem('theme', t); localStorage.setItem('se.lang', 'en'); }, theme);
    if (theme === 'light') { await page.reload(); await page.screenshot({ path: `${out}login.png` }); }
    await page.reload();
    await page.getByText('Explore with demo data').click();
    const shot = async (hash, name, extra) => {
      await page.evaluate((h) => (location.hash = h), hash);
      await page.waitForTimeout(900);
      if (extra) await extra();
      await page.screenshot({ path: `${out}${name}-${theme}.png` });
    };
    await shot('/dashboard', 'dashboard');
    await shot('/leads', 'leads-board');
    if (theme === 'light') {
      await shot('/leads', 'lead-detail', async () => { await page.locator('article').first().click(); await page.waitForTimeout(500); });
      await page.keyboard.press('Escape');
      await shot('/quotations', 'quotations');
      await shot('/shipping', 'shipping-detail', async () => { await page.locator('tbody tr').first().click(); await page.waitForTimeout(500); });
      await page.keyboard.press('Escape');
      await shot('/settings', 'settings');
      await page.evaluate(() => { localStorage.leadView = 'table'; });
      await page.evaluate(() => (location.hash = '/dashboard'));
      await shot('/leads', 'leads-table');
      await page.evaluate(() => { localStorage.leadView = 'board'; localStorage.sidebar = 'collapsed'; });
      await page.reload();
      await shot('/dashboard', 'dashboard-collapsed-loading', async () => { await page.reload(); await page.waitForTimeout(150); });
      await page.evaluate(() => { localStorage.sidebar = 'open'; });
      // Price forms with the currency picker (USD / RMB / INR) — no conversion.
      await shot('/quotations', 'quotation-price-form', async () => {
        await page.locator('tbody tr').nth(2).click(); await page.waitForTimeout(500);
        await page.getByTestId('client-price-currency').selectOption('USD'); await page.fill('#client-price', '31.50');
      });
      await page.keyboard.press('Escape');
      await shot('/leads', 'new-lead-currency', async () => {
        await page.getByRole('button', { name: 'New lead' }).click(); await page.waitForTimeout(400);
        await page.fill('#target-price', '9.80'); await page.getByTestId('target-price-currency').selectOption('CNY');
      });
      await page.keyboard.press('Escape');
      // Simplified Chinese via the header switch (top-right).
      await page.getByTestId('lang-switch').getByText('中文').click();
      await shot('/dashboard', 'zh-dashboard');
      await shot('/quotations', 'zh-quotations');
      await shot('/quotations', 'zh-quotation-price-form', async () => { await page.locator('tbody tr').first().click(); await page.waitForTimeout(500); });
      await page.keyboard.press('Escape');
      await shot('/leads', 'zh-leads-board');
      await shot('/settings', 'zh-settings');
      await page.getByRole('button', { name: '退出登录' }).click(); await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}zh-login.png` });
      await page.evaluate(() => localStorage.setItem('se.lang', 'en'));
    }
    await page.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log('screenshots written to', out);
