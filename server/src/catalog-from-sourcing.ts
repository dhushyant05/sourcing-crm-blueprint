import { createHash, randomUUID } from 'node:crypto';
/**
 * When China returns a sourcing quote with a price, create or refresh an
 * unpublished marketplace draft for the Marketplace Team to review.
 * Never auto-publishes. Factory/reference cost is staff-only.
 * Customer identity is never copied onto the product.
 */
import type { CatalogDeps } from './catalog.js';
import { CatalogStore, normalizeSpecs, ownerKey, processProductImage, saveProductPhoto, slugify } from './catalog.js';
import { QuoteStore, type Quote } from './quotes.js';
import { LeadStore, type Rec } from './leads.js';

const PRICE_RE = /^(\d+(?:\.\d+)?)/;

export function parseMoq(raw: unknown, fallback?: unknown): number | null {
  for (const v of [raw, fallback]) {
    if (v == null || v === '') continue;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    const m = String(v).replace(/,/g, '').trim().match(PRICE_RE);
    if (m) return Number(m[1]);
  }
  return null;
}

function titleOf(quote: Quote, lead: Rec): string {
  const fromQuote = String(quote.product ?? '').trim();
  const fromLead = String(lead.productInterest ?? lead.name ?? '').trim();
  return (fromQuote || fromLead || 'Sourced product').slice(0, 200);
}

function summaryOf(quote: Quote, lead: Rec): string | null {
  const notes = String(quote.notes ?? '').trim();
  const summary = String(lead.summary ?? '').trim();
  const text = notes || summary;
  return text ? text.slice(0, 4000) : null;
}

function specsOf(quote: Quote, lead: Rec): Record<string, string> | null {
  const out: Record<string, string> = {};
  if (quote.moq) out.MOQ = String(quote.moq);
  else if (lead.quantity != null) out.MOQ = String(lead.quantity) + (lead.unit ? ` ${lead.unit}` : '');
  if (quote.leadTime) out['Lead time'] = String(quote.leadTime);
  if (quote.validity) out.Validity = String(quote.validity);
  if (quote.shipTerm) out.Incoterm = String(quote.shipTerm);
  if (quote.shipMode) out['Shipping mode'] = String(quote.shipMode);
  if (quote.shipPort) out.Port = String(quote.shipPort);
  if (quote.shipTransit) out.Transit = String(quote.shipTransit);
  return Object.keys(out).length ? out : null;
}

/** A lead has been "returned with a price" when China has quoted it or sent it back to India. */
export function leadIsReturnedWithPrice(lead: Rec | null | undefined): boolean {
  if (!lead) return false;
  const status = String(lead.status ?? '');
  if (status === 'QUOTED' || status === 'APPROVED') return true;
  const office = String(lead.ownerOffice ?? lead.assignedOffice ?? '');
  if (office === 'INDIA' && ['SOURCING', 'ASSIGNED', 'QUOTED', 'APPROVED', 'NEW'].includes(status)) return true;
  return false;
}

async function matchCategory(store: CatalogStore, title: string): Promise<string | null> {
  const name = title.trim();
  if (!name) return null;
  const exact = await store.db.get<{ id: string }>('SELECT id FROM categories WHERE lower(name) = lower(?) AND active = true LIMIT 1', name);
  if (exact) return exact.id;
  const words = name.split(/\s+/).filter((w) => w.length >= 4).slice(0, 4);
  for (const w of words) {
    const row = await store.db.get<{ id: string }>('SELECT id FROM categories WHERE active = true AND lower(name) = lower(?) LIMIT 1', w);
    if (row) return row.id;
  }
  return null;
}

