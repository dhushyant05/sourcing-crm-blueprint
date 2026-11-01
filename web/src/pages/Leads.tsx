import { clsx } from 'clsx';
import { CornerDownLeft, UserCheck, Users, Download, KanbanSquare, Pencil, Play, Plus, Rows3, Send, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACCEPT, EXT, FileIcon, fmtSize, isVideoName, tooBig } from '../components/EnquiryForm';
import { useApp, useLoad } from '../lib/store';
import { LeadQuotes } from '../components/LeadQuotes';
import { PIPELINE, type Attachment, type Currency, type Lead, type LeadStatus, type Office, type StaffLite } from '../lib/types';
import { useTranslation } from 'react-i18next';
import i18n, { fmtDate } from '../i18n';
import { MoneyInput, Money } from '../components/MoneyInput';
import { Avatar, Chip, dot, Empty, Field, PageHeader, Skeleton, SlideOver, TableSkeleton, pretty } from '../components/ui';

const who = (l: Lead, customers: boolean) => (customers ? l.clientName ?? l.name : l.leadRef ?? i18n.t('common.leadN', { id: l.id }));
/** The one reference shared by India, China and the customer (SE-YYMM-NNNN). */
export const RefTag = ({ v }: { v?: string }) => (v ? <span data-testid="lead-ref" className="inline-flex items-center rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">{v}</span> : null);
export const matches = (l: Lead, q: string) => !q || [l.leadRef, l.name, l.clientName, l.productInterest, l.assignedChinaAgent].some((v) => v?.toLowerCase().includes(q.toLowerCase()));

