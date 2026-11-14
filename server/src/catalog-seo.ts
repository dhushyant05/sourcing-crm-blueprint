/**
 * Google- and WhatsApp-friendly product pages: robots.txt, sitemap.xml,
 * and HTML shells with unique title, description, OG tags and JSON-LD.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CatalogStore, publicView, type CatalogDeps } from './catalog.js';

const FALLBACK_SHELL = `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Source Easy</title></head><body><div id="root"></div></body></html>`;

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function publicOrigin(req: FastifyRequest) {
  const proto = String((req.headers['x-forwarded-proto'] as string) || req.protocol || 'https').split(',')[0].trim();
  const host = String((req.headers['x-forwarded-host'] as string) || req.headers.host || 'sourceeasy.in').split(',')[0].trim();
  const scheme = proto === 'http' ? 'http' : 'https';
  return `${scheme}://${host}`;
}

function shellHtml(webDir?: string) {
  const index = webDir ? join(webDir, 'index.html') : '';
  if (index && existsSync(index)) return readFileSync(index, 'utf8');
  return FALLBACK_SHELL;
}

function imageUrl(origin: string, url?: string | null) {
  if (!url) return `${origin}/brand/mark.png`;
  if (url.startsWith('http')) return url;
  return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
}

function coverUrl(origin: string, images: { url?: string; cardUrl?: string | null; cover?: boolean }[]) {
  const cover = images.find((i) => i.cover) ?? images[0];
  return imageUrl(origin, cover?.url || cover?.cardUrl);
}

export function injectHead(html: string, tags: string) {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/i, '');
  out = out.replace(/<meta name="description"[^>]*>/i, '');
  out = out.replace(/<meta property="og:title"[^>]*>/i, '');
  if (out.includes('</head>')) return out.replace('</head>', `${tags}\n</head>`);
  return tags + out;
}

export function productHead(origin: string, p: any) {
  const url = `${origin}/p/${encodeURIComponent(p.slug)}`;
  const title = `${p.title} — Source Easy`;
  const desc = String(p.summary || `${p.title} sourced from China through Source Easy.`).slice(0, 300);
  const img = coverUrl(origin, p.images ?? []);
  const amounts = p.price?.amounts?.USD;
  const low = amounts?.min ?? amounts?.max ?? null;
  const high = amounts?.max ?? amounts?.min ?? null;
  const offer = p.price?.mode === 'GET_QUOTE' || low == null
    ? { '@type': 'Offer', url, availability: 'https://schema.org/InStock', priceCurrency: 'USD' }
    : { '@type': 'AggregateOffer', url, priceCurrency: 'USD', lowPrice: low, highPrice: high ?? low, availability: 'https://schema.org/InStock' };
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: desc,
    image: (p.images ?? []).map((i: any) => imageUrl(origin, i.url || i.cardUrl)).filter(Boolean),
    sku: p.slug,
    brand: { '@type': 'Brand', name: 'Source Easy' },
    offers: offer,
  };
  return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="Source Easy" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:image" content="${escapeHtml(img)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(desc)}" />
    <meta name="twitter:image" content="${escapeHtml(img)}" />
    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
  `;
}

export function categoryHead(origin: string, name: string, slug: string) {
  const url = `${origin}/c/${encodeURIComponent(slug)}`;
  const title = `${name} — Source Easy`;
  const desc = `Browse ${name} products sourced from China through Source Easy. Request a quote in USD, RMB or INR.`;
  return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Source Easy" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
  `;
}

function sendHtml(reply: FastifyReply, html: string) {
  return reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=60').send(html);
}

export function registerCatalogSeo(app: FastifyInstance, deps: CatalogDeps, webDir?: string) {
  const store = new CatalogStore(deps.db);
  const htmlShell = () => shellHtml(webDir);

  app.get('/robots.txt', async (_req, reply) => {
    const body = [
      'User-agent: *',
      'Allow: /',
      'Allow: /api/public/',
      'Disallow: /api/',
      'Disallow: /app',
      'Disallow: /portal',
      'Disallow: /download/',
      'Sitemap: https://sourceeasy.in/sitemap.xml',
      '',
    ].join('\n');
    return reply.type('text/plain; charset=utf-8').header('cache-control', 'public, max-age=3600').send(body);
  });

  app.get('/sitemap.xml', async (req, reply) => {
    const origin = publicOrigin(req);
    const cats = await store.categories(true);
    const products = await store.searchPublic({ sort: 'newest', limit: 48, offset: 0 });
    // Paginate all published products.
    const rows = [...products.rows];
    let offset = products.limit;
    while (offset < products.total) {
      const next = await store.searchPublic({ sort: 'newest', limit: 48, offset });
      rows.push(...next.rows);
      offset += next.limit;
      if (!next.rows.length) break;
    }
    const urls = [
      { loc: `${origin}/`, pri: '1.0', freq: 'daily' },
      { loc: `${origin}/products`, pri: '0.9', freq: 'daily' },
      ...cats.map((c: any) => ({ loc: `${origin}/c/${encodeURIComponent(c.slug)}`, pri: '0.8', freq: 'weekly' })),
      ...rows.map((p: any) => ({ loc: `${origin}/p/${encodeURIComponent(p.slug)}`, pri: '0.8', freq: 'weekly', last: p.updated_at || p.published_at })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => {
      const last = (u as any).last ? `<lastmod>${new Date((u as any).last).toISOString()}</lastmod>` : '';
      return `  <url><loc>${escapeHtml(u.loc)}</loc>${last}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`;
    }).join('\n')}\n</urlset>\n`;
    return reply.type('application/xml; charset=utf-8').header('cache-control', 'public, max-age=300').send(xml);
  });

  app.get<{ Params: { slug: string } }>('/p/:slug', async (req, reply) => {
    const row = await store.get(req.params.slug);
    if (!row || row.status !== 'PUBLISHED') {
      return sendHtml(reply.code(404), htmlShell());
    }
    const data = await publicView(store, row, await store.rates());
    return sendHtml(reply, injectHead(htmlShell(), productHead(publicOrigin(req), data)));
  });

  app.get<{ Params: { slug: string } }>('/c/:slug', async (req, reply) => {
    const cats = await store.categories(true);
    const cat = cats.find((c: any) => c.slug === req.params.slug);
    if (!cat) return sendHtml(reply.code(404), htmlShell());
    return sendHtml(reply, injectHead(htmlShell(), categoryHead(publicOrigin(req), cat.name, cat.slug)));
  });
}