async function copyImages(deps: CatalogDeps, productId: string, keys: string[], alt: string) {
  const existing = await deps.db.all<{ n: number }>('SELECT count(distinct coalesce(group_id, file_id))::int AS n FROM product_images WHERE product_id = ?', productId);
  let sort = Number(existing?.[0] ? 0 : 0);
  const groups = (await deps.db.all<{ n: number }>('SELECT count(*)::int AS n FROM (SELECT coalesce(group_id, file_id) FROM product_images WHERE product_id = ? GROUP BY 1) x', productId))?.[0];
  sort = groups?.n ?? 0;
  let added = 0;
  for (const key of keys) {
    for (const meta of deps.uploads.list(key)) {
      if (sort + added >= 15) return;
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(meta.mime || '')) continue;
      const file = deps.uploads.read(key, meta.id);
      if (!file?.data) continue;
      try {
        const processed = await processProductImage(file.data);
        await saveProductPhoto(deps, productId, processed, alt.slice(0, 200), sort + added, sort + added === 0);
        added += 1;
        await deps.mediaSync?.(ownerKey('p', productId), deps.uploads.list(ownerKey('p', productId)));
      } catch {
        // Skip a bad file; the draft should still be created.
      }
    }
  }
}

function qKey(id: string) { return `q_${id.replace(/-/g, '')}`.slice(0, 64); }

/** Quote photos only. Lead-level enquiry photos are used only when this is the lead's sole priced quote, so sibling products cannot leak in. */
export async function imageKeysForQuote(deps: CatalogDeps, leadId: string, quoteId: string): Promise<string[]> {
  const keys = [qKey(quoteId)];
  const priced = await deps.db.get<{ n: number }>('SELECT count(*)::int AS n FROM quotes WHERE lead_id = ? AND unit_price IS NOT NULL', leadId);
  if ((priced?.n ?? 0) <= 1) keys.push(leadId);
  return keys;
}

function sha256(data: Buffer) { return createHash('sha256').update(data).digest('hex'); }

async function hashesForKeys(deps: CatalogDeps, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const key of keys) {
    for (const meta of deps.uploads.list(key)) {
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(meta.mime || '')) continue;
      const file = deps.uploads.read(key, meta.id);
      if (!file?.data) continue;
      try {
        const processed = await processProductImage(file.data);
        out.add(sha256(processed.original));
      } catch { /* skip */ }
    }
  }
  return out;
}

async function clearPhotoGroup(deps: CatalogDeps, productId: string, fileIds: string[]) {
  for (const fid of fileIds) {
    await deps.db.run('DELETE FROM product_images WHERE product_id = ? AND file_id = ?', productId, fid);
    deps.uploads.remove(ownerKey('p', productId), fid);
  }
  await deps.mediaSync?.(ownerKey('p', productId), deps.uploads.list(ownerKey('p', productId)));
}