export function Leads({ search, openLead }: { search: string; openLead: (l: Lead) => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const [mine, setMine] = useState(() => localStorage.leadMine === '1');
  const { data, setData, reload } = useLoad(() => api.leads(mine), [api, mine]);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'board' | 'table'>(() => (localStorage.leadView as 'board') ?? 'board');
  const [drag, setDrag] = useState<string | null>(null);
  const leads = data?.filter((l) => matches(l, search));
  const pick = (v: 'board' | 'table') => { setView(v); localStorage.leadView = v; };

  const move = async (id: string, status: LeadStatus) => {
    setData((d) => d && d.map((l) => (l.id === id ? { ...l, status, ...(['ASSIGNED', 'SOURCING', 'QUOTED'].includes(status) ? { assignedOffice: 'CHINA' } : {}) } : l)));
    await api.updateLeadStatus(id, status);
  };

  return (
    <>
      <PageHeader title={t('nav.leads')} subtitle={data ? t('leads.count', { n: data.length }) : t('common.loading')}
        actions={<>
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5 text-sm dark:border-ink-700 dark:bg-ink-900" data-testid="mine-filter">
            {([[false, t('assign.all')], [true, t('assign.mine')]] as const).map(([v, label]) => (
              <button key={String(v)} onClick={() => { setMine(v); localStorage.leadMine = v ? '1' : '0'; }} className={clsx('rounded-lg px-2.5 py-1.5 transition', mine === v ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-white' : 'text-ink-500')}>{label}</button>
            ))}
          </div>
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900">
            {([['board', KanbanSquare], ['table', Rows3]] as const).map(([v, I]) => (
              <button key={v} onClick={() => pick(v)} className={clsx('rounded-lg px-2.5 py-1.5 text-sm transition', view === v ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-white' : 'text-ink-500')}><I size={16} /></button>
            ))}
          </div>
          {perms.customers && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} />{t('leads.new')}</button>}
        </>} />

      {mine && data && !data.length && <p className="mb-4 rounded-xl border border-dashed border-ink-200 px-4 py-3 text-sm text-ink-500 dark:border-ink-800">{t('assign.noneMine')}</p>}
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
                      <div className="text-sm font-medium text-ink-900 dark:text-white">{who(l, perms.customers)}</div>{perms.customers && <div className="mt-1"><RefTag v={l.leadRef} /></div>}
                      <div className="mt-0.5 text-xs text-ink-500">{l.productInterest}</div>
                      <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                        <span>{t('common.pcs', { n: l.quantity?.toLocaleString() })}</span>
                        <span className="flex items-center gap-1.5" title={l.assignedToName ?? t('assign.queue', { office: l.ownerOffice === 'CHINA' ? t('leads.officeChina') : t('leads.officeIndia') })}>{l.ownerOffice && <span className="text-[10px] uppercase text-ink-400">{l.ownerOffice === 'CHINA' ? '中' : 'IN'}</span>}<Avatar name={l.assignedToName ?? l.assignedChinaAgent ?? '—'} className="h-6 w-6 text-[10px]" /></span>
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
                      <td className="td"><div className="flex items-center gap-3"><Avatar name={who(l, perms.customers)} /><span className="font-medium text-ink-900 dark:text-white">{who(l, perms.customers)}</span>{perms.customers && <RefTag v={l.leadRef} />}</div></td>
                      <td className="td text-ink-600 dark:text-ink-300">{l.productInterest}</td>
                      <td className="td text-right tabular-nums">{l.quantity?.toLocaleString()}</td>
                      {perms.clientPricing && <td className="td text-right tabular-nums"><Money v={l.targetPrice} c={l.targetCurrency} /></td>}
                      <td className="td"><Chip value={l.status} /></td>
                      <td className="td text-ink-600 dark:text-ink-300">{l.assignedToName ?? l.assignedChinaAgent ?? '—'}</td>
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
  const blank = { clientName: '', productInterest: '', quantity: '100', price: '', currency: 'INR' as Currency, summary: '' };
  const [f, setF] = useState(blank), [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]), [pct, setPct] = useState<number | null>(null);
  const submit = async () => {
    try {
      setErr(null); setPct(files.length ? 0 : null);
      const id = await api.createLead({ clientName: f.clientName, productInterest: f.productInterest, quantity: Number(f.quantity) || 1,
        targetPrice: Number(f.price) > 0 ? Number(f.price) : undefined, targetCurrency: f.currency, summary: f.summary.trim() || undefined });
      if (files.length) await api.uploadAttachments(id, files, setPct);
      setF(blank); setFiles([]); setPct(null); onCreated();
    } catch (e) { setPct(null); setErr((e as Error).message); }
  };
  return (
    <SlideOver open={open} onClose={onClose} title={t('leads.new')}
      footer={<><button className="btn-outline" onClick={onClose}>{t('common.cancel')}</button><button className="btn-primary" form="new-lead" disabled={pct != null}>{t('leads.create')}</button></>}>
      <form id="new-lead" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div><label className="label">{t('leads.clientName')}</label><input className="input" required value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} /></div>
        <div><label className="label">{t('common.product')}</label><input className="input" required value={f.productInterest} onChange={(e) => setF({ ...f, productInterest: e.target.value })} /></div>
        <div><label className="label">{t('common.quantity')}</label><input className="input" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
        <MoneyInput id="target-price" label={t('leads.targetPrice')} value={f.price} currency={f.currency} onValue={(price) => setF({ ...f, price })} onCurrency={(currency) => setF({ ...f, currency })} />
        <div><label className="label" htmlFor="lead-summary">{t('leads.summary')}</label><textarea id="lead-summary" className="input min-h-24" placeholder={t('leads.summaryHint')} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></div>
        <div>
          <label className="label">{t('leads.media')}</label>
          <FilePicker onPick={(fs) => setFiles((cur) => [...cur, ...fs])} onError={setErr} />
          {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((x, i) => (
            <li key={i} className="flex items-center gap-2 text-sm"><FileIcon name={x.name} /><span className="min-w-0 flex-1 truncate">{x.name}</span><span className="text-xs text-ink-400">{fmtSize(x.size)}</span>
              <button type="button" aria-label={t('common.remove')} onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} className="text-ink-400 hover:text-rose-600"><Trash2 size={14} /></button></li>))}</ul>}
          {pct != null && <p className="mt-2 text-xs text-ink-500">{t('leads.uploading', { pct })}</p>}
        </div>
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      </form>
    </SlideOver>
  );
}

/** Photo / video / document picker used by staff (validates type and size like the server). */
export function FilePicker({ onPick, onError }: { onPick: (f: File[]) => void; onError: (m: string | null) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null), vid = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null) => {
    if (!list) return; const ok: File[] = []; onError(null);
    for (const f of Array.from(list)) {
      const e = (f.name.split('.').pop() ?? '').toLowerCase();
      if (!EXT.includes(e)) { onError(t('landing.contact.errType', { name: f.name })); continue; }
      if (tooBig(f)) { onError(t('leads.errSize', { name: f.name })); continue; }
      ok.push(f);
    }
    if (ok.length) onPick(ok);
  };
  const inp = (r: React.RefObject<HTMLInputElement | null>, accept: string, capture?: boolean, multiple = true) =>
    <input ref={r} type="file" multiple={multiple} accept={accept} capture={capture ? 'environment' : undefined} className="hidden" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />;
  return (<>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-outline" onClick={() => ref.current?.click()}><Upload size={15} />{t('leads.addMedia')}</button>
      <button type="button" className="btn-outline sm:hidden" onClick={() => cam.current?.click()}>{t('landing.contact.camera')}</button>
      <button type="button" className="btn-outline sm:hidden" onClick={() => vid.current?.click()}>{t('leads.recordVideo')}</button>
    </div>
    <p className="mt-1 text-xs text-ink-400">{t('leads.mediaHint')}</p>
    {inp(ref, ACCEPT)}{inp(cam, 'image/*', true, false)}{inp(vid, 'video/*', true, false)}
  </>);
}

