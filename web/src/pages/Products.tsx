import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../lib/store';
import { PageHeader } from '../components/ui';
import { staffReq } from '../catalog/api';
import { FIXTURE_PRODUCTS } from '../catalog/fixtures';
import type { Product } from '../catalog/types';

type StaffProduct = Product & { status?: string; deletedAt?: string | null };

export function Products() {
  const { session, perms } = useApp();
  const demo = !!session?.demo;
  const canPrice = perms.can('catalog.price') || session?.role === 'SUPER_ADMIN';
  const canPublish = perms.can('catalog.publish') || session?.role === 'SUPER_ADMIN';
  const canDelete = perms.can('catalog.delete') || session?.role === 'SUPER_ADMIN';
  const isSa = session?.role === 'SUPER_ADMIN';
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
          {['DRAFT', 'READY_FOR_PRICE', 'PUBLISHED', 'UNPUBLISHED', 'DELETED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-primary ml-auto" onClick={() => setEdit('new')}>Add product</button>
      </div>
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
                    <button className="btn-outline !py-1 text-xs" onClick={() => setEdit(p)}>Edit</button>
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
      {edit && <ProductEditor product={edit === 'new' ? null : edit} canPrice={canPrice} busy={busy}
        onClose={() => setEdit(null)}
        onSave={async (body, file) => {
          setBusy(true); setErr(null);
          try {
            if (demo) {
              if (edit === 'new') setRows((xs) => [{ id: `local-${Date.now()}`, slug: body.title.toLowerCase().replace(/\s+/g, '-'), title: body.title, summary: body.summary, moq: body.moq, unit: body.unit, status: 'DRAFT', images: [], price: { mode: 'GET_QUOTE', base: 'USD', amounts: null }, isSample: true }, ...xs]);
              else setRows((xs) => xs.map((x) => x.id === (edit as StaffProduct).id ? { ...x, ...body } : x));
            } else {
              const saved = edit === 'new'
                ? (await staffReq<{ data: StaffProduct }>('POST', '/api/products', body)).data
                : (await staffReq<{ data: StaffProduct }>('PATCH', `/api/products/${(edit as StaffProduct).id}`, body)).data;
              if (file) {
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

function ProductEditor({ product, canPrice, busy, onClose, onSave }: {
  product: StaffProduct | null; canPrice: boolean; busy: boolean; onClose: () => void;
  onSave: (body: any, file?: File) => Promise<void>;
}) {
  const [f, setF] = useState({
    title: product?.title ?? '', summary: product?.summary ?? '', moq: product?.moq != null ? String(product.moq) : '',
    unit: product?.unit ?? 'pcs', leadTime: product?.leadTime ?? '', priceMode: product?.priceMode ?? product?.price?.mode ?? 'GET_QUOTE',
    priceMin: product?.priceMin != null ? String(product.priceMin) : '', priceMax: product?.priceMax != null ? String(product.priceMax) : '',
    baseCurrency: product?.baseCurrency ?? 'USD',
  });
  const [file, setFile] = useState<File | undefined>();
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave({
      title: f.title, summary: f.summary, moq: f.moq ? Number(f.moq) : null, unit: f.unit, leadTime: f.leadTime,
      ...(canPrice ? { priceMode: f.priceMode, priceMin: f.priceMin ? Number(f.priceMin) : null, priceMax: f.priceMax ? Number(f.priceMax) : null, baseCurrency: f.baseCurrency } : {}),
    }, file);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4" onClick={onClose}>
      <form data-testid="product-editor" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-lift dark:bg-ink-900" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-white">{product ? 'Edit product' : 'Add product'}</h2>
        <div className="mt-4 space-y-3">
          <input className="input" required placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="product-title" />
          <textarea className="input min-h-[80px]" placeholder="Summary" value={f.summary} onChange={(e) => set('summary', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" type="number" min="0" placeholder="MOQ" value={f.moq} onChange={(e) => set('moq', e.target.value)} />
            <input className="input" placeholder="Unit" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          </div>
          <input className="input" placeholder="Lead time" value={f.leadTime} onChange={(e) => set('leadTime', e.target.value)} />
          {canPrice && (
            <div className="grid grid-cols-3 gap-3">
              <select className="input" value={f.priceMode} onChange={(e) => set('priceMode', e.target.value)}>
                <option value="GET_QUOTE">Get quote</option>
                <option value="RANGE">Price range</option>
              </select>
              <input className="input" placeholder="Min price" value={f.priceMin} onChange={(e) => set('priceMin', e.target.value)} />
              <input className="input" placeholder="Max price" value={f.priceMax} onChange={(e) => set('priceMax', e.target.value)} />
            </div>
          )}
          <input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0])} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} data-testid="product-save">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
