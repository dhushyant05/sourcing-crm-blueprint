/**
 * Marketplace Phase 2: view/enquiry scoring, related products, and customer favourites.
 * Views are deduped per visitor per product per UTC day. Known bots are ignored.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Db } from './db.js';

const BOT_UA = /bot\b|crawler|spider|crawling|facebookexternalhit|facebot|whatsapp|telegram|slackbot|bingpreview|googlebot|baiduspider|yandex|duckduckbot|semrush|ahrefs|bytespider|gptbot|claudebot|applebot|pingdom|uptimerobot|headlesschrome|lighthouse|preview\/|embed\//i;

export function isBotUa(ua: string | undefined) {
  return !!ua && BOT_UA.test(ua);
}

export function visitorKey(ip: string | undefined, ua: string | undefined) {
  return createHash('sha256').update(`${ip || '0'}\n${ua || ''}`).digest('hex').slice(0, 32);
}

export function windowDays(raw: unknown) {
  const n = Number(raw);
  return n === 30 ? 30 : 7;
}

export function parseTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? (v.trim().startsWith('[') ? JSON.parse(v) : v.split(/[,;]/)) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const t = String(item ?? '').trim().toLowerCase().slice(0, 40);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

export function tagsOf(row: { tags?: unknown }) {
  return parseTags(row.tags);
}

export async function recordView(db: Db, productId: string, req: FastifyRequest) {
  const ua = String(req.headers['user-agent'] ?? '');
  if (isBotUa(ua)) return { recorded: false, reason: 'bot' as const };
  const key = visitorKey(req.ip, ua);
  await db.run(
    `INSERT INTO product_views (product_id, visitor_key, day, at) VALUES (?,?,CURRENT_DATE,now())
     ON CONFLICT (product_id, visitor_key, day) DO NOTHING`,
    productId, key,
  );
  return { recorded: true, reason: 'ok' as const };
}

export async function recordEnquiryEvent(db: Db, productId: string, leadId: string | null, req?: FastifyRequest, customerId?: string) {
  const ua = req ? String(req.headers['user-agent'] ?? '') : '';
  const key = req ? visitorKey(req.ip, ua) : (customerId ? `cust:${customerId}` : randomUUID());
  await db.run(
    `INSERT INTO product_enquiries (id, product_id, lead_id, customer_id, visitor_key, day, at)
     VALUES (?,?,?,?,?,CURRENT_DATE,now())`,
    randomUUID(), productId, leadId, customerId ?? null, key,
  );
}

/** SQL fragment: score over the last `days` days. Safe: days is only 7 or 30. */
export function scoreJoin(days: number) {
  const d = days === 30 ? 30 : 7;
  return `LEFT JOIN (
    SELECT product_id, SUM(w)::int AS score, SUM(views)::int AS views, SUM(enquiries)::int AS enquiries
    FROM (
      SELECT product_id, 1 AS w, 1 AS views, 0 AS enquiries
      FROM product_views WHERE at >= now() - interval '${d} days'
      UNION ALL
      SELECT product_id, 10 AS w, 0 AS views, 1 AS enquiries
      FROM (
        SELECT DISTINCT product_id, coalesce(visitor_key, id) AS vk, coalesce(day, at::date) AS d
        FROM product_enquiries WHERE at >= now() - interval '${d} days'
      ) e
    ) x
    GROUP BY product_id
  ) ts ON ts.product_id = p.id`;
}

export function pinOrder(nowIso: string, scoreExpr = 'coalesce(ts.score, 0)') {
  return `CASE WHEN p.pinned AND (p.pin_starts_at IS NULL OR p.pin_starts_at <= '${nowIso}') AND (p.pin_ends_at IS NULL OR p.pin_ends_at >= '${nowIso}') THEN 0 ELSE 1 END, ${scoreExpr} DESC, p.published_at DESC NULLS LAST, p.title`;
}

export async function scoresFor(db: Db, ids: string[], days: number) {
  const map = new Map<string, { score: number; views: number; enquiries: number }>();
  if (!ids.length) return map;
  const d = days === 30 ? 30 : 7;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all<{ product_id: string; score: number; views: number; enquiries: number }>(
    `SELECT product_id, SUM(w)::int AS score, SUM(views)::int AS views, SUM(enquiries)::int AS enquiries
     FROM (
       SELECT product_id, 1 AS w, 1 AS views, 0 AS enquiries FROM product_views
       WHERE at >= now() - interval '${d} days' AND product_id IN (${placeholders})
       UNION ALL
       SELECT product_id, 10 AS w, 0 AS views, 1 AS enquiries FROM (
         SELECT DISTINCT product_id, coalesce(visitor_key, id) AS vk, coalesce(day, at::date) AS d
         FROM product_enquiries WHERE at >= now() - interval '${d} days' AND product_id IN (${placeholders})
       ) e
     ) x GROUP BY product_id`,
    ...ids, ...ids,
  );
  for (const r of rows) map.set(r.product_id, { score: r.score, views: r.views, enquiries: r.enquiries });
  return map;
}

export async function relatedProducts(db: Db, row: any, limit = 8) {
  const tags = tagsOf(row);
  const tagParams = tags.map(() => '?').join(',');
  const where = [`p.status = 'PUBLISHED'`, 'p.deleted_at IS NULL', 'p.id <> ?'];
  const whereParams: unknown[] = [row.id];
  if (row.category_id || tags.length) {
    const parts: string[] = [];
    if (row.category_id) { parts.push('p.category_id = ?'); whereParams.push(row.category_id); }
    if (tags.length) {
      parts.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(p.tags, '[]'::jsonb)) t(tag) WHERE t.tag IN (${tagParams}))`);
      whereParams.push(...tags);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const overlap = tags.length
    ? `CASE WHEN p.category_id = ? THEN 2 ELSE 0 END + (
         SELECT count(*)::int FROM jsonb_array_elements_text(coalesce(p.tags, '[]'::jsonb)) t(tag) WHERE t.tag IN (${tagParams})
       )`
    : `CASE WHEN p.category_id = ? THEN 2 ELSE 0 END`;
  const orderParams: unknown[] = tags.length ? [row.category_id, ...tags] : [row.category_id];
  const now = new Date().toISOString();
  return db.all(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name, coalesce(ts.score, 0) AS trending_score
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${scoreJoin(7)}
     WHERE ${where.join(' AND ')}
     ORDER BY ${overlap} DESC, ${pinOrder(now)}
     LIMIT ?`,
    ...whereParams, ...orderParams, limit,
  );
}

export async function favoriteIds(db: Db, customerId: string) {
  const rows = await db.all<{ product_id: string }>('SELECT product_id FROM customer_favorites WHERE customer_id = ? ORDER BY created_at DESC', customerId);
  return rows.map((r) => r.product_id);
}

export async function listFavorites(db: Db, customerId: string) {
  return db.all(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
     FROM customer_favorites f
     JOIN products p ON p.id = f.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE f.customer_id = ? AND p.status = 'PUBLISHED' AND p.deleted_at IS NULL
     ORDER BY f.created_at DESC`,
    customerId,
  );
}

export async function addFavorite(db: Db, customerId: string, productId: string) {
  await db.run(
    `INSERT INTO customer_favorites (customer_id, product_id) VALUES (?,?)
     ON CONFLICT (customer_id, product_id) DO NOTHING`,
    customerId, productId,
  );
}

export async function removeFavorite(db: Db, customerId: string, productId: string) {
  await db.run('DELETE FROM customer_favorites WHERE customer_id = ? AND product_id = ?', customerId, productId);
}
