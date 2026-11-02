import { useEffect, useState } from 'react';
import { GitMerge, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { useTranslation } from 'react-i18next';
import { Avatar, Chip, Empty, Field, PageHeader, SlideOver, TableSkeleton } from '../components/ui';
import type { Customer } from '../lib/types';

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
const inr = (n?: number | null) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const KEYS = ['name', 'company', 'phone', 'whatsapp', 'email', 'city', 'state', 'country', 'gst'] as const;
type Form = Record<(typeof KEYS)[number] | 'address' | 'notes' | 'tags', string>;
const blank: Form = { name: '', company: '', phone: '', whatsapp: '', email: '', city: '', state: '', country: 'India', gst: '', address: '', notes: '', tags: '' };

/** India office customer directory (mirror of the China supplier directory). China never reaches this page or the API behind it. */
export function Customers({ search, openLead }: { search: string; openLead: (id: string) => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const canEdit = perms.can('customers.edit');
  const { data, reload } = useLoad(() => api.customers(), [api]);
  const [openId, setOpenId] = useState<string | null>(() => { const id = sessionStorage.openCustomer ?? null; delete sessionStorage.openCustomer; return id; });
  useEffect(() => { const h = (e: Event) => { delete sessionStorage.openCustomer; setOpenId((e as CustomEvent<string>).detail); }; addEventListener('open-customer', h); return () => removeEventListener('open-customer', h); }, []);
  const [edit, setEdit] = useState<{ id?: string; f: Form } | null>(null);
  const [merge, setMerge] = useState<Customer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [due, setDue] = useState(false);
  const term = search.toLowerCase();
  const rows = data?.filter((c) => (!due || c.paymentPending > 0) && (!term || [c.name, c.company, c.phone, c.whatsapp, c.email, c.city, c.state, c.gst, c.notes, ...c.tags].some((v) => v && v.toLowerCase().includes(term))));
  const startEdit = (c?: Customer) => { setErr(null); setEdit({ id: c?.id, f: c ? { ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, k === 'tags' ? c.tags.join(', ') : ((c as any)[k] ?? '')])) } as Form : blank }); };
  const save = async () => {
    if (!edit?.f.name.trim() && !edit?.f.company.trim()) { setErr(t('customers.nameRequired')); return; }
    const f = Object.fromEntries(Object.entries(edit.f).map(([k, v]) => [k, k === 'tags' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v.trim() || null])) as unknown as Customer;
    try { await api.saveCustomer({ ...f, name: edit.f.name.trim() || edit.f.company.trim() }, edit.id); setEdit(null); reload(); } catch (e) { setErr(String((e as Error).message)); }
  };
  const pending = data?.filter((c) => c.paymentPending > 0).length ?? 0;
  return (
    <>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')}
        actions={<div className="flex gap-2">
          <button data-testid="customers-due" className={due ? 'btn-primary' : 'btn-outline'} onClick={() => setDue(!due)}>{t('customers.duesFilter', { n: pending })}</button>
          {canEdit && <button data-testid="customer-add" className="btn-primary" onClick={() => startEdit()}><Plus size={16} />{t('customers.add')}</button>}</div>} />
      <div className="card overflow-hidden">
        {!data ? <TableSkeleton /> : !rows?.length ? <Empty title={t('customers.none')} /> : (
          <table data-testid="customers-table" className="rtable w-full text-sm">
            <thead><tr><th className="th">{t('customers.customer')}</th><th className="th">{t('customers.contact')}</th><th className="th">{t('customers.place')}</th>
              <th className="th">{t('customers.activity')}</th><th className="th">{t('customers.total')}</th><th className="th">{t('customers.lastLead')}</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={c.name} /><div><div className="font-medium text-ink-900 dark:text-white">{c.name}</div>
                    <div className="text-xs text-ink-500">{c.company && c.company !== c.name ? c.company : ''}{c.tags.map((x) => <span key={x} className="ml-1 rounded bg-brand-50 px-1.5 text-brand-700 dark:bg-brand-900/30">{x}</span>)}</div></div></div></td>
                  <td className="td"><div>{c.phone ?? '—'}</div>{c.email && <div className="text-xs text-ink-500">{c.email}</div>}</td>
                  <td className="td">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="td text-xs">{t('customers.stats', { leads: c.leads, quotes: c.quotes, orders: c.orders })}
                    {c.paymentPending > 0 && <span data-testid="payment-pending" className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t('customers.pending', { n: c.paymentPending })}</span>}</td>
                  <td className="td">{inr(c.orderTotal)}{c.due ? <div className="text-xs text-amber-700">{t('customers.due', { v: inr(c.due) })}</div> : null}</td>
                  <td className="td">{fmtDate(c.lastLeadAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && <CustomerPanel id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} openLead={openLead}
        onEdit={(c) => { setOpenId(null); startEdit(c); }} onMerge={(c) => { setOpenId(null); setMerge(c); }} onDeleted={() => { setOpenId(null); reload(); }} />}
      {merge && data && <MergeDialog into={merge} all={data} onClose={() => setMerge(null)} onDone={() => { setMerge(null); reload(); }} />}
      <SlideOver open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('customers.edit') : t('customers.add')}
        footer={<div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button data-testid="customer-save" className="btn-primary" onClick={() => void save()}>{t('common.save')}</button></div>}>
        {edit && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">{KEYS.map((k) => (
            <Field key={k} label={t(`customers.f.${k}`)}><input data-testid={`cf-${k}`} className="input" value={edit.f[k]} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, [k]: e.target.value } })} /></Field>))}</div>
          <Field label={t('customers.f.tags')}><input className="input" placeholder={t('customers.tagsHint')} value={edit.f.tags} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, tags: e.target.value } })} /></Field>
          <Field label={t('customers.f.address')}><textarea className="input min-h-20" value={edit.f.address} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, address: e.target.value } })} /></Field>
          <Field label={t('customers.f.notes')}><textarea className="input min-h-20" value={edit.f.notes} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, notes: e.target.value } })} /></Field>
          {err && <div className="text-sm text-rose-600">{err}</div>}
        </div>}
      </SlideOver>
    </>
  );
}