/** Drop photos that came from a sibling quote or from a shared lead album, then fill any missing quote photos. */
export async function isolateSourcingPhotos(deps: CatalogDeps, productId: string, leadId: string, quoteId: string, alt: string, opts: { dryRun?: boolean } = {}): Promise<{ kept: number; removed: number; added: number; merged: boolean }> {
  const store = new CatalogStore(deps.db);
  const allowedKeys = await imageKeysForQuote(deps, leadId, quoteId);
  const allowed = await hashesForKeys(deps, allowedKeys);
  const siblingKeys: string[] = [];
  const siblings = await deps.db.all<{ id: string }>('SELECT id FROM quotes WHERE lead_id = ? AND id <> ? AND unit_price IS NOT NULL', leadId, quoteId);
  for (const q of siblings) siblingKeys.push(qKey(q.id));
  if (siblings.length) siblingKeys.push(leadId);
  const leaked = await hashesForKeys(deps, siblingKeys);
  const imgs = await store.images(productId) as { fileId: string; kind: string; groupId: string | null }[];
  const groups = new Map<string, { fileIds: string[]; originalId?: string }>();
  for (const im of imgs) {
    const gid = im.groupId || im.fileId;
    const g = groups.get(gid) ?? { fileIds: [] };
    g.fileIds.push(im.fileId);
    if (im.kind === 'ORIGINAL') g.originalId = im.fileId;
    groups.set(gid, g);
  }
  let removed = 0;
  for (const g of groups.values()) {
    const origId = g.originalId ?? g.fileIds[0];
    const file = deps.uploads.read(ownerKey('p', productId), origId);
    const hash = file?.data ? sha256(file.data) : '';
    const isLeaked = !!hash && leaked.has(hash) && !allowed.has(hash);
    if (isLeaked) {
      if (!opts.dryRun) await clearPhotoGroup(deps, productId, g.fileIds);
      removed += 1;
    }
  }
  const remainingGroups = new Map<string, { fileIds: string[]; originalId?: string }>();
  for (const im of await store.images(productId) as any[]) {
    const gid = im.groupId || im.fileId;
    const g = remainingGroups.get(gid) ?? { fileIds: [] };
    g.fileIds.push(im.fileId);
    if (im.kind === 'ORIGINAL') g.originalId = im.fileId;
    remainingGroups.set(gid, g);
  }
  let groupsLeft = 0;
  for (const g of remainingGroups.values()) {
    const origId = g.originalId ?? g.fileIds[0];
    const file = deps.uploads.read(ownerKey('p', productId), origId);
    const hash = file?.data ? sha256(file.data) : '';
    const isLeaked = !!hash && leaked.has(hash) && !allowed.has(hash);
    if (opts.dryRun && isLeaked) continue;
    groupsLeft += 1;
  }
  let added = 0;
  if (!groupsLeft) {
    if (opts.dryRun) {
      added = allowed.size; // one hash per source image (original)
    } else {
      await copyImages(deps, productId, allowedKeys, alt);
      const after = new Set((await store.images(productId)).map((i: any) => i.groupId || i.fileId)).size;
      added = after;
    }
  }
  const kept = opts.dryRun ? groupsLeft + added : new Set((await store.images(productId)).map((i: any) => i.groupId || i.fileId)).size;
  return { kept, removed, added, merged: removed > 0 };
}