export function LeadPanel({ lead: initial, onClose }: { lead: Lead | null; onClose: () => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const [lead, setLead] = useState<Lead | null>(initial);
  const { session } = useApp();
  const [mode, setMode] = useState<Office | null>(null), [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffLite[] | null>(null), [pickTo, setPickTo] = useState('');
  const [editSum, setEditSum] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setLead(initial); setMode(null); setEditSum(null); setMsg(null); }, [initial]);
  const officeName = (o?: Office | null) => (o === 'CHINA' ? t('leads.officeChina') : t('leads.officeIndia'));
  const openPicker = (o: Office) => {
    setMode(o); setStaff(null); setPickTo(o === 'INDIA' && lead?.ownerOffice === 'CHINA' ? 'default' : '');
    api.staff(o).then(setStaff).catch(() => { setStaff([]); setMsg(t('assign.loadStaffFail')); });
  };
  const assign = async (office: Office, to?: string | null) => {
    if (!lead) return; setBusy(true); setMsg(null);
    try {
      const l = await api.assignLead(lead.id, office, to);
      setLead({ ...lead, ...l }); setMode(null);
      setMsg(t('assign.sent', { who: l.assignedToName ?? t('assign.queue', { office: officeName(office) }) }));
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const saveSummary = async () => {
    if (!lead || editSum == null) return; setBusy(true);
    try { await api.updateLead(lead.id, { summary: editSum.trim() }); setLead({ ...lead, summary: editSum.trim() }); setEditSum(null); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const owner: Office = lead?.ownerOffice ?? (lead?.assignedOffice === 'CHINA' ? 'CHINA' : 'INDIA');
  const role = session?.role ?? 'INDIA_STAFF', isAdmin = role.endsWith('ADMIN');
  const canSend = perms.customers && owner !== 'CHINA';
  const canReturn = perms.suppliers && owner === 'CHINA' && lead?.assignedOffice === 'CHINA';
  const myOffice: Office | null = role.startsWith('CHINA') ? 'CHINA' : role.startsWith('INDIA') ? 'INDIA' : null;
  const canReassign = role === 'SUPER_ADMIN' || (isAdmin && myOffice === owner);
  const canTake = !isAdmin && myOffice === owner && !!session?.id && lead?.assignedTo !== session.id;
  return (
    <SlideOver open={!!lead} onClose={onClose} title={lead && who(lead, perms.customers)}
      subtitle={lead && <div className="flex flex-wrap items-center gap-2"><RefTag v={lead.leadRef} /><Chip value={lead.status} /><span>{lead.productInterest}</span></div>}
      footer={<><button className="btn-outline" onClick={onClose}>{t('common.close')}</button>{perms.suppliers && <button className="btn-primary">{t('leads.newSourcing')}</button>}{!mode && canTake && <button className="btn-outline" data-testid="assign-take" disabled={busy} onClick={() => void assign(owner, session!.id!)}><UserCheck size={15} />{t('assign.takeIt')}</button>}
        {!mode && canReassign && <button className="btn-outline" data-testid="assign-reassign" onClick={() => openPicker(owner)}><Users size={15} />{t('assign.reassign')}</button>}
        {!mode && canReturn && <button className="btn-primary" data-testid="assign-return" onClick={() => openPicker('INDIA')}><CornerDownLeft size={15} />{t('assign.returnIndia')}</button>}
        {!mode && canSend && <button className="btn-primary" data-testid="assign-china" onClick={() => openPicker('CHINA')}><Send size={15} />{t('assign.sendChina')}</button>}</>}>
      {lead && (
        <>
          {mode && (
            <div data-testid="assign-picker" className="mb-5 rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="mb-2 text-sm font-medium text-ink-900 dark:text-white">{mode !== owner ? (mode === 'CHINA' ? t('assign.sendChina') : t('assign.returnIndia')) : t('assign.reassign')}</div>
              <label className="label" htmlFor="assign-to">{t('assign.member')} · {officeName(mode)}</label>
              <select id="assign-to" data-testid="assign-select" className="input" value={pickTo} disabled={!staff} onChange={(e) => setPickTo(e.target.value)}>
                {pickTo === 'default' || (mode === 'INDIA' && owner === 'CHINA') ? <option value="default">{lead.raisedByName ? t('assign.raiserDefault', { name: lead.raisedByName }) : t('assign.queueOpt', { office: officeName(mode) })}</option> : null}
                <option value="">{t('assign.queueOpt', { office: officeName(mode) })}</option>
                {staff?.map((s) => <option key={s.id} value={s.id}>{s.name} · {t(`role.${s.role}`)}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-500">{mode === 'CHINA' ? t('assign.sendHint') : owner === 'CHINA' ? t('assign.returnHint') : ''}</p>
              <div className="mt-2 flex gap-2"><button className="btn-primary" disabled={busy || !staff} onClick={() => void assign(mode, pickTo === 'default' ? undefined : pickTo || null)} data-testid="assign-confirm">{t('assign.confirm')}</button><button className="btn-outline" onClick={() => setMode(null)}>{t('common.cancel')}</button></div>
            </div>
          )}
          {msg && <p role="status" className="mb-4 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700 dark:bg-ink-800 dark:text-ink-200">{msg}</p>}
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.request')}</h3>
          <dl className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
            <Field label={t('leads.reference')}><span className="font-mono">{lead.leadRef ?? '—'}</span></Field>
            <Field label={t('common.product')}>{lead.productInterest}</Field>
            <Field label={t('common.quantity')}>{lead.unit && lead.unit !== 'pcs' ? `${lead.quantity?.toLocaleString() ?? ''} ${t(`landing.contact.units.${lead.unit}`)}` : t('common.pcs', { n: lead.quantity?.toLocaleString() })}</Field>
            {perms.clientPricing && <Field label={t('leads.targetPrice')}><Money v={lead.targetPrice} c={lead.targetCurrency} /></Field>}
            <Field label={t('leads.channel')}>{lead.sourceChannel}</Field>
            <Field label={t('leads.office')}>{lead.assignedOffice === 'CHINA' ? t('leads.officeChina') : t('leads.officeIndia')}</Field>
            <Field label={t('assign.raisedBy')}><span data-testid="raised-by">{lead.raisedByName ?? '—'}</span></Field>
            <Field label={t('assign.owner')}><span data-testid="assigned-to">{lead.assignedToName ?? t('assign.queue', { office: officeName(owner) })}</span></Field>
            {lead.assignedChinaAgent && <Field label={t('common.chinaAgent')}>{lead.assignedChinaAgent}</Field>}
            {lead.referenceUrl && <Field label={t('leads.refLink')}><a href={lead.referenceUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand-600 underline">{lead.referenceUrl}</a></Field>}
          </dl>
          <h3 className="mt-6 flex items-center text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.summary')}
            {perms.customers && editSum == null && <button className="ml-auto inline-flex items-center gap-1 normal-case text-brand-600" onClick={() => setEditSum(lead.summary ?? '')}><Pencil size={12} />{t('common.edit')}</button>}</h3>
          {editSum != null ? (
            <div className="mt-2"><textarea data-testid="summary-edit" className="input min-h-24" value={editSum} onChange={(e) => setEditSum(e.target.value)} placeholder={t('leads.summaryHint')} />
              <div className="mt-2 flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => void saveSummary()}>{t('common.save')}</button><button className="btn-outline" onClick={() => setEditSum(null)}>{t('common.cancel')}</button></div></div>
          ) : <p data-testid="lead-summary" className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{lead.summary || <span className="text-ink-400">{t('leads.noSummary')}</span>}</p>}
          {perms.customers && (<>
            <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.customer')}</h3>
            <dl className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
              {lead.contactName && <Field label={t('leads.contactName')}>{lead.contactName}</Field>}
              <Field label={t('common.phone')}>{lead.contactPhone && <a className="text-brand-600" href={`tel:${lead.contactPhone.replace(/\s/g, '')}`}>{lead.contactPhone}</a>}</Field><Field label={t('common.email')}>{lead.contactEmail}</Field>
              {lead.deliveryCity && <Field label={t('leads.deliveryCity')}>{lead.deliveryCity}</Field>}
            </dl>
            {lead.enquiryMessage && <><h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.message')}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{lead.enquiryMessage}</p></>}
          </>)}
          <Attachments leadId={lead.id} canEdit={perms.customers} />
          <LeadQuotes leadId={lead.id} />
          <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.timeline')}</h3>
          <ol className="mt-3 space-y-4 border-l border-ink-200 pl-4 dark:border-ink-800">
            {[[t('leads.createdEvt'), lead.createdAt], ...(lead.assignedOffice === 'CHINA' ? [[t('leads.assignedTo', { who: lead.assignedToName || lead.assignedChinaAgent || t('leads.officeChina') }), lead.updatedAt ?? lead.createdAt]] : [])].map(([t, d]) => (
              <li key={t} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-white dark:ring-ink-900" /><div className="text-ink-800 dark:text-ink-100">{t}</div><div className="text-xs text-ink-500">{fmtDate(d, { dateStyle: 'medium' })}</div></li>
            ))}
          </ol>
        </>
      )}
    </SlideOver>
  );
}

/** Enquiry photos/documents. Files are fetched with the staff token and shown via blob: URLs, never public links. */
export function Attachments({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const { api } = useApp();
  const { t } = useTranslation();
  const [list, setList] = useState<Attachment[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [videos, setVideos] = useState<Record<string, string>>({});
  const [pct, setPct] = useState<number | null>(null), [err, setErr] = useState<string | null>(null);
  const upload = async (fs: File[]) => {
    setPct(0); setErr(null);
    try { setList(await api.uploadAttachments(leadId, fs, setPct)); } catch (e) { setErr((e as Error).message); } finally { setPct(null); }
  };
  const del = async (a: Attachment) => {
    if (!confirm(t('leads.deleteFile', { name: a.name }))) return;
    try { await api.deleteAttachment(leadId, a.id); setList((l) => l && l.filter((x) => x.id !== a.id)); } catch (e) { setErr((e as Error).message); }
  };
  /** Videos are fetched with the staff token (original file) and played from a blob: URL. */
  const play = async (a: Attachment) => {
    if (videos[a.id]) return;
    setVideos((v) => ({ ...v, [a.id]: 'loading' }));
    try { const u = await api.attachmentUrl(leadId, a); setVideos((v) => ({ ...v, [a.id]: u })); }
    catch (e) { setErr((e as Error).message); setVideos((v) => { const n = { ...v }; delete n[a.id]; return n; }); }
  };
  useEffect(() => () => Object.values(videos).forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)), [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
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
    {canEdit && <div className="mt-2"><FilePicker onPick={(fs) => void upload(fs)} onError={setErr} /></div>}
    {pct != null && <p className="mt-2 text-xs text-ink-500">{t('leads.uploading', { pct })}</p>}
    {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
    {!list ? <p className="mt-2 text-sm text-ink-400">{t('leads.loadingFiles')}</p> : list.length === 0 ? <p className="mt-2 text-sm text-ink-400">{t('leads.noAttachments')}</p> : (
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {list.map((a) => (
          <li key={a.id} className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
            {a.mime.startsWith('video/') || isVideoName(a.name) ? (
              videos[a.id] && videos[a.id] !== 'loading'
                ? <video data-testid="lead-video" src={videos[a.id]} controls playsInline className="h-40 w-full bg-black object-contain" />
                : <button className="relative grid h-28 w-full place-items-center bg-ink-900 text-white" onClick={() => void play(a)} title={t('leads.play')}>
                    {videos[a.id] === 'loading' ? <span className="text-xs">{t('leads.loadingVideo')}</span> : <Play size={34} />}</button>
            ) : (
              <button className="block w-full" onClick={() => open(a, false)} title={t('leads.open')}>
                {thumbs[a.id] ? <img src={thumbs[a.id]} alt={a.name} className="h-28 w-full object-cover" /> : <span className="grid h-28 place-items-center bg-ink-50 dark:bg-ink-800"><FileIcon name={a.name} className="h-10 w-10" /></span>}
              </button>
            )}
            <div className="flex items-center gap-2 p-2">
              <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-ink-800 dark:text-ink-100">{a.name}</div><div className="text-[11px] text-ink-400">{fmtSize(a.size)}</div></div>
              <button onClick={() => open(a, true)} aria-label={`${t('leads.download')} ${a.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Download size={15} /></button>
              {canEdit && <button onClick={() => void del(a)} aria-label={`${t('common.remove')} ${a.name}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>}
            </div>
          </li>
        ))}
      </ul>
    )}
  </>);
}
