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
import type { UploadStore, Attachment, Staged } from './uploads.js';
import { MAX_FILE_BYTES, MAX_FILES, isVideo } from './uploads.js';
import { productStudioImage, bannerStudioImage, sceneFor, CATEGORY_PALETTES } from './studio.js';
import {
  addFavorite, favoriteIds, listFavorites, parseTags, pinOrder, recordEnquiryEvent, recordView,
  relatedProducts, removeFavorite, scoreJoin, scoresFor, tagsOf, windowDays,
} from './catalog-engagement.js';
import { normalizeMerchandising, parseMerchandising, publicMerchandising } from './merchandising.js';

export const PRODUCT_STATUSES = ['DRAFT', 'READY_FOR_PRICE', 'PENDING_REVIEW', 'PUBLISHED', 'UNPUBLISHED', 'DELETED'] as const;
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
    product?: { id: string; title: string; slug: string };
    name: string; phone: string; phoneCode: string; email?: string; company?: string; requirement?: string;
    quantity?: number; unit?: string; message?: string; city?: string; requestLogin?: boolean;
    customerId?: string;
  }) => Promise<{ leadId: string; leadRef: string; loginRequested?: boolean }>;
  readMultipart?: (req: FastifyRequest, maxFiles: number) => Promise<{ fields: Record<string, string>; files: Staged[]; err: { status: number; error: string; code: string } | null }>;
  /** True when the request carries a customer-portal token for an active paid membership. Staff tokens never count. */
  isPaidMember?: (req: FastifyRequest) => Promise<boolean>;
  reservePublicEnquiry?: (req: FastifyRequest, honeypot: string) => Promise<{ skip?: true; limited?: true; ok?: true }>;
  createPublicShipping?: (input: {
    name: string; phone: string; phoneCode: string; email?: string; company?: string;
    goods: string; quantity?: number; unit?: string; packages?: number; weightKg?: number; cbm?: number;
    shipperName?: string; shipperPhone?: string; pickupAddress?: string; pickupCity?: string;
    destCity: string; destAddress?: string; destPincode?: string; mode?: string; incoterm?: string;
    readyDate?: string; customerNote?: string; files: Staged[];
  }) => Promise<{ id: string; ref: string }>;
  livePublicGreetings?: () => Promise<PublicBanner[]>;
  /** Linked catalog supplier for a SUPPLIER login, if any. */
  supplierOf?: (userId: string) => Promise<{ supplierId: string; status: string } | null>;
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
export function canManageCategories(u: User) { return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM'; }
/** Manual Trending pin and Clearance flags: Marketplace Team and super admin only (not India staff or suppliers). */
export function canPromote(u: User) { return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM'; }

/** Live clearance rows: flagged, not expired, and not sold out. Used by the public Clearance section. */
export const ACTIVE_CLEARANCE_SQL = `(p.clearance = true AND (p.clearance_ends_at IS NULL OR p.clearance_ends_at >= now()) AND (p.clearance_stock_left IS NULL OR p.clearance_stock_left > 0))`;

export function isActiveClearance(row: { clearance?: unknown; clearance_ends_at?: string | null; clearanceEndsAt?: string | null; clearance_stock_left?: number | null; clearanceStockLeft?: number | null }, at = Date.now()) {
  if (!row?.clearance) return false;
  const ends = row.clearance_ends_at ?? row.clearanceEndsAt;
  if (ends && new Date(ends).getTime() < at) return false;
  const left = row.clearance_stock_left ?? row.clearanceStockLeft;
  if (left != null && Number(left) <= 0) return false;
  return true;
}

function parseClearanceEnd(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999+05:30`).toISOString();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) bad('Clearance end date is not valid', 400);
  return d.toISOString();
}

function parseDiscountPct(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) bad('Clearance discount must be between 0 and 100', 400);
  return Math.round(n * 100) / 100;
}

function parseStockLeft(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) bad('Stock left must be a whole number of 0 or more', 400);
  return n;
}

function clearanceSalePrice(row: any, rates: RateMap, regular: ReturnType<typeof priced>) {
  const base = (CURRENCIES.includes(row.base_currency) ? row.base_currency : 'USD') as Currency;
  const direct = numOrNull(row.clearance_price);
  const pct = numOrNull(row.clearance_discount_pct);
  let baseSale: number | null = direct;
  if (baseSale == null && pct != null) {
    const orig = regular.amounts?.[base]?.min ?? numOrNull(row.price_min);
    if (orig != null) baseSale = roundMoney(orig * (1 - pct / 100), base);
  }
  if (baseSale == null) return null;
  const amounts: Record<Currency, { min: number | null; max: number | null }> = { USD: { min: null, max: null }, CNY: { min: null, max: null }, INR: { min: null, max: null } };
  amounts[base] = { min: baseSale, max: baseSale };
  return { mode: 'RANGE' as const, base, amounts };
}
function categoryMatchSql(ids: string[]) {
  const ph = ids.map(() => '?').join(',');
  return { sql: `(p.category_id IN (${ph}) OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id IN (${ph})))`, params: [...ids, ...ids] };
}
function isSa(u: User) { return u.role === 'SUPER_ADMIN'; }
function hidePrices(role: Role) { return sides(role).china && role !== 'SUPER_ADMIN'; }
/** Super admin, China staff, and Marketplace Team may link a supplier to a product. India staff cannot. */
export function canLinkSupplier(u: User) {
  return u.role === 'SUPER_ADMIN' || u.role === 'MARKETPLACE_TEAM' || u.role.startsWith('CHINA');
}
/** Who may see supplier identity on staff catalog screens. Follows the existing rule: SA, Marketplace Team, China, and a supplier on their own products. India-only roles (INDIA_ADMIN, INDIA_STAFF, etc.) cannot. */
export function canSeeSupplierIdentity(role: Role) {
  return role === 'SUPER_ADMIN' || role === 'MARKETPLACE_TEAM' || role === 'SUPPLIER' || role.startsWith('CHINA');
}

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
    return { enabled: v?.enabled === true, text, href };
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

  categoryRow(r: any) {
    return r ? { id: r.id, slug: r.slug, name: r.name, parentId: r.parentId ?? r.parent_id ?? null, active: r.active !== false } : null;
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
  async categoryById(id: string) {
    return this.db.get('SELECT id, slug, name, parent_id AS "parentId", active FROM categories WHERE id = ?', id);
  }
  async categoryBySlugOrId(idOrSlug: string) {
    return this.db.get('SELECT id, slug, name, parent_id AS "parentId", active FROM categories WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
  }
  async uniqueCategorySlug(base: string, except?: string) {
    let n = 2;
    let slug = slugify(base);
    if (!slug) bad('Category name is required');
    for (;;) {
      const row = await this.db.get<{ id: string }>('SELECT id FROM categories WHERE slug = ?', slug);
      if (!row || row.id === except) return slug;
      slug = `${slugify(base).slice(0, 70)}-${n++}`;
    }
  }
  async categoryPath(idOrSlug: string) {
    const start = await this.db.get('SELECT id, slug, name, parent_id AS "parentId" FROM categories WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
    if (!start) return [];
    const path = [{ id: start.id, slug: start.slug, name: start.name }];
    const seen = new Set<string>([start.id]);
    let parentId = start.parentId as string | null;
    for (let i = 0; i < 20 && parentId; i++) {
      const row = await this.db.get('SELECT id, slug, name, parent_id AS "parentId" FROM categories WHERE id = ?', parentId);
      if (!row || seen.has(row.id)) break;
      seen.add(row.id);
      path.unshift({ id: row.id, slug: row.slug, name: row.name });
      parentId = row.parentId;
    }
    return path;
  }
  async descendantIds(idOrSlug: string) {
    const rows = await this.db.all<{ id: string }>(`WITH RECURSIVE tree AS (
      SELECT id, 1 AS depth FROM categories WHERE id = ? OR slug = ?
      UNION ALL
      SELECT c.id, t.depth + 1 FROM categories c JOIN tree t ON c.parent_id = t.id WHERE t.depth < 20
    ) SELECT id FROM tree`, idOrSlug, idOrSlug);
    return rows.map((r) => r.id);
  }
  async wouldCycle(id: string, parentId: string | null) {
    if (!parentId) return false;
    if (parentId === id) return true;
    let cur: string | null = parentId;
    const seen = new Set<string>();
    for (let i = 0; i < 20 && cur; i++) {
      if (cur === id) return true;
      if (seen.has(cur)) return true;
      seen.add(cur);
      const parentRow: { parentId: string | null } | undefined = await this.db.get('SELECT parent_id AS "parentId" FROM categories WHERE id = ?', cur);
      cur = parentRow?.parentId ?? null;
    }
    return false;
  }
  async upsertCategory(name: string, id?: string, parentId?: string | null, active?: boolean) {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) bad('Category name is required');
    const parent = parentId === undefined ? undefined : (parentId ? String(parentId) : null);
    if (parent) {
      const p = await this.categoryById(parent);
      if (!p) bad('Parent category not found', 400);
    }
    const parentKey = parent === undefined && id ? (await this.categoryById(id))?.parentId ?? null : (parent ?? null);
    const sibling = await this.db.get<{ id: string }>(
      `SELECT id FROM categories WHERE lower(name) = lower(?) AND coalesce(parent_id, '') = coalesce(?, '') AND id <> coalesce(?, '')`,
      trimmed, parentKey, id ?? '',
    );
    if (sibling && !id) {
      // Same name under the same parent: return the existing row so repeated creates are idempotent.
      return this.categoryById(sibling.id);
    }
    if (sibling && id && sibling.id !== id) bad('A category with that name already exists under this parent', 409, 'duplicate');
    if (id) {
      if (parent !== undefined && await this.wouldCycle(id, parent ?? null)) bad('A category cannot be nested under itself');
      const slug = await this.uniqueCategorySlug(trimmed, id);
      const sets = ['name = ?', 'slug = ?'];
      const args: unknown[] = [trimmed, slug];
      if (parent !== undefined) { sets.push('parent_id = ?'); args.push(parent); }
      if (active !== undefined) { sets.push('active = ?'); args.push(!!active); }
      await this.db.run(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
      return this.categoryById(id);
    }
    const slug = await this.uniqueCategorySlug(trimmed);
    const existing = await this.db.get('SELECT id, slug, name, parent_id AS "parentId", active FROM categories WHERE slug = ?', slug);
    // Reuse only a same-name top-level category when creating another top-level row (seed-safe).
    if (existing && !parent && !existing.parentId) return existing;
    const nid = randomUUID();
    await this.db.run('INSERT INTO categories (id, slug, name, parent_id) VALUES (?,?,?,?)', nid, slug, trimmed, parent ?? null);
    return { id: nid, slug, name: trimmed, parentId: parent ?? null, active: true };
  }


  async auditCategory(categoryId: string | null, by: string | null, action: string, before?: unknown, after?: unknown) {
    await this.db.run(
      'INSERT INTO category_audit (category_id, by_user, action, before, after) VALUES (?,?,?,?,?)',
      categoryId, by, action, before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null,
    );
  }
  async categoryAuditList(id: string) {
    return this.db.all(
      'SELECT id, at, by_user AS "by", action, before, after FROM category_audit WHERE category_id = ? ORDER BY id DESC LIMIT 100',
      id,
    );
  }
  async categoryUsage(id: string) {
    const cur = await this.categoryById(id);
    if (!cur) return null;
    const descendants = (await this.descendantIds(id)).filter((x) => x !== id);
    const children = (await this.db.get<{ n: number }>('SELECT count(*)::int AS n FROM categories WHERE parent_id = ?', id))?.n ?? 0;
    const primaryLive = (await this.db.get<{ n: number }>("SELECT count(*)::int AS n FROM products WHERE category_id = ? AND deleted_at IS NULL", id))?.n ?? 0;
    const primaryAll = (await this.db.get<{ n: number }>('SELECT count(*)::int AS n FROM products WHERE category_id = ?', id))?.n ?? 0;
    const extraProducts = (await this.db.get<{ n: number }>('SELECT count(DISTINCT product_id)::int AS n FROM product_categories WHERE category_id = ?', id))?.n ?? 0;
    const banners = (await this.db.get<{ n: number }>('SELECT count(*)::int AS n FROM banner_slides WHERE category_id = ?', id))?.n ?? 0;
    const empty = primaryAll === 0 && extraProducts === 0 && children === 0 && banners === 0;
    return {
      id: cur.id, name: cur.name, slug: cur.slug, active: !!cur.active, parentId: cur.parentId ?? null,
      children, descendants: descendants.length, primaryProducts: primaryLive,
      primaryProductsIncludingDeleted: primaryAll, extraProducts, banners, empty,
    };
  }
  async setCategoryActive(id: string, active: boolean, by: string | null) {
    const cur = await this.categoryById(id);
    if (!cur) bad('Category not found', 404);
    if (!!cur.active === !!active) return cur;
    await this.db.run('UPDATE categories SET active = ? WHERE id = ?', !!active, id);
    const next = await this.categoryById(id);
    await this.auditCategory(id, by, active ? 'ACTIVATE' : 'DEACTIVATE', cur, next);
    return next;
  }
  async reassignCategoryProducts(fromId: string, toId: string, by: string | null) {
    const from = await this.categoryById(fromId);
    const to = await this.categoryById(toId);
    if (!from || !to) bad('Category not found', 404);
    if (fromId === toId) bad('Choose a different category to move products to');
    const rows = await this.db.all<{ id: string }>('SELECT id FROM products WHERE category_id = ?', fromId);
    await this.db.run('UPDATE products SET category_id = ?, updated_at = now() WHERE category_id = ?', toId, fromId);
    if (rows.length) {
      const ph = rows.map(() => '?').join(',');
      await this.db.run(`DELETE FROM product_categories WHERE category_id = ? AND product_id IN (${ph})`, toId, ...rows.map((r) => r.id));
    }
    await this.auditCategory(fromId, by, 'REASSIGN', { primaryProducts: rows.length }, { moveTo: toId, productIds: rows.map((r) => r.id) });
    return { moved: rows.length, usage: await this.categoryUsage(fromId) };
  }
  async clearCategoryExtras(id: string, by: string | null) {
    const cur = await this.categoryById(id);
    if (!cur) bad('Category not found', 404);
    const rows = await this.db.all<{ product_id: string }>('SELECT product_id FROM product_categories WHERE category_id = ?', id);
    await this.db.run('DELETE FROM product_categories WHERE category_id = ?', id);
    await this.auditCategory(id, by, 'REMOVE_EXTRAS', { productIds: rows.map((r) => r.product_id) }, { cleared: rows.length });
    return { cleared: rows.length, usage: await this.categoryUsage(id) };
  }
  async deleteCategory(id: string, by: string | null) {
    const cur = await this.categoryById(id);
    if (!cur) bad('Category not found', 404);
    const usage = await this.categoryUsage(id);
    if (!usage || !usage.empty) bad('This category still has products, subcategories or banners. Deactivate it, or move the products first.', 409, 'not_empty');
    await this.db.run('DELETE FROM categories WHERE id = ?', id);
    await this.auditCategory(id, by, 'DELETE', cur, null);
    return { ok: true, deleted: cur };
  }

  async extraCategories(productId: string) {
    return this.db.all<{ id: string; slug: string; name: string; parentId: string | null }>(
      `SELECT c.id, c.slug, c.name, c.parent_id AS "parentId"
       FROM product_categories pc JOIN categories c ON c.id = pc.category_id
       WHERE pc.product_id = ? ORDER BY lower(c.name)`,
      productId,
    );
  }
  async setExtraCategories(productId: string, primaryId: string | null, extraIds: unknown) {
    if (extraIds === undefined) return;
    const raw = Array.isArray(extraIds) ? extraIds : [];
    const uniq = [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))].filter((id) => id !== primaryId);
    for (const id of uniq) {
      if (!(await this.categoryById(id))) bad('Category not found', 400);
    }
    await this.db.run('DELETE FROM product_categories WHERE product_id = ?', productId);
    for (const id of uniq) {
      await this.db.run('INSERT INTO product_categories (product_id, category_id) VALUES (?,?)', productId, id);
    }
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
  async catalogSupplier(id: string) {
    return this.db.get(`SELECT ${CATALOG_SUPPLIER_COLS} FROM suppliers WHERE id = ?`, id);
  }
  async listCatalogSuppliers(q?: string) {
    const query = (q ?? '').trim();
    if (query) {
      return this.db.all(`SELECT ${CATALOG_SUPPLIER_COLS} FROM suppliers WHERE name ILIKE ? ORDER BY lower(name) LIMIT 200`, `%${query}%`);
    }
    return this.db.all(`SELECT ${CATALOG_SUPPLIER_COLS} FROM suppliers ORDER BY lower(name) LIMIT 200`);
  }
  async upsertCatalogSupplier(input: Record<string, unknown>, id?: string) {
    const name = String(input.name ?? '').trim().slice(0, 120);
    if (!id && !name) bad('Supplier name is required');
    const consent = input.catalogConsent == null ? undefined : !!(input.catalogConsent === true || input.catalogConsent === 'true');
    const region = input.publicRegion === undefined ? undefined : emptyToNull(input.publicRegion, 80);
    const about = input.publicAbout === undefined ? undefined : emptyToNull(input.publicAbout, 2000);
    const years = input.publicYears === undefined ? undefined : numOrNull(input.publicYears);
    const verified = input.publicVerified == null ? undefined : !!(input.publicVerified === true || input.publicVerified === 'true');
    if (id) {
      const cur = await this.catalogSupplier(id);
      if (!cur) bad('Supplier not found', 404);
      const sets: string[] = [];
      const args: unknown[] = [];
      if (name) { sets.push('name = ?'); args.push(name); }
      if (region !== undefined) { sets.push('public_region = ?'); args.push(region); }
      if (about !== undefined) { sets.push('public_about = ?'); args.push(about); }
      if (years !== undefined) { sets.push('public_years = ?'); args.push(years); }
      if (verified !== undefined) { sets.push('public_verified = ?'); args.push(verified); }
      if (consent !== undefined) {
        sets.push('catalog_consent = ?'); args.push(consent);
        if (consent) { sets.push('consent_at = coalesce(consent_at, now())'); }
        else { sets.push('consent_at = null'); }
      }
      if (sets.length) await this.db.run(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
      return this.catalogSupplier(id);
    }
    const nid = randomUUID();
    await this.db.run(
      `INSERT INTO suppliers (id, name, catalog_consent, consent_at, public_region, public_about, public_years, public_verified, created_at)
       VALUES (?,?,?,?,?,?,?,?,now())`,
      nid, name, consent === true, consent === true ? new Date().toISOString() : null, region ?? null, about ?? null, years ?? null, verified === true,
    );
    return this.catalogSupplier(nid);
  }

  async searchPublic(q: {
    q?: string; category?: string; sort?: string; window?: number; moqMax?: number; hasPrice?: boolean; clearance?: boolean; limit?: number; offset?: number;
  }) {
    const limit = Math.min(48, Math.max(1, q.limit ?? 24));
    const offset = Math.max(0, q.offset ?? 0);
    const days = windowDays(q.window);
    const where = ["p.status = 'PUBLISHED'", 'p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.category) {
      const cat = await this.categoryBySlugOrId(q.category);
      if (!cat || cat.active === false) {
        return { rows: [], total: 0, limit, offset };
      }
      const ids = await this.descendantIds(cat.id);
      const m = categoryMatchSql(ids.length ? ids : [cat.id]);
      where.push(m.sql); params.push(...m.params);
    }
    if (q.moqMax != null && Number.isFinite(q.moqMax)) { where.push('(p.moq IS NULL OR p.moq <= ?)'); params.push(q.moqMax); }
    if (q.hasPrice) where.push("p.price_mode <> 'GET_QUOTE'");
    if (q.clearance) where.push(ACTIVE_CLEARANCE_SQL);
    const query = (q.q ?? '').trim();
    if (query) {
      params.push(query, `%${query}%`);
      where.push(`(p.search_tsv @@ websearch_to_tsquery('simple', ?) OR p.title ILIKE ? OR coalesce(p.summary,'') ILIKE ?)`);
      params.push(`%${query}%`);
    }
    const now = new Date().toISOString();
    const order = q.sort === 'newest' ? 'p.published_at DESC NULLS LAST, p.created_at DESC'
      : q.sort === 'moq' ? 'p.moq ASC NULLS LAST, p.title'
      : q.clearance ? 'p.clearance_ends_at ASC NULLS LAST, p.published_at DESC NULLS LAST, p.title'
      : pinOrder(now);
    const from = `FROM products p LEFT JOIN categories c ON c.id = p.category_id ${scoreJoin(days)} WHERE ${where.join(' AND ')}`;
    const total = (await this.db.get<{ n: number }>(`SELECT count(*)::int AS n ${from}`, ...params))?.n ?? 0;
    const rows = await this.db.all(`SELECT p.*, c.slug AS category_slug, c.name AS category_name, coalesce(ts.score, 0) AS trending_score, coalesce(ts.views, 0) AS view_count, coalesce(ts.enquiries, 0) AS enquiry_count ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
    return { rows, total, limit, offset };
  }

  async listStaff(q: { q?: string; status?: string; category?: string; includeDeleted?: boolean; supplierId?: string; fromSourcing?: boolean; discarded?: boolean; limit?: number; offset?: number; page?: number }) {
    const limit = Math.min(100, Math.max(1, Number.isFinite(q.limit as number) ? Number(q.limit) : 25));
    const page = Math.max(1, Number(q.page) || 1);
    const offset = q.offset != null && Number.isFinite(q.offset) ? Math.max(0, Number(q.offset)) : (page - 1) * limit;
    const where: string[] = [];
    const params: unknown[] = [];
    if (!q.includeDeleted) where.push('p.deleted_at IS NULL');
    if (q.discarded) {
      where.push("p.source_quote_id IS NOT NULL AND p.source_discarded_at IS NOT NULL");
    } else if (q.fromSourcing) {
      where.push("p.source_quote_id IS NOT NULL AND p.source_discarded_at IS NULL");
      where.push("(p.status <> 'PUBLISHED' OR p.source_update_pending = true)");
    } else {
      // All statuses (and other status filters) hide discarded sourcing drafts; use discarded=1 to see them.
      where.push('p.source_discarded_at IS NULL');
    }
    if (q.status) { where.push('p.status = ?'); params.push(q.status); }
    if (q.category) {
      const cat = await this.categoryBySlugOrId(q.category);
      const ids = cat ? await this.descendantIds(cat.id) : [];
      if (ids.length) { const m = categoryMatchSql(ids); where.push(m.sql); params.push(...m.params); }
      else { where.push('(c.slug = ? OR p.category_id = ?)'); params.push(q.category, q.category); }
    }
    if (q.supplierId) { where.push('p.supplier_id = ?'); params.push(q.supplierId); }
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

  async create(input: Record<string, unknown>, by: string, opts: { ownerSupplierId?: string | null } = {}) {
    const title = String(input.title ?? '').trim().slice(0, 200);
    if (!title) bad('Title is required');
    const id = randomUUID();
    const slug = await this.uniqueSlug(String(input.slug ?? title));
    const base = CURRENCIES.includes(input.baseCurrency as Currency) ? input.baseCurrency : 'USD';
    const supplierId = emptyToNull(opts.ownerSupplierId);
    await this.db.run(`INSERT INTO products (id, slug, title, summary, specs, category_id, status, moq, unit, lead_time, capacity, packaging, customization, sample_policy, merchandising, price_mode, base_currency, created_by, supplier_id, is_sample)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?,false)`,
      id, slug, title, emptyToNull(input.summary, 4000), input.specs ? JSON.stringify(normalizeSpecs(input.specs)) : null,
      emptyToNull(input.categoryId), 'DRAFT', numOrNull(input.moq), emptyToNull(input.unit, 24), emptyToNull(input.leadTime, 80),
      emptyToNull(input.capacity, 400), emptyToNull(input.packaging, 4000), emptyToNull(input.customization, 4000), emptyToNull(input.samplePolicy, 2000),
      JSON.stringify(normalizeMerchandising(input.merchandising)),
      'GET_QUOTE', base, by, supplierId);
    const tags = parseTags(input.tags);
    if (tags.length) await this.db.run('UPDATE products SET tags = ?::jsonb WHERE id = ?', JSON.stringify(tags), id);
    await this.setExtraCategories(id, emptyToNull(input.categoryId), input.extraCategoryIds ?? []);
    await this.audit(id, by, 'CREATE', null, { title, slug });
    return this.get(id);
  }

  async update(id: string, patch: Record<string, unknown>, by: string, opts: { prices: boolean; linkSupplier?: boolean; promote?: boolean; fromSync?: boolean }) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') bad('This product has been deleted', 409);
    const next: Record<string, unknown> = {};
    if (patch.title != null) next.title = String(patch.title).trim().slice(0, 200);
    if (patch.summary !== undefined) next.summary = emptyToNull(patch.summary, 4000);
    if (patch.specs !== undefined) next.specs = patch.specs == null ? null : JSON.stringify(normalizeSpecs(patch.specs));
    if (patch.categoryId !== undefined) next.category_id = emptyToNull(patch.categoryId);
    if (patch.moq !== undefined) next.moq = numOrNull(patch.moq);
    if (patch.unit !== undefined) next.unit = emptyToNull(patch.unit, 24);
    if (patch.leadTime !== undefined) next.lead_time = emptyToNull(patch.leadTime, 80);
    if (patch.capacity !== undefined) next.capacity = emptyToNull(patch.capacity, 400);
    if (patch.packaging !== undefined) next.packaging = emptyToNull(patch.packaging, 4000);
    if (patch.customization !== undefined) next.customization = emptyToNull(patch.customization, 4000);
    if (patch.samplePolicy !== undefined) next.sample_policy = emptyToNull(patch.samplePolicy, 2000);
    if (patch.merchandising !== undefined) next.merchandising = JSON.stringify(normalizeMerchandising(patch.merchandising));
    if (opts.linkSupplier && patch.supplierId !== undefined) {
      const sid = emptyToNull(patch.supplierId);
      if (sid && !(await this.catalogSupplier(String(sid)))) bad('Supplier not found', 400);
      next.supplier_id = sid;
    }
    if (patch.slug) next.slug = await this.uniqueSlug(String(patch.slug), id);
    if (patch.tags !== undefined) next.tags = JSON.stringify(parseTags(patch.tags));
    if (patch.status === 'READY_FOR_PRICE' && cur.status === 'DRAFT') next.status = 'READY_FOR_PRICE';
    if (opts.prices) {
      if (patch.baseCurrency && CURRENCIES.includes(patch.baseCurrency as Currency)) next.base_currency = patch.baseCurrency;
      if (patch.priceMode && ['RANGE', 'TIERS', 'GET_QUOTE'].includes(String(patch.priceMode))) next.price_mode = patch.priceMode;
      if (patch.priceMin !== undefined) next.price_min = numOrNull(patch.priceMin);
      if (patch.priceMax !== undefined) next.price_max = numOrNull(patch.priceMax);
      if (patch.priceUsd !== undefined) next.price_usd = numOrNull(patch.priceUsd);
      if (patch.priceCny !== undefined) next.price_cny = numOrNull(patch.priceCny);
      if (patch.priceInr !== undefined) next.price_inr = numOrNull(patch.priceInr);
    }
    if (opts.promote) {
      if (patch.pinned !== undefined) next.pinned = !!patch.pinned;
      if (patch.pinStartsAt !== undefined) next.pin_starts_at = patch.pinStartsAt || null;
      if (patch.pinEndsAt !== undefined) next.pin_ends_at = patch.pinEndsAt || null;
      if (patch.clearance !== undefined) next.clearance = !!patch.clearance;
      if (patch.clearancePrice !== undefined) {
        const n = numOrNull(patch.clearancePrice);
        if (n != null && n < 0) bad('Clearance price must be 0 or more', 400);
        next.clearance_price = n;
      }
      if (patch.clearanceDiscountPct !== undefined) next.clearance_discount_pct = parseDiscountPct(patch.clearanceDiscountPct);
      if (patch.clearanceEndsAt !== undefined) next.clearance_ends_at = parseClearanceEnd(patch.clearanceEndsAt);
      if (patch.clearanceStockLeft !== undefined) next.clearance_stock_left = parseStockLeft(patch.clearanceStockLeft);
    }
    const cols = Object.keys(next);
    if (cols.length) {
      const assign = cols.map((c) => (c === 'tags' || c === 'merchandising') ? `${c} = ?::jsonb` : `${c} = ?`);
      await this.db.run(`UPDATE products SET ${assign.join(', ')}, updated_at = now() WHERE id = ?`, ...cols.map((c) => next[c]), id);
    }
    const primary = next.category_id !== undefined ? (next.category_id as string | null) : (cur.category_id as string | null);
    const prevExtras = patch.extraCategoryIds !== undefined || patch.categoryId !== undefined
      ? (await this.extraCategories(id)).map((c) => c.id)
      : [];
    await this.setExtraCategories(id, primary, patch.extraCategoryIds);
    if (patch.extraCategoryIds !== undefined || patch.categoryId !== undefined) {
      const newExtras = (await this.extraCategories(id)).map((c) => c.id);
      const removed = prevExtras.filter((x) => !newExtras.includes(x));
      const added = newExtras.filter((x) => !prevExtras.includes(x));
      const primaryChanged = patch.categoryId !== undefined && emptyToNull(patch.categoryId) !== (cur.category_id as string | null);
      if (removed.length || added.length || primaryChanged) {
        await this.audit(id, by, 'CATEGORIES', { categoryId: cur.category_id, extraCategoryIds: prevExtras }, { categoryId: primary, extraCategoryIds: newExtras, removed, added });
      }
    }
    if (opts.prices && Array.isArray(patch.tiers)) {
      await this.db.run('DELETE FROM product_price_tiers WHERE product_id = ?', id);
      for (const t of patch.tiers as any[]) {
        const unitPrice = Number(t.unitPrice);
        if (!Number.isFinite(unitPrice)) continue;
        await this.db.run('INSERT INTO product_price_tiers (id, product_id, min_qty, max_qty, unit_price, price_usd, price_cny, price_inr) VALUES (?,?,?,?,?,?,?,?)',
          randomUUID(), id, numOrNull(t.minQty) ?? 1, numOrNull(t.maxQty), unitPrice, numOrNull(t.priceUsd), numOrNull(t.priceCny), numOrNull(t.priceInr));
      }
    }
    if (cur.source_quote_id && !opts.fromSync && cols.length) {
      await this.db.run('UPDATE products SET source_team_edited_at = coalesce(source_team_edited_at, now()) WHERE id = ?', id);
    }
    await this.audit(id, by, 'UPDATE', pickPublic(cur), next);
    return this.get(id);
  }

  async submitReview(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') bad('This product has been deleted', 409);
    if (cur.status === 'PUBLISHED') bad('This product is already published');
    if (cur.status !== 'DRAFT' && cur.status !== 'UNPUBLISHED' && cur.status !== 'READY_FOR_PRICE') {
      bad('Only a draft can be sent for review');
    }
    await this.db.run(`UPDATE products SET status = 'PENDING_REVIEW', updated_at = now() WHERE id = ?`, id);
    await this.audit(id, by, 'SUBMIT_REVIEW', { status: cur.status }, { status: 'PENDING_REVIEW' });
    return this.get(id);
  }
  async withdrawReview(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status !== 'PENDING_REVIEW') bad('This product is not waiting for review');
    await this.db.run(`UPDATE products SET status = 'DRAFT', updated_at = now() WHERE id = ?`, id);
    await this.audit(id, by, 'WITHDRAW_REVIEW', { status: cur.status }, { status: 'DRAFT' });
    return this.get(id);
  }
  async publish(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (cur.status === 'DELETED') bad('This product has been deleted', 409);
    const hasSelling = rowHasSellingPrice(cur)
      || ((await this.db.get<{ n: number }>('SELECT count(*)::int AS n FROM product_price_tiers WHERE product_id = ?', id))?.n ?? 0) > 0;
    for (const msg of publishBlockers(cur, hasSelling)) bad(msg);
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
  /** Hide a sourcing draft from the review queue. Does not change the sourcing request or its quotes. */
  async discardSourceDraft(id: string, by: string) {
    const cur = await this.get(id); if (!cur) bad('Product not found', 404);
    if (!cur.source_quote_id) bad('This product did not come from a sourcing request', 400);
    if (cur.status === 'DELETED' || cur.source_discarded_at) return cur;
    if (cur.status === 'PUBLISHED') {
      await this.db.run(`UPDATE products SET status = 'UNPUBLISHED', source_discarded_at = now(), source_discarded_by = ?, source_update_pending = false, updated_at = now() WHERE id = ?`, by, id);
    } else {
      await this.db.run(`UPDATE products SET source_discarded_at = now(), source_discarded_by = ?, source_update_pending = false, updated_at = now() WHERE id = ?`, by, id);
    }
    await this.audit(id, by, 'SOURCE_DISCARD', { status: cur.status }, { discarded: true });
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
export const DEFAULT_PROMO = { enabled: false, text: 'Sourcing from China — request a quote from the Source Easy team', href: '/#quote' };

type ImgRow = { fileId: string; kind?: string; altText?: string | null; groupId?: string | null; isCover?: boolean; sort?: number };
export function photoGroups(images: ImgRow[]) {
  const groups: { id: string; altText: string | null; cover: boolean; sort: number; original?: ImgRow; card?: ImgRow; gallery?: ImgRow; fileIds: string[] }[] = [];
  const by = new Map<string, (typeof groups)[0]>();
  let last: string | null = null;
  for (const im of images) {
    let gid: string;
    if (im.groupId) gid = im.groupId;
    else if ((im.kind === 'CARD' || im.kind === 'GALLERY') && last) gid = last;
    else gid = im.fileId;
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
export async function saveProductPhoto(deps: CatalogDeps, productId: string, processed: { original: Buffer; card: Buffer; gallery: Buffer }, alt: string, sort: number, cover: boolean) {
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


export function priced(row: any, _rates?: RateMap) {
  const base = (CURRENCIES.includes(row.base_currency) ? row.base_currency : 'USD') as Currency;
  const mode = row.price_mode ?? 'GET_QUOTE';
  if (mode === 'GET_QUOTE' && row.price_min == null && row.price_usd == null && row.price_inr == null && row.price_cny == null)
    return { mode: 'GET_QUOTE' as const, base, amounts: null as null };
  const amounts: Record<Currency, { min: number | null; max: number | null }> = { USD: { min: null, max: null }, CNY: { min: null, max: null }, INR: { min: null, max: null } };
  const put = (cur: Currency, min: number | null, max: number | null) => { amounts[cur] = { min, max }; };
  // Each currency is stored and shown as entered. A base min/max applies only to the base currency.
  const baseMin = numOrNull(row.price_min) ?? numOrNull(row.unit_price);
  const baseMax = numOrNull(row.price_max) ?? baseMin;
  for (const cur of CURRENCIES) {
    const manual = cur === 'USD' ? numOrNull(row.price_usd) : cur === 'CNY' ? numOrNull(row.price_cny) : numOrNull(row.price_inr);
    if (manual != null) put(cur, manual, manual);
    else if (cur === base && baseMin != null) put(cur, baseMin, baseMax);
  }
  return { mode, base, amounts };
}

function stripSupplier(row: any) {
  const { supplier_id, supplierId, created_by, approved_by, deleted_by, ...rest } = row;
  void supplier_id; void supplierId; void created_by; void approved_by; void deleted_by;
  return rest;
}

/** Key attributes: a plain object, or a list of {key,value} rows from the staff form. */
export function normalizeSpecs(raw: unknown): Record<string, string> | null {
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const key = String((row as any).key ?? (row as any).name ?? '').trim().slice(0, 80);
      const value = String((row as any).value ?? '').trim().slice(0, 400);
      if (key && value) out[key] = value;
    }
    return Object.keys(out).length ? out : null;
  }
  if (typeof raw === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null || String(v).trim() === '') continue;
      out[String(k).trim().slice(0, 80)] = String(v).trim().slice(0, 400);
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

const CATALOG_SUPPLIER_COLS = 'id, name, contact, phone, wechat, city, notes, catalog_consent AS "catalogConsent", public_region AS "publicRegion", public_about AS "publicAbout", public_years AS "publicYears", public_verified AS "publicVerified", show_contacts_to_members AS "showContactsToMembers"';

export function catalogSupplierCard(row: any, paidMember: boolean): { supplier: Record<string, unknown> | null; supplierAvailable: boolean } {
  if (!row || !row.catalogConsent) return { supplier: null, supplierAvailable: false };
  if (!paidMember) return { supplier: null, supplierAvailable: true };
  return {
    supplierAvailable: true,
    supplier: {
      company: row.name,
      region: row.publicRegion || null,
      years: row.publicYears == null ? null : Number(row.publicYears),
      verified: !!row.publicVerified,
      about: row.publicAbout || null,
    },
  };
}

export function catalogSupplierStaffView(row: any) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact || null,
    phone: row.phone || null,
    wechat: row.wechat || null,
    city: row.city || null,
    notes: row.notes || null,
    catalogConsent: !!row.catalogConsent,
    publicRegion: row.publicRegion || null,
    publicAbout: row.publicAbout || null,
    publicYears: row.publicYears == null ? null : Number(row.publicYears),
    publicVerified: !!row.publicVerified,
  };
}

export async function publicView(store: CatalogStore, row: any, rates: RateMap, opts: { paidMember?: boolean } = {}) {
  const images = await store.images(row.id);
  const tiers = await store.tiers(row.id);
  let cat = { id: row.category_id, slug: row.category_slug ?? null, name: row.category_name ?? null };
  if (row.category_id && !cat.slug) {
    const c = await store.categoryById(row.category_id);
    if (c) cat = { id: c.id, slug: c.slug, name: c.name };
  }
  const breadcrumbs = row.category_id ? await store.categoryPath(row.category_id) : [];
  const price = priced(row, rates);
  const pubTiers = await Promise.all(tiers.map(async (t: any) => {
    const amounts: Record<string, number | null> = { USD: null, CNY: null, INR: null };
    for (const cur of CURRENCIES) {
      const manual = cur === 'USD' ? t.priceUsd : cur === 'CNY' ? t.priceCny : t.priceInr;
      if (manual != null) amounts[cur] = Number(manual);
      else if (cur === price.base && t.unitPrice != null) amounts[cur] = Number(t.unitPrice);
    }
    return { minQty: t.minQty, maxQty: t.maxQty, amounts };
  }));
  const supplierRow = row.supplier_id ? await store.catalogSupplier(row.supplier_id) : null;
  const supplierCard = catalogSupplierCard(supplierRow, !!opts.paidMember);
  return {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary, specs: parseSpecs(row.specs),
    category: cat.slug ? cat : null,
    breadcrumbs,
    moq: row.moq, unit: row.unit, leadTime: row.lead_time,
    capacity: row.capacity ?? null, packaging: row.packaging ?? null,
    customization: row.customization ?? null, samplePolicy: row.sample_policy ?? null,
    merchandising: publicMerchandising(row.merchandising),
    price, tiers: pubTiers,
    images: publicPhotos(images as any, row.id),
    isSample: !!row.is_sample,
    pinned: !!row.pinned,
    publishedAt: row.published_at ?? null,
    tags: tagsOf(row),
    trendingScore: Number(row.trending_score ?? 0),
    viewCount: Number(row.view_count ?? 0),
    enquiryCount: Number(row.enquiry_count ?? 0),
    trending: !!row.pinned || Number(row.trending_score ?? 0) > 0,
    clearance: isActiveClearance(row),
    clearancePrice: isActiveClearance(row) ? clearanceSalePrice(row, rates, price) : null,
    clearanceDiscountPct: isActiveClearance(row) ? numOrNull(row.clearance_discount_pct) : null,
    clearanceEndsAt: isActiveClearance(row) ? (row.clearance_ends_at ?? null) : null,
    clearanceStockLeft: isActiveClearance(row) ? (row.clearance_stock_left ?? null) : null,
    supplier: supplierCard.supplier,
    supplierAvailable: supplierCard.supplierAvailable,
  };
}

function parseSpecs(raw: unknown): Record<string, string> | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    try { return normalizeSpecs(JSON.parse(raw)); } catch { return null; }
  }
  return normalizeSpecs(raw);
}

