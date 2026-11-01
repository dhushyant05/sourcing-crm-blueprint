import { Download, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { INCOTERMS, SHIP_MODES, type Attachment, type Lead, type LeadQuote, type QuoteCurrency, type QuoteInput, type QuoteSupplier } from '../lib/types';
import { CustomerQuote, QuoteStatusChip } from './CustomerQuote';
import { FileIcon, fmtSize, isVideoName } from './EnquiryForm';
import { FilePicker } from '../pages/Leads';

const CUR: { v: QuoteCurrency; label: string; sym: string }[] = [{ v: 'USD', label: 'USD', sym: '$' }, { v: 'CNY', label: 'RMB', sym: '¥' }, { v: 'INR', label: 'INR', sym: '₹' }];
const money = (n: number | null | undefined, c?: string | null) => n == null ? '—' : `${CUR.find((x) => x.v === c)?.sym ?? ''}${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${CUR.find((x) => x.v === c)?.label ?? c ?? ''}`;

/** Supplier quotes on a lead. China adds/edits (with supplier + media); India sees product/price/media only and adds its INR selling price. */
export function LeadQuotes({ leadId, lead, onLeadStatus }: { leadId: string; lead?: Lead | null; onLeadStatus?: (s: string) => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const china = perms.suppliers, india = perms.customers;
  const [list, setList] = useState<LeadQuote[] | null>(null), [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<LeadQuote | 'new' | null>(null);
  const load = () => api.quotes(leadId).then(setList).catch((e) => { setList([]); setErr((e as Error).message); });
  useEffect(() => { setList(null); setForm(null); setErr(null); void load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = (q: LeadQuote) => !!q.canEdit;
  const replace = (q: LeadQuote) => setList((l) => l && (l.some((x) => x.id === q.id) ? l.map((x) => (x.id === q.id ? q : x)) : [...l, q]));
  const del = async (q: LeadQuote) => {
    if (!confirm(t('lq.confirmDelete', { p: q.product }))) return;
    try { await api.deleteQuote(q.id); setList((l) => l && l.filter((x) => x.id !== q.id)); } catch (e) { setErr((e as Error).message); }
  };
  return (<section data-testid="lead-quotes">
    <div className="mt-6 flex items-center justify-between">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('lq.title')}{list && list.length > 0 && ` · ${list.length}`}</h3>
      {china && perms.can('quotes.create') && !form && <button data-testid="quote-add" className="btn-primary !py-1.5 text-sm" onClick={() => setForm('new')}><Plus size={15} />{t('lq.add')}</button>}
    </div>
    {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
    {form && <QuoteForm leadId={leadId} quote={form === 'new' ? null : form} onDone={(q) => { if (q) replace(q); setForm(null); }} />}
    {!list ? <p className="mt-2 text-sm text-ink-400">{t('leads.loadingFiles')}</p> : list.length === 0 ? <p className="mt-2 text-sm text-ink-400">{china ? t('lq.noneChina') : t('lq.none')}</p> : (
      <ul className="mt-3 space-y-3">
        {list.map((q, i) => (
          <li key={q.id} data-testid="quote-card" className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] font-mono text-ink-400">{q.label ?? `Q${i + 1}`}<QuoteStatusChip s={q.status} /></div>
                <div className="font-medium text-ink-900 dark:text-white">{q.product}</div>
                <div className="mt-0.5 text-lg font-semibold text-brand-700 dark:text-brand-300">{money(q.unitPrice, q.currency)} <span className="text-xs font-normal text-ink-400">/ {t('lq.unit')}</span></div>
              </div>
              {canEdit(q) && <><button aria-label={t('common.edit')} onClick={() => setForm(q)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Pencil size={15} /></button>
                <button aria-label={t('common.remove')} onClick={() => void del(q)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button></>}
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {([['lq.moq', q.moq], ['lq.leadTime', q.leadTime], ['lq.validity', q.validity]] as const).map(([k, v]) => <div key={k}><dt className="text-ink-400">{t(k)}</dt><dd className="text-ink-800 dark:text-ink-100">{v || '—'}</dd></div>)}
            </dl>
            {(q.shipCost != null || q.shipTerm || q.shipMode || q.shipPort || q.shipTransit) && <div data-testid="quote-ship" className="mt-2 rounded-lg bg-ink-50 p-2 text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200">
              <b>{t('lq.shipFrom')}:</b> {[q.shipCost != null && `${money(q.shipCost, q.shipCurrency ?? q.currency)}`, q.shipTerm && t(`ship.terms.${q.shipTerm}`), q.shipMode && t(`ship.modes.${q.shipMode}`), q.shipPort, q.shipTransit].filter(Boolean).join(' · ')}</div>}
            {q.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-ink-600 dark:text-ink-300">{q.notes}</p>}
            {china && q.supplier && <div data-testid="quote-supplier" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <b>{t('lq.supplier')}:</b> {q.supplier.name}{q.supplier.contact && ` · ${q.supplier.contact}`}{q.supplier.phone && ` · ${q.supplier.phone}`}{q.supplier.wechat && ` · WeChat ${q.supplier.wechat}`}{q.supplier.city && ` · ${q.supplier.city}`}
              <span className="ml-1 text-amber-700/70">({t('lq.chinaOnly')})</span></div>}
            {china && q.createdByName && <div className="mt-1 text-[11px] text-ink-400">{t('lq.by', { who: q.createdByName })}</div>}
            <QuoteFiles quote={q} canEdit={canEdit(q)} onChange={replace} />
            {india && perms.can('quotes.customer') && perms.can('prices.inr') && <CustomerQuote q={q} lead={lead} onChange={replace} onLeadStatus={onLeadStatus} />}
          </li>
        ))}
      </ul>
    )}
    {china && list && list.length > 0 && <p className="mt-2 text-xs text-ink-400">{t('lq.returnHint')}</p>}
  </section>);
}

function QuoteForm({ leadId, quote, onDone }: { leadId: string; quote: LeadQuote | null; onDone: (q: LeadQuote | null) => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const [sups, setSups] = useState<QuoteSupplier[]>([]);
  const [supId, setSupId] = useState(quote?.supplierId ?? ''), [ns, setNs] = useState({ name: '', contact: '', phone: '', wechat: '', city: '' });
  const [f, setF] = useState({ product: quote?.product ?? '', unitPrice: quote?.unitPrice?.toString() ?? '', currency: (quote?.currency ?? 'USD') as QuoteCurrency, moq: quote?.moq ?? '', leadTime: quote?.leadTime ?? '', validity: quote?.validity ?? '', notes: quote?.notes ?? '',
    shipCost: quote?.shipCost?.toString() ?? '', shipCurrency: (quote?.shipCurrency ?? quote?.currency ?? 'USD') as QuoteCurrency, shipTerm: quote?.shipTerm ?? '', shipMode: quote?.shipMode ?? '', shipPort: quote?.shipPort ?? '', shipTransit: quote?.shipTransit ?? '' });
  const [files, setFiles] = useState<File[]>([]), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [pct, setPct] = useState<number | null>(null);
  useEffect(() => { api.quoteSuppliers().then(setSups).catch(() => setSups([])); }, [api]);
  const isNew = supId === '__new';
  const save = async () => {
    setErr(null);
    if (!f.product.trim()) return setErr(t('lq.errProduct'));
    if (f.unitPrice.trim() === '' || !(Number(f.unitPrice) >= 0)) return setErr(t('lq.errPrice'));
    if (isNew && !ns.name.trim()) return setErr(t('lq.errSupplier'));
    if (f.shipCost.trim() !== '' && !(Number(f.shipCost) >= 0)) return setErr(t('lq.errPrice'));
    const body: QuoteInput = { ...f, unitPrice: f.unitPrice.trim(), shipCost: f.shipCost.trim() === '' ? null : f.shipCost.trim(), shipCurrency: f.shipCost.trim() === '' ? null : f.shipCurrency, shipTerm: f.shipTerm || null, shipMode: f.shipMode || null, ...(isNew ? { newSupplier: ns } : { supplierId: supId || null }) };
    setBusy(true);
    try {
      let q = quote ? await api.updateQuote(quote.id, body) : await api.createQuote(leadId, body);
      if (files.length) { setPct(0); q = await api.uploadQuoteFiles(q.id, files, setPct); }
      onDone(q);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setPct(null); }
  };
  const inp = (k: keyof typeof f, label: string, ph?: string) => (<div><label className="label" htmlFor={`qf-${k}`}>{label}</label><input id={`qf-${k}`} data-testid={`qf-${k}`} className="input" placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>);
  return (<div data-testid="quote-form" className="mt-3 space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-500/30 dark:bg-brand-500/5">
    <div className="text-sm font-medium text-ink-900 dark:text-white">{quote ? t('lq.edit') : t('lq.add')}</div>
    <div><label className="label" htmlFor="qf-sup">{t('lq.supplier')} <span className="text-[11px] text-amber-600">({t('lq.chinaOnly')})</span></label>
      <select id="qf-sup" data-testid="qf-supplier" className="input" value={supId} onChange={(e) => setSupId(e.target.value)}>
        <option value="">{t('lq.noSupplier')}</option>
        {sups.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}
        <option value="__new">+ {t('lq.newSupplier')}</option>
      </select></div>
    {isNew && <div data-testid="qf-newsup" className="grid grid-cols-2 gap-2 rounded-lg bg-amber-50/70 p-2 dark:bg-amber-500/10">
      {([['name', t('lq.supName')], ['contact', t('lq.supContact')], ['phone', t('lq.supPhone')], ['wechat', 'WeChat'], ['city', t('lq.supCity')]] as const).map(([k, l]) =>
        <div key={k}><label className="label" htmlFor={`ns-${k}`}>{l}</label><input id={`ns-${k}`} data-testid={`ns-${k}`} className="input" value={ns[k]} onChange={(e) => setNs({ ...ns, [k]: e.target.value })} /></div>)}
    </div>}
    {inp('product', t('lq.product'), t('lq.productPh'))}
    <div className="grid grid-cols-[1fr_auto] gap-2">{inp('unitPrice', t('lq.unitPrice'))}
      <div><label className="label" htmlFor="qf-cur">{t('lq.currency')}</label><select id="qf-cur" data-testid="qf-currency" className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as QuoteCurrency })}>{CUR.map((c) => <option key={c.v} value={c.v}>{c.sym} {c.label}</option>)}</select></div></div>
    <div className="grid grid-cols-3 gap-2">{inp('moq', t('lq.moq'), '1000 pcs')}{inp('leadTime', t('lq.leadTime'), '15 days')}{inp('validity', t('lq.validity'), '30 days')}</div>
    <div className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('ship.title')}</div>
    <div className="grid grid-cols-[1fr_auto] gap-2">{inp('shipCost', t('ship.cost'), '800')}
      <div><label className="label" htmlFor="qf-shipcur">{t('lq.currency')}</label><select id="qf-shipcur" data-testid="qf-shipCurrency" className="input" value={f.shipCurrency} onChange={(e) => setF({ ...f, shipCurrency: e.target.value as QuoteCurrency })}>{CUR.map((c) => <option key={c.v} value={c.v}>{c.sym} {c.label}</option>)}</select></div></div>
    <div className="grid grid-cols-2 gap-2">
      <div><label className="label" htmlFor="qf-term">{t('ship.term')}</label><select id="qf-term" data-testid="qf-shipTerm" className="input" value={f.shipTerm} onChange={(e) => setF({ ...f, shipTerm: e.target.value })}><option value="">{t('ship.none')}</option>{INCOTERMS.map((o) => <option key={o} value={o}>{t(`ship.terms.${o}`)}</option>)}</select></div>
      <div><label className="label" htmlFor="qf-mode">{t('ship.mode')}</label><select id="qf-mode" data-testid="qf-shipMode" className="input" value={f.shipMode} onChange={(e) => setF({ ...f, shipMode: e.target.value })}><option value="">{t('ship.none')}</option>{SHIP_MODES.map((o) => <option key={o} value={o}>{t(`ship.modes.${o}`)}</option>)}</select></div>
      {inp('shipPort', t('ship.port'), 'Ningbo')}{inp('shipTransit', t('ship.transit'), '20 days')}</div>
    <div><label className="label" htmlFor="qf-notes">{t('lq.notes')}</label><textarea id="qf-notes" className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
    <div><div className="label">{t('lq.media')}</div><FilePicker onPick={(fs) => setFiles((x) => [...x, ...fs])} onError={setErr} />
      {files.length > 0 && <ul className="mt-1 text-xs text-ink-600 dark:text-ink-300">{files.map((x, i) => <li key={i}>{x.name} · {fmtSize(x.size)} <button className="text-rose-600" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></li>)}</ul>}</div>
    {pct != null && <p className="text-xs text-ink-500">{t('leads.uploading', { pct })}</p>}
    {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    <div className="flex gap-2"><button data-testid="qf-save" className="btn-primary" disabled={busy} onClick={() => void save()}>{t('common.save')}</button><button className="btn-outline" onClick={() => onDone(null)}>{t('common.cancel')}</button></div>
  </div>);
}

function QuoteFiles({ quote, canEdit, onChange }: { quote: LeadQuote; canEdit: boolean; onChange: (q: LeadQuote) => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const [thumbs, setThumbs] = useState<Record<string, string>>({}), [videos, setVideos] = useState<Record<string, string>>({});
  const [pct, setPct] = useState<number | null>(null), [err, setErr] = useState<string | null>(null);
  const files = quote.files ?? [];
  const key = files.map((f) => f.id).join(',');
  useEffect(() => {
    let live = true; const made: string[] = [];
    (async () => { for (const a of files.filter((x) => /^image\/(jpeg|png|webp)$/.test(x.mime))) {
      const u = await api.quoteFileUrl(quote.id, a).catch(() => ''); if (!live) return; if (u.startsWith('blob:')) made.push(u); if (u) setThumbs((m) => ({ ...m, [a.id]: u }));
    } })();
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [api, quote.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (a: Attachment, dl: boolean) => {
    const u = thumbs[a.id] ?? await api.quoteFileUrl(quote.id, a).catch(() => ''); if (!u) return;
    const el = document.createElement('a'); el.href = u; el.rel = 'noopener';
    if (dl || !/^image\/|^application\/pdf$/.test(a.mime)) el.download = a.name; else el.target = '_blank'; el.click();
  };
  const play = async (a: Attachment) => { setVideos((v) => ({ ...v, [a.id]: 'loading' })); try { const u = await api.quoteFileUrl(quote.id, a); setVideos((v) => ({ ...v, [a.id]: u })); } catch (e) { setErr((e as Error).message); } };
  const upload = async (fs: File[]) => { setPct(0); setErr(null); try { onChange(await api.uploadQuoteFiles(quote.id, fs, setPct)); } catch (e) { setErr((e as Error).message); } finally { setPct(null); } };
  const del = async (a: Attachment) => { if (!confirm(t('leads.deleteFile', { name: a.name }))) return; try { await api.deleteQuoteFile(quote.id, a.id); onChange({ ...quote, files: files.filter((x) => x.id !== a.id) }); } catch (e) { setErr((e as Error).message); } };
  return (<div className="mt-2">
    {files.length > 0 && <ul className="grid grid-cols-3 gap-2">{files.map((a) => (
      <li key={a.id} data-testid="quote-file" className="overflow-hidden rounded-lg border border-ink-100 dark:border-ink-800">
        {a.mime.startsWith('video/') || isVideoName(a.name) ? (videos[a.id] && videos[a.id] !== 'loading'
          ? <video src={videos[a.id]} controls playsInline className="h-20 w-full bg-black object-contain" />
          : <button className="grid h-20 w-full place-items-center bg-ink-900 text-white" onClick={() => void play(a)}><Play size={22} /></button>)
          : <button className="block w-full" onClick={() => void open(a, false)}>{thumbs[a.id] ? <img src={thumbs[a.id]} alt={a.name} className="h-20 w-full object-cover" /> : <span className="grid h-20 place-items-center bg-ink-50 dark:bg-ink-800"><FileIcon name={a.name} className="h-8 w-8" /></span>}</button>}
        <div className="flex items-center gap-1 px-1.5 py-1"><span className="min-w-0 flex-1 truncate text-[10px] text-ink-600 dark:text-ink-300">{a.name}</span>
          <button aria-label={`${t('leads.download')} ${a.name}`} onClick={() => void open(a, true)} className="text-ink-400"><Download size={12} /></button>
          {canEdit && <button aria-label={`${t('common.remove')} ${a.name}`} onClick={() => void del(a)} className="text-ink-400 hover:text-rose-600"><Trash2 size={12} /></button>}</div>
      </li>))}</ul>}
    {canEdit && <div className="mt-2"><FilePicker onPick={(fs) => void upload(fs)} onError={setErr} /></div>}
    {pct != null && <p className="text-xs text-ink-500">{t('leads.uploading', { pct })}</p>}
    {err && <p role="alert" className="text-xs text-rose-600">{err}</p>}
  </div>);
}
