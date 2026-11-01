import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { useTranslation } from 'react-i18next';
import { Avatar, Chip, Empty, Field, PageHeader, SlideOver, TableSkeleton } from '../components/ui';
import type { Supplier } from '../lib/types';

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
type Form = { name: string; contact: string; phone: string; wechat: string; city: string; notes: string };
const blank: Form = { name: '', contact: '', phone: '', wechat: '', city: '', notes: '' };

/** China office supplier directory (own PostgreSQL table). India never reaches this page or the API behind it. */
export function Suppliers({ search }: { search: string }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const { data, reload } = useLoad(() => api.suppliers(), [api]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; f: Form } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const term = search.toLowerCase();
  const rows = data?.filter((s) => !term || [s.name, s.city, s.contact, s.phone, s.wechat, s.notes].some((v) => v && v.toLowerCase().includes(term)));
  const startEdit = (s?: Supplier) => { setErr(null); setEdit({ id: s?.id, f: s ? { name: s.name, contact: s.contact ?? '', phone: s.phone ?? '', wechat: s.wechat ?? '', city: s.city ?? '', notes: s.notes ?? '' } : blank }); };
  const save = async () => {
    if (!edit?.f.name.trim()) { setErr(t('suppliers.nameRequired')); return; }
    const f = Object.fromEntries(Object.entries(edit.f).map(([k, v]) => [k, v.trim() || null])) as unknown as Supplier;
    try { await api.saveSupplier({ ...f, name: edit.f.name.trim() }, edit.id); setEdit(null); reload(); } catch (e) { setErr(String((e as Error).message)); }
  };
  return (
    <>
      <PageHeader title={t('suppliers.title')} subtitle={t('suppliers.subtitle')}
        actions={<button className="btn-primary" onClick={() => startEdit()}><Plus size={16} />{t('suppliers.add')}</button>} />
      <div className="card overflow-hidden">
        {!data ? <TableSkeleton /> : !rows?.length ? <Empty title={t('suppliers.none')} /> : (
          <table className="rtable w-full text-sm">
            <thead><tr><th className="th">{t('common.supplier')}</th><th className="th">{t('suppliers.city')}</th><th className="th">{t('suppliers.contact')}</th>
              <th className="th">{t('suppliers.activity')}</th><th className="th">{t('suppliers.lastQuote')}</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} onClick={() => setOpenId(s.id)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={s.name} /><div><div className="font-medium text-ink-900 dark:text-white">{s.name}</div>
                    {s.notes && <div className="max-w-xs truncate text-xs text-ink-500">{s.notes}</div>}</div></div></td>
                  <td className="td">{s.city ?? '—'}</td>
                  <td className="td"><div>{s.contact ?? '—'}{s.phone ? ` · ${s.phone}` : ''}</div>{s.wechat && <div className="text-xs text-ink-500">{t('suppliers.wechat', { id: s.wechat })}</div>}</td>
                  <td className="td text-xs">{t('suppliers.stats', { quotes: s.quotes, accepted: s.accepted, orders: s.orders })}</td>
                  <td className="td">{fmtDate(s.lastQuoteAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && <SupplierPanel id={openId} onClose={() => setOpenId(null)} onEdit={(s) => { setOpenId(null); startEdit(s); }} />}
      <SlideOver open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('suppliers.edit') : t('suppliers.add')}
        footer={<div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button className="btn-primary" onClick={() => void save()}>{t('common.save')}</button></div>}>
        {edit && <div className="space-y-4">
          {(['name', 'contact', 'phone', 'wechat', 'city'] as const).map((k) => (
            <Field key={k} label={t(`suppliers.f.${k}`)}><input className="input" value={edit.f[k]} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, [k]: e.target.value } })} /></Field>))}
          <Field label={t('suppliers.f.notes')}><textarea className="input min-h-24" value={edit.f.notes} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, notes: e.target.value } })} /></Field>
          {err && <div className="text-sm text-rose-600">{err}</div>}
        </div>}
      </SlideOver>
    </>
  );
}

function SupplierPanel({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (s: Supplier) => void }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const { data: s } = useLoad(() => api.supplier(id), [api, id]);
  return (
    <SlideOver open onClose={onClose} title={s?.name ?? '…'} subtitle={s ? [s.city, s.contact].filter(Boolean).join(' · ') : undefined}
      footer={s && <div className="flex justify-end"><button className="btn-ghost" onClick={() => onEdit({ ...s, quotes: s.quoteCount })}><Pencil size={14} />{t('suppliers.edit')}</button></div>}>
      {!s ? <TableSkeleton rows={3} cols={2} /> : <div className="space-y-5 text-sm">
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-ink-500">{t('suppliers.f.phone')}</dt><dd>{s.phone ?? '—'}</dd></div>
          <div><dt className="text-ink-500">{t('suppliers.f.wechat')}</dt><dd>{s.wechat ?? '—'}</dd></div>
          <div><dt className="text-ink-500">{t('suppliers.addedBy')}</dt><dd>{s.createdByName ?? '—'} · {fmtDate(s.createdAt)}</dd></div>
          <div><dt className="text-ink-500">{t('suppliers.activity')}</dt><dd>{t('suppliers.stats', { quotes: s.quoteCount, accepted: s.accepted, orders: s.orders })}</dd></div>
        </dl>
        {s.notes && <p className="whitespace-pre-wrap rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">{s.notes}</p>}
        <div>
          <h3 className="mb-2 font-semibold">{t('suppliers.history')}</h3>
          {!s.quotes.length ? <div className="text-ink-500">{t('suppliers.noQuotes')}</div> : <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {s.quotes.map((q) => <li key={q.id} className="py-2.5">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{q.leadRef ?? '—'} · {q.product}</span><Chip value={q.status} /></div>
              <div className="text-xs text-ink-500">{q.unitPrice} {q.currency}{q.moq ? ` · MOQ ${q.moq}` : ''}{q.leadTime ? ` · ${q.leadTime}` : ''} · {fmtDate(q.createdAt)}{q.createdByName ? ` · ${q.createdByName}` : ''}</div>
              {q.order && <div className="mt-1 text-xs">{t('suppliers.order', { qty: q.order.qty })} · <Chip value={q.order.production} /></div>}
            </li>)}
          </ul>}
        </div>
      </div>}
    </SlideOver>
  );
}
