import { HardDrive, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { StorageItem, StoragePage } from '../lib/api';

const fmt = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`;
const PAGE = 25;

/** Super admin: managed uploads, largest first. Deleting is permanent and removes the file from every place listed. */
export function StorageCard() {
  const { t } = useTranslation(); const { api } = useApp();
  const [type, setType] = useState(''), [owner, setOwner] = useState(''), [q, setQ] = useState(''), [offset, setOffset] = useState(0);
  const [page, setPage] = useState<StoragePage | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [sel, setSel] = useState<Record<string, StorageItem>>({}), [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.storage!({ type, owner, q, offset: String(offset), limit: String(PAGE) }).then((p) => { setPage(p); setErr(null); }).catch((e) => setErr((e as Error).message)), [api, type, owner, q, offset]);
  useEffect(() => { void load(); }, [load]);
  const k = (f: StorageItem) => `${f.key}/${f.id}`;
  const open = (f: StorageItem) => void api.storageFileUrl!(f.key, f.id).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => setErr((e as Error).message));
  const remove = async (files: StorageItem[]) => {
    const ok = files.filter((f) => !f.blocked); if (!ok.length) return;
    const places = ok.reduce((n, f) => n + f.places.length, 0), bytes = ok.reduce((n, f) => n + f.size, 0);
    const where = [...new Set(ok.flatMap((f) => f.places.map((p) => t(`storage.place.${p.kind}`, { defaultValue: p.kind }))))].join(', ');
    if (!window.confirm(t('storage.confirm', { files: ok.length, size: fmt(bytes), places, where }))) return;
    const reason = window.prompt(t('storage.reason')) ?? undefined;
    setBusy(true); setMsg(null);
    try {
      const r = await api.storageDelete!(ok.map((f) => ({ key: f.key, id: f.id, size: f.size, places: f.places.length })), reason || undefined);
      const failed = r.results.filter((x) => !x.ok).length;
      setMsg(t('storage.done', { n: r.results.length - failed, size: fmt(r.freed) }) + (failed ? ` ${t('storage.failed', { n: failed })}` : ''));
      setSel({}); await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const selected = Object.values(sel);
  const d = page?.disk;
  return (
    <section className="card mt-6 p-6" data-testid="storage">
      <h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><HardDrive size={18} className="text-ink-400" />{t('storage.title')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('storage.hint')}</p>
      {d && <div className="mt-4" data-testid="storage-disk">
        <div className="h-2 overflow-hidden rounded-full bg-ink-100"><div className="h-full bg-brand-600" style={{ width: `${Math.min(100, (d.used / d.total) * 100)}%` }} /></div>
        <p className="mt-1 text-sm">{t('storage.disk', { used: fmt(d.used), total: fmt(d.total), free: fmt(d.free) })}</p>
        <p className="text-xs text-ink-400">{t('storage.diskNote')}</p></div>}
      {page && <p className="mt-2 text-sm" data-testid="storage-uploads">{t('storage.uploads', { files: page.uploads.files, size: fmt(page.uploads.bytes) })}{page.uploads.missing ? ` · ${t('storage.missing', { n: page.uploads.missing })}` : ''}</p>}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <select className="input !w-auto" value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }} aria-label={t('storage.type')}>
          <option value="">{t('storage.allTypes')}</option>{['image', 'video', 'document'].map((x) => <option key={x} value={x}>{t(`storage.t.${x}`)}</option>)}</select>
        <select className="input !w-auto" value={owner} onChange={(e) => { setOwner(e.target.value); setOffset(0); }} aria-label={t('storage.owner')}>
          <option value="">{t('storage.allOwners')}</option>{['LEAD', 'QUOTE', 'SHIPPING', 'GREETING'].map((x) => <option key={x} value={x}>{t(`storage.o.${x}`)}</option>)}</select>
        <input className="input !w-48" placeholder={t('storage.search')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <button disabled={busy || !selected.length} className="btn-outline !py-1 text-rose-600" onClick={() => void remove(selected)} data-testid="storage-bulk-delete"><Trash2 size={14} />{t('storage.deleteSelected', { n: selected.length })}</button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
      {msg && <p className="mt-2 text-sm text-accent-700" data-testid="storage-msg">{msg}</p>}
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-ink-500"><tr><th /><th>{t('storage.name')}</th><th>{t('storage.size')}</th><th>{t('storage.type')}</th><th>{t('storage.used')}</th><th>{t('storage.date')}</th><th /></tr></thead>
        <tbody>{page?.items.map((f) => <tr key={k(f)} className="border-t border-ink-100 align-top dark:border-ink-800" data-testid="storage-row">
          <td className="py-2 pr-2"><input type="checkbox" disabled={!!f.blocked} checked={!!sel[k(f)]} onChange={(e) => setSel((s) => { const n = { ...s }; if (e.target.checked) n[k(f)] = f; else delete n[k(f)]; return n; })} aria-label={f.name} /></td>
          <td className="max-w-[16rem] truncate py-2 pr-2"><button className="text-brand-600 underline" onClick={() => open(f)} disabled={f.missing}>{f.name}</button>{f.missing && <span className="ml-1 text-xs text-amber-700">{t('storage.fileMissing')}</span>}</td>
          <td className="py-2 pr-2 font-medium">{fmt(f.size)}</td>
          <td className="py-2 pr-2">{t(`storage.t.${f.type}`)}</td>
          <td className="py-2 pr-2 text-xs">{f.places.map((p, i) => <div key={i}>{t(`storage.place.${p.kind}`, { defaultValue: p.kind })}{p.ref ? ` · ${p.ref}` : ''}</div>)}</td>
          <td className="py-2 pr-2 text-xs text-ink-500">{f.createdAt ? new Date(f.createdAt).toLocaleDateString() : '—'}</td>
          <td className="py-2">{f.blocked ? <span className="text-xs text-amber-700" data-testid="storage-blocked">{t(`storage.blocked.${f.blocked}`)}</span>
            : <button disabled={busy} className="text-rose-600 underline" onClick={() => void remove([f])} data-testid="storage-delete">{t('storage.delete')}</button>}</td>
        </tr>)}</tbody></table></div>
      {page && page.total > PAGE && <div className="mt-3 flex items-center gap-3 text-sm">
        <button className="btn-outline !py-1" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('storage.prev')}</button>
        <span>{offset + 1}–{Math.min(offset + PAGE, page.total)} / {page.total}</span>
        <button className="btn-outline !py-1" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>{t('storage.next')}</button></div>}
    </section>
  );
}
