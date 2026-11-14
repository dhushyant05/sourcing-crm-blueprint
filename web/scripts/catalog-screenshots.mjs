// Public marketplace + staff product screens (sample data, labelled Sample).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('../../docs/screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const svg = (title, color) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="48%" text-anchor="middle" fill="#fff" font-size="36" font-family="Arial">${title}</text><text x="50%" y="60%" text-anchor="middle" fill="#ffffffcc" font-size="22">SAMPLE</text></svg>`
)}`;

const products = [
  { id: 'p1', slug: 'stainless-hex-bolts-m8', title: 'Stainless Hex Bolts M8', summary: 'Grade 304 hex bolts. Sample product for the catalog preview.', category: { slug: 'hardware', name: 'Hardware' }, moq: 2000, unit: 'pcs', leadTime: '15–20 days', isSample: true, pinned: true,
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 0.08, max: 0.12 }, CNY: { min: 0.58, max: 0.86 }, INR: { min: 7, max: 10 } } },
    images: [{ id: 'i1', kind: 'CARD', altText: 'Stainless Hex Bolts M8 (sample)', url: svg('Stainless Hex Bolts M8', '#1a6d98') }] },
  { id: 'p2', slug: 'bamboo-cutting-board', title: 'Bamboo Cutting Board', summary: 'Bamboo board with juice groove. Sample product for the catalog preview.', category: { slug: 'housewares', name: 'Housewares' }, moq: 400, unit: 'pcs', leadTime: '20–30 days', isSample: true, pinned: true,
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 4.2, max: 6.5 }, CNY: { min: 30, max: 47 }, INR: { min: 351, max: 543 } } },
    images: [{ id: 'i2', kind: 'CARD', altText: 'Bamboo Cutting Board (sample)', url: svg('Bamboo Cutting Board', '#0e7490') }] },
  { id: 'p3', slug: 'led-panel-light-60x60', title: 'LED Panel Light 60×60', summary: '40 W recessed panel. Sample product for the catalog preview.', category: { slug: 'lighting', name: 'Lighting' }, moq: 200, unit: 'pcs', leadTime: '15–22 days', isSample: true, pinned: true,
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 8.5, max: 12 }, CNY: { min: 61, max: 86 }, INR: { min: 710, max: 1002 } } },
    images: [{ id: 'i3', kind: 'CARD', altText: 'LED Panel Light (sample)', url: svg('LED Panel Light', '#ea580c') }] },
  { id: 'p4', slug: 'cotton-tea-towels', title: 'Cotton Tea Towels', summary: 'Plain-weave cotton towels. Sample product for the catalog preview.', category: { slug: 'textiles', name: 'Textiles' }, moq: 600, unit: 'pcs', leadTime: '20–25 days', isSample: true,
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 1.1, max: 1.8 }, CNY: { min: 8, max: 13 }, INR: { min: 92, max: 150 } } },
    images: [{ id: 'i4', kind: 'CARD', altText: 'Cotton Tea Towels (sample)', url: svg('Cotton Tea Towels', '#56a33a') }] },
];
const categories = [
  { id: 'c1', slug: 'hardware', name: 'Hardware' }, { id: 'c2', slug: 'housewares', name: 'Housewares' },
  { id: 'c3', slug: 'kitchenware', name: 'Kitchenware' }, { id: 'c4', slug: 'lighting', name: 'Lighting' },
  { id: 'c5', slug: 'packaging', name: 'Packaging' }, { id: 'c6', slug: 'textiles', name: 'Textiles' },
];
const banners = [
  { id: 'b1', sort: 0, altText: 'Source from China, delivered worldwide', imageUrl: svg('Source from China, delivered worldwide', '#1a6d98'), href: '/products' },
  { id: 'b2', sort: 1, altText: 'Request a quote in a few taps', imageUrl: svg('Request a quote in a few taps', '#ea580c'), href: '/products' },
  { id: 'b3', sort: 2, altText: 'Clear prices in USD, RMB and INR', imageUrl: svg('Clear prices in USD, RMB and INR', '#56a33a'), href: '/products' },
];

async function mockCatalog(page) {
  await page.route('**/api/public/catalog/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/status')) return route.fulfill({ json: { homepageEnabled: true, hasPublished: true, showMarketplace: true } });
    if (url.includes('/categories')) return route.fulfill({ json: { data: categories } });
    if (url.includes('/banners')) return route.fulfill({ json: { data: banners, direction: 'LTR', intervalSeconds: 5 } });
    const prod = products.find((p) => url.includes(`/products/${p.slug}`));
    if (prod) return route.fulfill({ json: { data: prod } });
    if (url.includes('/products')) return route.fulfill({ json: { data: products, total: products.length, limit: 48, offset: 0 } });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
}

const srv = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url) });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme: 'light' });
    await mockCatalog(page);
    await page.goto('http://localhost:4320/');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}catalog-home-${name}.png`, fullPage: true });
    await page.goto('http://localhost:4320/products');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}catalog-listing-${name}.png`, fullPage: true });
    await page.goto('http://localhost:4320/p/stainless-hex-bolts-m8');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}catalog-product-${name}.png`, fullPage: true });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await page.goto('http://localhost:4320/app');
  await page.evaluate(() => { localStorage.setItem('theme', 'light'); localStorage.setItem('se.lang', 'en'); });
  await page.reload();
  await page.getByText('Explore with demo data').click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = '/products'; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}catalog-staff-products.png` });
  await page.getByText('Add product').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}catalog-staff-upload.png` });
  await page.close();
} finally { await browser.close(); try { process.kill(-srv.pid); } catch {} }
console.log('catalog screenshots written to', out);
