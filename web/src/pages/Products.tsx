import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useApp } from '../lib/store';
import { PageHeader } from '../components/ui';
import { staffReq } from '../catalog/api';
import { FIXTURE_PRODUCTS } from '../catalog/fixtures';
import type { Category, Merchandising, Product } from '../catalog/types';
import { CategoryPicker } from '../catalog/CategoryPicker';
import { CategoryManager } from '../catalog/CategoryManager';

type StaffProduct = Product & {
  status?: string; deletedAt?: string | null;
  fromSourcing?: boolean; sourceLeadId?: string; sourceQuoteId?: string; sourceLeadRef?: string;
  sourceHref?: string; sourceLabel?: string; sourceUpdatePending?: boolean; sourceTeamEditedAt?: string | null;
  referenceCost?: { amount: number; currency: string | null } | null;
  priceUsd?: number | null; priceCny?: number | null; priceInr?: number | null;
  publishBlockers?: string[];
};
function ymdIST(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Calcutta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function staffAmount(v: Product['clearancePrice']) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return v.amounts?.USD?.min != null ? String(v.amounts.USD.min) : '';
}

const PHOTO_MAX = 15;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
type PhotoDraft = { key: string; file: File; url: string; cover: boolean };

function checkPhoto(file: File) {
  if (!PHOTO_TYPES.includes(file.type)) return 'Photos must be JPEG, PNG or WebP.';
  if (file.size > PHOTO_MAX_BYTES) return 'Each photo must be 10 MB or smaller.';
  return null;
}

const PAGE_SIZE = 25;
const SOURCE_PRICE_MSG = 'Set a selling price in at least one currency (USD, RMB or INR), then save, before publishing a fixed-price product. One currency is enough. Or switch the pricing mode to Get quote. The China factory cost is never shown publicly.';

function priceModeOf(p: { priceMode?: string; price?: any }) {
  return p.priceMode ?? p.price?.mode ?? 'GET_QUOTE';
}
function hasSellingPrice(p: StaffProduct | { priceUsd?: number | null; priceCny?: number | null; priceInr?: number | null; priceMin?: number | null; price?: any; tiers?: any[]; publishBlockers?: string[]; priceMode?: string }) {
  if (p.priceUsd != null || p.priceCny != null || p.priceInr != null || p.priceMin != null) return true;
  const amounts = p.price?.amounts;
  if (amounts && Object.values(amounts).some((a: any) => a && (a.min != null || a.max != null))) return true;
  if (Array.isArray(p.tiers) && p.tiers.length) return true;
  return false;
}
function needsSellingPrice(p: StaffProduct | { priceMode?: string; price?: any; priceUsd?: number | null; priceCny?: number | null; priceInr?: number | null; priceMin?: number | null; tiers?: any[] }) {
  return priceModeOf(p) !== 'GET_QUOTE' && !hasSellingPrice(p);
}

type StaffSupplier = { id: string; name: string; catalogConsent?: boolean; publicRegion?: string | null; publicAbout?: string | null; publicYears?: number | null; publicVerified?: boolean; contact?: string | null; phone?: string | null; wechat?: string | null; city?: string | null; notes?: string | null };
function SupplierDetails({ s }: { s: StaffSupplier }) {
  const location = s.city || s.publicRegion || null;
  const rows: [string, string][] = [];
  if (s.contact) rows.push(['Contact', s.contact]);
  if (s.phone) rows.push(['Phone', s.phone]);
  if (s.wechat) rows.push(['WeChat', s.wechat]);
  if (location) rows.push(['Location', location]);
  if (s.notes) rows.push(['Notes', s.notes]);
  return (
    <div className="mt-2 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-800 dark:border-ink-800 dark:bg-ink-850 dark:text-ink-100" data-testid="product-supplier-details">
      <p className="font-medium">{s.name}</p>
      {rows.map(([k, v]) => <p key={k} className="text-ink-600 dark:text-ink-300">{k}: {v}</p>)}
      <p className="mt-1 text-xs text-ink-500">{s.catalogConsent ? 'Catalog consent given — public details are shown only to paid members.' : 'Has not consented to public catalog display.'}</p>
    </div>
  );
}