function MergeDialog({ into, all, onClose, onDone }: { into: Customer; all: Customer[]; onClose: () => void; onDone: () => void }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const [q, setQ] = useState(''), [sel, setSel] = useState<Set<string>>(new Set()), [err, setErr] = useState<string | null>(null);
  const list = all.filter((c) => c.id !== into.id && (!q || [c.name, c.company, c.phone, c.email].some((v) => v && v.toLowerCase().includes(q.toLowerCase()))));
  const go = async () => { try { await api.mergeCustomers(into.id, [...sel]); onDone(); } catch (e) { setErr((e as Error).message); } };
  return (
    <SlideOver open onClose={onClose} title={t('customers.mergeTitle', { name: into.name })} subtitle={t('customers.mergeHint')}
      footer={<div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button><button data-testid="merge-go" className="btn-primary" disabled={!sel.size} onClick={() => void go()}>{t('customers.mergeGo', { n: sel.size })}</button></div>}>
      <input className="input mb-3" placeholder={t('customers.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">{list.map((c) => (
        <li key={c.id}><label className="flex cursor-pointer items-center gap-3 py-2 text-sm"><input type="checkbox" checked={sel.has(c.id)} onChange={() => { const s = new Set(sel); s.has(c.id) ? s.delete(c.id) : s.add(c.id); setSel(s); }} />
          <span className="flex-1"><span className="font-medium">{c.name}</span> <span className="text-ink-500">{[c.company, c.phone, c.email].filter(Boolean).join(' · ')}</span></span><span className="text-xs text-ink-500">{t('customers.stats', { leads: c.leads, quotes: c.quotes, orders: c.orders })}</span></label></li>))}</ul>
      {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
    </SlideOver>
  );
}

