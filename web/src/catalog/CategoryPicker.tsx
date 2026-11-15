import { useMemo, useState, type FormEvent } from 'react';
import { staffReq } from './api';
import type { Category } from './types';
import { childrenOf, topLevel } from './tree';

function pathLabel(all: Category[], c: Category): string {
  const parts = [c.name];
  let parentId = c.parentId;
  const seen = new Set<string>([c.id]);
  while (parentId) {
    const p = all.find((x) => x.id === parentId);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    parts.unshift(p.name);
    parentId = p.parentId;
  }
  return parts.join(' / ');
}

function ancestors(all: Category[], id: string | null): string[] {
  if (!id) return [];
  const start = all.find((c) => c.id === id);
  if (!start) return [];
  const chain = [start.id];
  let parentId = start.parentId;
  const seen = new Set<string>([start.id]);
  while (parentId) {
    const p = all.find((x) => x.id === parentId);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    chain.unshift(p.id);
    parentId = p.parentId;
  }
  return chain;
}

export function CategoryPicker({
  categories, value, extraIds, onChange, onExtrasChange, onCategoriesChange, canCreate,
}: {
  categories: Category[];
  value: string;
  extraIds: string[];
  onChange: (id: string) => void;
  onExtrasChange: (ids: string[]) => void;
  onCategoriesChange: (rows: Category[]) => void;
  canCreate: boolean;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [addingAt, setAddingAt] = useState<string | 'root' | null>(null);
  const [newName, setNewName] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const chain = useMemo(() => ancestors(categories, value || null), [categories, value]);

  const create = async (parentId: string | null, e?: FormEvent) => {
    e?.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    try {
      const r = await staffReq<{ data: Category }>('POST', '/api/catalog/categories', { name, parentId });
      const rows = (await staffReq<{ data: Category[] }>('GET', '/api/catalog/categories')).data;
      onCategoriesChange(rows);
      setNewName('');
      setAddingAt(null);
      if (!parentId || chain.includes(parentId) || parentId === value) onChange(r.data.id);
    } catch (err) { setErr((err as Error).message); }
  };

  const levels: { parentId: string | null; selected: string; options: Category[] }[] = [];
  const roots = topLevel(categories);
  levels.push({ parentId: null, selected: chain[0] ?? '', options: roots });
  for (let i = 0; i < chain.length; i++) {
    const kids = childrenOf(categories, chain[i]).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (kids.length || canCreate) levels.push({ parentId: chain[i], selected: chain[i + 1] ?? '', options: kids });
  }

  const extras = extraIds.map((id) => categories.find((c) => c.id === id)).filter((c): c is Category => !!c);
  const addExtra = (id: string) => {
    if (!id || id === value || extraIds.includes(id)) return;
    onExtrasChange([...extraIds, id]);
    setExtraOpen(false);
  };

  return (
    <div className="space-y-3" data-testid="category-picker">
      <div>
        <p className="mb-1 text-xs font-medium text-ink-600">Primary category (breadcrumb)</p>
        <div className="flex flex-wrap items-end gap-2">
          {levels.map((lvl, i) => (
            <div key={i} className="min-w-[10rem] flex-1">
              <select className="input" value={lvl.selected} data-testid={i === 0 ? 'product-category' : `product-category-l${i}`}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id === '__new__') { setAddingAt(lvl.parentId ?? 'root'); setNewName(''); return; }
                  onChange(id);
                }}>
                <option value="">{lvl.parentId ? 'Select a subcategory' : 'Select a category'}</option>
                {lvl.options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                {canCreate && <option value="__new__">{lvl.parentId ? '+ New subcategory' : '+ New category'}</option>}
              </select>
            </div>
          ))}
        </div>
        {addingAt != null && canCreate && (
          <div className="mt-2 flex flex-wrap gap-2" data-testid="new-category-form">
            <input className="input flex-1" autoFocus placeholder="Category name" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(addingAt === 'root' ? null : addingAt); } }}
              data-testid="new-category-name" />
            <button className="btn-primary" type="button" onClick={() => void create(addingAt === 'root' ? null : addingAt)}>Add</button>
            <button className="btn-outline" type="button" onClick={() => setAddingAt(null)}>Cancel</button>
          </div>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-ink-600">Also show in these categories</p>
        <div className="flex flex-wrap gap-2">
          {extras.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-800">
              {pathLabel(categories, c)}
              <button type="button" className="text-ink-500 hover:text-red-600" onClick={() => onExtrasChange(extraIds.filter((id) => id !== c.id))} aria-label="Remove">×</button>
            </span>
          ))}
        </div>
        {extraOpen ? (
          <select className="input mt-2" defaultValue="" onChange={(e) => addExtra(e.target.value)} data-testid="extra-category">
            <option value="">Select a category</option>
            {categories.filter((c) => c.id !== value && !extraIds.includes(c.id)).map((c) => (
              <option key={c.id} value={c.id}>{pathLabel(categories, c)}</option>
            ))}
          </select>
        ) : (
          <button type="button" className="btn-outline mt-2 !py-1 text-xs" onClick={() => setExtraOpen(true)} data-testid="add-extra-category">Add another category</button>
        )}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
