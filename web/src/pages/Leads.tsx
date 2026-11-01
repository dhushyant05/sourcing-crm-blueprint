import { clsx } from 'clsx';
import { Download, KanbanSquare, Plus, Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FileIcon, fmtSize } from '../components/EnquiryForm';
import { useApp, useLoad } from '../lib/store';
import { PIPELINE, type Attachment, type Currency, type Lead, type LeadStatus } from '../lib/types';
import { useTranslation } from 'react-i18next';
import i18n, { fmtDate } from '../i18n';
import { MoneyInput, Money } from '../components/MoneyInput';
import { Avatar, Chip, dot, Empty, Field, PageHeader, Skeleton, SlideOver, TableSkeleton, pretty } from '../components/ui';

const who = (l: Lead, customers: boolean) => (customers ? l.clientName ?? l.name : i18n.t('common.leadN', { id: l.id }));
export const matches = (l: Lead, q: string) => !q || [l.name, l.clientName, l.productInterest, l.assignedChinaAgent].some((v) => v?.toLowerCase().includes(q.toLowerCase()));

export function Leads({ search, openLead }: { search: string; openLead: (l: Lead) => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const { data, setData, reload } = useLoad(() => api.leads(), [api]);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'board' | 'table'>(() => (localStorage.leadView as 'board') ?? 'board');
  const [drag, setDrag] = useState<string | null>(null);
  const leads = data?.filter((l) => matches(l, search));
  const pick = (v: 'board' | 'table') => { setView(v); localStorage.leadView = v; };

  const move = async (id: string, status: LeadStatus) => {
    setData((d) => d && d.map((l) => (l.id === id ? { ...l, status } : l)));
    await api.updateLeadStatus(id, status);
  };

  return (
    <>
      <PageHeader title={t('nav.leads')} subtitle={data ? t('leads.count', { n: data.length }) : t('common.loading')}
        actions={<>
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900">
            {([['board', KanbanSquare], ['table', Rows3]] as const).map(([v, I]) => (
              <button key={v} onClick={() => pick(v)} className={clsx('rounded-lg px-2.5 py-1.5 text-sm transition', view === v ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-white' : 'text-ink-500')}><I size={16} /></button>
            ))}
          </div>
          {perms.customers && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} />{t('leads.new')}</button>}
        </>} />

      {view === 'board' ? (
        <div className="-mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-4 md:snap-none">
          {PIPELINE.map((s) => {
            const col = leads?.filter((l) => l.status === s) ?? [];
            return (
              <div key={s} onDragOver={(e) => e.preventDefault()} onDrop={() => drag && move(drag, s)}
                className="flex w-[82vw] shrink-0 snap-center flex-col rounded-2xl sm:w-72 bg-ink-100/60 p-2 dark:bg-ink-900/50">
                <div className="flex items-center gap-2 px-2 py-2 text-sm font-medium text-ink-700 dark:text-ink-200">
                  <span className={`h-2 w-2 rounded-full ${dot[s]}`} />{pretty(s)}<span className="ml-auto rounded-full bg-white px-2 text-xs text-ink-500 dark:bg-ink-800">{data ? col.length : '·'}</span>
                </div>
                <div className="flex min-h-24 flex-col gap-2">
                  {!data && [0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                  {col.map((l) => (
                    <article key={l.id} draggable onDragStart={() => setDrag(l.id)} onDragEnd={() => setDrag(null)} onClick={() => openLead(l)}
                      className={clsx('cursor-pointer rounded-xl border border-ink-200/70 bg-white p-3.5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift dark:border-ink-800 dark:bg-ink-900', drag === l.id && 'opacity-50')}>
                      <div className="text-sm font-medium text-ink-900 dark:text-white">{who(l, perms.customers)}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{l.productInterest}</div>
                      <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                        <span>{t('common.pcs', { n: l.quantity?.toLocaleString() })}</span>
                        <Avatar name={l.assignedChinaAgent ?? 'NA'} className="h-6 w-6 text-[10px]" />
                      </div>
                    </article>
                  ))}
                  {data && !col.length && <div className="rounded-xl border border-dashed border-ink-200 py-6 text-center text-xs text-ink-400 dark:border-ink-800">{t('leads.none')}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {!data ? <TableSkeleton /> : !leads?.length ? <Empty title={t('leads.noMatch')} hint={t('leads.tryOther')} /> : (
            <div className="md:max-h-[calc(100vh-220px)] md:overflow-auto">
              <table className="rtable w-full text-sm">
                <thead><tr><th className="th">{perms.customers ? t('common.client') : t('common.lead')}</th><th className="th">{t('common.product')}</th><th className="th text-right">{t('common.qty')}</th>{perms.clientPricing && <th className="th text-right">{t('leads.target')}</th>}<th className="th">{t('common.status')}</th><th className="th">{t('common.chinaAgent')}</th><th className="th">{t('common.created')}</th></tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} onClick={() => openLead(l)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                      <td className="td"><div className="flex items-center gap-3"><Avatar name={who(l, perms.customers)} /><span className="font-medium text-ink-900 dark:text-white">{who(l, perms.customers)}</span></div></td>
                      <td className="td text-ink-600 dark:text-ink-300">{l.productInterest}</td>
                      <td className="td text-right tabular-nums">{l.quantity?.toLocaleString()}</td>
                      {perms.clientPricing && <td className="td text-right tabular-nums"><Money v={l.targetPrice} c={l.targetCurrency} /></td>}
                      <td className="td"><Chip value={l.status} /></td>
                      <td className="td text-ink-600 dark:text-ink-300">{l.assignedChinaAgent ?? '—'}</td>
                      <td className="td text-ink-500">{fmtDate(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <NewLead open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
    </>
  );
}

/** India creates a lead; the optional target price is stored in the currency picked (USD / RMB / INR). */
function NewLead({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const blank = { clientName: '', productInterest: '', quantity: '100', price: '', currency: 'INR' as Currency };
  const [f, setF] = useState(blank), [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api.createLead({ clientName: f.clientName, productInterest: f.productInterest, quantity: Number(f.quantity) || 1,
        targetPrice: Number(f.price) > 0 ? Number(f.price) : undefined, targetCurrency: f.currency });
      setF(blank); onCreated();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <SlideOver open={open} onClose={onClose} title={t('leads.new')}
      footer={<><button className="btn-outline" onClick={onClose}>{t('common.cancel')}</button><button className="btn-primary" form="new-lead">{t('leads.create')}</button></>}>
      <form id="new-lead" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div><label className="label">{t('leads.clientName')}</label><input className="input" required value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} /></div>
        <div><label className="label">{t('common.product')}</label><input className="input" required value={f.productInterest} onChange={(e) => setF({ ...f, productInterest: e.target.value })} /></div>
        <div><label className="label">{t('common.quantity')}</label><input className="input" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
        <MoneyInput id="target-price" label={t('leads.targetPrice')} value={f.price} currency={f.currency} onValue={(price) => setF({ ...f, price })} onCurrency={(currency) => setF({ ...f, currency })} />
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      </form>
    </SlideOver>
  );
}

export function LeadPanel({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const { perms } = useApp();
  const { t } = useTranslation();
  return (
    <SlideOver open={!!lead} onClose={onClose} title={lead && who(lead, perms.customers)}
      subtitle={lead && <div className="flex items-center gap-2"><Chip value={lead.status} /><span>{lead.productInterest}</span></div>}
      footer={<><button className="btn-outline" onClick={onClose}>{t('common.close')}</button>{perms.suppliers && <button className="btn-primary">{t('leads.newSourcing')}</button>}{perms.customers && <button className="btn-primary">{t('leads.assignChina')}</button>}</>}>
      {lead && (
        <>
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.request')}</h3>
          <dl className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
            <Field label={t('common.product')}>{lead.productInterest}</Field>
            <Field label={t('common.quantity')}>{lead.unit && lead.unit !== 'pcs' ? `${lead.quantity?.toLocaleString() ?? ''} ${t(`landing.contact.units.${lead.unit}`)}` : t('common.pcs', { n: lead.quantity?.toLocaleString() })}</Field>
            {perms.clientPricing && <Field label={t('leads.targetPrice')}><Money v={lead.targetPrice} c={lead.targetCurrency} /></Field>}
            <Field label={t('leads.channel')}>{lead.sourceChannel}</Field>
            <Field label={t('common.chinaAgent')}>{lead.assignedChinaAgent}</Field>
            {lead.referenceUrl && <Field label={t('leads.refLink')}><a href={lead.referenceUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand-600 underline">{lead.referenceUrl}</a></Field>}
          </dl>
          {perms.customers && (<>
            <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.customer')}</h3>
            <dl className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
              {lead.contactName && <Field label={t('leads.contactName')}>{lead.contactName}</Field>}
              <Field label={t('common.phone')}>{lead.contactPhone && <a className="text-brand-600" href={`tel:${lead.contactPhone.replace(/\s/g, '')}`}>{lead.contactPhone}</a>}</Field><Field label={t('common.email')}>{lead.contactEmail}</Field>
              {lead.deliveryCity && <Field label={t('leads.deliveryCity')}>{lead.deliveryCity}</Field>}
              {lead.enquiryRef && <Field label={t('leads.reference')}><span className="font-mono">{lead.enquiryRef}</span></Field>}
            </dl>
            {lead.enquiryMessage && <><h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.message')}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{lead.enquiryMessage}</p></>}
            <Attachments leadId={lead.id} />
          </>)}
          <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.timeline')}</h3>
          <ol className="mt-3 space-y-4 border-l border-ink-200 pl-4 dark:border-ink-800">
            {[[t('leads.createdEvt'), lead.createdAt], [t('leads.assignedTo', { who: lead.assignedChinaAgent ?? 'China' }), lead.createdAt]].map(([t, d]) => (
              <li key={t} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-white dark:ring-ink-900" /><div className="text-ink-800 dark:text-ink-100">{t}</div><div className="text-xs text-ink-500">{fmtDate(d, { dateStyle: 'medium' })}</div></li>
            ))}
          </ol>
        </>
      )}
    </SlideOver>
  );
}

/** Enquiry photos/documents. Files are fetched with the staff token and shown via blob: URLs, never public links. */
function Attachments({ leadId }: { leadId: string }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const [list, setList] = useState<Attachment[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true; const made: string[] = [];
    setList(null); setThumbs({});
    api.attachments(leadId).then(async (as) => {
      if (!live) return; setList(as);
      for (const a of as.filter((x) => /^image\/(jpeg|png|webp)$/.test(x.mime))) {
        const u = await api.attachmentUrl(leadId, a).catch(() => ''); if (!live) return;
        if (u.startsWith('blob:')) made.push(u);
        if (u) setThumbs((t0) => ({ ...t0, [a.id]: u }));
      }
    }).catch(() => live && setList([]));
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [api, leadId]);
  const open = async (a: Attachment, dl: boolean) => {
    const u = thumbs[a.id] ?? await api.attachmentUrl(leadId, a);
    if (!u) return;
    const el = document.createElement('a'); el.href = u; el.rel = 'noopener';
    if (dl || !/^image\/|^application\/pdf$/.test(a.mime)) el.download = a.name; else el.target = '_blank';
    el.click();
  };
  return (<>
    <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.attachments')}{list && list.length > 0 && ` · ${list.length}`}</h3>
    {!list ? <p className="mt-2 text-sm text-ink-400">{t('leads.loadingFiles')}</p> : list.length === 0 ? <p className="mt-2 text-sm text-ink-400">{t('leads.noAttachments')}</p> : (
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {list.map((a) => (
          <li key={a.id} className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
            <button className="block w-full" onClick={() => open(a, false)} title={t('leads.open')}>
              {thumbs[a.id] ? <img src={thumbs[a.id]} alt={a.name} className="h-28 w-full object-cover" /> : <span className="grid h-28 place-items-center bg-ink-50 dark:bg-ink-800"><FileIcon name={a.name} className="h-10 w-10" /></span>}
            </button>
            <div className="flex items-center gap-2 p-2">
              <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-ink-800 dark:text-ink-100">{a.name}</div><div className="text-[11px] text-ink-400">{fmtSize(a.size)}</div></div>
              <button onClick={() => open(a, true)} aria-label={`${t('leads.download')} ${a.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Download size={15} /></button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </>);
}