async function upsertOne(deps: CatalogDeps, lead: Rec, quote: Quote, by: string | null) {
  const store = new CatalogStore(deps.db);
  const existing = await store.db.get<any>(
    'SELECT * FROM products WHERE source_quote_id = ?',
    quote.id,
  );
  if (existing?.source_discarded_at || existing?.status === 'DELETED' || existing?.deleted_at) return existing ?? null;

  const title = titleOf(quote, lead);
  const summary = summaryOf(quote, lead);
  const specs = specsOf(quote, lead);
  const moq = parseMoq(quote.moq, lead.quantity);
  const unit = quote.moq && /[a-zA-Z]+/.test(String(quote.moq))
    ? (String(quote.moq).match(/[a-zA-Z]+(?:\s+[a-zA-Z]+)*$/)?.[0]?.trim().slice(0, 24) || (lead.unit as string) || 'pcs')
    : ((lead.unit as string) || 'pcs');
  const leadTime = (quote.leadTime || null) as string | null;
  const categoryId = existing?.category_id ?? await matchCategory(store, String(lead.productInterest ?? title));
  const ref = String(lead.leadRef ?? existing?.source_lead_ref ?? '').slice(0, 32) || null;

  if (!existing) {
    const id = randomUUID();
    const slug = await store.uniqueSlug(slugify(title) || 'sourced-product');
    await store.db.run(
      `INSERT INTO products (
         id, slug, title, summary, specs, category_id, status, moq, unit, lead_time,
         price_mode, base_currency, created_by, is_sample,
         source_lead_id, source_quote_id, source_lead_ref,
         source_unit_price, source_currency, source_update_pending
       ) VALUES (?,?,?,?,?::jsonb,?,?,?,?,?, 'GET_QUOTE', 'USD', ?, false, ?,?,?,?,?, false)`,
      id, slug, title, summary, specs ? JSON.stringify(normalizeSpecs(specs)) : null,
      categoryId, 'UNPUBLISHED', moq, unit, leadTime, by,
      lead.id, quote.id, ref, quote.unitPrice, quote.currency,
    );
    await store.audit(id, by, 'SOURCE_DRAFT', null, { sourceLeadId: lead.id, sourceQuoteId: quote.id, sourceLeadRef: ref });
    await copyImages(deps, id, await imageKeysForQuote(deps, String(lead.id), quote.id), title);
    return store.get(id);
  }

  const teamEdited = !!existing.source_team_edited_at;
  const published = existing.status === 'PUBLISHED';
  if (teamEdited || published) {
    await store.db.run(
      `UPDATE products SET source_unit_price = ?, source_currency = ?, source_lead_ref = coalesce(source_lead_ref, ?),
         source_update_pending = true, updated_at = now() WHERE id = ?`,
      quote.unitPrice, quote.currency, ref, existing.id,
    );
    await store.audit(existing.id, by, 'SOURCE_UPDATE_FLAGGED', { sourceUnitPrice: existing.source_unit_price, sourceCurrency: existing.source_currency }, { sourceUnitPrice: quote.unitPrice, sourceCurrency: quote.currency });
    return store.get(existing.id);
  }

  await store.db.run(
    `UPDATE products SET title = ?, summary = ?, specs = ?::jsonb, moq = ?, unit = ?, lead_time = ?,
       category_id = coalesce(category_id, ?), source_lead_id = ?, source_lead_ref = ?,
       source_unit_price = ?, source_currency = ?, source_update_pending = false, updated_at = now()
     WHERE id = ?`,
    title, summary, specs ? JSON.stringify(normalizeSpecs(specs)) : null, moq, unit, leadTime,
    categoryId, lead.id, ref, quote.unitPrice, quote.currency, existing.id,
  );
  await store.audit(existing.id, by, 'SOURCE_REFRESH', { title: existing.title }, { title, sourceUnitPrice: quote.unitPrice, sourceCurrency: quote.currency });
  const imgs = await store.images(existing.id);
  if (!imgs.length) await copyImages(deps, existing.id, await imageKeysForQuote(deps, String(lead.id), quote.id), title);
  return store.get(existing.id);
}

/** Create or refresh drafts for one quote, or every priced quote on a returned lead. */
export async function syncSourcingDrafts(deps: CatalogDeps, lead: Rec, quotes: Quote[], by: string | null, opts: { quoteId?: string; force?: boolean } = {}) {
  if (!lead?.id) return [];
  const list = opts.quoteId ? quotes.filter((q) => q.id === opts.quoteId) : quotes;
  const out = [];
  for (const q of list) {
    if (q.unitPrice == null || !Number.isFinite(Number(q.unitPrice))) continue;
    const already = await deps.db.get<{ id: string }>('SELECT id FROM products WHERE source_quote_id = ?', q.id);
    if (!already && !opts.force && !leadIsReturnedWithPrice(lead)) continue;
    const row = await upsertOne(deps, lead, q, by);
    if (row) out.push(row);
  }
  return out;
}


/** Historical QA / test sourcing records — excluded from backfill only, not from live sync. */
export function isTestSourcingRecord(lead: Rec | null | undefined, quote?: Quote | null): boolean {
  if (String(lead?.leadRef ?? '') === 'SE-2611-0109') return true;
  const parts = [lead?.leadRef, lead?.name, lead?.productInterest, lead?.summary, quote?.product, quote?.notes];
  const text = parts.map((v) => String(v ?? '').trim()).filter(Boolean).join(' \n ');
  if (!text) return false;
  if (/\bTEST(?:[\s\-–_]+QA)?\b/i.test(text)) return true;
  if (/\bQA[\s\-–_]+TEST\b/i.test(text)) return true;
  const fields = [lead?.name, lead?.productInterest, quote?.product].map((v) => String(v ?? '').trim());
  if (fields.some((f) => /^test$/i.test(f))) return true;
  return false;
}