export function Products() {
  const { session, perms } = useApp();
  const demo = !!session?.demo;
  const canPrice = perms.can('catalog.price') || session?.role === 'SUPER_ADMIN';
  const canPublish = perms.can('catalog.publish') || session?.role === 'SUPER_ADMIN';
  const canDelete = perms.can('catalog.delete') || session?.role === 'SUPER_ADMIN';
  const isSa = session?.role === 'SUPER_ADMIN';
  const canLink = session?.role === 'SUPER_ADMIN' || session?.role === 'MARKETPLACE_TEAM' || !!session?.role?.startsWith('CHINA');
  const canPromote = session?.role === 'SUPER_ADMIN' || session?.role === 'MARKETPLACE_TEAM';
  const isSupplier = session?.role === 'SUPPLIER';
  const [rows, setRows] = useState<StaffProduct[]>(demo ? FIXTURE_PRODUCTS.map((p) => ({ ...p, status: 'PUBLISHED' })) : []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [fromSourcing, setFromSourcing] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<StaffProduct | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (demo) return;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (fromSourcing) params.set('fromSourcing', '1');
    if (discarded) params.set('discarded', '1');
    if (isSa && status === 'DELETED') params.set('deleted', '1');
    params.set('limit', String(PAGE_SIZE));
    params.set('page', String(page));
    const r = await staffReq<{ data: StaffProduct[]; total: number; page: number; pageCount: number }>('GET', `/api/products?${params}`);
    setRows(r.data);
    setTotal(r.total ?? r.data.length);
    setPageCount(Math.max(1, r.pageCount ?? 1));
  };
  useEffect(() => { setPage(1); }, [q, status, fromSourcing, discarded]); // eslint-disable-line
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, [q, status, fromSourcing, discarded, page, demo]); // eslint-disable-line

  const remove = async (p: StaffProduct) => {
    if (!confirm(`Delete “${p.title}”? This hides it from the catalog. Super admin can restore it.`)) return;
    if (demo) { setRows((xs) => xs.filter((x) => x.id !== p.id)); return; }
    await staffReq('POST', `/api/products/${p.id}/delete`, { confirm: true });
    await load();
  };
  const restore = async (p: StaffProduct) => {
    if (demo) return;
    await staffReq('POST', `/api/products/${p.id}/restore`, {});
    await load();
  };
  const submitReview = async (p: StaffProduct, on: boolean) => {
    if (demo) { setRows((xs) => xs.map((x) => x.id === p.id ? { ...x, status: on ? 'PENDING_REVIEW' : 'DRAFT' } : x)); return; }
    await staffReq('POST', `/api/products/${p.id}/${on ? 'submit-review' : 'withdraw-review'}`, {});
    await load();
  };
  const publish = async (p: StaffProduct, on: boolean) => {
    try {
      setErr(null);
      if (demo) { setRows((xs) => xs.map((x) => x.id === p.id ? { ...x, status: on ? 'PUBLISHED' : 'UNPUBLISHED' } : x)); return; }
      if (on && needsSellingPrice(p)) {
        setErr(SOURCE_PRICE_MSG);
        setEdit(p);
        return;
      }
      await staffReq('POST', `/api/products/${p.id}/${on ? 'publish' : 'unpublish'}`, {});
      await load();
    } catch (e) { setErr((e as Error).message); }
  };
  const canReviewSourcing = session?.role === 'SUPER_ADMIN' || session?.role === 'INDIA_ADMIN' || session?.role === 'MARKETPLACE_TEAM';
  const discardSource = async (p: StaffProduct) => {
    if (!confirm(`Discard “${p.title}” from the marketplace review queue? The sourcing request itself will not be changed.`)) return;
    await staffReq('POST', `/api/products/${p.id}/discard-source`, {});
    await load();
  };

  return (
    <>
      <PageHeader title="Products" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['DRAFT', 'READY_FOR_PRICE', 'PENDING_REVIEW', 'PUBLISHED', 'UNPUBLISHED', 'DELETED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {canReviewSourcing && (
          <button type="button" data-testid="filter-from-sourcing" onClick={() => { setFromSourcing((v) => !v); setDiscarded(false); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${fromSourcing ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:bg-ink-50'}`}>
            From sourcing — needs review
          </button>
        )}
        {canReviewSourcing && (
          <button type="button" data-testid="filter-discarded" onClick={() => { setDiscarded((v) => !v); setFromSourcing(false); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${discarded ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:bg-ink-50'}`}>
            Discarded
          </button>
        )}
        <button className="btn-primary ml-auto" onClick={() => setEdit('new')}>Add product</button>
      </div>
      {!demo && (session?.role === 'SUPER_ADMIN' || session?.role === 'MARKETPLACE_TEAM') && <CategoryManager />}
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
      <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-ink-500 dark:bg-ink-850"><tr>
            <th className="px-4 py-3">Product</th><th>Status</th><th>MOQ</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-ink-100 dark:border-ink-800">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900 dark:text-white">{p.title}</div>
                  <div className="text-xs text-ink-500">{p.category?.name || p.categoryName}{p.isSample ? ' · Sample' : ''}{p.pinned ? ' · Trending' : ''}{p.clearance ? ' · Clearance' : ''}{p.fromSourcing ? ' · From sourcing request' : ''}{p.sourceUpdatePending ? ' · Updated from sourcing — review' : ''}{p.catalogSupplier?.name ? ` · ${p.catalogSupplier.name}` : ''}</div>
                </td>
                <td className="text-ink-600">{p.status}{p.deletedAt ? ' (deleted)' : ''}</td>
                <td>{p.moq ?? '—'} {p.unit || ''}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {!(isSupplier && p.status === 'PUBLISHED') && <button className="btn-outline !py-1 text-xs" onClick={() => setEdit(p)}>Edit</button>}
                    {isSupplier && (p.status === 'DRAFT' || p.status === 'UNPUBLISHED' || p.status === 'READY_FOR_PRICE') && <button className="btn-outline !py-1 text-xs" data-testid="submit-review" onClick={() => void submitReview(p, true)}>Submit for review</button>}
                    {isSupplier && p.status === 'PENDING_REVIEW' && <button className="btn-outline !py-1 text-xs" data-testid="withdraw-review" onClick={() => void submitReview(p, false)}>Withdraw review</button>}
                    {canPublish && p.status !== 'PUBLISHED' && p.status !== 'DELETED' && <button className="btn-outline !py-1 text-xs" onClick={() => void publish(p, true)}>Publish</button>}
                    {canPublish && p.status === 'PUBLISHED' && <button className="btn-outline !py-1 text-xs" onClick={() => void publish(p, false)}>Unpublish</button>}
                    {canReviewSourcing && p.fromSourcing && p.status !== 'DELETED' && <button className="btn-outline !py-1 text-xs" data-testid="discard-source" onClick={() => void discardSource(p)}>Discard</button>}
                    {canDelete && p.status !== 'DELETED' && <button className="btn-outline !py-1 text-xs text-red-600" onClick={() => void remove(p)}>Delete</button>}
                    {isSa && p.status === 'DELETED' && <button className="btn-outline !py-1 text-xs" onClick={() => void restore(p)}>Restore</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-500">No products yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {!demo && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-600" data-testid="product-pagination">
          <p data-testid="product-page-status">
            Showing {Math.min(total, (page - 1) * PAGE_SIZE + 1)}–{Math.min(total, page * PAGE_SIZE)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-outline !py-1 text-xs" data-testid="product-page-prev" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span>Page {page} of {pageCount}</span>
            <button type="button" className="btn-outline !py-1 text-xs" data-testid="product-page-next" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
          </div>
        </div>
      )}
      {edit && <ProductEditor product={edit === 'new' ? null : edit} canPrice={canPrice} canLink={canLink} canPromote={canPromote} canPublish={canPublish} busy={busy}
        onClose={() => setEdit(null)}
        onSave={async (body, photos, opts) => {
          setBusy(true); setErr(null);
          try {
            if (demo) {
              if (edit === 'new') setRows((xs) => [{ id: `local-${Date.now()}`, slug: body.title.toLowerCase().replace(/\s+/g, '-'), title: body.title, summary: body.summary, moq: body.moq, unit: body.unit, status: 'DRAFT', images: [], price: { mode: 'GET_QUOTE', base: 'USD', amounts: null }, isSample: true }, ...xs]);
              else setRows((xs) => xs.map((x) => x.id === (edit as StaffProduct).id ? { ...x, ...body } : x));
            } else {
              const saved = edit === 'new'
                ? (await staffReq<{ data: StaffProduct }>('POST', '/api/products', body)).data
                : (await staffReq<{ data: StaffProduct }>('PATCH', `/api/products/${(edit as StaffProduct).id}`, body)).data;
              const existingCount = (saved.images ?? []).length;
              for (const photo of photos) {
                const fd = new FormData(); fd.append('file', photo.file);
                await staffReq('POST', `/api/products/${saved.id}/images`, fd);
              }
              if (photos.length) {
                const fresh = (await staffReq<{ data: StaffProduct }>('GET', `/api/products/${saved.id}`)).data;
                const imgs = fresh.images ?? [];
                const added = imgs.slice(Math.max(0, imgs.length - photos.length));
                const coverIdx = Math.max(0, photos.findIndex((x) => x.cover));
                const coverId = added[coverIdx]?.id ?? added[0]?.id;
                if (coverId) {
                  await staffReq('PATCH', `/api/products/${saved.id}/images`, {
                    order: [...imgs.slice(0, existingCount).map((im) => im.id), ...added.map((im) => im.id)],
                    cover: coverId,
                  });
                }
              }
              if (opts?.publish) {
                await staffReq('POST', `/api/products/${saved.id}/publish`, {});
              }
              await load();
            }
            setEdit(null);
          } catch (e) { setErr((e as Error).message); }
          finally { setBusy(false); }
        }} />}
    </>
  );
}

function ProductEditor({ product, canPrice, canLink, canPromote, canPublish, busy, onClose, onSave }: {
  product: StaffProduct | null; canPrice: boolean; canLink: boolean; canPromote: boolean; canPublish?: boolean; busy: boolean; onClose: () => void;
  onSave: (body: any, photos: PhotoDraft[], opts?: { publish?: boolean }) => Promise<void>;
}) {
  const { session } = useApp();
  const canCreate = session?.role === 'SUPER_ADMIN' || session?.role === 'MARKETPLACE_TEAM';
  const [formErr, setFormErr] = useState<string | null>(null);
  const specsObj = product?.specs && typeof product.specs === 'object' ? product.specs : {};
  const [f, setF] = useState({
    title: product?.title ?? '', summary: product?.summary ?? '', moq: product?.moq != null ? String(product.moq) : '',
    unit: product?.unit ?? 'pcs', leadTime: product?.leadTime ?? '', capacity: product?.capacity ?? '',
    packaging: product?.packaging ?? '', customization: product?.customization ?? '', samplePolicy: product?.samplePolicy ?? '',
    priceMode: product?.priceMode ?? product?.price?.mode ?? 'GET_QUOTE',
    priceMin: product?.priceMin != null ? String(product.priceMin) : '', priceMax: product?.priceMax != null ? String(product.priceMax) : '',
    priceUsd: product?.price?.amounts?.USD?.min != null ? String(product.price.amounts.USD.min) : (product?.priceUsd != null ? String(product.priceUsd) : ''),
    priceCny: product?.price?.amounts?.CNY?.min != null ? String(product.price.amounts.CNY.min) : (product?.priceCny != null ? String(product.priceCny) : ''),
    priceInr: product?.price?.amounts?.INR?.min != null ? String(product.price.amounts.INR.min) : (product?.priceInr != null ? String(product.priceInr) : ''),
    baseCurrency: product?.baseCurrency ?? 'USD',
    categoryId: product?.categoryId ?? product?.category?.id ?? '',
    extraCategoryIds: (product?.extraCategories ?? []).map((c: { id: string }) => c.id),

    supplierId: product?.supplierId ?? product?.catalogSupplier?.id ?? '',
    tags: Array.isArray(product?.tags) ? product!.tags.join(', ') : '',
    pinned: !!product?.pinned,
    clearance: !!product?.clearance,
    clearancePrice: staffAmount(product?.clearancePrice),
    clearanceDiscountPct: product?.clearanceDiscountPct != null ? String(product.clearanceDiscountPct) : '',
    clearanceEndsAt: ymdIST(product?.clearanceEndsAt),
    clearanceStockLeft: product?.clearanceStockLeft != null ? String(product.clearanceStockLeft) : '',
  });
  const [attrs, setAttrs] = useState<{ key: string; value: string }[]>(
    Object.entries(specsObj).map(([key, value]) => ({ key, value: String(value ?? '') })).concat([{ key: '', value: '' }]),
  );
  const emptyTier = { minQty: '', maxQty: '', unitPrice: '', priceUsd: '', priceCny: '', priceInr: '' };
  const [tiers, setTiers] = useState<{ minQty: string; maxQty: string; unitPrice: string; priceUsd: string; priceCny: string; priceInr: string }[]>(
    (product?.tiers ?? []).map((t: any) => ({
      minQty: String(t.minQty ?? ''), maxQty: t.maxQty != null ? String(t.maxQty) : '',
      unitPrice: t.unitPrice != null ? String(t.unitPrice) : String(t.amounts?.[product?.baseCurrency ?? 'USD'] ?? ''),
      priceUsd: t.priceUsd != null ? String(t.priceUsd) : t.amounts?.USD != null ? String(t.amounts.USD) : '',
      priceCny: t.priceCny != null ? String(t.priceCny) : t.amounts?.CNY != null ? String(t.amounts.CNY) : '',
      priceInr: t.priceInr != null ? String(t.priceInr) : t.amounts?.INR != null ? String(t.amounts.INR) : '',
    })).concat([emptyTier]),
  );
  const [sourcePending, setSourcePending] = useState(!!product?.sourceUpdatePending);
  const merch: Merchandising = product?.merchandising ?? {};
  const [variations, setVariations] = useState<{ name: string; options: { label: string; hex: string }[] }[]>(
    (merch.variations ?? []).map((v) => ({ name: v.name, options: (v.options ?? []).map((o) => ({ label: o.label, hex: o.hex || '' })).concat([{ label: '', hex: '' }]) })).concat([{ name: '', options: [{ label: '', hex: '' }] }]),
  );
  const [customizations, setCustomizations] = useState<{ label: string; moq: string; note: string }[]>(
    (merch.customizations ?? []).map((c) => ({ label: c.label, moq: c.moq != null ? String(c.moq) : '', note: c.note || '' })).concat([{ label: '', moq: '', note: '' }]),
  );
  const [leadTimes, setLeadTimes] = useState<{ minQty: string; maxQty: string; time: string }[]>(
    (merch.leadTimes ?? []).map((t) => ({ minQty: String(t.minQty), maxQty: t.maxQty != null ? String(t.maxQty) : '', time: t.time })).concat([{ minQty: '', maxQty: '', time: '' }]),
  );
  const [industryAttrs, setIndustryAttrs] = useState<{ key: string; value: string }[]>(
    (merch.industryAttributes ?? []).concat([{ key: '', value: '' }]),
  );
  const [otherAttrs, setOtherAttrs] = useState<{ key: string; value: string }[]>(
    (merch.otherAttributes?.length ? merch.otherAttributes : []).concat([{ key: '', value: '' }]),
  );
  const [sampleAmount, setSampleAmount] = useState(merch.samplePrice?.amount != null ? String(merch.samplePrice.amount) : '');
  const [sampleCurrency, setSampleCurrency] = useState<'USD' | 'CNY' | 'INR'>(merch.samplePrice?.currency ?? 'USD');
  const [sampleLead, setSampleLead] = useState(merch.samplePrice?.leadTime ?? '');
  const [shipOrigin, setShipOrigin] = useState(merch.shipping?.origin ?? '');
  const [shipEstimate, setShipEstimate] = useState(merch.shipping?.estimate ?? '');
  const [shipNote, setShipNote] = useState(merch.shipping?.note ?? '');
  const [sellingUnits, setSellingUnits] = useState(merch.packing?.sellingUnits ?? '');
  const [packageSize, setPackageSize] = useState(merch.packing?.singlePackageSize ?? '');
  const [grossWeight, setGrossWeight] = useState(merch.packing?.grossWeight ?? '');
  const [packageType, setPackageType] = useState(merch.packing?.packageType ?? '');
  const [longDescription, setLongDescription] = useState(merch.description ?? '');
  const [reviewsNote, setReviewsNote] = useState(merch.reviewsNote ?? '');
  const [protections, setProtections] = useState<{ title: string; text: string }[]>(
    (merch.protections ?? []).concat([{ title: '', text: '' }]),
  );
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<StaffSupplier[]>([]);
  const linkedSupplier = suppliers.find((s) => s.id === f.supplierId) || (product?.catalogSupplier?.id === f.supplierId ? product.catalogSupplier : null);
  const [newSup, setNewSup] = useState({ name: '', publicRegion: '', publicYears: '', publicAbout: '', catalogConsent: false, publicVerified: false });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    void staffReq<{ data: Category[] }>('GET', '/api/catalog/categories').then((r) => setCategories(r.data)).catch(() => setCategories([]));
    if (canLink) void staffReq<{ data: typeof suppliers }>('GET', '/api/catalog/suppliers').then((r) => setSuppliers(r.data)).catch(() => setSuppliers([]));
    if (product?.id) {
      void staffReq<{ data: StaffProduct }>('GET', `/api/products/${product.id}`).then((r) => {
        const p = r.data;
        setF((s) => ({
          ...s,
          categoryId: p.categoryId ?? p.category?.id ?? s.categoryId,
          extraCategoryIds: (p.extraCategories ?? []).map((c: { id: string }) => c.id),
          priceUsd: p.price?.amounts?.USD?.min != null ? String(p.price.amounts.USD.min) : s.priceUsd,
          priceCny: p.price?.amounts?.CNY?.min != null ? String(p.price.amounts.CNY.min) : s.priceCny,
          priceInr: p.price?.amounts?.INR?.min != null ? String(p.price.amounts.INR.min) : s.priceInr,
        }));
        if (p.sourceUpdatePending != null) setSourcePending(!!p.sourceUpdatePending);
      }).catch(() => { /* keep values from the list row */ });
    }
  }, [canLink, product?.id]); // eslint-disable-line
  const addSupplier = async () => {
    if (!newSup.name.trim()) return;
    const r = await staffReq<{ data: (typeof suppliers)[number] }>('POST', '/api/catalog/suppliers', {
      name: newSup.name, publicRegion: newSup.publicRegion || null, publicYears: newSup.publicYears ? Number(newSup.publicYears) : null,
      publicAbout: newSup.publicAbout || null, catalogConsent: newSup.catalogConsent, publicVerified: newSup.publicVerified,
    });
    setSuppliers((xs) => [...xs, r.data].sort((a, b) => a.name.localeCompare(b.name)));
    setF((s) => ({ ...s, supplierId: r.data.id }));
    setNewSup({ name: '', publicRegion: '', publicYears: '', publicAbout: '', catalogConsent: false, publicVerified: false });
  };
  const formHasSellingPrice = () => {
    if (f.priceUsd.trim() || f.priceCny.trim() || f.priceInr.trim() || f.priceMin.trim()) return true;
    if (f.priceMode === 'TIERS' && tiers.some((t) => t.unitPrice.trim() || t.priceUsd.trim() || t.priceCny.trim() || t.priceInr.trim())) return true;
    return false;
  };
  const submit = (e: { preventDefault(): void }, opts?: { publish?: boolean }) => {
    e.preventDefault();
    setFormErr(null);
    if (opts?.publish && f.priceMode !== 'GET_QUOTE' && !formHasSellingPrice()) {
      setFormErr(SOURCE_PRICE_MSG);
      return;
    }
    const specs = attrs.filter((a) => a.key.trim() && a.value.trim()).map((a) => ({ key: a.key.trim(), value: a.value.trim() }));
    const pricedTiers = tiers.filter((t) => t.unitPrice.trim() || t.priceUsd.trim() || t.priceCny.trim() || t.priceInr.trim()).map((t) => ({
      minQty: t.minQty ? Number(t.minQty) : 1, maxQty: t.maxQty ? Number(t.maxQty) : null,
      unitPrice: t.unitPrice ? Number(t.unitPrice) : (t.priceUsd ? Number(t.priceUsd) : t.priceCny ? Number(t.priceCny) : Number(t.priceInr)),
      priceUsd: t.priceUsd ? Number(t.priceUsd) : null, priceCny: t.priceCny ? Number(t.priceCny) : null, priceInr: t.priceInr ? Number(t.priceInr) : null,
    }));
    const merchandising = {
      variations: variations.filter((v) => v.name.trim()).map((v) => ({
        name: v.name.trim(),
        options: v.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), hex: o.hex.trim() || null })),
      })).filter((v) => v.options.length),
      customizations: customizations.filter((c) => c.label.trim()).map((c) => ({
        label: c.label.trim(), moq: c.moq ? Number(c.moq) : null, note: c.note.trim() || null,
      })),
      leadTimes: leadTimes.filter((x) => x.minQty && x.time.trim()).map((x) => ({
        minQty: Number(x.minQty), maxQty: x.maxQty ? Number(x.maxQty) : null, time: x.time.trim(),
      })),
      samplePrice: sampleAmount ? { amount: Number(sampleAmount), currency: sampleCurrency, leadTime: sampleLead.trim() || null } : null,
      shipping: (shipOrigin || shipEstimate || shipNote) ? { origin: shipOrigin || null, estimate: shipEstimate || null, note: shipNote || null } : null,
      industryAttributes: industryAttrs.filter((a) => a.key.trim() && a.value.trim()).map((a) => ({ key: a.key.trim(), value: a.value.trim() })),
      otherAttributes: otherAttrs.filter((a) => a.key.trim() && a.value.trim()).map((a) => ({ key: a.key.trim(), value: a.value.trim() })),
      packing: (sellingUnits || packageSize || grossWeight || packageType) ? {
        sellingUnits: sellingUnits || null, singlePackageSize: packageSize || null, grossWeight: grossWeight || null, packageType: packageType || null,
      } : null,
      description: longDescription.trim() || null,
      reviewsNote: reviewsNote.trim() || null,
      protections: protections.filter((x) => x.title.trim() && x.text.trim()).map((x) => ({ title: x.title.trim(), text: x.text.trim() })),
    };
    const allAttrs = [...merchandising.industryAttributes, ...merchandising.otherAttributes];
    void onSave({
      title: f.title, summary: f.summary, moq: f.moq ? Number(f.moq) : null, unit: f.unit, leadTime: f.leadTime,
      capacity: f.capacity, packaging: f.packaging, customization: f.customization, samplePolicy: f.samplePolicy,
      categoryId: f.categoryId || null, extraCategoryIds: f.extraCategoryIds, tags: f.tags, specs: allAttrs.length ? allAttrs : specs, merchandising,
      ...(canPrice ? {
        priceMode: f.priceMode, priceMin: f.priceMin ? Number(f.priceMin) : null, priceMax: f.priceMax ? Number(f.priceMax) : null,
        priceUsd: f.priceUsd === '' ? null : Number(f.priceUsd), priceCny: f.priceCny === '' ? null : Number(f.priceCny), priceInr: f.priceInr === '' ? null : Number(f.priceInr),
        baseCurrency: f.baseCurrency, tiers: f.priceMode === 'TIERS' ? pricedTiers : [],
      } : {}),
      ...(canPromote ? {
        pinned: !!f.pinned,
        clearance: !!f.clearance,
        clearancePrice: f.clearancePrice === '' ? null : Number(f.clearancePrice),
        clearanceDiscountPct: f.clearanceDiscountPct === '' ? null : Number(f.clearanceDiscountPct),
        clearanceEndsAt: f.clearanceEndsAt || null,
        clearanceStockLeft: f.clearanceStockLeft === '' ? null : Number(f.clearanceStockLeft),
      } : {}),
      ...(canLink ? { supplierId: f.supplierId || null } : {}),
    }, photos, opts);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4" onClick={onClose}>
      <form data-testid="product-editor" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lift dark:bg-ink-900" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
                <h2 className="text-lg font-semibold text-ink-900 dark:text-white">{product ? 'Edit product' : 'Add product'}</h2>
        {product?.fromSourcing && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-ink-800" data-testid="source-from-sourcing">
            <p className="font-semibold text-amber-900">{product.sourceLabel || 'From sourcing request'}</p>
            {product.sourceLeadRef && <p className="mt-0.5 text-ink-600">Request {product.sourceLeadRef}</p>}
            {product.sourceHref && <a className="mt-1 inline-block text-brand-700 underline" href={product.sourceHref}>Open sourcing request</a>}
            {product.referenceCost && product.referenceCost.amount != null && (
              <p className="mt-2 font-medium text-ink-800">China quoted cost (internal only): {product.referenceCost.currency || ''} {product.referenceCost.amount}</p>
            )}
            <p className="mt-1 text-xs text-ink-500">You can publish this as Get quote with no selling price, or choose a fixed price and enter at least one currency (USD, RMB or INR). Values are stored as entered and never converted. The China factory cost is never shown on the public marketplace.</p>
            {sourcePending && product.id && (
              <p className="mt-2 text-amber-800">The China quote was updated after this draft was edited.
                <button type="button" className="ml-2 underline" onClick={() => void staffReq('POST', `/api/products/${product.id}/ack-source-update`, {}).then(() => setSourcePending(false))}>Mark as reviewed</button>
              </p>
            )}
          </div>
        )}
        <div className="mt-4 space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Basic details</h3>
            <div className="space-y-3">
              <input className="input" required placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="product-title" />
              <textarea className="input min-h-[80px]" placeholder="Description / summary" value={f.summary} onChange={(e) => set('summary', e.target.value)} />
              <CategoryPicker
                categories={categories}
                value={f.categoryId}
                extraIds={f.extraCategoryIds ?? []}
                onChange={(id) => setF((s: any) => ({ ...s, categoryId: id, extraCategoryIds: (s.extraCategoryIds ?? []).filter((x: string) => x !== id) }))}
                onExtrasChange={(ids) => setF((s) => ({ ...s, extraCategoryIds: ids }))}
                onCategoriesChange={setCategories}
                canCreate={canCreate}
              />
              <input className="input" placeholder="Tags (comma separated)" value={f.tags} onChange={(e) => set('tags', e.target.value)} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Order & production</h3>
            <div className="grid grid-cols-2 gap-3">
              <input className="input" type="number" min="0" placeholder="MOQ" value={f.moq} onChange={(e) => set('moq', e.target.value)} />
              <input className="input" placeholder="Unit" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
              <input className="input" placeholder="Lead time" value={f.leadTime} onChange={(e) => set('leadTime', e.target.value)} />
              <input className="input" placeholder="Supply capacity" value={f.capacity} onChange={(e) => set('capacity', e.target.value)} data-testid="product-capacity" />
            </div>
          </section>

          {canPrice && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink-700">Selling price</h3>
              <p className="mb-2 text-xs text-ink-500">Enter USD, RMB and INR separately. A missing currency is left blank — values are never converted.</p>
              <div className="grid grid-cols-3 gap-3">
                <select className="input" value={f.priceMode} onChange={(e) => set('priceMode', e.target.value)} data-testid="product-price-mode">
                  <option value="GET_QUOTE">Get quote</option>
                  <option value="RANGE">Price range</option>
                  <option value="TIERS">Price tiers</option>
                </select>
                <select className="input" value={f.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}>
                  {['USD', 'CNY', 'INR'].map((c) => <option key={c} value={c}>{c === 'CNY' ? 'RMB' : c}</option>)}
                </select>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <label className="text-xs text-ink-600">USD
                  <input className="input mt-1" inputMode="decimal" placeholder="USD" value={f.priceUsd} onChange={(e) => set('priceUsd', e.target.value)} data-testid="product-price-usd" />
                </label>
                <label className="text-xs text-ink-600">RMB
                  <input className="input mt-1" inputMode="decimal" placeholder="RMB" value={f.priceCny} onChange={(e) => set('priceCny', e.target.value)} data-testid="product-price-cny" />
                </label>
                <label className="text-xs text-ink-600">INR
                  <input className="input mt-1" inputMode="decimal" placeholder="INR" value={f.priceInr} onChange={(e) => set('priceInr', e.target.value)} data-testid="product-price-inr" />
                </label>
              </div>
              {f.priceMode === 'RANGE' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input className="input" placeholder={`Min price (${f.baseCurrency === 'CNY' ? 'RMB' : f.baseCurrency})`} value={f.priceMin} onChange={(e) => set('priceMin', e.target.value)} />
                  <input className="input" placeholder={`Max price (${f.baseCurrency === 'CNY' ? 'RMB' : f.baseCurrency})`} value={f.priceMax} onChange={(e) => set('priceMax', e.target.value)} />
                </div>
              )}
              {f.priceMode === 'TIERS' && (
                <div className="mt-3 space-y-2" data-testid="product-tiers">
                  {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-5 gap-2">
                      <input className="input" placeholder="Min qty" value={t.minQty} onChange={(e) => setTiers((xs) => xs.map((x, j) => j === i ? { ...x, minQty: e.target.value } : x))} />
                      <input className="input" placeholder="Max qty" value={t.maxQty} onChange={(e) => setTiers((xs) => xs.map((x, j) => j === i ? { ...x, maxQty: e.target.value } : x))} />
                      <input className="input" placeholder="USD" value={t.priceUsd} onChange={(e) => setTiers((xs) => {
                        const next = xs.map((x, j) => j === i ? { ...x, priceUsd: e.target.value } : x);
                        if (i === next.length - 1 && (e.target.value || t.priceCny || t.priceInr || t.unitPrice)) next.push(emptyTier);
                        return next;
                      })} />
                      <input className="input" placeholder="RMB" value={t.priceCny} onChange={(e) => setTiers((xs) => xs.map((x, j) => j === i ? { ...x, priceCny: e.target.value } : x))} />
                      <input className="input" placeholder="INR" value={t.priceInr} onChange={(e) => setTiers((xs) => xs.map((x, j) => j === i ? { ...x, priceInr: e.target.value } : x))} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}


          {canPromote && (
            <section data-testid="product-placement">
              <h3 className="mb-2 text-sm font-semibold text-ink-700">Marketplace placement</h3>
              <label className="flex items-start gap-2 text-sm text-ink-800">
                <input type="checkbox" className="mt-1" checked={!!f.pinned} onChange={(e) => set('pinned', e.target.checked)} data-testid="product-mark-trending" />
                <span>
                  <span className="font-medium">Mark as Trending</span>
                  <span className="block text-xs text-ink-500">Pins this product to the top of the Trending list. Automatic ranking by views and enquiries still applies to the products after it.</span>
                </span>
              </label>
              <label className="mt-3 flex items-start gap-2 text-sm text-ink-800">
                <input type="checkbox" className="mt-1" checked={!!f.clearance} onChange={(e) => set('clearance', e.target.checked)} data-testid="product-mark-clearance" />
                <span>
                  <span className="font-medium">Mark as Clearance</span>
                  <span className="block text-xs text-ink-500">Shows a Clearance badge and lists the product in the homepage Clearance section until the end date or stock left runs out.</span>
                </span>
              </label>
              {!!f.clearance && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-ink-600">Clearance price ({f.baseCurrency})
                    <input className="input mt-1" inputMode="decimal" placeholder="Optional sale price" value={f.clearancePrice} onChange={(e) => set('clearancePrice', e.target.value)} data-testid="product-clearance-price" />
                  </label>
                  <label className="text-xs text-ink-600">Discount %
                    <input className="input mt-1" inputMode="decimal" placeholder="Optional, e.g. 20" value={f.clearanceDiscountPct} onChange={(e) => set('clearanceDiscountPct', e.target.value)} data-testid="product-clearance-discount" />
                  </label>
                  <label className="text-xs text-ink-600">End date
                    <input className="input mt-1" type="date" value={f.clearanceEndsAt} onChange={(e) => set('clearanceEndsAt', e.target.value)} data-testid="product-clearance-ends" />
                  </label>
                  <label className="text-xs text-ink-600">Stock left
                    <input className="input mt-1" inputMode="numeric" placeholder="Optional quantity" value={f.clearanceStockLeft} onChange={(e) => set('clearanceStockLeft', e.target.value)} data-testid="product-clearance-stock" />
                  </label>
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Variations (colour, size, capacity)</h3>
            <p className="mb-2 text-xs text-ink-500">Each variation has options. Add a hex colour (e.g. #1f3a5f) to show a swatch.</p>
            <div className="space-y-3" data-testid="product-variations-editor">
              {variations.map((v, i) => (
                <div key={i} className="rounded-xl border border-ink-100 p-3">
                  <input className="input mb-2" placeholder="Variation name (e.g. Colour)" value={v.name} onChange={(e) => setVariations((xs) => {
                    const next = xs.map((x, j) => j === i ? { ...x, name: e.target.value } : x);
                    if (i === next.length - 1 && e.target.value) next.push({ name: '', options: [{ label: '', hex: '' }] });
                    return next;
                  })} />
                  {v.options.map((o, k) => (
                    <div key={k} className="mb-1 grid grid-cols-[1fr_8rem] gap-2">
                      <input className="input" placeholder="Option (e.g. Black)" value={o.label} onChange={(e) => setVariations((xs) => xs.map((x, j) => {
                        if (j !== i) return x;
                        const options = x.options.map((op, n) => n === k ? { ...op, label: e.target.value } : op);
                        if (k === options.length - 1 && e.target.value) options.push({ label: '', hex: '' });
                        return { ...x, options };
                      }))} />
                      <input className="input" placeholder="#hex" value={o.hex} onChange={(e) => setVariations((xs) => xs.map((x, j) => j === i ? { ...x, options: x.options.map((op, n) => n === k ? { ...op, hex: e.target.value } : op) } : x))} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Industry-specific attributes</h3>
            <AttrRows testId="product-industry-attributes" rows={industryAttrs} setRows={setIndustryAttrs} keyPh="Attribute (e.g. Material)" />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Other attributes</h3>
            <AttrRows testId="product-other-attributes" rows={otherAttrs} setRows={setOtherAttrs} keyPh="Attribute (e.g. Origin)" />
            <p className="mt-2 text-xs text-ink-500">Legacy key attributes still save if the grouped lists above are empty.</p>
            <div className="mt-2 space-y-2" data-testid="product-attributes">
              {attrs.map((a, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="Attribute (e.g. Material)" value={a.key} onChange={(e) => setAttrs((xs) => xs.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
                  <input className="input" placeholder="Value" value={a.value} onChange={(e) => setAttrs((xs) => {
                    const next = xs.map((x, j) => j === i ? { ...x, value: e.target.value } : x);
                    if (i === next.length - 1 && (e.target.value || a.key)) next.push({ key: '', value: '' });
                    return next;
                  })} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Customization options</h3>
            <div className="space-y-2" data-testid="product-customizations-editor">
              {customizations.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_6rem_1fr] gap-2">
                  <input className="input" placeholder="Option (logo, packaging, graphic)" value={c.label} onChange={(e) => setCustomizations((xs) => {
                    const next = xs.map((x, j) => j === i ? { ...x, label: e.target.value } : x);
                    if (i === next.length - 1 && e.target.value) next.push({ label: '', moq: '', note: '' });
                    return next;
                  })} />
                  <input className="input" placeholder="Min qty" value={c.moq} onChange={(e) => setCustomizations((xs) => xs.map((x, j) => j === i ? { ...x, moq: e.target.value } : x))} />
                  <input className="input" placeholder="Note" value={c.note} onChange={(e) => setCustomizations((xs) => xs.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
                </div>
              ))}
            </div>
            <label className="mt-3 block text-sm">Customization notes<textarea className="input mt-1 min-h-[80px]" value={f.customization} onChange={(e) => set('customization', e.target.value)} /></label>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Sample price</h3>
            <div className="grid grid-cols-3 gap-2" data-testid="product-sample-price">
              <input className="input" placeholder="Sample price" value={sampleAmount} onChange={(e) => setSampleAmount(e.target.value)} />
              <select className="input" value={sampleCurrency} onChange={(e) => setSampleCurrency(e.target.value as 'USD' | 'CNY' | 'INR')}>
                {['USD', 'CNY', 'INR'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="input" placeholder="Sample lead time" value={sampleLead} onChange={(e) => setSampleLead(e.target.value)} />
            </div>
            <label className="mt-3 block text-sm">Sample policy<textarea className="input mt-1 min-h-[80px]" value={f.samplePolicy} onChange={(e) => set('samplePolicy', e.target.value)} /></label>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Lead time by quantity</h3>
            <div className="space-y-2" data-testid="product-lead-times">
              {leadTimes.map((row, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <input className="input" placeholder="Min qty" value={row.minQty} onChange={(e) => setLeadTimes((xs) => {
                    const next = xs.map((x, j) => j === i ? { ...x, minQty: e.target.value } : x);
                    if (i === next.length - 1 && e.target.value) next.push({ minQty: '', maxQty: '', time: '' });
                    return next;
                  })} />
                  <input className="input" placeholder="Max qty" value={row.maxQty} onChange={(e) => setLeadTimes((xs) => xs.map((x, j) => j === i ? { ...x, maxQty: e.target.value } : x))} />
                  <input className="input" placeholder="Time (e.g. 15 days)" value={row.time} onChange={(e) => setLeadTimes((xs) => xs.map((x, j) => j === i ? { ...x, time: e.target.value } : x))} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Shipping and delivery estimate</h3>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="product-shipping">
              <input className="input" placeholder="Ships from (e.g. Ningbo, China)" value={shipOrigin} onChange={(e) => setShipOrigin(e.target.value)} />
              <input className="input" placeholder="Typical transit (e.g. 18–25 days by sea to India)" value={shipEstimate} onChange={(e) => setShipEstimate(e.target.value)} />
              <textarea className="input min-h-[80px] sm:col-span-2" placeholder="Shipping note (no live rate is calculated on the product page)" value={shipNote} onChange={(e) => setShipNote(e.target.value)} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Packaging & delivery</h3>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="product-packing">
              <input className="input" placeholder="Selling units (e.g. Single item)" value={sellingUnits} onChange={(e) => setSellingUnits(e.target.value)} />
              <input className="input" placeholder="Single package size (e.g. 8 × 8 × 25 cm)" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
              <input className="input" placeholder="Single gross weight (e.g. 0.35 kg)" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} />
              <input className="input" placeholder="Package type" value={packageType} onChange={(e) => setPackageType(e.target.value)} />
            </div>
            <label className="mt-3 block text-sm">Packaging notes<textarea className="input mt-1 min-h-[80px]" value={f.packaging} onChange={(e) => set('packaging', e.target.value)} /></label>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Product description</h3>
            <textarea className="input min-h-[140px]" placeholder="Long product description (shown with product photos)" value={longDescription} onChange={(e) => setLongDescription(e.target.value)} data-testid="product-long-description" />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Source Easy protections</h3>
            <p className="mb-2 text-xs text-ink-500">Leave blank to use the standard Source Easy guarantees. Do not enter Alibaba Trade Assurance wording.</p>
            <div className="space-y-2" data-testid="product-protections">
              {protections.map((row, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-2">
                  <input className="input" placeholder="Title" value={row.title} onChange={(e) => setProtections((xs) => {
                    const next = xs.map((x, j) => j === i ? { ...x, title: e.target.value } : x);
                    if (i === next.length - 1 && e.target.value) next.push({ title: '', text: '' });
                    return next;
                  })} />
                  <input className="input" placeholder="Details" value={row.text} onChange={(e) => setProtections((xs) => xs.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Reviews note</h3>
            <input className="input" placeholder="Optional reviews placeholder (leave blank for the default message)" value={reviewsNote} onChange={(e) => setReviewsNote(e.target.value)} />
          </section>

          {canLink && (
            <section data-testid="product-supplier">
              <h3 className="mb-2 text-sm font-semibold text-ink-700">Linked supplier</h3>
              <p className="mb-2 text-xs text-ink-500">Company, location, years and verified status are shown on the product page only to paid members, and only if the supplier has consented. Factory cost is never shown.</p>
              <select className="input" value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)} data-testid="product-supplier-select">
                <option value="">No supplier linked</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.catalogConsent ? ' · consented' : ''}{s.city || s.publicRegion ? ` · ${s.city || s.publicRegion}` : ''}</option>)}
              </select>
              {linkedSupplier && <SupplierDetails s={linkedSupplier} />}
              <div className="mt-3 grid gap-2 rounded-xl border border-ink-100 p-3 sm:grid-cols-2">
                <input className="input" placeholder="New supplier company" value={newSup.name} onChange={(e) => setNewSup((x) => ({ ...x, name: e.target.value }))} />
                <input className="input" placeholder="Public location" value={newSup.publicRegion} onChange={(e) => setNewSup((x) => ({ ...x, publicRegion: e.target.value }))} />
                <input className="input" placeholder="Years in business" value={newSup.publicYears} onChange={(e) => setNewSup((x) => ({ ...x, publicYears: e.target.value }))} />
                <input className="input" placeholder="Public about" value={newSup.publicAbout} onChange={(e) => setNewSup((x) => ({ ...x, publicAbout: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={newSup.catalogConsent} onChange={(e) => setNewSup((x) => ({ ...x, catalogConsent: e.target.checked }))} /> Catalog consent</label>
                <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={newSup.publicVerified} onChange={(e) => setNewSup((x) => ({ ...x, publicVerified: e.target.checked }))} /> Verified</label>
                <button type="button" className="btn-outline sm:col-span-2" onClick={() => void addSupplier()}>Add and link supplier</button>
              </div>
            </section>
          )}

          {product?.id && !product.id.startsWith('local-') && <ImageManager productId={product.id} images={product.images ?? []} />}
          <PhotoDrafts
            photos={photos}
            setPhotos={setPhotos}
            error={photoErr}
            setError={setPhotoErr}
            already={(product?.images ?? []).length}
          />
        </div>
        {formErr && <p className="mt-4 text-sm text-red-600" data-testid="product-publish-error">{formErr}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} data-testid="product-save">{busy ? 'Saving…' : 'Save'}</button>
          {canPublish && product && product.status !== 'PUBLISHED' && product.status !== 'DELETED' && (
            <button type="button" className="btn-primary" disabled={busy} data-testid="product-publish"
              onClick={(e) => submit(e, { publish: true })}>{busy ? 'Publishing…' : 'Save and publish'}</button>
          )}
        </div>
      </form>
    </div>
  );
}


function AttrRows({ rows, setRows, keyPh, testId }: { rows: { key: string; value: string }[]; setRows: Dispatch<SetStateAction<{ key: string; value: string }[]>>; keyPh: string; testId: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      {rows.map((a, i) => (
        <div key={i} className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={keyPh} value={a.key} onChange={(e) => setRows((xs) => {
            const next = xs.map((x, j) => j === i ? { ...x, key: e.target.value } : x);
            if (i === next.length - 1 && e.target.value) next.push({ key: '', value: '' });
            return next;
          })} />
          <input className="input" placeholder="Value" value={a.value} onChange={(e) => setRows((xs) => xs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
        </div>
      ))}
    </div>
  );
}

function PhotoDrafts({ photos, setPhotos, error, setError, already }: {
  photos: PhotoDraft[]; setPhotos: Dispatch<SetStateAction<PhotoDraft[]>>;
  error: string | null; setError: (s: string | null) => void; already: number;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { photos.forEach((p) => URL.revokeObjectURL(p.url)); }, []); // eslint-disable-line
  const room = Math.max(0, PHOTO_MAX - already - photos.length);
  const add = (list: File[]) => {
    const next: PhotoDraft[] = [];
    let err: string | null = null;
    for (const file of list) {
      const why = checkPhoto(file);
      if (why) { err = why; continue; }
      if (already + photos.length + next.length >= PHOTO_MAX) { err = `Up to ${PHOTO_MAX} photos per product.`; break; }
      next.push({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, url: URL.createObjectURL(file), cover: false });
    }
    setError(err);
    if (!next.length) return;
    setPhotos((xs) => {
      const merged = [...xs, ...next];
      if (!merged.some((x) => x.cover) && already === 0) merged[0] = { ...merged[0], cover: true };
      return merged;
    });
  };
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= photos.length) return;
    const next = photos.slice(); const [it] = next.splice(i, 1); next.splice(j, 0, it);
    setPhotos(next);
  };
  const cover = (key: string) => setPhotos((xs) => xs.map((x) => ({ ...x, cover: x.key === key })));
  const remove = (key: string) => setPhotos((xs) => {
    const hit = xs.find((x) => x.key === key);
    if (hit) URL.revokeObjectURL(hit.url);
    const next = xs.filter((x) => x.key !== key);
    if (already === 0 && next.length && !next.some((x) => x.cover)) next[0] = { ...next[0], cover: true };
    return next;
  });
  return (
    <div data-testid="product-photo-drafts">
      <p className="text-sm font-medium text-ink-700">Photos</p>
      <p className="mt-1 text-xs text-ink-500">JPEG, PNG or WebP, up to 10 MB each. You can add up to {PHOTO_MAX} photos. The first photo, or the one you mark as cover, is the main image. They upload when you save.</p>
      <div
        className={`mt-2 rounded-2xl border-2 border-dashed p-4 text-center ${over ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-ink-50/60'}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
        data-testid="photo-dropzone"
      >
        <p className="text-sm text-ink-600">Drag and drop photos here, or</p>
        <button type="button" className="btn-outline mt-2" onClick={() => inputRef.current?.click()} data-testid="photo-add">Choose photos</button>
        <input ref={inputRef} className="hidden" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        {room === 0 && <p className="mt-2 text-xs text-ink-500">This product already has the maximum of {PHOTO_MAX} photos.</p>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="photo-draft-grid">
          {photos.map((im, i) => (
            <div key={im.key} className={`overflow-hidden rounded-xl border ${im.cover ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-200'}`}>
              <img src={im.url} alt="" className="aspect-square w-full object-cover" />
              <div className="flex flex-wrap gap-1 p-1 text-[10px]">
                <button type="button" className="btn-outline !px-1.5 !py-0.5" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="btn-outline !px-1.5 !py-0.5" onClick={() => move(i, 1)} disabled={i === photos.length - 1}>↓</button>
                <button type="button" className="btn-outline !px-1.5 !py-0.5" onClick={() => cover(im.key)}>{im.cover ? 'Cover' : 'Set cover'}</button>
                <button type="button" className="btn-outline !px-1.5 !py-0.5 text-red-600" onClick={() => remove(im.key)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageManager({ productId, images }: { productId: string; images: StaffProduct['images'] }) {
  const [rows, setRows] = useState(images);
  const [src, setSrc] = useState<Record<string, string>>({});
  useEffect(() => { setRows(images); }, [images]);
  useEffect(() => {
    let on = true;
    const token = sessionStorage.getItem('se.jwt');
    const load = async () => {
      const next: Record<string, string> = {};
      for (const im of images) {
        if (im.url.startsWith('data:') || im.url.startsWith('blob:')) { next[im.id] = im.cardUrl || im.url; continue; }
        try {
          const r = await fetch(im.cardUrl || im.url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
          if (r.ok) next[im.id] = URL.createObjectURL(await r.blob());
        } catch { /* preview optional */ }
      }
      if (on) setSrc(next);
    };
    void load();
    return () => { on = false; Object.values(src).forEach((u) => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); }); };
  }, [images]); // eslint-disable-line
  const persist = async (order: typeof rows, cover?: string) => {
    const r = await staffReq<{ data: typeof rows }>('PATCH', `/api/products/${productId}/images`, { order: order.map((x) => x.id), cover: cover ?? order.find((x) => x.cover)?.id ?? order[0]?.id });
    setRows(r.data);
  };
  const move = async (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= rows.length) return;
    const next = rows.slice(); const [it] = next.splice(i, 1); next.splice(j, 0, it);
    setRows(next);
    await persist(next);
  };
  const cover = async (id: string) => { await persist(rows, id); };
  const remove = async (id: string) => {
    if (!confirm('Delete this photo?')) return;
    await staffReq('DELETE', `/api/products/${productId}/images/${id}`);
    setRows((xs) => xs.filter((x) => x.id !== id));
  };
  if (!rows.length) return <p className="text-sm text-ink-500">No photos yet. Add some below.</p>;
  return (
    <div data-testid="product-images">
      <p className="mb-2 text-sm font-medium text-ink-700">Photos</p>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((im, i) => (
          <div key={im.id} className={`overflow-hidden rounded-xl border ${im.cover ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-200'}`}>
            <img src={src[im.id] || im.cardUrl || im.url} alt={im.altText || ''} className="aspect-square w-full object-cover" />
            <div className="flex flex-wrap gap-1 p-1 text-[10px]">
              <button type="button" className="btn-outline !px-1.5 !py-0.5" onClick={() => void move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="btn-outline !px-1.5 !py-0.5" onClick={() => void move(i, 1)} disabled={i === rows.length - 1}>↓</button>
              <button type="button" className="btn-outline !px-1.5 !py-0.5" onClick={() => void cover(im.id)}>{im.cover ? 'Cover' : 'Set cover'}</button>
              <button type="button" className="btn-outline !px-1.5 !py-0.5 text-red-600" onClick={() => void remove(im.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
