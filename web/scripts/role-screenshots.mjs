// Real-login screenshots against server/scripts/demo-server.ts (mock Twenty). Shows server-side role filtering.
import { chromium } from 'playwright-core';
const base = process.env.BASE ?? 'http://127.0.0.1:8099', out = new URL('../../docs/screenshots/', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const [who, email] of [['china', 'china@sourceeasy.in'], ['india', 'india@sourceeasy.in'], ['india-admin', 'indiaadmin@sourceeasy.in']]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + '/'); await p.evaluate(() => localStorage.setItem('se.lang', 'en')); await p.reload();
  if (who === 'china') await p.screenshot({ path: `${out}login-server.png` });
  await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'demo-password-1');
  await p.click('button:has-text("Sign in")'); await p.waitForTimeout(1500);
  for (const r of ['quotations', 'leads', ...(who === 'india-admin' ? ['users'] : [])]) {
    await p.goto(`${base}/#/${r}`); await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}role-${who}-${r}.png` });
  }
  // Price form for this side: China edits supplier cost, India edits client price — each with a currency picker.
  await p.goto(`${base}/#/quotations`); await p.waitForTimeout(1200);
  await p.locator('tbody tr').first().click(); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}role-${who}-price-form.png` });
  await p.close();
}
await b.close();