export type BackfillSkipReason = 'test_record' | 'already_exists' | 'no_price';
export type BackfillItem = { leadRef: string | null; quoteId: string; title: string; productId?: string; slug?: string; status?: string };
export type BackfillSkip = BackfillItem & { reason: BackfillSkipReason };
export type BackfillResult = { created: BackfillItem[]; skipped: BackfillSkip[]; counts: { candidates: number; created: number; skipped: number; testRecord: number; alreadyExists: number } };

/**
 * Idempotent backfill of unpublished marketplace drafts for historical priced quotes
 * on quoted or India-held leads. Never auto-publishes. Leaves existing drafts untouched.
 * Skips TEST / QA sourcing records.
 */
export async function backfillSourcingDrafts(deps: CatalogDeps, by: string | null, opts: { dryRun?: boolean } = {}): Promise<BackfillResult> {
  const leads = new LeadStore(deps.db);
  const quotes = new QuoteStore(deps.db);
  const rows = await deps.db.all<{ quote_id: string; lead_id: string; lead_ref: string | null; status: string; owner_office: string | null; assigned_office: string | null }>(
    `SELECT q.id AS quote_id, q.lead_id, l.lead_ref, l.status, l.owner_office, l.assigned_office
       FROM quotes q
       JOIN leads l ON l.id = q.lead_id
      WHERE q.unit_price IS NOT NULL
        AND (l.status IN ('QUOTED', 'APPROVED') OR l.owner_office = 'INDIA' OR l.assigned_office = 'INDIA')
      ORDER BY l.lead_ref NULLS LAST, q.created_at, q.id`,
  );
  const created: BackfillItem[] = [];
  const skipped: BackfillSkip[] = [];
  for (const row of rows) {
    const lead = await leads.get(row.lead_id);
    const quote = await quotes.get(row.quote_id);
    if (!lead || !quote) continue;
    lead.ownerOffice = row.owner_office ?? lead.assignedOffice ?? null;
    const item: BackfillItem = {
      leadRef: (lead.leadRef as string) || row.lead_ref || null,
      quoteId: quote.id,
      title: (String(quote.product || lead.productInterest || 'Sourced product')).slice(0, 200),
    };
    if (quote.unitPrice == null || !Number.isFinite(Number(quote.unitPrice))) {
      skipped.push({ ...item, reason: 'no_price' });
      continue;
    }
    if (isTestSourcingRecord(lead, quote)) {
      skipped.push({ ...item, reason: 'test_record' });
      continue;
    }
    const existing = await deps.db.get<{ id: string; slug: string; status: string; source_discarded_at: string | null }>(
      'SELECT id, slug, status, source_discarded_at FROM products WHERE source_quote_id = ?',
      quote.id,
    );
    if (existing) {
      skipped.push({ ...item, reason: 'already_exists', productId: existing.id, slug: existing.slug, status: existing.status });
      continue;
    }
    if (opts.dryRun) {
      created.push(item);
      continue;
    }
    const out = await syncSourcingDrafts(deps, lead, [quote], by, { quoteId: quote.id, force: true });
    const draft = out[0];
    if (draft) created.push({ ...item, productId: draft.id, slug: draft.slug, status: draft.status });
  }
  const testRecord = skipped.filter((s) => s.reason === 'test_record').length;
  const alreadyExists = skipped.filter((s) => s.reason === 'already_exists').length;
  return {
    created,
    skipped,
    counts: { candidates: rows.length, created: created.length, skipped: skipped.length, testRecord, alreadyExists },
  };
}


export type RepairItem = BackfillItem & { kept?: number; removed?: number; added?: number; merged?: boolean };
export type RepairSkipReason = 'team_edited' | 'discarded' | 'published' | 'missing_quote' | 'already_clean';
export type RepairResult = {
  repaired: RepairItem[];
  skipped: (BackfillItem & { reason: RepairSkipReason })[];
  counts: { candidates: number; repaired: number; merged: number; skipped: number; teamEdited: number; alreadyClean: number };
};

