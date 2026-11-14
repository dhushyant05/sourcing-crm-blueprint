// Public marketplace + staff product screens (sample data, labelled Sample).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { bannerDataUri, productPhotos } from './studio-art.mjs';

const out = new URL('../../docs/screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const products = [
  { id: 'p1', slug: 'stainless-hex-bolts-m8', title: 'Stainless Hex Bolts M8', summary: 'Grade 304 hex bolts, standard pitch. Packed by carton. Sample product for the catalog preview.', category: { slug: 'hardware', name: 'Hardware' }, moq: 2000, unit: 'pcs', leadTime: '15–20 days', isSample: true, pinned: true, publishedAt: '2026-11-01T00:00:00.000Z',
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 0.08, max: 0.12 }, CNY: { min: 0.58, max: 0.86 }, INR: { min: 7, max: 10 } } },
    specs: { material: 'Grade 304 stainless', finish: 'As pictured (sample)', packing: 'Export carton', origin: 'China (sample)', note: 'Sample product — not a live offer' },
    tiers: [{ minQty: 2000, maxQty: 4000, amounts: { USD: 0.08, CNY: 0.58, INR: 7 } }, { minQty: 4000, maxQty: null, amounts: { USD: 0.072, CNY: 0.52, INR: 6 } }],
    images: productPhotos('Stainless Hex Bolts M8', 'Hardware') },
  { id: 'p2', slug: 'bamboo-cutting-board', title: 'Bamboo Cutting Board', summary: 'Bamboo board with juice groove. Sample product for the catalog preview.', category: { slug: 'housewares', name: 'Housewares' }, moq: 400, unit: 'pcs', leadTime: '20–30 days', isSample: true, pinned: true, publishedAt: '2026-11-02T00:00:00.000Z',
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 4.2, max: 6.5 }, CNY: { min: 30, max: 47 }, INR: { min: 351, max: 543 } } },
    images: productPhotos('Bamboo Cutting Board', 'Housewares') },
  { id: 'p3', slug: 'led-panel-light-60x60', title: 'LED Panel Light 60×60', summary: '40 W recessed panel. Sample product for the catalog preview.', category: { slug: 'lighting', name: 'Lighting' }, moq: 200, unit: 'pcs', leadTime: '15–22 days', isSample: true, pinned: true, publishedAt: '2026-11-03T00:00:00.000Z',
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 8.5, max: 12 }, CNY: { min: 61, max: 86 }, INR: { min: 710, max: 1002 } } },
    images: productPhotos('LED Panel Light 60×60', 'Lighting') },
  { id: 'p4', slug: 'cotton-tea-towels', title: 'Cotton Tea Towels', summary: 'Plain-weave cotton towels. Sample product for the catalog preview.', category: { slug: 'textiles', name: 'Textiles' }, moq: 600, unit: 'pcs', leadTime: '20–25 days', isSample: true, publishedAt: '2026-11-04T00:00:00.000Z',
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 1.1, max: 1.8 }, CNY: { min: 8, max: 13 }, INR: { min: 92, max: 150 } } },
    images: productPhotos('Cotton Tea Towels', 'Textiles') },
  { id: 'p5', slug: 'silicone-spatula-set', title: 'Silicone Spatula Set', summary: 'Heat-resistant utensils, 5-piece kitchen set. Sample product for the catalog preview.', category: { slug: 'kitchenware', name: 'Kitchenware' }, moq: 500, unit: 'sets', leadTime: '15–20 days', isSample: true, pinned: true, publishedAt: '2026-11-05T00:00:00.000Z',
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 2.8, max: 4.0 }, CNY: { min: 20, max: 29 }, INR: { min: 234, max: 334 } } },
    images: productPhotos('Silicone Spatula Set', 'Kitchenware') },
  { id: 'p6', slug: 'corrugated-mailer-boxes', title: 'Corrugated Mailer Boxes', summary: 'E-flute mailer boxes, custom print option. Sample product for the catalog preview.', category: { slug: 'packaging', name: 'Packaging' }, moq: 1000, unit: 'pcs', leadTime: '12–18 days', isSample: true, publishedAt: '2026-11-06T00:00:00.000Z',
    price: { mode: 'RANGE', base: 'USD', amounts: { USD: { min: 0.22, max: 0.4 }, CNY: { min: 1.6, max: 2.9 }, INR: { min: 18, max: 33 } } },
    images: productPhotos('Corrugated Mailer Boxes', 'Packaging') },
];
const categories = [
  { id: 'c1', slug: 'hardware', name: 'Hardware' }, { id: 'c2', slug: 'housewares', name: 'Housewares' },
  { id: 'c3', slug: 'kitchenware', name: 'Kitchenware' }, { id: 'c4', slug: 'lighting', name: 'Lighting' },
  { id: 'c5', slug: 'packaging', name: 'Packaging' }, { id: 'c6', slug: 'textiles', name: 'Textiles' },
];
const banners = [
  { id: 'b1', sort: 0, altText: 'Source from China, delivered worldwide', imageUrl: bannerDataUri('Source from China, delivered worldwide', '#1a6d98'), href: '/products' },
  { id: 'b2', sort: 1, altText: 'Request a quote in a few taps', imageUrl: bannerDataUri('Request a quote in a few taps', '#ea580c'), href: '/products' },
  { id: 'b3', sort: 2, altText: 'Clear prices in USD, RMB and INR', imageUrl: bannerDataUri('Clear prices in USD, RMB and INR', '#56a33a'), href: '/products' },
];
const trust = [
  { title: 'Sourced in China', text: 'Quoted and managed by Source Easy' },
  { title: 'Two offices', text: 'India and China working as one team' },
  { title: 'Prices you can compare', text: 'Switch between USD, RMB and INR' },
  { title: 'Quality on request', text: 'Factory visits and checks when you need them' },
];

async function mockCatalog(page) {
  await page.route('**/api/public/catalog/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/status')) return route.fulfill({ json: { homepageEnabled: true, hasPublished: true, showMarketplace: true, trust, promo: { enabled: true, text: 'Sourcing from China — request a quote from the Source Easy team', href: '/#contact' } } });
    if (url.includes('/categories')) return route.fulfill({ json: { data: categories } });
    if (url.includes('/banners')) return route.fulfill({ json: { data: banners, direction: 'LTR', intervalSeconds: 5 } });
    const prod = products.find((p) => url.includes(`/products/${p.slug}`));
    if (prod) return route.fulfill({ json: { data: prod } });
    if (url.includes('/products')) return route.fulfill({ json: { data: products, total: products.length, limit: 48, offset: 0 } });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
}

const srv = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { stdio: 'ignore', detached: true, cwd: new URL('..', import.meta.url) });
await new Promise((r) => setTimeout(r, 3500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, colorScheme: 'light' });
    await mockCatalog(page);
    await page.goto('http://localhost:4320/');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}catalog-home-${name}.png`, fullPage: true });
    await page.goto('http://localhost:4320/products');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}catalog-listing-${name}.png`, fullPage: true });
    await page.goto('http://localhost:4320/p/stainless-hex-bolts-m8');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}catalog-product-${name}.png`, fullPage: true });
    await page.getByLabel('Open photo full screen').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}catalog-product-lightbox-${name}.png` });
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
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.waitForSelector('[data-testid="product-images"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}catalog-staff-upload.png` });
  await page.close();
} finally { await browser.close(); try { process.kill(-srv.pid); } catch {} }
console.log('catalog screenshots written to', out);