export function rowHasSellingPrice(row: any) {
  return row.price_min != null || row.price_usd != null || row.price_inr != null || row.price_cny != null;
}

/** Why this product cannot be published yet. Get quote needs no selling price (including sourced drafts). Fixed-price modes need one currency. Factory cost never counts. */
export function publishBlockers(row: any, hasSelling?: boolean): string[] {
  if (row.status === 'DELETED') return ['This product has been deleted'];
  const priced = hasSelling ?? rowHasSellingPrice(row);
  const mode = row.price_mode ?? 'GET_QUOTE';
  if (mode !== 'GET_QUOTE' && !priced) {
    return ['Set a selling price in USD, RMB or INR before publishing a fixed-price product. One currency is enough. Or switch the pricing mode to Get quote.'];
  }
  return [];
}

export function staffView(row: any, role: Role, rates: RateMap, extra: { images?: any[]; tiers?: any[]; catalogSupplier?: any; extraCategories?: any[] } = {}) {
  const hide = hidePrices(role);
  const price = hide ? { mode: row.price_mode, base: row.base_currency, amounts: null } : priced(row, rates);
  const out: Record<string, unknown> = {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary, specs: parseSpecs(row.specs),
    categoryId: row.category_id, categorySlug: row.category_slug ?? null, categoryName: row.category_name ?? null,
    extraCategories: extra.extraCategories ?? [],
    tags: tagsOf(row),
    status: row.status, moq: row.moq, unit: row.unit, leadTime: row.lead_time,
    capacity: row.capacity ?? null, packaging: row.packaging ?? null,
    customization: row.customization ?? null, samplePolicy: row.sample_policy ?? null,
    merchandising: parseMerchandising(row.merchandising),
    priceMode: row.price_mode, baseCurrency: row.base_currency,
    pinned: !!row.pinned, pinStartsAt: row.pin_starts_at, pinEndsAt: row.pin_ends_at,
    clearance: !!row.clearance, clearancePrice: numOrNull(row.clearance_price),
    clearanceDiscountPct: numOrNull(row.clearance_discount_pct),
    clearanceEndsAt: row.clearance_ends_at ?? null, clearanceStockLeft: row.clearance_stock_left ?? null,
    isSample: !!row.is_sample, deletedAt: row.deleted_at, publishedAt: row.published_at,
    updatedAt: row.updated_at, createdAt: row.created_at,
    price, images: extra.images ?? [], tiers: hide ? [] : (extra.tiers ?? []),
    publishBlockers: publishBlockers(row, rowHasSellingPrice(row) || !!(extra.tiers && extra.tiers.length)),
  };
  if (!hide) {
    out.priceMin = row.price_min; out.priceMax = row.price_max;
    out.priceUsd = row.price_usd; out.priceCny = row.price_cny; out.priceInr = row.price_inr;
  }
  // Supplier identity (including staff contact/location) follows canSeeSupplierIdentity: SA, Marketplace Team, China, and a supplier on their own products. India-only roles never see it. Public APIs use catalogSupplierCard instead (consent + paid member, no contacts, no factory cost).
  if (canSeeSupplierIdentity(role)) {
    out.supplierId = row.supplier_id ?? null;
    if (extra.catalogSupplier) out.catalogSupplier = extra.catalogSupplier;
  }
  if (row.source_quote_id) {
    out.fromSourcing = true;
    if (role === 'SUPER_ADMIN' || role === 'INDIA_ADMIN' || role === 'MARKETPLACE_TEAM' || role.startsWith('CHINA')) {
      out.sourceLeadId = row.source_lead_id;
      out.sourceQuoteId = row.source_quote_id;
      out.sourceLeadRef = row.source_lead_ref;
      out.sourceHref = row.source_lead_id ? `/app#/leads?id=${row.source_lead_id}` : '/app#/leads';
      out.sourceLabel = 'From sourcing request';
      out.sourceUpdatePending = !!row.source_update_pending;
      out.sourceDiscardedAt = row.source_discarded_at ?? null;
      out.sourceTeamEditedAt = row.source_team_edited_at ?? null;
      out.referenceCost = row.source_unit_price != null ? { amount: Number(row.source_unit_price), currency: row.source_currency || null } : null;
    }
  }
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
export async function processBannerMobile(data: Buffer) {
  if (data.length > MAX_FILE_BYTES) bad('Image must be 10 MB or smaller', 413, 'size');
  let src: sharp.Sharp | undefined;
  try { src = sharp(data, { limitInputPixels: 50e6 }).rotate(); await src.metadata(); }
  catch { bad('Upload a JPEG, PNG or WebP image', 415, 'type'); }
  return src!.resize(1080, 720, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
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
      price_min, price_max, pinned, is_sample, created_by, approved_by, published_at, tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,now(),?::jsonb)`,
      id, slug, p.title, p.summary, JSON.stringify(specs),
      cat.id, 'PUBLISHED', p.moq, p.unit, p.leadTime, 'RANGE', 'USD', p.min, p.max, !!p.pin, true, by, by,
      JSON.stringify([...new Set([p.category.toLowerCase(), ...p.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 3)])]));
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

export async function isActiveMember(db: Db, customerId: string | null | undefined) {
  if (!customerId) return false;
  const row = await db.get(`SELECT 1 FROM memberships WHERE customer_id = ? AND status = 'ACTIVE' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`, customerId);
  return !!row;
}

export function registerPublicCatalog(app: FastifyInstance, deps: CatalogDeps) {
  const store = new CatalogStore(deps.db);
  const pubCache = 'public, max-age=60';

  app.get('/api/public/catalog/status', async () => store.status());
  app.get('/api/public/catalog/fx', async () => {
    const list = await store.rateList();
    return { data: list.map((r: any) => ({ base: r.base, quote: r.quote, rate: Number(r.rate), asOf: r.asOf })) };
  });
  app.get('/api/public/catalog/categories', async (_req, reply) => reply.header('cache-control', 'no-store').send({ data: await store.categories(true) }));

  app.get<{ Querystring: Record<string, string> }>('/api/public/catalog/products', async (req, reply) => {
    const q = req.query ?? {};
    const rates = await store.rates();
    const { rows, total, limit, offset } = await store.searchPublic({
      q: q.q, category: q.category, sort: q.sort, window: windowDays(q.window), moqMax: q.moq ? Number(q.moq) : undefined,
      hasPrice: q.hasPrice === '1' || q.hasPrice === 'true',
      clearance: q.clearance === '1' || q.clearance === 'true',
      limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
    });
    const data = [];
    for (const r of rows) data.push(await publicView(store, r, rates));
    return reply.header('cache-control', 'no-store').send({ data, total, limit, offset });
  });

  app.get<{ Params: { slug: string } }>('/api/public/catalog/products/:slug/related', async (req, reply) => {
    const row = await store.get(req.params.slug);
    if (!row || row.status !== 'PUBLISHED' || row.deleted_at) return reply.code(404).header('cache-control', 'no-store').send({ error: 'This product is no longer available' });
    const rates = await store.rates();
    const rows = await relatedProducts(store.db, row, 8);
    const data = [];
    for (const r of rows) data.push(await publicView(store, r, rates));
    return reply.header('cache-control', 'no-store').send({ data });
  });

  app.get<{ Params: { slug: string } }>('/api/public/catalog/products/:slug', async (req, reply) => {
    const row = await store.get(req.params.slug);
    if (!row || row.status !== 'PUBLISHED' || row.deleted_at) return reply.code(404).header('cache-control', 'no-store').send({ error: 'This product is no longer available' });
    await recordView(store.db, row.id, req);
    const rates = await store.rates();
    const sc = (await scoresFor(store.db, [row.id], 7)).get(row.id);
    const paidMember = deps.isPaidMember ? await deps.isPaidMember(req) : false;
    const data = await publicView(store, { ...row, trending_score: sc?.score ?? 0, view_count: sc?.views ?? 0, enquiry_count: sc?.enquiries ?? 0 }, rates, { paidMember });
    return reply.header('cache-control', 'no-store').send({ data });
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
    // Festival greetings are a separate homepage strip (/api/public/greetings), not mixed into this carousel.
    return { data: slides.slice(0, MAX_LIVE_BANNERS), ...settings };
  });

  app.get<{ Params: { id: string }; Querystring: { k?: string } }>('/api/public/catalog/banners/:id/image', async (req, reply) => {
    const r = await deps.db.get<any>('SELECT * FROM banner_slides WHERE id = ?', req.params.id);
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

  async function parseEnquireBody(req: FastifyRequest, reply: FastifyReply): Promise<{ b: Record<string, string>; files: Staged[] } | null> {
    if (req.isMultipart()) {
      if (!deps.readMultipart) { reply.code(501).send({ error: 'Uploads are not available' }); return null; }
      const m = await deps.readMultipart(req, MAX_FILES);
      if (m.err) { reply.code(m.err.status).send({ error: m.err.error, code: m.err.code }); return null; }
      if (m.files.some((f) => isVideo(f.mime))) { deps.uploads.discard(m.files); reply.code(415).send({ error: 'The quote form accepts photos, PDF, Word and Excel only', code: 'type' }); return null; }
      return { b: m.fields, files: m.files };
    }
    const raw = (req.body ?? {}) as Record<string, unknown>;
    return { b: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null ? '' : String(v)])), files: [] };
  }

  async function finishEnquire(req: FastifyRequest, reply: FastifyReply, parsed: { b: Record<string, string>; files: Staged[] }, row: { id: string; title: string; slug: string; status: string } | null) {
    const { b, files } = parsed;
    const reject = (code: number, body: unknown) => { deps.uploads.discard(files); return reply.code(code).send(body); };
    const str = (k: string, max = 200) => (b[k] ?? '').trim().slice(0, max);
    if (str('website') && deps.reservePublicEnquiry) {
      const q = await deps.reservePublicEnquiry(req, str('website', 200));
      if (q.skip) return reject(202, { ok: true });
    }
    const name = str('name', 120), phone = str('phone', 40), email = str('email', 160);
    if (!name || !phone) return reject(400, { error: 'Name and mobile number are required', code: 'required' });
    const kind = (str('type', 20) || str('requestType', 20) || 'SOURCING').toUpperCase();
    const isShipping = kind === 'SHIPPING' || kind === 'FREIGHT' || kind === 'FREIGHT_ONLY';
    if (isShipping) {
      const destCity = str('destCity', 120);
      const pickupCity = str('pickupCity', 120), pickupAddress = str('pickupAddress', 1000);
      if (!destCity) return reject(400, { error: 'Destination city is required', code: 'required' });
      if (!pickupCity && !pickupAddress) return reject(400, { error: 'Pickup city or address is required', code: 'required' });
      if (!(str('goods', 1000) || str('requirement', 1000) || row?.title)) return reject(400, { error: 'Describe the goods to ship', code: 'required' });
    }
    if (deps.reservePublicEnquiry) {
      const q = await deps.reservePublicEnquiry(req, '');
      if (q.limited) return reject(429, { error: 'Too many enquiries, please try again later' });
    }
    try {
      if (isShipping) {
        if (!deps.createPublicShipping) return reject(501, { error: 'Shipping quotes are not available' });
        const num = (k: string) => { const n = Number(str(k, 20)); return Number.isFinite(n) && n > 0 ? n : undefined; };
        const r = await deps.createPublicShipping({
          name, phone, phoneCode: str('phoneCode', 6) || '+91', email: email || undefined, company: str('company', 160) || undefined,
          goods: str('goods', 1000) || str('requirement', 1000) || row!.title,
          quantity: num('quantity'), unit: str('unit', 20) || undefined, packages: num('packages'), weightKg: num('weightKg'), cbm: num('cbm'),
          shipperName: str('shipperName', 120) || undefined, shipperPhone: str('shipperPhone', 40) || undefined,
          pickupAddress: str('pickupAddress', 1000) || undefined, pickupCity: str('pickupCity', 120) || undefined,
          destCity: str('destCity', 120), destAddress: str('destAddress', 1000) || undefined, destPincode: str('destPincode', 12) || undefined,
          mode: str('mode', 20) || undefined, incoterm: str('incoterm', 20) || undefined,
          readyDate: str('readyDate', 10) || undefined, customerNote: str('message', 2000) || str('customerNote', 2000) || undefined,
          files,
        });
        return reply.code(201).send({ ok: true, kind: 'SHIPPING', reference: r.ref, id: r.id, attachments: files.length });
      }
      if (!deps.createEnquiry) return reject(501, { error: 'Enquiry is not available' });
      const r = await deps.createEnquiry({
        ...(row ? { product: { id: row.id, title: row.title, slug: row.slug } } : {}),
        name, phone, phoneCode: str('phoneCode', 6) || '+91', email: email || undefined,
        company: str('company', 160) || undefined, quantity: (() => { const n = Number(str('quantity', 20)); return Number.isFinite(n) && n > 0 ? n : undefined; })(),
        unit: str('unit', 20) || undefined, message: str('message', 2000) || undefined,
        city: str('city', 120) || str('destCity', 120) || undefined, requirement: str('requirement', 1000) || undefined,
        requestLogin: /^(1|true|on|yes)$/i.test(str('requestLogin', 5)),
      });
      if (files.length) {
        const list = deps.uploads.commit(r.leadId, files);
        if (deps.mediaSync) await deps.mediaSync(r.leadId, list);
      } else deps.uploads.discard(files);
      if (row) await recordEnquiryEvent(deps.db, row.id, r.leadId, req);
      return reply.code(201).send({ ok: true, kind: 'SOURCING', reference: r.leadRef, attachments: files.length, ...(r.loginRequested ? { loginRequested: true } : {}) });
    } catch (e: any) {
      deps.uploads.discard(files);
      return reply.code(e.status ?? 400).send({ error: e.message, ...(e.appCode ? { code: e.appCode } : {}) });
    }
  }

  app.post('/api/public/catalog/enquire', async (req, reply) => {
    const parsed = await parseEnquireBody(req, reply); if (!parsed) return;
    const id = (parsed.b.productId || parsed.b.product || '').trim();
    let row = null as { id: string; title: string; slug: string; status: string } | null;
    if (id) {
      const found = await store.get(id);
      if (!found || found.status !== 'PUBLISHED') { deps.uploads.discard(parsed.files); return reply.code(404).send({ error: 'Not found' }); }
      row = found;
    }
    return finishEnquire(req, reply, parsed, row);
  });

  app.post<{ Params: { id: string } }>('/api/public/catalog/products/:id/enquire', async (req, reply) => {
    const row = await store.get(req.params.id);
    if (!row || row.status !== 'PUBLISHED') return reply.code(404).send({ error: 'Not found' });
    const parsed = await parseEnquireBody(req, reply); if (!parsed) return;
    return finishEnquire(req, reply, parsed, row);
  });
}

export function registerStaffCatalog(api: FastifyInstance, deps: CatalogDeps) {
  const store = new CatalogStore(deps.db);
  const supplierScope = async (u: User) => (u.role === 'SUPPLIER' ? (await deps.supplierOf?.(u.id)) ?? null : null);
  const requireVerified = async (u: User) => {
    if (u.role !== 'SUPPLIER') return null;
    const s = await supplierScope(u);
    if (!s || s.status !== 'APPROVED') bad('Your supplier account must be approved before you can manage products', 403, 'unverified');
    return s;
  };
  const owned = async (u: User, id: string, opts: { includeDeleted?: boolean } = {}) => {
    const row = await store.get(id, { includeDeleted: !!opts.includeDeleted && isSa(u) });
    if (!row) bad('Product not found', 404);
    const s = await supplierScope(u);
    if (s && row.supplier_id !== s.supplierId) bad('Product not found', 404);
    return row;
  };
  const need = (u: User, k: string) => { if (!deps.perms.can(u, k) && u.role !== 'SUPER_ADMIN') forbid(`You do not have permission: ${k}`); };
  // SUPER_ADMIN always passes perms.can, but keep explicit.

  api.get('/api/catalog/status', async (req) => store.status());
  api.get('/api/catalog/categories', async () => ({ data: await store.categories(false) }));
  api.post<{ Body: { name?: string; parentId?: string | null } }>('/api/catalog/categories', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can add categories');
    const b = req.body ?? {};
    return { data: await store.upsertCategory(String(b.name ?? ''), undefined, b.parentId === undefined ? undefined : (b.parentId ? String(b.parentId) : null)) };
  });
  api.patch<{ Params: { id: string }; Body: { name?: string; parentId?: string | null; active?: boolean } }>('/api/catalog/categories/:id', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can edit categories');
    const b = req.body ?? {};
    const cur = await store.categoryById(req.params.id);
    if (!cur) bad('Category not found', 404);
    const data = await store.upsertCategory(String(b.name ?? cur.name), req.params.id, b.parentId === undefined ? undefined : (b.parentId ? String(b.parentId) : null), b.active);
    if (b.active !== undefined && !!cur.active !== !!data?.active) {
      await store.auditCategory(req.params.id, u.id, b.active ? 'ACTIVATE' : 'DEACTIVATE', cur, data);
    }
    return { data };
  });
  api.get<{ Params: { id: string } }>('/api/catalog/categories/:id/usage', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can manage categories');
    const usage = await store.categoryUsage(req.params.id);
    if (!usage) bad('Category not found', 404);
    return { data: usage };
  });
  api.get<{ Params: { id: string } }>('/api/catalog/categories/:id/audit', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can manage categories');
    if (!(await store.categoryById(req.params.id))) bad('Category not found', 404);
    return { data: await store.categoryAuditList(req.params.id) };
  });
  api.post<{ Params: { id: string }; Body: { categoryId?: string } }>('/api/catalog/categories/:id/reassign', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can manage categories');
    const to = String(req.body?.categoryId ?? '').trim();
    if (!to) bad('Choose a category to move products to');
    return await store.reassignCategoryProducts(req.params.id, to, u.id);
  });
  api.post<{ Params: { id: string } }>('/api/catalog/categories/:id/clear-extras', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can manage categories');
    return await store.clearCategoryExtras(req.params.id, u.id);
  });
  api.delete<{ Params: { id: string } }>('/api/catalog/categories/:id', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canManageCategories(u)) forbid('Only the Marketplace Team or super admin can manage categories');
    const usage = await store.categoryUsage(req.params.id);
    if (!usage) return reply.code(404).send({ error: 'Category not found' });
    if (!usage.empty) return reply.code(409).send({ error: 'This category still has products, subcategories or banners. Deactivate it, or move the products first.', code: 'not_empty', usage });
    return await store.deleteCategory(req.params.id, u.id);
  });

  api.get<{ Querystring: { q?: string } }>('/api/catalog/suppliers', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canLinkSupplier(u)) forbid();
    const rows = await store.listCatalogSuppliers(req.query?.q);
    return { data: rows.map(catalogSupplierStaffView) };
  });
  api.post<{ Body: Record<string, unknown> }>('/api/catalog/suppliers', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canLinkSupplier(u)) forbid();
    return reply.code(201).send({ data: catalogSupplierStaffView(await store.upsertCatalogSupplier(req.body ?? {})) });
  });
  api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/catalog/suppliers/:id', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canLinkSupplier(u)) forbid();
    return { data: catalogSupplierStaffView(await store.upsertCatalogSupplier(req.body ?? {}, req.params.id)) };
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
    const scope = await supplierScope(u);
    const limitNum = q.limit ? Number(q.limit) : undefined;
    const { rows, total, limit, offset } = await store.listStaff({
      q: q.q, status: q.status, category: q.category,
      includeDeleted: isSa(u) && (q.status === 'DELETED' || q.deleted === '1' || q.deleted === 'true'),
      supplierId: scope?.supplierId,
      fromSourcing: q.fromSourcing === '1' || q.fromSourcing === 'true' || q.source === 'sourcing',
      discarded: q.discarded === '1' || q.discarded === 'true',
      limit: limitNum, offset: q.offset ? Number(q.offset) : undefined, page: q.page ? Number(q.page) : undefined,
    });
    const data = [];
    const canSee = canSeeSupplierIdentity(u.role);
    const supplierIds = canSee ? [...new Set(rows.map((r: any) => r.supplier_id).filter(Boolean))] : [];
    const supplierMap = new Map<string, ReturnType<typeof catalogSupplierStaffView>>();
    for (const id of supplierIds) {
      const linked = await store.catalogSupplier(String(id));
      if (linked) supplierMap.set(String(id), catalogSupplierStaffView(linked));
    }
    for (const r of rows) {
      const images = await store.images(r.id);
      const extraCategories = await store.extraCategories(r.id);
      const catalogSupplier = canSee && r.supplier_id ? supplierMap.get(r.supplier_id) : undefined;
      data.push(staffView(r, u.role, rates, { images: staffPhotos(images as any, r.id), extraCategories, catalogSupplier }));
    }
    const page = limit ? Math.floor(offset / limit) + 1 : 1;
    const pageCount = Math.max(1, Math.ceil(total / (limit || 25)));
    return { data, total, limit, offset, page, pageCount };
  });

  const staffProductView = async (row: any, role: Role) => {
    const images = await store.images(row.id);
    const tiers = await store.tiers(row.id);
    const link = canSeeSupplierIdentity(role);
    const linked = link && row.supplier_id ? await store.catalogSupplier(row.supplier_id) : null;
    const catalogSupplier = linked ? catalogSupplierStaffView(linked) : undefined;
    const extraCategories = await store.extraCategories(row.id);
    return staffView(row, role, await store.rates(), { images: staffPhotos(images as any, row.id), tiers, catalogSupplier, extraCategories });
  };

  api.post<{ Body: Record<string, unknown> }>('/api/products', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const scope = await requireVerified(u);
    let row = await store.create(req.body ?? {}, u.id, { ownerSupplierId: scope?.supplierId ?? null });
    row = await store.update(row.id, req.body ?? {}, u.id, { prices: canPrice(deps.perms, u), linkSupplier: canLinkSupplier(u), promote: canPromote(u) });
    return reply.code(201).send({ data: await staffProductView(row, u.role) });
  });

  api.get<{ Params: { id: string } }>('/api/products/:id', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    const row = await owned(u, req.params.id, { includeDeleted: isSa(u) });
    return { data: await staffProductView(row, u.role) };
  });

  api.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/products/:id', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    const cur = await owned(u, req.params.id);
    if (u.role === 'SUPPLIER') {
      await requireVerified(u);
      if (cur.status === 'PUBLISHED') bad('Ask the Marketplace Team to unpublish this product before you edit it', 409);
    }
    const row = await store.update(req.params.id, req.body ?? {}, u.id, { prices: canPrice(deps.perms, u), linkSupplier: canLinkSupplier(u), promote: canPromote(u) });
    return { data: await staffProductView(row, u.role) };
  });

  api.post<{ Params: { id: string } }>('/api/products/:id/submit-review', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    await requireVerified(u);
    await owned(u, req.params.id);
    return { data: await staffProductView(await store.submitReview(req.params.id, u.id), u.role) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/withdraw-review', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    await requireVerified(u);
    await owned(u, req.params.id);
    return { data: await staffProductView(await store.withdrawReview(req.params.id, u.id), u.role) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/publish', async (req) => {
    const u = req.user!; need(u, 'catalog.publish');
    return { data: staffView(await store.publish(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/unpublish', async (req) => {
    const u = req.user!; need(u, 'catalog.publish');
    return { data: staffView(await store.unpublish(req.params.id, u.id), u.role, await store.rates()) };
  });
  const canReviewSourcing = (u: { role: string }) => u.role === 'SUPER_ADMIN' || u.role === 'INDIA_ADMIN' || u.role === 'MARKETPLACE_TEAM';
  api.post<{ Params: { id: string } }>('/api/products/:id/discard-source', async (req) => {
    const u = req.user!; need(u, 'catalog.delete');
    if (!canReviewSourcing(u)) forbid('Only the Marketplace Team, India admin or super admin can discard a sourcing draft');
    return { data: await staffProductView(await store.discardSourceDraft(req.params.id, u.id), u.role) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/ack-source-update', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (!canReviewSourcing(u)) forbid('Only the Marketplace Team, India admin or super admin can review a sourcing update');
    const row = await owned(u, req.params.id);
    if (!row.source_quote_id) bad('This product did not come from a sourcing request', 400);
    await store.db.run('UPDATE products SET source_update_pending = false, updated_at = now() WHERE id = ?', row.id);
    await store.audit(row.id, u.id, 'SOURCE_UPDATE_ACK', { pending: true }, { pending: false });
    return { data: await staffProductView(await store.get(row.id), u.role) };
  });
  api.post<{ Params: { id: string }; Body: { confirm?: unknown } }>('/api/products/:id/delete', async (req) => {
    const u = req.user!; need(u, 'catalog.delete');
    if (req.body?.confirm !== true && req.body?.confirm !== 'true') bad('Confirm deletion');
    await owned(u, req.params.id);
    if (u.role === 'SUPPLIER') await requireVerified(u);
    return { data: staffView(await store.softDelete(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.post<{ Params: { id: string } }>('/api/products/:id/restore', async (req) => {
    const u = req.user!; if (!isSa(u)) forbid('Only the super admin can restore a deleted product');
    return { data: staffView(await store.restore(req.params.id, u.id), u.role, await store.rates()) };
  });
  api.get<{ Params: { id: string } }>('/api/products/:id/audit', async (req) => {
    const u = req.user!; need(u, 'catalog.edit');
    await owned(u, req.params.id, { includeDeleted: isSa(u) });
    return { data: await store.auditList(req.params.id) };
  });

  api.post<{ Params: { id: string } }>('/api/products/:id/images', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (u.role === 'SUPPLIER') await requireVerified(u);
    const row = await owned(u, req.params.id);
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
    const row = await owned(u, req.params.id, { includeDeleted: isSa(u) });
    return sendUpload(reply, deps.uploads, ownerKey('p', row.id), req.params.fid, 'private, max-age=60');
  });

  api.delete<{ Params: { id: string; fid: string } }>('/api/products/:id/images/:fid', async (req, reply) => {
    const u = req.user!; need(u, 'catalog.edit');
    if (u.role === 'SUPPLIER') await requireVerified(u);
    const row = await owned(u, req.params.id);
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
    if (u.role === 'SUPPLIER') await requireVerified(u);
    const row = await owned(u, req.params.id);
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
    const desk = parts.find((p) => p.field === 'file' || p.field === 'desktop')?.buf
      ?? parts.find((p) => p.field !== 'mobile')?.buf;
    const mob = parts.find((p) => p.field === 'mobile')?.buf;
    if (!desk && !mob) bad('No file');
    if (!desk) {
      if (!cur.file_id) bad('Upload a desktop image first');
      const mobile = await processBannerMobile(mob!);
      const saved = deps.uploads.save(ownerKey('bn', cur.id), [{ name: 'mobile.webp', mime: 'image/webp', data: mobile }]);
      await deps.db.run('UPDATE banner_slides SET mobile_file_id = ?, updated_at = now() WHERE id = ?', saved[0].id, cur.id);
    } else {
      const processed = await processBannerImage(desk, mob);
      const saved = deps.uploads.save(ownerKey('bn', cur.id), [
        { name: 'desktop.webp', mime: 'image/webp', data: processed.desktop },
        { name: 'mobile.webp', mime: 'image/webp', data: processed.mobile },
      ]);
      await deps.db.run('UPDATE banner_slides SET file_id = ?, mobile_file_id = ?, updated_at = now() WHERE id = ?', saved[0].id, saved[1].id, cur.id);
    }
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
  // Public image URLs: an <img> cannot send a bearer token, so staff previews must use a public file route.
  const v = r.updated_at ? `&v=${new Date(r.updated_at).getTime()}` : '';
  return {
    id: r.id, sort: r.sort, altText: r.alt_text, linkKind: r.link_kind, productId: r.product_id, categoryId: r.category_id, url: r.url,
    startsAt: r.starts_at, endsAt: r.ends_at, active: !!r.active, isSample: !!r.is_sample, updatedAt: r.updated_at,
    imageUrl: r.file_id ? `/api/public/catalog/banners/${r.id}/image?k=desktop${v}` : null,
    mobileUrl: r.mobile_file_id ? `/api/public/catalog/banners/${r.id}/image?k=mobile${v}` : null,
  };
}

/** Routes a Marketplace Team login may call. Everything else is 403. */
export function marketplaceTeamAllowed(url: string) {
  return /^\/api\/me(\/|$)/.test(url) || /^\/api\/products(\/|$)/.test(url) || /^\/api\/catalog(\/|$)/.test(url) || /^\/api\/banners(\/|$)/.test(url) || /^\/api\/supplier(\/|$)/.test(url) || /^\/api\/chat(\/|$)/.test(url) || /^\/api\/leads\/[^/]+\/chat/.test(url) || /^\/api\/quotes\/[^/]+\/files/.test(url) || /^\/api\/notifications(\/|$)/.test(url);
}

/** Suppliers may only use their own catalog and profile routes. */
export function supplierAllowed(url: string, method: string) {
  if (/^\/api\/me(\/|$)/.test(url)) return true;
  if (/^\/api\/products(\/|$)/.test(url)) return true;
  if (/^\/api\/catalog\/categories$/.test(url) && method === 'GET') return true;
  if (/^\/api\/supplier(\/|$)/.test(url)) return true;
  return false;
}

export { stripSupplier };

export function registerPortalCatalog(api: FastifyInstance, deps: CatalogDeps) {
  const store = new CatalogStore(deps.db);
  api.get('/api/portal/catalog/favorites/ids', async (req) => ({ data: await favoriteIds(deps.db, req.customer!.customerId) }));
  api.get('/api/portal/catalog/favorites', async (req) => {
    const rates = await store.rates();
    const rows = await listFavorites(deps.db, req.customer!.customerId);
    const data = [];
    const paidMember = await isActiveMember(deps.db, req.customer!.customerId);
    for (const r of rows) data.push(await publicView(store, r, rates, { paidMember }));
    return { data };
  });
  api.put<{ Params: { productId: string } }>('/api/portal/catalog/favorites/:productId', async (req, reply) => {
    const row = await store.get(req.params.productId);
    if (!row || row.status !== 'PUBLISHED') return reply.code(404).send({ error: 'Product not found' });
    await addFavorite(deps.db, req.customer!.customerId, row.id);
    return reply.code(201).send({ ok: true, id: row.id });
  });
  api.delete<{ Params: { productId: string } }>('/api/portal/catalog/favorites/:productId', async (req, reply) => {
    await removeFavorite(deps.db, req.customer!.customerId, req.params.productId);
    return reply.code(204).send();
  });
}
