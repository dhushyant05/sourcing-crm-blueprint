/**
 * Source Easy public catalog / marketplace (Phase 1).
 * Public JSON never includes supplier identity, factory cost or staff names.
 * Selling prices are omitted for China staff. Marketplace Team is catalog-only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from './db.js';
import type { User } from './users.js';
import { sides, type Role } from './roles.js';
import type { PermStore } from './permissions.js';
import type { UploadStore, Attachment } from './uploads.js';
import { MAX_FILE_BYTES } from './uploads.js';
import { productStudioImage, bannerStudioImage, sceneFor, CATEGORY_PALETTES } from './studio.js';

export const PRODUCT_STATUSES = ['DRAFT', 'READY_FOR_PRICE', 'PUBLISHED', 'UNPUBLISHED', 'DELETED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const CURRENCIES = ['USD', 'CNY', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];
const MAX_LIVE_BANNERS = 6;
const MAX_PRODUCT_IMAGES = 15;
const SAMPLE_RATES: [Currency, Currency, number][] = [
  ['USD', 'INR', 83.5], ['INR', 'USD', 1 / 83.5],
  ['USD', 'CNY', 7.2], ['CNY', 'USD', 1 / 7.2],
  ['INR', 'CNY', 7.2 / 83.5], ['CNY', 'INR', 83.5 / 7.2],
];

export class CatalogError extends Error {
  status: number; appCode?: string;
  constructor(message: string, status = 400, appCode?: string) { super(message); this.status = status; this.appCode = appCode; }
}
const bad = (m: string, s = 400, c?: string): never => { throw new CatalogError(m, s, c); };
const forbid = (m = 'Forbidden'): never => { throw new CatalogError(m, 403); };

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
export const ownerKey = (kind: 'p' | 'bn', id: string) => `${kind}_${id}`;

export function roundMoney(n: number, currency: Currency) {
  if (!Number.isFinite(n)) return n;
  const d = currency === 'INR' ? 0 : 2;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

type RateMap = Map<string, number>;
const rateKey = (a: string, b: string) => `${a}:${b}`;
function fxRate(from: Currency, to: Currency, rates: RateMap): number | null {
  if (from === to) return 1;
  const direct = rates.get(rateKey(from, to));
  if (direct) return direct;
  const inv = rates.get(rateKey(to, from));
  return inv ? 1 / inv : null;
}
export function convertAmount(amount: number, from: Currency, to: Currency, rates: RateMap): number | null {
  if (from === to) return roundMoney(amount, to);
  const direct = fxRate(from, to, rates);
  if (direct != null) return roundMoney(amount * direct, to);
  for (const mid of CURRENCIES) {
    if (mid === from || mid === to) continue;
    const a = fxRate(from, mid, rates), b = fxRate(mid, to, rates);
    if (a != null && b != null) return roundMoney(amount * a * b, to);
  }
  return null;
}

export interface CatalogDeps {
  db: Db;
  uploads: UploadStore;
  perms: PermStore;
  mediaSync?: (key: string, list: Attachment[]) => Promise<void>;
  createEnquiry?: (input: {
    product: { id: string; title: string; slug: string };
    name: string; phone: string; phoneCode: string; email?: string; company?: string;
    quantity?: number; unit?: string; message?: string; city?: string; requestLogin?: boolean;
    customerId?: string;
  }) => Promise<{ leadId: string; leadRef: string; loginRequested?: boolean }>;
  livePublicGreetings?: () => Promise<PublicBanner[]>;
}

export interface PublicBanner {
  id: string; sort: number; altText: string; imageUrl: string; mobileUrl?: string | null;
  href?: string | null; source: 'banner' | 'greeting';
}

function canEdit(perms: PermStore, u: User) { return perms.can(u, 'catalog.edit'); }
function canPrice(perms: PermStore, u: User) { return perms.can(u, 'catalog.price'); }
function canPublish(perms: PermStore, u: User) { return perms.can(u, 'catalog.publish'); }
function canDelete(perms: PermStore, u: User) { return perms.can(u, 'catalog.delete'); }
function canBanners(perms: PermStore, u: User) { return perms.can(u, 'catalog.banners'); }
function isSa(u: User) { return u.role === 'SUPER_ADMIN'; }
function hidePrices(role: Role) { return sides(role).china && role !== 'SUPER_ADMIN'; }

export class CatalogStore {
  constructor(readonly db: Db) {}

  async setting<T = unknown>(key: string, fallback: T): Promise<T> {
    const r = await this.db.get<{ value: unknown }>('SELECT value FROM catalog_settings WHERE key = ?', key);
    return (r ? (r.value as T) : fallback);
  }
  async setSetting(key: string, value: unknown, by?: string) {
    await this.db.run(`INSERT INTO catalog_settings (key, value, updated_by, updated_at) VALUES (?,?::jsonb,?,now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, key, JSON.stringify(value), by ?? null);
  }
  async homepageEnabled() { return (await this.setting<boolean>('homepage_enabled', false)) === true; }
  async bannerSettings() {
    const direction = (await this.setting<string>('banner_direction', 'LTR')) === 'RTL' ? 'RTL' as const : 'LTR' as const;
    const n = Number(await this.setting<number>('banner_interval_seconds', 5));
    const intervalSeconds = Number.isFinite(n) ? Math.min(10, Math.max(3, Math.round(n))) : 5;
    return { direction, intervalSeconds };
  }

  async publishedCount() {
    const r = await this.db.get<{ n: number }>("SELECT count(*)::int AS n FROM products WHERE status = 'PUBLISHED' AND deleted_at IS NULL");
    return r?.n ?? 0;
  }
  async status() {
    const enabled = await this.homepageEnabled();
    const hasPublished = (await this.publishedCount()) > 0;
    return { homepageEnabled: enabled, hasPublished, showMarketplace: enabled && hasPublished, trust: await this.trustItems(), promo: await this.promoStrip() };
  }
  async trustItems() {
    const v = await this.setting<unknown>('trust_items', DEFAULT_TRUST);
    return Array.isArray(v) && v.length ? v : DEFAULT_TRUST;
  }

  async promoStrip() {
    const v = await this.setting<any>('promo_strip', DEFAULT_PROMO);
    const text = String(v?.text ?? DEFAULT_PROMO.text).trim().slice(0, 160) || DEFAULT_PROMO.text;
    const href = String(v?.href ?? DEFAULT_PROMO.href).trim().slice(0, 200) || DEFAULT_PROMO.href;
    return { enabled: v?.enabled !== false, text, href };
  }
  async setPromoStrip(promo: { enabled?: boolean; text?: string; href?: string }, by: string) {
    const next = await this.promoStrip();
    if (typeof promo.enabled === 'boolean') next.enabled = promo.enabled;
    if (promo.text != null) next.text = String(promo.text).trim().slice(0, 160) || DEFAULT_PROMO.text;
    if (promo.href != null) next.href = String(promo.href).trim().slice(0, 200) || DEFAULT_PROMO.href;
    await this.setSetting('promo_strip', next, by);
    return next;
  }
  async setTrustItems(items: { title: string; text: string }[], by: string) {
    const clean = items.slice(0, 6).map((x) => ({ title: String(x.title ?? '').trim().slice(0, 80), text: String(x.text ?? '').trim().slice(0, 200) })).filter((x) => x.title);
    if (!clean.length) bad('Add at least one trust item');
    await this.setSetting('trust_items', clean, by);
    return clean;
  }

  async rates(): Promise<RateMap> {
    const rows = await this.db.all<{ base: string; quote: string; rate: number }>('SELECT base, quote, rate FROM fx_rates');
    const m: RateMap = new Map();
    for (const r of rows) m.set(rateKey(r.base, r.quote), Number(r.rate));
    return m;
  }
  async rateList() {
    return this.db.all('SELECT base, quote, rate, as_of AS "asOf", set_by AS "setBy" FROM fx_rates ORDER BY base, quote');
  }
  async setRates(rows: { base: string; quote: string; rate: number }[], by: string) {
    await this.db.tx(async (t) => {
      await t.run('DELETE FROM fx_rates');
      for (const r of rows) {
        if (!CURRENCIES.includes(r.base as Currency) || !CURRENCIES.includes(r.quote as Currency)) bad('Currency must be USD, CNY or INR');
        if (r.base === r.quote) continue;
        const rate = Number(r.rate);
        if (!(rate > 0) || !Number.isFinite(rate)) bad('Rate must be a positive number');
        await t.run('INSERT INTO fx_rates (base, quote, rate, as_of, set_by) VALUES (?,?,?,now(),?)', r.base, r.quote, rate, by);
      }
    });
    return this.rateList();
  }

  async uniqueSlug(base: string, except?: string) {
    let slug = slugify(base), n = 2;
    for (;;) {
      const row = await this.db.get<{ id: string }>('SELECT id FROM products WHERE slug = ?', slug);
      if (!row || row.id === except) return slug;
      slug = `${slugify(base).slice(0, 70)}-${n++}`;
    }
  }

  async categories(activeOnly = true) {
    const sql = activeOnly
      ? 'SELECT id, slug, name, parent_id AS "parentId", active FROM categories WHERE active = true ORDER BY lower(name)'
      : 'SELECT id, slug, name, parent_id AS "parentId", active FROM categories ORDER BY lower(name)';
    return this.db.all(sql);
  }
  async categoryBySlug(slug: string) {
    return this.db.get('SELECT id, slug, name, parent_id AS "parentId", active FROM categories WHERE slug = ?', slug);
  }
  async upsertCategory(name: string, id?: string) {
    const slug = slugify(name);
    if (!slug) bad('Category name is required');
    if (id) {
      await this.db.run('UPDATE categories SET name = ?, slug = ? WHERE id = ?', name.trim().slice(0, 80), slug, id);
      return this.db.get('SELECT id, slug, name FROM categories WHERE id = ?', id);
    }
    const existing = await this.db.get('SELECT id, slug, name FROM categories WHERE slug = ?', slug);
    if (existing) return existing;
    const nid = randomUUID();
    await this.db.run('INSERT INTO categories (id, slug, name) VALUES (?,?,?)', nid, slug, name.trim().slice(0, 80));
    return { id: nid, slug, name: name.trim().slice(0, 80) };
  }

  async get(idOrSlug: string, opts: { includeDeleted?: boolean } = {}) {
    const del = opts.includeDeleted ? '' : ' AND deleted_at IS NULL';
    return this.db.get(`SELECT * FROM products WHERE (id = ? OR slug = ?)${del}`, idOrSlug, idOrSlug);
  }
  async images(productId: string) {
    return this.db.all('SELECT id, product_id AS "productId", file_id AS "fileId", kind, sort, alt_text AS "altText", group_id AS "groupId", is_cover AS "isCover" FROM product_images WHERE product_id = ? ORDER BY sort, created_at', productId);
  }
  async tiers(productId: string) {
    return this.db.all('SELECT id, min_qty AS "minQty", max_qty AS "maxQty", unit_price AS "unitPrice", price_usd AS "priceUsd", price_cny AS "priceCny", price_inr AS "priceInr" FROM product_price_tiers WHERE product_id = ? ORDER BY min_qty', productId);
  }

  async searchPublic(q: {
    q?: string; category?: string; sort?: string; moqMax?: number; hasPrice?: boolean; limit?: number; offset?: number;
  }) {
    const limit = Math.min(48, Math.max(1, q.limit ?? 24));
    const offset = Math.max(0, q.offset ?? 0);
    const where = ["p.status = 'PUBLISHED'", 'p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.category) { where.push('(c.slug = ? OR p.category_id = ?)'); params.push(q.category, q.category); }
    if (q.moqMax != null && Number.isFinite(q.moqMax)) { where.push('(p.moq IS NULL OR p.moq <= ?)'); params.push(q.moqMax); }
    if (q.hasPrice) where.push("p.price_mode <> 'GET_QUOTE'");
    const query = (q.q ?? '').trim();
    if (query) {
      params.push(query, `%${query}%`);
      where.push(`(p.search_tsv @@ websearch_to_tsquery('simple', ?) OR p.title ILIKE ? OR coalesce(p.summary,'') ILIKE ?)`);
      params.push(`%${query}%`);
    }
    const now = new Date().toISOString();
    const order = q.sort === 'newest' ? 'p.published_at DESC NULLS LAST, p.created_at DESC'
      : q.sort === 'moq' ? 'p.moq ASC NULLS LAST, p.title'
      : `CASE WHEN p.pinned AND (p.pin_starts_at IS NULL OR p.pin_starts_at <= '${now}') AND (p.pin_ends_at IS NULL OR p.pin_ends_at >= '${now}') THEN 0 ELSE 1 END, p.published_at DESC NULLS LAST, p.title`;
    const from = `FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
    const total = (await this.db.get<{ n: number }>(`SELECT count(*)::int AS n ${from}`, ...params))?.n ?? 0;
    const rows = await this.db.all(`SELECT p.*, c.slug AS category_slug, c.name AS category_name ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
    return { rows, total, limit, offset };
  }

  async listStaff(q: { q?: string; status?: string; category?: string; includeDeleted?: boolean; limit?: number; offset?: number }) {
    const limit = Math.min(100, Math.max(1, q.limit ?? 40));
    const offset = Math.max(0, q.offset ?? 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (!q.includeDeleted) where.push('p.deleted_at IS NULL');
    if (q.status) { where.push('p.status = ?'); params.push(q.status); }
    if (q.category) { where.push('(c.slug = ? OR p.category_id = ?)'); params.push(q.category, q.category); }
    const query = (q.q ?? '').trim();
    if (query) { where.push('(p.title ILIKE ? OR coalesce(p.summary,\'\') ILIKE ?)'); params.push(`%${query}%`, `%${query}%`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM products p LEFT JOIN categories c ON c.id = p.category_id ${w}`;
    const total = (await this.db.get<{ n: number }>(`SELECT count(*)::int AS n ${from}`, ...params))?.n ?? 0;
    const rows = await this.db.all(`SELECT p.*, c.slug AS category_slug, c.name AS category_name ${from} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    return { rows, total, limit, offset };
  }

  async audit(productId: string, by: string | null, action: string, before?: unknown, after?: unknown) {
    await this.db.run('INSERT INTO product_audit (product_id, by_user, action, before, after) VALUES (?,?,?,?,?)',
      productId, by, action, before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null);
  }
  async auditList(productId: string) {
    return this.db.all('SELECT id, at, by_user AS "by", action, before, after FROM product_audit WHERE product_id = ? ORDER BY id DESC LIMIT 100', productId);
  }

  async create(input: Record<string, unknown>, by: string) {
    const title = String(input.title ?? '').trim().slice(0, 200);
    if (!title) bad('Title is required');
    const id = randomUUID();
    const slug = await this.uniqueSlug(String(input.slug ?? title));
    const base = CURRENCIES.includes(input.baseCurrency as Currency) ? input.baseCurrency : 'USD';
    await this.db.run(`INSERT INTO products (id, slug, title, summary, specs, category_id, status, moq, unit, lead_time, price_mode, base_currency, created_by, is_sample)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,false)`,
      id, slug, title, emptyToNull(input.summary, 4000), input.specs ? JSON.stringify(input.specs) : null,
      emptyToNull(input.categoryId), 'DRAFT', numOrNull(input.moq), emptyToNull(input.unit, 24), emptyToNull(input.leadTime, 80),
      'GET_QUOTE', base, by);
    await this.audit(id, by, 'CREATE', null, { title, slug });
    return this.get(id);
  }

  async update(id: string, patch: Record<string, unknown>, by: string, opts: { prices: boolean }) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') bad('This product has been deleted', 409);
    const next: Record<string, unknown> = {};
    if (patch.title != null) next.title = String(patch.title).trim().slice(0, 200);
    if (patch.summary !== undefined) next.summary = emptyToNull(patch.summary, 4000);
    if (patch.specs !== undefined) next.specs = patch.specs == null ? null : JSON.stringify(patch.specs);
    if (patch.categoryId !== undefined) next.category_id = emptyToNull(patch.categoryId);
    if (patch.moq !== undefined) next.moq = numOrNull(patch.moq);
    if (patch.unit !== undefined) next.unit = emptyToNull(patch.unit, 24);
    if (patch.leadTime !== undefined) next.lead_time = emptyToNull(patch.leadTime, 80);
    if (patch.slug) next.slug = await this.uniqueSlug(String(patch.slug), id);
    if (patch.status === 'READY_FOR_PRICE' && cur.status === 'DRAFT') next.status = 'READY_FOR_PRICE';
    if (opts.prices) {
      if (patch.baseCurrency && CURRENCIES.includes(patch.baseCurrency as Currency)) next.base_currency = patch.baseCurrency;
      if (patch.priceMode && ['RANGE', 'TIERS', 'GET_QUOTE'].includes(String(patch.priceMode))) next.price_mode = patch.priceMode;
      if (patch.priceMin !== undefined) next.price_min = numOrNull(patch.priceMin);
      if (patch.priceMax !== undefined) next.price_max = numOrNull(patch.priceMax);
      if (patch.priceUsd !== undefined) next.price_usd = numOrNull(patch.priceUsd);
      if (patch.priceCny !== undefined) next.price_cny = numOrNull(patch.priceCny);
      if (patch.priceInr !== undefined) next.price_inr = numOrNull(patch.priceInr);
      if (patch.pinned !== undefined) next.pinned = !!patch.pinned;
      if (patch.pinStartsAt !== undefined) next.pin_starts_at = patch.pinStartsAt || null;
      if (patch.pinEndsAt !== undefined) next.pin_ends_at = patch.pinEndsAt || null;
    }
    const cols = Object.keys(next);
    if (!cols.length) return cur;
    await this.db.run(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, ...cols.map((c) => next[c]), id);
    if (opts.prices && Array.isArray(patch.tiers)) {
      await this.db.run('DELETE FROM product_price_tiers WHERE product_id = ?', id);
      for (const t of patch.tiers as any[]) {
        await this.db.run('INSERT INTO product_price_tiers (id, product_id, min_qty, max_qty, unit_price, price_usd, price_cny, price_inr) VALUES (?,?,?,?,?,?,?,?)',
          randomUUID(), id, numOrNull(t.minQty) ?? 1, numOrNull(t.maxQty), Number(t.unitPrice), numOrNull(t.priceUsd), numOrNull(t.priceCny), numOrNull(t.priceInr));
      }
    }
    await this.audit(id, by, 'UPDATE', pickPublic(cur), next);
    return this.get(id);
  }

  async publish(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') bad('This product has been deleted', 409);
    if (cur.price_mode !== 'GET_QUOTE' && cur.price_min == null && cur.price_usd == null && cur.price_inr == null && cur.price_cny == null) {
      const n = (await this.db.get<{ n: number }>('SELECT count(*)::int AS n FROM product_price_tiers WHERE product_id = ?', id))?.n ?? 0;
      if (!n) bad('Set a selling price or mark the product as Get quote before publishing');
    }
    await this.db.run(`UPDATE products SET status = 'PUBLISHED', approved_by = ?, published_at = coalesce(published_at, now()), updated_at = now() WHERE id = ?`, by, id);
    await this.audit(id, by, 'PUBLISH', { status: cur.status }, { status: 'PUBLISHED' });
    return this.get(id);
  }
  async unpublish(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') bad('This product has been deleted', 409);
    await this.db.run(`UPDATE products SET status = 'UNPUBLISHED', updated_at = now() WHERE id = ?`, id);
    await this.audit(id, by, 'UNPUBLISH', { status: cur.status }, { status: 'UNPUBLISHED' });
    return this.get(id);
  }
  async softDelete(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') return cur;
    await this.db.run(`UPDATE products SET status = 'DELETED', deleted_at = now(), deleted_by = ?, updated_at = now() WHERE id = ?`, by, id);
    await this.audit(id, by, 'DELETE', { status: cur.status }, { status: 'DELETED' });
    return this.get(id, { includeDeleted: true });
  }
  async restore(id: string, by: string) {
    const cur = await this.get(id, { includeDeleted: true }); if (!cur) bad('Product not found', 404);
    if (cur.status !== 'DELETED' && !cur.deleted_at) bad('This product is not deleted');
    await this.db.run(`UPDATE products SET status = 'UNPUBLISHED', deleted_at = NULL, deleted_by = NULL, updated_at = now() WHERE id = ?`, id);
    await this.audit(id, by, 'RESTORE', { status: cur.status }, { status: 'UNPUBLISHED' });
    return this.get(id);
  }
  async removeAllSamples(by: string) {
    const rows = await this.db.all<{ id: string; status: string }>("SELECT id, status FROM products WHERE is_sample = true AND deleted_at IS NULL");
    for (const r of rows) await this.softDelete(r.id, by);
    const banners = await this.db.all<{ id: string }>('SELECT id FROM banner_slides WHERE is_sample = true');
    for (const b of banners) await this.db.run('DELETE FROM banner_slides WHERE id = ?', b.id);
    return { products: rows.length, banners: banners.length };
  }
}

function emptyToNull(v: unknown, max = 200): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pickPublic(row: any) { return { id: row.id, slug: row.slug, title: row.title, status: row.status }; }

export const DEFAULT_TRUST = [
  { title: 'Sourced in China', text: 'Quoted and managed by Source Easy' },
  { title: 'Two offices', text: 'India and China working as one team' },
  { title: 'Prices you can compare', text: 'Switch between USD, RMB and INR' },
  { title: 'Quality on request', text: 'Factory visits and checks when you need them' },
];
export const DEFAULT_PROMO = { enabled: true, text: 'Sourcing from China — request a quote from the Source Easy team', href: '/#contact' };

type ImgRow = { fileId: string; kind?: string; altText?: string | null; groupId?: string | null; isCover?: boolean; sort?: number };
export function photoGroups(images: ImgRow[]) {
  const groups: { id: string; altText: string | null; cover: boolean; sort: number; original?: ImgRow; card?: ImgRow; gallery?: ImgRow; fileIds: string[] }[] = [];
  const by = new Map<string, (typeof groups)[0]>();
  let last: string | null = null;
  for (const im of images) {
    let gid = im.groupId || ((im.kind === 'CARD' || im.kind === 'GALLERY') && last) || im.fileId;
    if (im.kind === 'ORIGINAL' || !im.kind) last = gid;
    let g = by.get(gid);
    if (!g) { g = { id: gid, altText: im.altText ?? null, cover: !!im.isCover, sort: im.sort ?? 0, fileIds: [] }; by.set(gid, g); groups.push(g); }
    if (im.kind === 'CARD') g.card = im; else if (im.kind === 'GALLERY') g.gallery = im; else g.original = im;
    if (im.isCover) g.cover = true;
    g.altText = g.altText || im.altText || null;
    g.sort = Math.min(g.sort, im.sort ?? 0);
    if (im.fileId && !g.fileIds.includes(im.fileId)) g.fileIds.push(im.fileId);
  }
  groups.sort((a, b) => (a.cover === b.cover ? a.sort - b.sort : a.cover ? -1 : 1));
  return groups;
}
export function publicPhotos(images: ImgRow[], productId: string) {
  const url = (im?: ImgRow) => im ? `/api/public/catalog/images/${productId}/${im.fileId}` : null;
  return photoGroups(images).map((g) => ({
    id: g.id, altText: g.altText, cover: g.cover,
    url: url(g.gallery) || url(g.original) || url(g.card) as string,
    cardUrl: url(g.card) || url(g.gallery) || url(g.original),
  }));
}
export function staffPhotos(images: ImgRow[], productId: string) {
  const url = (im?: ImgRow) => im ? `/api/products/${productId}/images/${im.fileId}` : null;
  return photoGroups(images).map((g) => ({
    id: g.id, altText: g.altText, cover: g.cover, sort: g.sort, fileIds: g.fileIds,
    url: url(g.gallery) || url(g.original) || url(g.card) as string,
    cardUrl: url(g.card) || url(g.gallery) || url(g.original),
  }));
}
async function saveProductPhoto(deps: CatalogDeps, productId: string, processed: { original: Buffer; card: Buffer; gallery: Buffer }, alt: string, sort: number, cover: boolean) {
  const groupId = randomUUID();
  const incoming = [
    { name: 'original.jpg', mime: 'image/jpeg', data: processed.original },
    { name: 'card.webp', mime: 'image/webp', data: processed.card },
    { name: 'gallery.webp', mime: 'image/webp', data: processed.gallery },
  ];
  const all = deps.uploads.save(ownerKey('p', productId), incoming);
  const saved = all.slice(-incoming.length);
  const kinds = ['ORIGINAL', 'CARD', 'GALLERY'] as const;
  for (let i = 0; i < saved.length; i++) {
    await deps.db.run('INSERT INTO product_images (id, product_id, file_id, kind, sort, alt_text, group_id, is_cover) VALUES (?,?,?,?,?,?,?,?)',
      randomUUID(), productId, saved[i].id, kinds[i], sort, alt, groupId, cover);
  }
  return { groupId, files: saved, kinds };
}


export function priced(row: any, rates: RateMap) {
  const base = (CURRENCIES.includes(row.base_currency) ? row.base_currency : 'USD') as Currency;
  const mode = row.price_mode ?? 'GET_QUOTE';
  if (mode === 'GET_QUOTE' && row.price_min == null && row.price_usd == null && row.price_inr == null && row.price_cny == null)
    return { mode: 'GET_QUOTE' as const, base, amounts: null as null };
  const amounts: Record<Currency, { min: number | null; max: number | null }> = { USD: { min: null, max: null }, CNY: { min: null, max: null }, INR: { min: null, max: null } };
  const put = (cur: Currency, min: number | null, max: number | null) => { amounts[cur] = { min, max }; };
  // Manual per-currency overrides win; otherwise convert from base min/max.
  const baseMin = numOrNull(row.price_min) ?? numOrNull(row.unit_price);
  const baseMax = numOrNull(row.price_max) ?? baseMin;
  for (const cur of CURRENCIES) {
    const manual = cur === 'USD' ? numOrNull(row.price_usd) : cur === 'CNY' ? numOrNull(row.price_cny) : numOrNull(row.price_inr);
    if (manual != null) put(cur, manual, manual);
    else if (baseMin != null) put(cur, convertAmount(baseMin, base, cur, rates), baseMax != null ? convertAmount(baseMax, base, cur, rates) : null);
  }
  return { mode, base, amounts };
}

function stripSupplier(row: any) {
  const { supplier_id, supplierId, created_by, approved_by, deleted_by, ...rest } = row;
  void supplier_id; void supplierId; void created_by; void approved_by; void deleted_by;
  return rest;
}

export async function publicView(store: CatalogStore, row: any, rates: RateMap) {
  const images = await store.images(row.id);
  const tiers = await store.tiers(row.id);
  const cat = { id: row.category_id, slug: row.category_slug ?? null, name: row.category_name ?? null };
  const price = priced(row, rates);
  const pubTiers = await Promise.all(tiers.map(async (t: any) => {
    const amounts: Record<string, number | null> = {};
    for (const cur of CURRENCIES) {
      const manual = cur === 'USD' ? t.priceUsd : cur === 'CNY' ? t.priceCny : t.priceInr;
      amounts[cur] = manual != null ? Number(manual) : convertAmount(Number(t.unitPrice), price.base, cur, rates);
    }
    return { minQty: t.minQty, maxQty: t.maxQty, amounts };
  }));
  return {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary, specs: row.specs,
    category: cat.slug ? cat : null,
    moq: row.moq, unit: row.unit, leadTime: row.lead_time,
    price, tiers: pubTiers,
    images: publicPhotos(images as any, row.id),
    isSample: !!row.is_sample,
    pinned: !!row.pinned,
    publishedAt: row.published_at ?? null,
  };
}

export function staffView(row: any, role: Role, rates: RateMap, extra: { images?: any[]; tiers?: any[] } = {}) {
  const hide = hidePrices(role);
  const price = hide ? { mode: row.price_mode, base: row.base_currency, amounts: null } : priced(row, rates);
  const out: Record<string, unknown> = {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary, specs: row.specs,
    categoryId: row.category_id, categorySlug: row.category_slug ?? null, categoryName: row.category_name ?? null,
    status: row.status, moq: row.moq, unit: row.unit, leadTime: row.lead_time,
    priceMode: row.price_mode, baseCurrency: row.base_currency,
    pinned: !!row.pinned, pinStartsAt: row.pin_starts_at, pinEndsAt: row.pin_ends_at,
    isSample: !!row.is_sample, deletedAt: row.deleted_at, publishedAt: row.published_at,
    updatedAt: row.updated_at, createdAt: row.created_at,
    price, images: extra.images ?? [], tiers: hide ? [] : (extra.tiers ?? []),
  };
  if (!hide) {
    out.priceMin = row.price_min; out.priceMax = row.price_max;
    out.priceUsd = row.price_usd; out.priceCny = row.price_cny; out.priceInr = row.price_inr;
  }
  // Phase 1: supplier identity is not returned to India or Marketplace Team (or public). Super admin and China may see the id only.
  if (role === 'SUPER_ADMIN' || role.startsWith('CHINA')) out.supplierId = row.supplier_id ?? null;
  return out;
}

/** Original, non-branded placeholder card (geometric + title + SAMPLE). */
export async function placeholderImage(title: string, color: string, w = 1200, h = 900, kind: 'product' | 'banner' = 'product') {
  const safe = escapeXml(title.slice(0, 48));
  const svg = kind === 'banner'
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="100%" height="100%" fill="${color}"/>
        <circle cx="${w * 0.85}" cy="${h * 0.2}" r="${h * 0.45}" fill="#ffffff18"/>
        <circle cx="${w * 0.1}" cy="${h * 0.9}" r="${h * 0.35}" fill="#00000014"/>
        <text x="6%" y="48%" fill="#fff" font-family="Arial, sans-serif" font-size="${Math.round(h / 7)}" font-weight="700">${safe}</text>
        <text x="6%" y="66%" fill="#ffffffcc" font-family="Arial, sans-serif" font-size="${Math.round(h / 14)}">Source Easy sample</text>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="100%" height="100%" fill="${color}"/>
        <rect x="${w * 0.08}" y="${h * 0.08}" width="${w * 0.84}" height="${h * 0.84}" rx="36" fill="#ffffff14"/>
        <circle cx="${w * 0.78}" cy="${h * 0.28}" r="${w * 0.18}" fill="#ffffff22"/>
        <text x="50%" y="48%" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="52" font-weight="700">${safe}</text>
        <text x="50%" y="62%" text-anchor="middle" fill="#ffffffd0" font-family="Arial, sans-serif" font-size="28">SAMPLE</text>
      </svg>`;
  const orig = await sharp(Buffer.from(svg)).png().toBuffer();
  if (kind === 'banner') {
    const desktop = await sharp(orig).resize(1920, 640, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
    const mobile = await sharp(orig).resize(1080, 720, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
    return { original: orig, desktop, mobile, mime: 'image/png' as const };
  }
  const card = await sharp(orig).resize(600, 600, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const gallery = await sharp(orig).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return { original: orig, card, gallery, mime: 'image/png' as const };
}
function escapeXml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

export async function processProductImage(data: Buffer) {
  if (data.length > MAX_FILE_BYTES) bad('Image must be 10 MB or smaller', 413, 'size');
  let src: sharp.Sharp | undefined;
  try { src = sharp(data, { limitInputPixels: 50e6 }).rotate(); await src.metadata(); }
  catch { bad('Upload a JPEG, PNG or WebP image', 415, 'type'); }
  const image = src!;
  const original = await image.clone().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const card = await image.clone().resize(600, 600, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const gallery = await image.clone().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return { original, card, gallery };
}
export async function processBannerImage(data: Buffer, mobile?: Buffer) {
  if (data.length > MAX_FILE_BYTES) bad('Image must be 10 MB or smaller', 413, 'size');
  let src: sharp.Sharp | undefined;
  try { src = sharp(data, { limitInputPixels: 50e6 }).rotate(); await src.metadata(); }
  catch { bad('Upload a JPEG, PNG or WebP image', 415, 'type'); }
  const image = src!;
  const desktop = await image.clone().resize(1920, 640, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
  const mobSrc = mobile ? sharp(mobile, { limitInputPixels: 50e6 }).rotate() : image;
  const mob = await mobSrc.clone().resize(1080, 720, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
  return { desktop, mobile: mob };
}

const SAMPLE_CATEGORIES = ['Hardware', 'Housewares', 'Kitchenware', 'Lighting', 'Packaging', 'Textiles'];
const SAMPLE_COLORS: Record<string, string> = {
  Hardware: '#1a6d98', Housewares: '#0e7490', Kitchenware: '#1f86bb', Lighting: '#ea580c', Packaging: '#475569', Textiles: '#56a33a',
};
const SAMPLE_PRODUCTS: { category: string; title: string; summary: string; moq: number; unit: string; leadTime: string; min: number; max: number; pin?: boolean }[] = [
  { category: 'Hardware', title: 'Stainless Hex Bolts M8', summary: 'Grade 304 hex bolts, standard pitch. Packed by carton. Sample product for the catalog preview.', moq: 2000, unit: 'pcs', leadTime: '15–20 days', min: 0.08, max: 0.12, pin: true },
  { category: 'Hardware', title: 'Adjustable Workshop Spanner', summary: 'Drop-forged adjustable spanner, 8–12 inch sizes. Sample product for the catalog preview.', moq: 500, unit: 'pcs', leadTime: '20–25 days', min: 2.4, max: 3.1 },
  { category: 'Hardware', title: 'PVC Cable Gland Set', summary: 'IP68 nylon cable glands, mixed metric sizes. Sample product for the catalog preview.', moq: 1000, unit: 'sets', leadTime: '12–18 days', min: 0.35, max: 0.55 },
  { category: 'Hardware', title: 'Brass Ball Valve 1/2 inch', summary: 'Full-bore brass ball valve with lever handle. Sample product for the catalog preview.', moq: 300, unit: 'pcs', leadTime: '18–22 days', min: 3.8, max: 5.2 },
  { category: 'Housewares', title: 'Bamboo Cutting Board', summary: 'FSC-style bamboo board, juice groove, custom logo area. Sample product for the catalog preview.', moq: 400, unit: 'pcs', leadTime: '20–30 days', min: 4.2, max: 6.5, pin: true },
  { category: 'Housewares', title: 'Glass Storage Jars', summary: 'Clear glass jars with bamboo lids, 3-size set. Sample product for the catalog preview.', moq: 600, unit: 'sets', leadTime: '25–30 days', min: 5.0, max: 7.8 },
  { category: 'Housewares', title: 'Microfiber Towel Set', summary: '400 gsm microfiber towels, 3-piece set, plain colours. Sample product for the catalog preview.', moq: 800, unit: 'sets', leadTime: '18–25 days', min: 3.2, max: 4.6 },
  { category: 'Kitchenware', title: 'Stainless Mixing Bowls', summary: 'Nesting 304 bowls, 3 sizes, satin finish. Sample product for the catalog preview.', moq: 300, unit: 'sets', leadTime: '20–25 days', min: 6.5, max: 9.0 },
  { category: 'Kitchenware', title: 'Silicone Spatula Set', summary: 'Heat-resistant utensils, 5-piece kitchen set. Sample product for the catalog preview.', moq: 500, unit: 'sets', leadTime: '15–20 days', min: 2.8, max: 4.0, pin: true },
  { category: 'Kitchenware', title: 'Cast Iron Skillet 26 cm', summary: 'Pre-seasoned skillet, wooden handle option. Sample product for the catalog preview.', moq: 200, unit: 'pcs', leadTime: '25–35 days', min: 11, max: 15 },
  { category: 'Lighting', title: 'LED Panel Light 60×60', summary: '40 W recessed panel, 4000 K, office and shop use. Sample product for the catalog preview.', moq: 200, unit: 'pcs', leadTime: '15–22 days', min: 8.5, max: 12, pin: true },
  { category: 'Lighting', title: 'Adjustable Desk Lamp', summary: 'Folding LED desk lamp, USB-C, matte finishes. Sample product for the catalog preview.', moq: 400, unit: 'pcs', leadTime: '20–28 days', min: 7.0, max: 10.5 },
  { category: 'Lighting', title: 'Edison Filament Bulb Pack', summary: 'E27 amber filament bulbs, pack of 4. Sample product for the catalog preview.', moq: 800, unit: 'sets', leadTime: '12–18 days', min: 3.4, max: 4.8 },
  { category: 'Packaging', title: 'Corrugated Mailer Boxes', summary: 'E-flute mailers, custom print available, three sizes. Sample product for the catalog preview.', moq: 1000, unit: 'pcs', leadTime: '12–16 days', min: 0.22, max: 0.45 },
  { category: 'Packaging', title: 'Kraft Bubble Mailers', summary: 'Padded kraft mailers, #0 to #5. Sample product for the catalog preview.', moq: 2000, unit: 'pcs', leadTime: '10–15 days', min: 0.09, max: 0.18 },
  { category: 'Packaging', title: 'Stretch Wrap Roll', summary: 'Hand-grade stretch film, 500 mm, 23 micron. Sample product for the catalog preview.', moq: 200, unit: 'pcs', leadTime: '10–14 days', min: 4.5, max: 6.2 },
  { category: 'Textiles', title: 'Cotton Tea Towels', summary: 'Plain-weave cotton towels, hemmed, dye-ready. Sample product for the catalog preview.', moq: 600, unit: 'pcs', leadTime: '20–25 days', min: 1.1, max: 1.8 },
  { category: 'Textiles', title: 'Canvas Tote Blank', summary: '12 oz cotton canvas tote, unprinted, 15 litre. Sample product for the catalog preview.', moq: 500, unit: 'pcs', leadTime: '18–24 days', min: 1.9, max: 2.7 },
  { category: 'Textiles', title: 'Polyester Drawstring Bag', summary: 'Lightweight kit bag, one colour, printed option. Sample product for the catalog preview.', moq: 1000, unit: 'pcs', leadTime: '15–20 days', min: 0.7, max: 1.1 },
];

export async function seedSamples(store: CatalogStore, deps: CatalogDeps, by: string) {
  const existing = await store.db.get<{ n: number }>("SELECT count(*)::int AS n FROM products WHERE is_sample = true AND deleted_at IS NULL");
  if ((existing?.n ?? 0) > 0) bad('Sample products are already in the catalog. Remove them first if you want to seed again.', 409, 'exists');
  const cats: Record<string, { id: string; slug: string; name: string }> = {};
  for (const name of SAMPLE_CATEGORIES) cats[name] = (await store.upsertCategory(name)) as any;
  if (!(await store.rateList()).length) {
    await store.setRates(SAMPLE_RATES.map(([base, quote, rate]) => ({ base, quote, rate })), by);
  }
  const created: string[] = [];
  for (const p of SAMPLE_PRODUCTS) {
    const cat = cats[p.category];
    const id = randomUUID();
    const slug = await store.uniqueSlug(p.title);
    const specs = { material: 'See summary', finish: 'As pictured (sample)', packing: 'Export carton', origin: 'China (sample)', note: 'Sample product — not a live offer' };
    await store.db.run(`INSERT INTO products (id, slug, title, summary, specs, category_id, status, moq, unit, lead_time, price_mode, base_currency,
      price_min, price_max, pinned, is_sample, created_by, approved_by, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,now())`,
      id, slug, p.title, p.summary, JSON.stringify(specs),
      cat.id, 'PUBLISHED', p.moq, p.unit, p.leadTime, 'RANGE', 'USD', p.min, p.max, !!p.pin, true, by, by);
    if (p.pin) {
      await store.db.run('INSERT INTO product_price_tiers (id, product_id, min_qty, max_qty, unit_price) VALUES (?,?,?,?,?)',
        randomUUID(), id, p.moq, p.moq * 2, p.min);
      await store.db.run('INSERT INTO product_price_tiers (id, product_id, min_qty, max_qty, unit_price) VALUES (?,?,?,?,?)',
        randomUUID(), id, p.moq * 2, null, Number((p.min * 0.9).toFixed(4)));
    }
    const pal = CATEGORY_PALETTES[p.category] ?? CATEGORY_PALETTES.Hardware;
    const scene = sceneFor(p.title, p.category);
    for (let v = 0; v < 4; v++) {
      const img = await productStudioImage(scene, v, pal);
      await saveProductPhoto(deps, id, img, `${p.title} (sample)`, v, v === 0);
    }
    await deps.mediaSync?.(ownerKey('p', id), deps.uploads.list(ownerKey('p', id)));
    await store.audit(id, by, 'SEED_SAMPLE', null, { title: p.title });
    created.push(id);
  }
  const banners = [
    { title: 'Source from China, delivered worldwide', color: '#1a6d98' },
    { title: 'Request a quote in a few taps', color: '#ea580c' },
    { title: 'Clear prices in USD, RMB and INR', color: '#56a33a' },
  ];
  let sort = 0;
  for (const b of banners) {
    const id = randomUUID();
    const img = await bannerStudioImage(b.title, { bg: b.color, mid: b.color, item: b.color, shade: b.color, highlight: '#ffffff' });
    const saved = deps.uploads.save(ownerKey('bn', id), [
      { name: 'desktop.webp', mime: 'image/webp', data: img.desktop },
      { name: 'mobile.webp', mime: 'image/webp', data: img.mobile },
    ]);
    await store.db.run(`INSERT INTO banner_slides (id, sort, file_id, mobile_file_id, alt_text, link_kind, active, is_sample, created_by)
      VALUES (?,?,?,?,?,?,true,true,?)`, id, sort++, saved[0].id, saved[1].id, b.title, 'NONE', by);
    await deps.mediaSync?.(ownerKey('bn', id), deps.uploads.list(ownerKey('bn', id)));
  }
  return { products: created.length, banners: banners.length, categories: SAMPLE_CATEGORIES.length };
}

async function sendUpload(reply: FastifyReply, uploads: UploadStore, key: string, id: string, cache: string) {
  const f = uploads.file(key, id); if (!f) return reply.code(404).send({ error: 'Not found' });
  return reply.header('content-type', f.meta.mime).header('cache-control', cache).header('content-length', f.size).send(await (await import('node:fs/promises')).readFile(f.path));
}

export function registerPublicCatalog(app: FastifyInstance, deps: CatalogDeps) {
  const store = new CatalogStore(deps.db);
  const pubCache = 'public, max-age=60';

  app.get('/api/public/catalog/status', async () => store.status());
  app.get('/api/public/catalog/fx', async () => {
    const list = await store.rateList();
    return { data: list.map((r: any) => ({ base: r.base, quote: r.quote, rate: Number(r.rate), asOf: r.asOf })) };
  });
  app.get('/api/public/catalog/categories', async () => ({ data: await store.categories(true) }));

  app.get<{ Querystring: Record<string, string> }>('/api/public/catalog/products', async (req) => {
    const q = req.query ?? {};
    const rates = await store.rates();
    const { rows, total, limit, offset } = await store.searchPublic({
      q: q.q, category: q.category, sort: q.sort, moqMax: q.moq ? Number(q.moq) : undefined,
      hasPrice: q.hasPrice === '1' || q.hasPrice === 'true', limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
    });
    const data = [];
    for (const r of rows) data.push(await publicView(store, r, rates));
    return { data, total, limit, offset };
  });

  app.get<{ Params: { slug: string } }>('/api/public/catalog/products/:slug', async (req, reply) => {
    const row = await store.get(req.params.slug);
    if (!row || row.status !== 'PUBLISHED') return reply.code(404).send({ error: 'Not found' });
    const rates = await store.rates();
    const data = await publicView(store, row, rates);
    return { data };
  });

  app.get('/api/public/catalog/banners', async () => {
    const settings = await store.bannerSettings();
    const now = new Date().toISOString();
    const rows = await deps.db.all<any>(`SELECT * FROM banner_slides WHERE active = true
      AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
      ORDER BY sort, created_at`, now, now);
    const slides: PublicBanner[] = rows.map((r: any) => ({
      id: r.id, sort: r.sort, altText: r.alt_text, source: 'banner' as const,
      imageUrl: `/api/public/catalog/banners/${r.id}/image?k=desktop`,
      mobileUrl: r.mobile_file_id ? `/api/public/catalog/banners/${r.id}/image?k=mobile` : null,
      href: r.link_kind === 'URL' ? r.url : r.link_kind === 'PRODUCT' && r.product_id ? `/p/${r.product_id}` : r.link_kind === 'CATEGORY' && r.category_id ? `/c/${r.category_id}` : null,
    }));
    const greetings = await deps.livePublicGreetings?.() ?? [];
    const merged = [...greetings.map((g, i) => ({ ...g, sort: -1000 + i })), ...slides].slice(0, MAX_LIVE_BANNERS);
    return { data: merged, ...settings };
  });

  app.get<{ Params: { id: string }; Querystring: { k?: string } }>('/api/public/catalog/banners/:id/image', async (req, reply) => {
    const r = await deps.db.get<any>('SELECT * FROM banner_slides WHERE id = ? AND active = true', req.params.id);
    if (!r) return reply.code(404).send({ error: 'Not found' });
    const fid = req.query.k === 'mobile' && r.mobile_file_id ? r.mobile_file_id : r.file_id;
    if (!fid) return reply.code(404).send({ error: 'Not found' });
    return sendUpload(reply, deps.uploads, ownerKey('bn', r.id), fid, 'public, max-age=86400');
  });

  app.get<{ Params: { productId: string; fileId: string } }>('/api/public/catalog/images/:productId/:fileId', async (req, reply) => {
    const row = await store.get(req.params.productId);
    if (!row || row.status !== 'PUBLISHED') return reply.code(404).send({ error: 'Not found' });
    const im = (await store.images(row.id)).find((x: any) => x.fileId === req.params.fileId);
    if (!im) return reply.code(404).send({ error: 'Not found' });
    return sendUpload(reply, deps.uploads, ownerKey('p', row.id), req.params.fileId, 'public, max-age=86400');
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/public/catalog/products/:id/enquire', async (req, reply) => {
    const row = await store.get(req.params.id);
    if (!row || row.status !== 'PUBLISHED') return reply.code(404).send({ error: 'Not found' });
    if (!deps.createEnquiry) return reply.code(501).send({ error: 'Enquiry is not available' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = String(b.name ?? '').trim(), phone = String(b.phone ?? '').trim();
    if (!name || !phone) return reply.code(400).send({ error: 'Name and mobile number are required', code: 'required' });
    try {
      const r = await deps.createEnquiry({
        product: { id: row.id, title: row.title, slug: row.slug },
        name, phone, phoneCode: String(b.phoneCode ?? '+91'), email: b.email ? String(b.email) : undefined,
        company: b.company ? String(b.company) : undefined, quantity: b.quantity != null ? Number(b.quantity) : undefined,
        unit: b.unit ? String(b.unit) : undefined, message: b.message ? String(b.message) : undefined,
        city: b.city ? String(b.city) : undefined, requestLogin: /^(1|true|on|yes)$/i.test(String(b.requestLogin ?? '')),
      });
      await deps.db.run('INSERT INTO product_enquiries (id, product_id, lead_id, at) VALUES (?,?,?,now())', randomUUID(), row.id, r.leadId);
      return reply.code(201).send({ ok: true, reference: r.leadRef, ...(r.loginRequested ? { loginRequested: true } : {}) });
    } catch (e: any) {
      return reply.code(e.status ?? 400).send({ error: e.message, ...(e.appCode ? { code: e.appCode } : {}) });
    }
  });
}

export function registerStaffCatalog(api: FastifyInstance, deps: CatalogDeps) {
  const store = new CatalogStore(deps.db);
  const need = (u: User, k: string) => { if (!deps.perms.can(u, k) && u.role !== 'SUPER_ADMIN') forbid(`You do not have permission: ${k}`); };
  // SUPER_ADMIN always passes perms.can, but keep explicit.

  api.get('/api/catalog/status', async (req) => store.status());
  api.get('/api/catalog/categories', async () => ({ data: await store.categories(false) }));
  api.post<{ Body: { name?: string } }>('/api/catalog/categories', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    return { data: await store.upsertCategory(String(req.body?.name ?? '')) };
  });

  api.get('/api/catalog/settings', async (req) => {
    if (!isSa(req.user!)) forbid();
    return { data: { ...(await store.status()), ...(await store.bannerSettings()), rates: await store.rateList() } };
  });
  api.patch<{ Body: { homepageEnabled?: boolean; bannerDirection?: string; bannerIntervalSeconds?: number; trustItems?: { title: string; text: string }[]; promo?: { enabled?: boolean; text?: string; href?: string } } }>('/api/catalog/settings', async (req) => {
    if (!isSa(req.user!)) forbid();
    const b = req.body ?? {};
    if (typeof b.homepageEnabled === 'boolean') await store.setSetting('homepage_enabled', b.homepageEnabled, req.user!.id);
    if (b.bannerDirection === 'LTR' || b.bannerDirection === 'RTL') await store.setSetting('banner_direction', b.bannerDirection, req.user!.id);
    if (b.bannerIntervalSeconds != null) await store.setSetting('banner_interval_seconds', Number(b.bannerIntervalSeconds), req.user!.id);
    if (b.trustItems) await store.setTrustItems(b.trustItems, req.user!.id);
    if (b.promo) await store.setPromoStrip(b.promo, req.user!.id);
    return { data: { ...(await store.status()), ...(await store.bannerSettings()) } };
  });

  api.get('/api/catalog/fx', async (req) => { if (!isSa(req.user!) && !canPrice(deps.perms, req.user!)) forbid(); return { data: await store.rateList() }; });
  api.put<{ Body: { rates?: { base: string; quote: string; rate: number }[] } }>('/api/catalog/fx', async (req) => {
    if (!isSa(req.user!)) forbid();
    return { data: await store.setRates(req.body?.rates ?? [], req.user!.id) };
  });

  api.post('/api/catalog/samples/seed', async (req, reply) => {
    if (!isSa(req.user!)) forbid();
    const r = await seedSamples(store, deps, req.user!.id);
    return reply.code(201).send({ data: r });
  });
  api.post('/api/catalog/samples/remove', async (req) => {
    if (!isSa(req.user!)) forbid();
    return { data: await store.removeAllSamples(req.user!.id) };
  });

  api.get<{ Querystring: Record<string, string> }>('/api/products', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    const q = req.query ?? {};
    const rates = await store.rates();
    const { rows, total, limit, offset } = await store.listStaff({
      q: q.q, status: q.status, category: q.category, includeDeleted: isSa(u) && (q.deleted === '1' || q.deleted === 'true'),
      limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
    });
    const data = [];
    for (const r of rows) {
      const images = await store.images(r.id);
      data.push(staffView(r, u.role, rates, { images: staffPhotos(images as any, r.id) }));
    }
    return { data, total, limit, offset };
  });

  api.post<{ Body: Record<string, unknown> }>('/api/products', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.create(req.body ?? {}, u.id);
    return reply.code(201).send({ data: staffView(row, u.role, await store.rates()) });
  });

  api.get<{ Params: { id: string } }>('/api/products/:id', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.get(req.params.id, { includeDeleted: isSa(u) });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const images = await store.images(row.id);
    const tiers = await store.tiers(row.id);
    return { data: staffView(row, u.role, await store.rates(), { images: staffPhotos(images as any, row.id), tiers }) };
  });

  api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/products/:id', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.update(req.params.id, req.body ?? {}, u.id, { prices: canPrice(deps.perms, u) });
    return { data: staffView(row, u.role, await store.rates()) };
  });

  api.post<{ Params: { id: string } }>('/api/products/:id/publish', async (req) => {
    const u = req.user!; need(u, 'catalog.publish');
    return { data: staffView(await store.publish(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/unpublish', async (req) => {
    const u = req.user!; need(u, 'catalog.publish');
    return { data: staffView(await store.unpublish(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.post<{ Params: { id: string }; Body: { confirm?: unknown } }>('/api/products/:id/delete', async (req) => {
    const u = req.user!; need(u, 'catalog.delete');
    if (req.body?.confirm !== true && req.body?.confirm !== 'true') bad('Confirm deletion');
    return { data: staffView(await store.softDelete(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/restore', async (req) => {
    const u = req.user!; if (!isSa(u)) forbid('Only the super admin can restore a deleted product');
    return { data: staffView(await store.restore(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.get<{ Params: { id: string } }>('/api/products/:id/audit', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    return { data: await store.auditList(req.params.id) };
  });

  api.post<{ Params: { id: string } }>('/api/products/:id/images', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.get(req.params.id); if (!row) return reply.code(404).send({ error: 'Not found' });
    if (!req.isMultipart()) bad('multipart/form-data expected');
    const f = await req.file({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
    if (!f) return reply.code(400).send({ error: 'No file' });
    const buf = await f.toBuffer();
    if (f.file.truncated) bad('Image must be 10 MB or smaller', 413, 'size');
    const existing = await store.images(row.id);
    const groups = photoGroups(existing as any);
    if (groups.length >= MAX_PRODUCT_IMAGES) bad(`Up to ${MAX_PRODUCT_IMAGES} photos per product`, 413, 'count');
    const processed = await processProductImage(buf);
    const alt = (req.headers['x-alt-text'] ? String(req.headers['x-alt-text']) : row.title).slice(0, 200);
    const saved = await saveProductPhoto(deps, row.id, processed, alt, groups.length, groups.length === 0);
    await deps.mediaSync?.(ownerKey('p', row.id), deps.uploads.list(ownerKey('p', row.id)));
    await store.audit(row.id, u.id, 'IMAGE_ADD', null, { groupId: saved.groupId, files: saved.files.map((s) => s.id) });
    return reply.code(201).send({ data: staffPhotos((await store.images(row.id)) as any, row.id) });
  });

  api.get<{ Params: { id: string; fid: string } }>('/api/products/:id/images/:fid', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.get(req.params.id, { includeDeleted: isSa(u) });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return sendUpload(reply, deps.uploads, ownerKey('p', row.id), req.params.fid, 'private, max-age=60');
  });

  api.delete<{ Params: { id: string; fid: string } }>('/api/products/:id/images/:fid', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.get(req.params.id); if (!row) return reply.code(404).send({ error: 'Not found' });
    const all = await store.images(row.id);
    const group = photoGroups(all as any).find((g) => g.id === req.params.fid || g.fileIds.includes(req.params.fid));
    const ids = group ? group.fileIds : [req.params.fid];
    for (const fid of ids) {
      await deps.db.run('DELETE FROM product_images WHERE product_id = ? AND file_id = ?', row.id, fid);
      deps.uploads.remove(ownerKey('p', row.id), fid);
    }
    await deps.mediaSync?.(ownerKey('p', row.id), deps.uploads.list(ownerKey('p', row.id)));
    await store.audit(row.id, u.id, 'IMAGE_DELETE', { fileIds: ids }, null);
    return { ok: true };
  });
  api.patch<{ Params: { id: string }; Body: { order?: string[]; cover?: string } }>('/api/products/:id/images', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await store.get(req.params.id); if (!row) return reply.code(404).send({ error: 'Not found' });
    const groups = photoGroups((await store.images(row.id)) as any);
    const order = Array.isArray(req.body?.order) ? req.body!.order : groups.map((g) => g.id);
    for (let i = 0; i < order.length; i++) {
      await deps.db.run('UPDATE product_images SET sort = ? WHERE product_id = ? AND (group_id = ? OR file_id = ?)', i, row.id, order[i], order[i]);
    }
    const cover = req.body?.cover || order[0];
    if (cover) {
      await deps.db.run('UPDATE product_images SET is_cover = false WHERE product_id = ?', row.id);
      await deps.db.run('UPDATE product_images SET is_cover = true WHERE product_id = ? AND (group_id = ? OR file_id = ?)', row.id, cover, cover);
    }
    await store.audit(row.id, u.id, 'IMAGE_REORDER', null, { order, cover });
    return { data: staffPhotos((await store.images(row.id)) as any, row.id) };
  });

  // Banners
  api.get('/api/banners', async (req) => {
    const u = req.user!; need(u, 'catalog.banners');
    const rows = await deps.db.all('SELECT * FROM banner_slides ORDER BY sort, created_at');
    return { data: rows.map(bannerDto), ...(await store.bannerSettings()) };
  });
  api.post<{ Body: Record<string, unknown> }>('/api/banners', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.banners');
    const live = (await deps.db.get<{ n: number }>('SELECT count(*)::int AS n FROM banner_slides WHERE active = true'))?.n ?? 0;
    if (live >= MAX_LIVE_BANNERS && req.body?.active !== false) bad(`At most ${MAX_LIVE_BANNERS} live banners`, 400, 'limit');
    const id = randomUUID();
    const alt = String(req.body?.altText ?? '').trim();
    if (!alt) bad('Alt text is required');
    await deps.db.run(`INSERT INTO banner_slides (id, sort, alt_text, link_kind, product_id, category_id, url, starts_at, ends_at, active, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, Number(req.body?.sort ?? 0), alt, req.body?.linkKind ?? 'NONE',
      emptyToNull(req.body?.productId), emptyToNull(req.body?.categoryId), emptyToNull(req.body?.url, 500),
      req.body?.startsAt || null, req.body?.endsAt || null, req.body?.active !== false, u.id);
    const row = await deps.db.get('SELECT * FROM banner_slides WHERE id = ?', id);
    return reply.code(201).send({ data: bannerDto(row) });
  });
  api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/banners/:id', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.banners');
    const cur = await deps.db.get('SELECT * FROM banner_slides WHERE id = ?', req.params.id);
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    const b = req.body ?? {};
    const fields: Record<string, unknown> = {};
    if (b.altText != null) fields.alt_text = String(b.altText).trim();
    if (b.sort != null) fields.sort = Number(b.sort);
    if (b.linkKind != null) fields.link_kind = b.linkKind;
    if (b.productId !== undefined) fields.product_id = emptyToNull(b.productId);
    if (b.categoryId !== undefined) fields.category_id = emptyToNull(b.categoryId);
    if (b.url !== undefined) fields.url = emptyToNull(b.url, 500);
    if (b.startsAt !== undefined) fields.starts_at = b.startsAt || null;
    if (b.endsAt !== undefined) fields.ends_at = b.endsAt || null;
    if (b.active != null) fields.active = !!b.active;
    const cols = Object.keys(fields);
    if (cols.length) await deps.db.run(`UPDATE banner_slides SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, ...cols.map((c) => fields[c]), req.params.id);
    return { data: bannerDto(await deps.db.get('SELECT * FROM banner_slides WHERE id = ?', req.params.id)) };
  });
  api.delete<{ Params: { id: string } }>('/api/banners/:id', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.banners');
    const cur = await deps.db.get('SELECT * FROM banner_slides WHERE id = ?', req.params.id);
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    await deps.db.run('DELETE FROM banner_slides WHERE id = ?', req.params.id);
    return { ok: true };
  });
  api.post<{ Params: { id: string } }>('/api/banners/:id/image', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.banners');
    const cur = await deps.db.get<any>('SELECT * FROM banner_slides WHERE id = ?', req.params.id);
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    if (!req.isMultipart()) bad('multipart/form-data expected');
    const parts: { field: string; buf: Buffer }[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.file.truncated) bad('Image must be 10 MB or smaller', 413, 'size');
        parts.push({ field: part.fieldname, buf });
      }
    }
    const desk = parts.find((p) => p.field !== 'mobile')?.buf ?? parts[0]?.buf;
    if (!desk) bad('No file');
    const processed = await processBannerImage(desk, parts.find((p) => p.field === 'mobile')?.buf);
    const saved = deps.uploads.save(ownerKey('bn', cur.id), [
      { name: 'desktop.webp', mime: 'image/webp', data: processed.desktop },
      { name: 'mobile.webp', mime: 'image/webp', data: processed.mobile },
    ]);
    await deps.db.run('UPDATE banner_slides SET file_id = ?, mobile_file_id = ?, updated_at = now() WHERE id = ?', saved[0].id, saved[1].id, cur.id);
    await deps.mediaSync?.(ownerKey('bn', cur.id), deps.uploads.list(ownerKey('bn', cur.id)));
    return reply.code(201).send({ data: bannerDto(await deps.db.get('SELECT * FROM banner_slides WHERE id = ?', cur.id)) });
  });
  api.get<{ Params: { id: string }; Querystring: { k?: string } }>('/api/banners/:id/image', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.banners');
    const r = await deps.db.get<any>('SELECT * FROM banner_slides WHERE id = ?', req.params.id);
    if (!r) return reply.code(404).send({ error: 'Not found' });
    const fid = req.query.k === 'mobile' && r.mobile_file_id ? r.mobile_file_id : r.file_id;
    if (!fid) return reply.code(404).send({ error: 'Not found' });
    return sendUpload(reply, deps.uploads, ownerKey('bn', r.id), fid, 'private, max-age=60');
  });
}

function bannerDto(r: any) {
  if (!r) return r;
  return {
    id: r.id, sort: r.sort, altText: r.alt_text, linkKind: r.link_kind, productId: r.product_id, categoryId: r.category_id, url: r.url,
    startsAt: r.starts_at, endsAt: r.ends_at, active: !!r.active, isSample: !!r.is_sample,
    imageUrl: r.file_id ? `/api/banners/${r.id}/image?k=desktop` : null,
    mobileUrl: r.mobile_file_id ? `/api/banners/${r.id}/image?k=mobile` : null,
  };
}

/** Routes a Marketplace Team login may call. Everything else is 403. */
export function marketplaceTeamAllowed(url: string) {
  return /^\/api\/me(\/|$)/.test(url) || /^\/api\/products(\/|$)/.test(url) || /^\/api\/catalog(\/|$)/.test(url) || /^\/api\/banners(\/|$)/.test(url);
}

export { stripSupplier };
