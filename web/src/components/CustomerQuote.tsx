import { CheckCircle2, Download, FileDown, Mail, MessageCircle, Package, RotateCcw, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { INCOTERMS, SHIP_MODES, type Lead, type LeadQuote , REJECT_REASONS } from '../lib/types';
import { fmtDate } from '../i18n';

export const inr = (n: number | null | undefined) => (n == null ? '—' : `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const absUrl = (u: string) => new URL(u, location.origin).toString();
const waNumber = (p?: string) => { const d = (p ?? '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };

export function QuoteStatusChip({ s }: { s?: string | null }) {
  const { t } = useTranslation(); const v = s ?? 'DRAFT';
  const c = v === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800' : v === 'REJECTED' ? 'bg-rose-100 text-rose-700' : v === 'SENT' ? 'bg-sky-100 text-sky-800' : 'bg-ink-100 text-ink-600';
  return <span data-testid="quote-status" className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`}>{t(`qs.${v}`)}</span>;
}

/** India: prepare the customer quote (INR), preview, generate the branded PDF, send it, then record the customer's decision and create the order. */
export function CustomerQuote({ q, lead, onChange, onLeadStatus }: { q: LeadQuote; lead?: Lead | null; onChange: (q: LeadQuote) => void; onLeadStatus?: (s: string) => void }) {
  const { api, perms } = useApp(); const { t } = useTranslation();
  const c = q.cq;
  const init = () => ({ qty: String(c?.qty ?? lead?.quantity ?? ''), unitPrice: String(c?.unitPrice ?? q.clientPrice ?? ''), gstPct: String(c?.gstPct ?? 18),
    shipCost: String(c?.shipCost ?? ''), shipTerm: c?.shipTerm ?? '', shipMode: c?.shipMode ?? q.shipMode ?? '', port: c?.port ?? '', transit: c?.transit ?? '',
    otherCharges: String(c?.otherCharges ?? ''), otherLabel: c?.otherLabel ?? '', validity: c?.validity ?? q.validity ?? '', terms: c?.terms ?? '' });
  const [mode, setMode] = useState<'form' | 'preview' | null>(null), [f, setF] = useState(init);
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [reason, setReason] = useState<string | null>(null), [code, setCode] = useState('');
  const [order, setOrder] = useState<{ advance: string; paymentStatus: string; expectedShip: string } | null>(null), [orderDone, setOrderDone] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const n = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(/,/g, '')));
  const sub = n(f.qty) * n(f.unitPrice), taxable = sub + n(f.shipCost) + n(f.otherCharges), gst = taxable * n(f.gstPct) / 100;
  const toPreview = () => {
    if (!(n(f.qty) > 0)) return setErr(t('cq.errQty')); if (f.unitPrice.trim() === '' || !(n(f.unitPrice) >= 0)) return setErr(t('cq.errPrice'));
    void run(async () => { onChange(await api.saveCustomerQuote(q.id, { ...f, shipTerm: f.shipTerm || null, shipMode: f.shipMode || null })); setMode('preview'); });
  };
  const status = q.status ?? 'DRAFT', decided = status === 'ACCEPTED' || status === 'REJECTED';
  const ref = q.label ?? q.leadRef ?? '', url = q.pdfUrl ? absUrl(q.pdfUrl) : '';
  const msg = t('cq.msg', { name: lead?.contactName || lead?.clientName || '', ref, product: q.product, url });
  const send = (how: 'wa' | 'mail' | 'dl') => {
    if (!url) return;
    const href = how === 'wa' ? `https://wa.me/${waNumber(lead?.contactPhone)}?text=${encodeURIComponent(msg)}`
      : how === 'mail' ? `mailto:${encodeURIComponent(lead?.contactEmail ?? '')}?subject=${encodeURIComponent(t('cq.subject', { ref, product: q.product }))}&body=${encodeURIComponent(msg)}` : url;
    window.open(href, '_blank', 'noopener');
    if (status === 'DRAFT') void run(async () => onChange(await api.setQuoteStatus(q.id, 'SENT')));
  };
  const decide = (s: 'ACCEPTED' | 'REJECTED', why?: string) => run(async () => { const nq = await api.setQuoteStatus(q.id, s, why || undefined, s === 'REJECTED' ? code : undefined); onChange(nq); setReason(null); onLeadStatus?.(s === 'ACCEPTED' ? 'WON' : 'REJECTED'); });
  const inp = (k: keyof typeof f, label: string, ph?: string, mode: 'decimal' | 'text' = 'decimal') => (<div><label className="label" htmlFor={`cq-${q.id}-${k}`}>{label}</label>
    <input id={`cq-${q.id}-${k}`} data-testid={`cq-${k}`} className="input" inputMode={mode} placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>);
  const sel = (k: 'shipTerm' | 'shipMode', label: string, opts: readonly string[], ns: string) => (<div><label className="label" htmlFor={`cq-${q.id}-${k}`}>{label}</label>
    <select id={`cq-${q.id}-${k}`} data-testid={`cq-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">{t('ship.none')}</option>{opts.map((o) => <option key={o} value={o}>{t(`${ns}.${o}`)}</option>)}</select></div>);
  const T = q.cqTotals;
  return (<div data-testid="cq-box" className="mt-2 rounded-lg bg-brand-50/60 p-2 text-xs dark:bg-brand-500/10">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-ink-500">{t('lq.sellPrice')}:</span><b data-testid="quote-sell" className="text-ink-900 dark:text-white">{q.clientPrice != null ? inr(q.clientPrice) : '—'}</b>
      {T && <span className="text-ink-500">· {t('cq.total')}: <b className="text-ink-900 dark:text-white">{inr(T.total)}</b></span>}
      <QuoteStatusChip s={status} />
      {!mode && !decided && <button data-testid="cq-prepare" className="ml-auto text-brand-600 hover:underline" onClick={() => { setF(init()); setMode('form'); }}>{c ? t('cq.editPrepared') : t('cq.prepare')}</button>}
    </div>
    {q.sentAt && <div className="mt-1 text-ink-500">{t('cq.sentOn', { d: fmtDate(q.sentAt, { day: 'numeric', month: 'short', year: 'numeric' }) })}</div>}
    {decided && <div className="mt-1 text-ink-600">{t('cq.decided', { s: t(`qs.${status}`), d: fmtDate(q.decidedAt ?? '', { day: 'numeric', month: 'short', year: 'numeric' }) })}{q.rejectReason && ` — ${q.rejectReason}`}</div>}
    {mode === 'form' && (<div data-testid="cq-form" className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-white p-3 text-sm dark:border-brand-500/30 dark:bg-ink-900">
      <div className="font-medium text-ink-900 dark:text-white">{t('cq.title')} · {ref}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{inp('unitPrice', t('cq.unitPrice'))}{inp('qty', t('cq.qty'))}{inp('gstPct', t('cq.gst'))}</div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('ship.title')}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{inp('shipCost', t('ship.costInr'))}{sel('shipTerm', t('ship.term'), INCOTERMS, 'ship.terms')}{sel('shipMode', t('ship.mode'), SHIP_MODES, 'ship.modes')}
        {inp('port', t('ship.port'), 'Chennai', 'text')}{inp('transit', t('ship.transit'), '25 days', 'text')}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{inp('otherCharges', t('cq.other'))}{inp('otherLabel', t('cq.otherLabel'), t('cq.otherLabelPh'), 'text')}{inp('validity', t('cq.validity'), t('cq.validityPh'), 'text')}</div>
      <div><label className="label" htmlFor={`cq-${q.id}-terms`}>{t('cq.terms')}</label><textarea id={`cq-${q.id}-terms`} data-testid="cq-terms" className="input min-h-[60px]" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></div>
      <div className="rounded-lg bg-ink-50 p-2 text-xs dark:bg-ink-800">{t('cq.subtotal')}: <b>{inr(sub)}</b> · {t('cq.shipping')}: {inr(n(f.shipCost))} · {t('cq.gstAmt', { p: n(f.gstPct) })}: {inr(gst)} · {t('cq.total')}: <b>{inr(taxable + gst)}</b></div>
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      <div className="flex gap-2"><button data-testid="cq-preview" className="btn-primary" disabled={busy} onClick={toPreview}>{t('cq.preview')}</button><button className="btn-outline" onClick={() => setMode(null)}>{t('common.cancel')}</button></div>
    </div>)}
    {mode === 'preview' && c && T && (<div data-testid="cq-preview-box" className="mt-2 rounded-lg border border-ink-200 bg-white p-4 text-sm shadow-sm dark:border-ink-700 dark:bg-ink-900">
      <div className="flex items-start justify-between border-b-2 border-emerald-600 pb-2"><div><img src="/brand/lockup.png" alt="Source Easy" className="h-12" /><div data-testid="cq-tagline" className="mt-0.5 text-[11px] text-ink-500">Sourcing made easy</div></div><div className="text-right"><div className="text-lg font-bold">QUOTATION</div><div className="text-xs text-ink-500">sourceeasy.in</div></div></div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div><div className="text-ink-400">No.</div><b>{ref}</b></div><div><div className="text-ink-400">{t('cq.validity')}</div><b>{c.validity || '—'}</b></div>
        {(lead?.clientName) && <div><div className="text-ink-400">{t('orders.customer')}</div><b>{lead.clientName}</b></div>}</div>
      <div className="mt-2 font-semibold">{q.product}</div>
      <table className="mt-2 w-full text-xs"><tbody>
        <tr className="border-b border-ink-100"><td className="py-1">{q.product}</td><td className="text-right">{c.qty.toLocaleString('en-IN')} × {inr(c.unitPrice)}</td><td className="text-right">{inr(T.subtotal)}</td></tr>
        <tr className="border-b border-ink-100"><td className="py-1">{t('cq.shipping')}{c.shipMode && ` · ${t(`ship.modes.${c.shipMode}`)}`}{c.shipTerm && ` · ${t(`ship.terms.${c.shipTerm}`)}`}</td><td /><td className="text-right">{inr(c.shipCost)}</td></tr>
        {c.otherCharges > 0 && <tr className="border-b border-ink-100"><td className="py-1">{c.otherLabel || t('cq.other')}</td><td /><td className="text-right">{inr(c.otherCharges)}</td></tr>}
        <tr><td className="py-1" /><td className="text-right">{t('cq.gstAmt', { p: c.gstPct })}</td><td className="text-right">{inr(T.gst)}</td></tr>
        <tr className="font-bold text-emerald-700"><td /><td className="text-right">{t('cq.total')}</td><td data-testid="cq-total" className="text-right">{inr(T.total)}</td></tr>
      </tbody></table>
      {(c.port || c.transit) && <div className="mt-2 text-xs text-ink-600">{c.port && `${t('ship.port')}: ${c.port}`}{c.port && c.transit && ' · '}{c.transit && `${t('ship.transit')}: ${c.transit}`}</div>}
      {c.terms && <p className="mt-2 whitespace-pre-wrap text-xs">{c.terms}</p>}
      <p className="mt-2 text-[11px] text-ink-400">{t('cq.pdfHint')}</p>
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2"><button data-testid="cq-generate" className="btn-primary" disabled={busy} onClick={() => void run(async () => { onChange(await api.quotePdf(q.id)); setMode(null); })}><FileDown size={15} />{q.pdfUrl ? t('cq.regenerate') : t('cq.generate')}</button>
        <button className="btn-outline" onClick={() => setMode('form')}>{t('cq.back')}</button></div>
    </div>)}
    {!mode && q.pdfUrl && !decided && (<div className="mt-2 flex flex-wrap gap-2">
      <button data-testid="cq-download" className="btn-outline !py-1 text-xs" onClick={() => send('dl')}><Download size={13} />{t('cq.download')}</button>
      <button data-testid="cq-wa" className="btn-outline !py-1 text-xs" onClick={() => send('wa')}><MessageCircle size={13} />{t('cq.whatsapp')}</button>
      <button data-testid="cq-mail" className="btn-outline !py-1 text-xs" onClick={() => send('mail')}><Mail size={13} />{t('cq.email')}</button>
      {status === 'DRAFT' && <button data-testid="cq-mark-sent" className="btn-outline !py-1 text-xs" disabled={busy} onClick={() => void run(async () => onChange(await api.setQuoteStatus(q.id, 'SENT')))}><Send size={13} />{t('cq.markSent')}</button>}
    </div>)}
    {!mode && status === 'SENT' && (<div className="mt-2 flex flex-wrap gap-2">
      <button data-testid="cq-accept" className="btn-primary !py-1 text-xs" disabled={busy} onClick={() => void decide('ACCEPTED')}><CheckCircle2 size={13} />{t('cq.accept')}</button>
      <button data-testid="cq-reject" className="btn-outline !py-1 text-xs text-rose-600" disabled={busy} onClick={() => setReason('')}><XCircle size={13} />{t('cq.reject')}</button>
    </div>)}
    {reason != null && (<div className="mt-2 flex flex-wrap gap-2"><select data-testid="cq-reason-code" className="input !w-auto !py-1 text-xs" value={code} onChange={(e) => setCode(e.target.value)}>
        <option value="">{t('rej.pick')}</option>{REJECT_REASONS.map((r) => <option key={r} value={r}>{t(`rej.r.${r}`)}</option>)}</select>
      <input data-testid="cq-reason" className="input !py-1 text-xs flex-1" placeholder={code === 'OTHER' ? t('rej.otherText') : t('rej.optText')} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button data-testid="cq-reject-confirm" className="btn-primary !py-1 text-xs" disabled={busy || !code || (code === 'OTHER' && !reason.trim())} onClick={() => void decide('REJECTED', reason.trim())}>{t('common.save')}</button></div>)}
    {!mode && status === 'ACCEPTED' && !q.orderId && !orderDone && (order ? (<div data-testid="order-form" className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-brand-200 bg-white p-2 sm:grid-cols-4 dark:bg-ink-900">
      <div><label className="label">{t('orders.advance')}</label><input data-testid="of-advance" className="input" inputMode="decimal" value={order.advance} onChange={(e) => setOrder({ ...order, advance: e.target.value })} /></div>
      <div><label className="label">{t('orders.payment')}</label><select data-testid="of-payment" className="input" value={order.paymentStatus} onChange={(e) => setOrder({ ...order, paymentStatus: e.target.value })}>{['PENDING', 'PARTIAL', 'PAID'].map((p) => <option key={p} value={p}>{t(`orders.pay.${p}`)}</option>)}</select></div>
      <div><label className="label">{t('orders.expectedShip')}</label><input data-testid="of-ship" type="date" className="input" value={order.expectedShip} onChange={(e) => setOrder({ ...order, expectedShip: e.target.value })} /></div>
      <div className="flex items-end"><button data-testid="of-create" className="btn-primary" disabled={busy} onClick={() => void run(async () => { const o = await api.createOrder(q.id, { qty: c?.qty, agreedPrice: c?.unitPrice, advance: order.advance || 0, paymentStatus: order.paymentStatus, expectedShip: order.expectedShip || null }); onChange({ ...q, orderId: o.id }); setOrderDone(true); })}><Package size={14} />{t('orders.create')}</button></div>
      <div className="col-span-full text-ink-500">{t('orders.qty')}: {c?.qty} · {t('orders.agreed')}: {inr(c?.unitPrice)}</div>
    </div>) : perms.can('orders.create') && <button data-testid="cq-create-order" className="btn-primary mt-2 !py-1 text-xs" onClick={() => setOrder({ advance: '', paymentStatus: 'PENDING', expectedShip: '' })}><Package size={13} />{t('cq.createOrder')}</button>)}
    {(q.orderId || orderDone) && <a data-testid="cq-order-link" href="#/orders" className="mt-2 inline-flex items-center gap-1 text-brand-600 hover:underline"><Package size={13} />{t('cq.viewOrder')}</a>}
    {!mode && decided && !q.orderId && <button className="ml-2 mt-2 inline-flex items-center gap-1 text-ink-500 hover:underline" onClick={() => void run(async () => onChange(await api.setQuoteStatus(q.id, 'DRAFT')))}><RotateCcw size={12} />{t('cq.reopen')}</button>}
    {err && !mode && <p role="alert" className="mt-1 text-rose-600">{err}</p>}
  </div>);
}