function CustomerPanel({ id, canEdit, onClose, onEdit, onMerge, onDeleted, openLead }: { id: string; canEdit: boolean; onClose: () => void; onEdit: (c: Customer) => void; onMerge: (c: Customer) => void; onDeleted: () => void; openLead: (id: string) => void }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const { data: c } = useLoad(() => api.customer(id), [api, id]);
  const [err, setErr] = useState<string | null>(null);
  const admin = session?.role === 'SUPER_ADMIN' || session?.role === 'INDIA_ADMIN';
  const del = async () => { try { await api.deleteCustomer(id); onDeleted(); } catch (e) { setErr((e as Error).message); } };
  const Row = ({ leadId, children }: { leadId: string; children: React.ReactNode }) => <li className="cursor-pointer py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800/40" onClick={() => openLead(leadId)}>{children}</li>;
  return (
    <SlideOver open onClose={onClose} title={c?.name ?? '…'} subtitle={c ? [c.company !== c.name ? c.company : null, c.city, c.state].filter(Boolean).join(' · ') : undefined}
      footer={c && canEdit && <div className="flex flex-wrap justify-end gap-2">
        {admin && !c.leads && <button className="btn-ghost text-rose-600" onClick={() => void del()}><Trash2 size={14} />{t('common.delete')}</button>}
        <button data-testid="customer-merge" className="btn-ghost" onClick={() => onMerge(c)}><GitMerge size={14} />{t('customers.merge')}</button>
        <button className="btn-ghost" onClick={() => onEdit(c)}><Pencil size={14} />{t('customers.edit')}</button></div>}>
      {!c ? <TableSkeleton rows={3} cols={2} /> : <div data-testid="customer-panel" className="space-y-5 text-sm">
        <dl className="grid grid-cols-2 gap-3">
          {(['phone', 'whatsapp', 'email', 'gst', 'country'] as const).map((k) => <div key={k}><dt className="text-ink-500">{t(`customers.f.${k}`)}</dt><dd className="break-all">{c[k] ?? '—'}</dd></div>)}
          <div><dt className="text-ink-500">{t('customers.addedBy')}</dt><dd>{c.createdByName ?? t('customers.auto')} · {fmtDate(c.createdAt)}</dd></div>
        </dl>
        {c.tags.length > 0 && <div className="flex flex-wrap gap-1">{c.tags.map((x) => <span key={x} className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-900/30">{x}</span>)}</div>}
        {c.address && <p className="whitespace-pre-wrap text-ink-600 dark:text-ink-300">{c.address}</p>}
        {c.notes && <p className="whitespace-pre-wrap rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">{c.notes}</p>}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/50"><div className="text-xs text-ink-500">{t('customers.total')}</div><div className="font-semibold">{inr(c.orderTotal)}</div></div>
          <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/50"><div className="text-xs text-ink-500">{t('customers.paid')}</div><div className="font-semibold">{inr(c.paid)}</div></div>
          <div className={`rounded-xl p-2 ${c.due ? 'bg-amber-50 dark:bg-amber-900/30' : 'bg-ink-50 dark:bg-ink-800/50'}`}><div className="text-xs text-ink-500">{t('customers.dueLabel')}</div><div className="font-semibold">{inr(c.due)}</div></div>
        </div>
        <Section title={t('customers.hLeads', { n: c.leadRows.length })}>{c.leadRows.map((l) => <Row key={l.id} leadId={l.id}>
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{l.leadRef ?? '—'} · {l.product ?? '—'}</span><Chip value={l.status} /></div>
          <div className="text-xs text-ink-500">{l.quantity ?? ''} {l.unit ?? ''} · {fmtDate(l.createdAt)}{l.ownerName ? ` · ${l.ownerName}` : ''}</div></Row>)}</Section>
        <Section title={t('customers.hQuotes', { n: c.quoteRows.length })}>{c.quoteRows.map((q) => <Row key={q.id} leadId={q.leadId}>
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{q.leadRef} · {q.product}</span><Chip value={q.status} /></div>
          <div className="text-xs text-ink-500">{q.unitPrice != null ? `${q.qty} × ${inr(q.unitPrice)} = ${inr(q.total)} · ` : ''}{fmtDate(q.updatedAt)}</div></Row>)}</Section>
        <Section title={t('customers.hOrders', { n: c.orderRows.length })}>{c.orderRows.map((x) => <Row key={x.id} leadId={x.leadId}>
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{x.leadRef} · {x.product}</span><Chip value={x.paymentStatus} /></div>
          <div className="text-xs text-ink-500">{x.qty} pcs{x.total != null ? ` · ${inr(x.total)} · ${t('customers.paidAmt', { v: inr(x.paymentStatus === 'PAID' ? x.total : x.advance) })}` : ''} · <Chip value={x.production} /></div></Row>)}</Section>
        <Section title={t('customers.hShipments', { n: c.shipmentRows.length })}>{c.shipmentRows.map((s) => <Row key={s.id} leadId={s.leadId}>
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{s.ref} · {s.leadRef}</span><Chip value={s.status} /></div>
          <div className="text-xs text-ink-500">{s.mode ?? ''}{s.etd ? ` · ETD ${s.etd}` : ''}{s.eta ? ` · ETA ${s.eta}` : ''}{s.deliveredAt ? ` · ${s.deliveredAt}` : ''}</div></Row>)}</Section>
        {err && <div className="text-sm text-rose-600">{err}</div>}
      </div>}
    </SlideOver>
  );
}
const Section = ({ title, children }: { title: string; children: React.ReactNode[] }) => (
  <div><h3 className="mb-1 font-semibold">{title}</h3>{children.length ? <ul className="divide-y divide-ink-100 dark:divide-ink-800">{children}</ul> : <div className="text-ink-400">—</div>}</div>);
