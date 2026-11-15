import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useApp } from '../lib/store';
import { PageHeader } from '../components/ui';
import { staffReq } from '../catalog/api';
import { FIXTURE_PRODUCTS } from '../catalog/fixtures';
import type { Category, Merchandising, Product } from '../catalog/types';
import { optionLabel, topLevel, childrenOf } from '../catalog/tree';

type StaffProduct = Product & { status?: string; deletedAt?: string | null };

export function Products() {
  const { session, perms } = useApp();
  const demo = !!session?.demo;
  const canPrice = perms.can('catalog.price') || session?.role === 'SUPER_ADMIN';
  const canPublish = perms.can('catalog.publish') || session?.role === 'SUPER_ADMIN';
  const canDelete = perms.can('catalog.delete') || session?.role === 'SUPER_ADMIN';
  const isSa = session?.role === 'SUPER_ADMIN';
  const canLink = session?.role === 'SUPER_ADMIN' || session?.role === 'MARKETPLACE_TEAM' || !!session?.role?.startsWith('CHINA');
  const isSupplier = session?.role === 'SUPPLIER';
  const [rows, setRows] = useState<StaffProduct[]>(demo ? FIXTURE_PRODUCTS.map((p) => ({ ...p, status: 'PUBLISHED' })) : []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<StaffProduct | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (demo) return;
    const r = await staffReq<{ data: StaffProduct[] }>('GET', `/api/products?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}${isSa ? '&deleted=1' : ''}`);
    setRows(r.data);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, [q, status, demo]); // eslint-disable-line

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
    if (demo) { setRows((xs) => xs.map((x) => x.id === p.id ? { ...x, status: on ? 'PUBLISHED' : 'UNPUBLISHED' } : x)); return; }
    await staffReq('POST', `/api/products/${p.id}/${on ? 'publish' : 'unpublish'}`, {});
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
        <button className="btn-primary ml-auto" onClick={() => setEdit('new')}>Add product</button>
      </div>
      {!demo && !isSupplier && <CategoryManager />}
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
                  <div className="text-xs text-ink-500">{p.category?.name || p.categoryName}{p.isSample ? ' · Sample' : ''}</div>
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
      {edit && <ProductEditor product={edit === 'new' ? null : edit} canPrice={canPrice} canLink={canLink} busy={busy}
        onClose={() => setEdit(null)}
        onSave={async (body, files) => {
          setBusy(true); setErr(null);
          try {
            if (demo) {
              if (edit === 'new') setRows((xs) => [{ id: `local-${Date.now()}`, slug: body.title.toLowerCase().replace(/\s+/g, '-'), title: body.title, summary: body.summary, moq: body.moq, unit: body.unit, status: 'DRAFT', images: [], price: { mode: 'GET_QUOTE', base: 'USD', amounts: null }, isSample: true }, ...xs]);
              else setRows((xs) => xs.map((x) => x.id === (edit as StaffProduct).id ? { ...x, ...body } : x));
            } else {
              const saved = edit === 'new'
                ? (await staffReq<{ data: StaffProduct }>('POST', '/api/products', body)).data
                : (await staffReq<{ data: StaffProduct }>('PATCH', `/api/products/${(edit as StaffProduct).id}`, body)).data;
              for (const file of files) {
                const fd = new FormData(); fd.append('file', file);
                await staffReq('POST', `/api/products/${saved.id}/images`, fd);
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

function ProductEditor({ product, canPrice, canLink, busy, onClose, onSave }: {
  product: StaffProduct | null; canPrice: boolean; canLink: boolean; busy: boolean; onClose: () => void;
  onSave: (body: any, files: File[]) => Promise<void>;
}) {
  const specsObj = product?.specs && typeof product.specs === 'object' ? product.specs : {};
  const [f, setF] = useState({
    title: product?.title ?? '', summary: product?.summary ?? '', moq: product?.moq != null ? String(product.moq) : '',
    unit: product?.unit ?? 'pcs', leadTime: product?.leadTime ?? '', capacity: product?.capacity ?? '',
    packaging: product?.packaging ?? '', customization: product?.customization ?? '', samplePolicy: product?.samplePolicy ?? '',
    priceMode: product?.priceMode ?? product?.price?.mode ?? 'GET_QUOTE',
    priceMin: product?.priceMin != null ? String(product.priceMin) : '', priceMax: product?.priceMax != null ? String(product.priceMax) : '',
    baseCurrency: product?.baseCurrency ?? 'USD',
    categoryId: product?.categoryId ?? product?.category?.id ?? '',
    supplierId: product?.supplierId ?? product?.catalogSupplier?.id ?? '',
    tags: Array.isArray(product?.tags) ? product!.tags.join(', ') : '',
  });
  const [attrs, setAttrs] = useState<{ key: string; value: string }[]>(
    Object.entries(specsObj).map(([key, value]) => ({ key, value: String(value ?? '') })).concat([{ key: '', value: '' }]),
  );
  const [tiers, setTiers] = useState<{ minQty: string; maxQty: string; unitPrice: string }[]>(
    (product?.tiers ?? []).map((t) => ({ minQty: String(t.minQty ?? ''), maxQty: t.maxQty != null ? String(t.maxQty) : '', unitPrice: String(t.amounts?.USD ?? t.amounts?.[product?.baseCurrency ?? 'USD'] ?? '') }))
      .concat([{ minQty: '', maxQty: '', unitPrice: '' }]),
  );
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
  const [files, setFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; catalogConsent?: boolean; publicRegion?: string | null; publicYears?: number | null; publicVerified?: boolean }[]>([]);
  const [newSup, setNewSup] = useState({ name: '', publicRegion: '', publicYears: '', publicAbout: '', catalogConsent: false, publicVerified: false });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    void staffReq<{ data: Category[] }>('GET', '/api/catalog/categories').then((r) => setCategories(r.data)).catch(() => setCategories([]));
    if (canLink) void staffReq<{ data: typeof suppliers }>('GET', '/api/catalog/suppliers').then((r) => setSuppliers(r.data)).catch(() => setSuppliers([]));
  }, [canLink]);
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const specs = attrs.filter((a) => a.key.trim() && a.value.trim()).map((a) => ({ key: a.key.trim(), value: a.value.trim() }));
    const pricedTiers = tiers.filter((t) => t.unitPrice.trim()).map((t) => ({
      minQty: t.minQty ? Number(t.minQty) : 1, maxQty: t.maxQty ? Number(t.maxQty) : null, unitPrice: Number(t.unitPrice),
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
      categoryId: f.categoryId || null, tags: f.tags, specs: allAttrs.length ? allAttrs : specs, merchandising,
      ...(canPrice ? {
        priceMode: f.priceMode, priceMin: f.priceMin ? Number(f.priceMin) : null, priceMax: f.priceMax ? Number(f.priceMax) : null,
        baseCurrency: f.baseCurrency, tiers: f.priceMode === 'TIERS' ? pricedTiers : [],
      } : {}),
      ...(canLink ? { supplierId: f.supplierId || null } : {}),
    }, files);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4" onClick={onClose}>
      <form data-testid="product-editor" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lift dark:bg-ink-900" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-white">{product ? 'Edit product' : 'Add product'}</h2>
        <div className="mt-4 space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Basic details</h3>
            <div className="space-y-3">
              <input className="input" required placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="product-title" />
              <textarea className="input min-h-[80px]" placeholder="Description / summary" value={f.summary} onChange={(e) => set('summary', e.target.value)} />
              <select className="input" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} data-testid="product-category">
                <option value="">Select a category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{optionLabel(categories, c)}</option>)}
              </select>
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
              <div className="grid grid-cols-3 gap-3">
                <select className="input" value={f.priceMode} onChange={(e) => set('priceMode', e.target.value)} data-testid="product-price-mode">
                  <option value="GET_QUOTE">Get quote</option>
                  <option value="RANGE">Price range</option>
                  <option value="TIERS">Price tiers</option>
                </select>
                <select className="input" value={f.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}>
                  {['USD', 'CNY', 'INR'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {f.priceMode === 'RANGE' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input className="input" placeholder="Min price" value={f.priceMin} onChange={(e) => set('priceMin', e.target.value)} />
                  <input className="input" placeholder="Max price" value={f.priceMax} onChange={(e) => set('priceMax', e.target.value)} />
                </div>
              )}
              {f.priceMode === 'TIERS' && (
                <div className="mt-3 space-y-2" data-testid="product-tiers">
                  {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2">
                      <input className="input" placeholder="Min qty" value={t.minQty} onChange={(e) => setTiers((xs) => xs.map((x, j) => j === i ? { ...x, minQty: e.target.value } : x))} />
                      <input className="input" placeholder="Max qty" value={t.maxQty} onChange={(e) => setTiers((xs) => xs.map((x, j) => j === i ? { ...x, maxQty: e.target.value } : x))} />
                      <input className="input" placeholder={`Unit price (${f.baseCurrency})`} value={t.unitPrice} onChange={(e) => setTiers((xs) => {
                        const next = xs.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x);
                        if (i === next.length - 1 && e.target.value) next.push({ minQty: '', maxQty: '', unitPrice: '' });
                        return next;
                      })} />
                    </div>
                  ))}
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
              <select className="input" value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
                <option value="">No supplier linked</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.catalogConsent ? ' · consented' : ''}{s.publicRegion ? ` · ${s.publicRegion}` : ''}</option>)}
              </select>
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
          <div>
            <label className="text-sm font-medium text-ink-700">Add photos</label>
            <input className="input mt-1" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            {files.length > 0 && <p className="mt-1 text-xs text-ink-500">{files.length} new photo{files.length === 1 ? '' : 's'} will upload on save.</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} data-testid="product-save">{busy ? 'Saving…' : 'Save'}</button>
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

function CategoryManager() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = () => staffReq<{ data: Category[] }>('GET', '/api/catalog/categories').then((r) => setCategories(r.data)).catch((e) => setErr((e as Error).message));
  useEffect(() => { if (open) void load(); }, [open]); // eslint-disable-line
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await staffReq('POST', '/api/catalog/categories', { name, parentId: parentId || null });
      setName('');
      await load();
    } catch (e) { setErr((e as Error).message); }
  };
  if (!open) return <button type="button" className="btn-outline !py-1 text-xs" onClick={() => setOpen(true)}>Manage categories</button>;
  return (
    <div className="mb-4 rounded-2xl border border-ink-200 bg-white p-4" data-testid="category-manager">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-800">Categories</h3>
        <button type="button" className="text-sm text-ink-500" onClick={() => setOpen(false)}>Close</button>
      </div>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {topLevel(categories).map((c) => (
          <CategoryBranch key={c.id} cat={c} all={categories} depth={0} />
        ))}
      </ul>
      <form onSubmit={(e) => void add(e)} className="mt-3 flex flex-wrap gap-2">
        <input className="input flex-1" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select className="input w-auto" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Top level</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{optionLabel(categories, c)}</option>)}
        </select>
        <button className="btn-primary" type="submit">Add</button>
      </form>
    </div>
  );
}

function CategoryBranch({ cat, all, depth }: { cat: Category; all: Category[]; depth: number }) {
  const kids = childrenOf(all, cat.id);
  return (
    <li>
      <span style={{ paddingLeft: depth * 12 }} className="block text-ink-800">{cat.name}</span>
      {kids.length > 0 && <ul>{kids.map((k) => <CategoryBranch key={k.id} cat={k} all={all} depth={depth + 1} />)}</ul>}
    </li>
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
