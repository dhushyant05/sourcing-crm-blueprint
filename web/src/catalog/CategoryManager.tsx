import { useEffect, useState, type FormEvent } from 'react';
import { staffReq } from './api';
import type { Category } from './types';
import { childrenOf, optionLabel, topLevel } from './tree';

type Usage = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  parentId: string | null;
  children: number;
  descendants: number;
  primaryProducts: number;
  primaryProductsIncludingDeleted: number;
  extraProducts: number;
  banners: number;
  empty: boolean;
};

export function CategoryManager() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Category | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [moveTo, setMoveTo] = useState('');

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

  const openRemove = async (c: Category) => {
    setErr(null);
    setTarget(c);
    setMoveTo('');
    setUsage(null);
    try {
      const r = await staffReq<{ data: Usage }>('GET', `/api/catalog/categories/${c.id}/usage`);
      setUsage(r.data);
    } catch (e) { setErr((e as Error).message); }
  };

  const refreshUsage = async (id: string) => {
    const r = await staffReq<{ data: Usage }>('GET', `/api/catalog/categories/${id}/usage`);
    setUsage(r.data);
    return r.data;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const deactivate = () => target && run(async () => {
    await staffReq('PATCH', `/api/catalog/categories/${target.id}`, { active: false });
    await refreshUsage(target.id);
  });
  const activate = () => target && run(async () => {
    await staffReq('PATCH', `/api/catalog/categories/${target.id}`, { active: true });
    await refreshUsage(target.id);
  });
  const move = () => target && moveTo && run(async () => {
    await staffReq('POST', `/api/catalog/categories/${target.id}/reassign`, { categoryId: moveTo });
    await refreshUsage(target.id);
  });
  const clearExtras = () => target && run(async () => {
    await staffReq('POST', `/api/catalog/categories/${target.id}/clear-extras`);
    await refreshUsage(target.id);
  });
  const hardDelete = () => target && run(async () => {
    await staffReq('DELETE', `/api/catalog/categories/${target.id}`);
    setTarget(null);
    setUsage(null);
  });

  if (!open) return <button type="button" className="btn-outline !py-1 text-xs" onClick={() => setOpen(true)}>Manage categories</button>;
  return (
    <div className="mb-4 rounded-2xl border border-ink-200 bg-white p-4" data-testid="category-manager">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-800">Categories</h3>
        <button type="button" className="text-sm text-ink-500" onClick={() => setOpen(false)}>Close</button>
      </div>
      {err && <p className="mb-2 text-sm text-red-600" data-testid="category-manager-error">{err}</p>}
      <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
        {topLevel(categories).map((c) => (
          <CategoryBranch key={c.id} cat={c} all={categories} depth={0} onRemove={openRemove} />
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
      {target && usage && (
        <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-3" data-testid="category-remove-dialog">
          <p className="text-sm font-semibold text-ink-800">Remove “{usage.name}”?</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-700">
            <li>Used as the main category on {usage.primaryProducts} product{usage.primaryProducts === 1 ? '' : 's'}{usage.primaryProductsIncludingDeleted > usage.primaryProducts ? ` (${usage.primaryProductsIncludingDeleted} including deleted)` : ''}.</li>
            <li>Shown as an extra category on {usage.extraProducts} product{usage.extraProducts === 1 ? '' : 's'}.</li>
            <li>Has {usage.children} subcategor{usage.children === 1 ? 'y' : 'ies'}{usage.descendants > usage.children ? ` (${usage.descendants} including nested)` : ''}.</li>
            {usage.banners > 0 && <li>Linked from {usage.banners} banner{usage.banners === 1 ? '' : 's'}.</li>}
          </ul>
          {usage.empty ? (
            <p className="mt-2 text-sm text-ink-600">This category is empty and can be deleted permanently. This cannot be undone.</p>
          ) : (
            <p className="mt-2 text-sm text-ink-600">It cannot be deleted while products, subcategories or banners still use it. Deactivate it to hide it from the public catalog — products keep their breadcrumb — or move the products first.</p>
          )}
          {usage.primaryProductsIncludingDeleted > 0 && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-xs font-medium text-ink-600">Move products to
                <select className="input mt-1" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} data-testid="category-move-to">
                  <option value="">Select a category</option>
                  {categories.filter((c) => c.id !== target.id).map((c) => (
                    <option key={c.id} value={c.id}>{optionLabel(categories, c)}{c.active === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-outline" disabled={busy || !moveTo} onClick={() => void move()} data-testid="category-move">Move products</button>
            </div>
          )}
          {usage.extraProducts > 0 && (
            <button type="button" className="btn-outline mt-2 !py-1 text-xs" disabled={busy} onClick={() => void clearExtras()} data-testid="category-clear-extras">
              Remove this extra category from {usage.extraProducts} product{usage.extraProducts === 1 ? '' : 's'}
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {usage.active ? (
              <button type="button" className="btn-outline" disabled={busy} onClick={() => void deactivate()} data-testid="category-deactivate">Deactivate</button>
            ) : (
              <button type="button" className="btn-outline" disabled={busy} onClick={() => void activate()} data-testid="category-activate">Reactivate</button>
            )}
            <button type="button" className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy || !usage.empty} onClick={() => void hardDelete()} data-testid="category-delete">
              Delete permanently
            </button>
            <button type="button" className="btn-outline" disabled={busy} onClick={() => { setTarget(null); setUsage(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryBranch({ cat, all, depth, onRemove }: { cat: Category; all: Category[]; depth: number; onRemove: (c: Category) => void }) {
  const kids = childrenOf(all, cat.id);
  return (
    <li>
      <div className="flex items-center gap-2" style={{ paddingLeft: depth * 12 }}>
        <span className={cat.active === false ? 'text-ink-400' : 'text-ink-800'}>
          {cat.name}{cat.active === false ? ' (inactive)' : ''}
        </span>
        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onRemove(cat)} data-testid="category-remove">Remove</button>
      </div>
      {kids.length > 0 && <ul>{kids.map((k) => <CategoryBranch key={k.id} cat={k} all={all} depth={depth + 1} onRemove={onRemove} />)}</ul>}
    </li>
  );
}