/**
 * Un-merge photos leaked from sibling quotes or a shared lead album, and
 * refresh unedited unpublished drafts from their own quote only.
 * Never publishes. Team-edited, discarded and published drafts are left untouched.
 */
export async function repairSourcingDrafts(deps: CatalogDeps, by: string | null, opts: { dryRun?: boolean } = {}): Promise<RepairResult> {
  const leads = new LeadStore(deps.db);
  const quotes = new QuoteStore(deps.db);
  const rows = await deps.db.all<any>(
    `SELECT id, slug, title, status, source_lead_id, source_quote_id, source_lead_ref,
            source_team_edited_at, source_discarded_at, deleted_at
       FROM products
      WHERE source_quote_id IS NOT NULL AND deleted_at IS NULL
      ORDER BY source_lead_ref NULLS LAST, created_at, id`,
  );
  const repaired: RepairItem[] = [];
  const skipped: RepairResult['skipped'] = [];
  for (const row of rows) {
    const item: BackfillItem = { leadRef: row.source_lead_ref ?? null, quoteId: row.source_quote_id, title: row.title, productId: row.id, slug: row.slug, status: row.status };
    if (row.source_discarded_at) { skipped.push({ ...item, reason: 'discarded' }); continue; }
    if (row.status === 'PUBLISHED') { skipped.push({ ...item, reason: 'published' }); continue; }
    if (row.source_team_edited_at) { skipped.push({ ...item, reason: 'team_edited' }); continue; }
    const lead = row.source_lead_id ? await leads.get(row.source_lead_id) : null;
    const quote = await quotes.get(row.source_quote_id);
    if (!lead || !quote) { skipped.push({ ...item, reason: 'missing_quote' }); continue; }
    const title = titleOf(quote, lead);
    const photo = await isolateSourcingPhotos(deps, row.id, String(lead.id), quote.id, title, { dryRun: !!opts.dryRun });
    if (!opts.dryRun) {
      await syncSourcingDrafts(deps, { ...lead, ownerOffice: lead.ownerOffice ?? lead.assignedOffice } as Rec, [quote], by, { quoteId: quote.id, force: true });
    }
    if (!photo.merged && !photo.added) { skipped.push({ ...item, reason: 'already_clean' }); continue; }
    repaired.push({ ...item, title, kept: photo.kept, removed: photo.removed, added: photo.added, merged: photo.merged, status: 'UNPUBLISHED' });
  }
  const teamEdited = skipped.filter((s) => s.reason === 'team_edited').length;
  const alreadyClean = skipped.filter((s) => s.reason === 'already_clean').length;
  return {
    repaired,
    skipped,
    counts: {
      candidates: rows.length,
      repaired: repaired.length,
      merged: repaired.filter((r) => r.merged).length,
      skipped: skipped.length,
      teamEdited,
      alreadyClean,
    },
  };
}

export function sourceStaffFields(row: any, role: string) {
  if (!row?.source_quote_id) return {};
  const canReview = role === 'SUPER_ADMIN' || role === 'INDIA_ADMIN' || role === 'MARKETPLACE_TEAM' || role.startsWith('CHINA');
  if (!canReview) return { fromSourcing: true };
  return {
    fromSourcing: true,
    sourceLeadId: row.source_lead_id,
    sourceQuoteId: row.source_quote_id,
    sourceLeadRef: row.source_lead_ref,
    sourceHref: row.source_lead_id ? `/app#/leads?id=${row.source_lead_id}` : '/app#/leads',
    sourceLabel: 'From sourcing request',
    sourceUpdatePending: !!row.source_update_pending,
    sourceDiscardedAt: row.source_discarded_at ?? null,
    sourceTeamEditedAt: row.source_team_edited_at ?? null,
    // Factory/reference cost — never included in publicView.
    referenceCost: row.source_unit_price != null ? { amount: Number(row.source_unit_price), currency: row.source_currency || null } : null,
  };
}
