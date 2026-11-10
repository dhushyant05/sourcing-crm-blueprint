import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Camera, ChevronRight, ImagePlus, Send, Ship, X } from 'lucide-react';
import type { PortalApi, PortalFreightQuote, PortalShippableOrder, PortalShipping } from './api';
import { WorkflowTracker } from './Workflow';
import { PortalHttpError } from './api';
import { ACCEPT, EXT, MAX_FILES, fmtSize, tooBig } from '../components/EnquiryForm';

// Customer portal: Shipping Requests (SH-YYMM-NNNN). English only, mobile-first.
const field = 'min-h-[48px] w-full rounded-xl border border-ink-200 bg-white px-4 text-[16px] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10';
const btn = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 font-medium transition disabled:opacity-60';
const primary = `${btn} bg-brand-600 text-white hover:bg-brand-700`;
const ghost = `${btn} border border-ink-200 text-ink-700 hover:bg-ink-50`;
const lbl = 'mb-1 block text-xs font-medium text-ink-600';
const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '');
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
export const SR_STATUS: Record<string, string> = { SUBMITTED: 'Received', UNDER_REVIEW: 'Being reviewed', NEEDS_INFO: 'Info needed', QUOTED: 'Freight quote ready', ACCEPTED: 'Accepted',
  PENDING: 'Awaiting booking', BOOKED: 'Booked', IN_TRANSIT: 'In transit', ARRIVED: 'Arrived', CUSTOMS: 'In customs', CLEARED: 'Customs cleared', OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered', REJECTED: 'Declined', CANCELLED: 'Cancelled' };
const STEPS = ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CLEARED', 'DELIVERED'];
const REASONS: Record<string, string> = { PRICE: 'Price too high', QUALITY: 'Quality / specification', LEAD_TIME: 'Delivery time', MOQ: 'Minimum quantity', SUPPLIER: 'Other source', NO_NEED: 'No longer needed', OTHER: 'Other reason' };
const MODES: [string, string][] = [['', 'Not sure'], ['SEA', 'Sea'], ['AIR', 'Air'], ['EXPRESS', 'Courier / express'], ['ROAD', 'Road']];
/** Status shown to the customer: a sourced request follows its shipment once accepted. */
export const srShown = (r: PortalShipping) => (r.status === 'ACCEPTED' && r.tracking ? r.tracking.stage : r.status);

function useFiles() {
  const [files, setFiles] = useState<File[]>([]), [err, setErr] = useState<string | null>(null);
  const add = (l: FileList | null) => {
    if (!l) return; const next = [...files];
    for (const f of Array.from(l)) {
      if (next.length >= MAX_FILES) { setErr(`Up to ${MAX_FILES} files.`); break; }
      if (!EXT.includes((f.name.split('.').pop() ?? '').toLowerCase())) { setErr(`File type not allowed: ${f.name}`); continue; }
      if (tooBig(f)) { setErr(`Too large: ${f.name} (photos/documents 10 MB, videos 100 MB)`); continue; }
      next.push(f);
    }
    setFiles(next);
  };
  return { files, setFiles, add, err, setErr };
}
function FilePicker({ f, label }: { f: ReturnType<typeof useFiles>; label: string }) {
  const pick = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className={lbl}>{label} (up to {MAX_FILES})</span>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => cam.current?.click()} className={`${ghost} w-full`}><Camera size={18} />Camera</button>
        <button type="button" onClick={() => pick.current?.click()} className={`${ghost} w-full`}><ImagePlus size={18} />Choose files</button>
      </div>
      <input ref={pick} type="file" multiple accept={ACCEPT} className="hidden" data-testid="sr-file-input" onChange={(e) => { f.add(e.target.files); e.target.value = ''; }} />
      <input ref={cam} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { f.add(e.target.files); e.target.value = ''; }} />
      {f.files.length > 0 && <ul className="mt-2 space-y-1">{f.files.map((x, i) => <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm"><span className="truncate">{x.name} <span className="text-xs text-ink-400">{fmtSize(x.size)}</span></span>
        <button type="button" aria-label={`Remove ${x.name}`} onClick={() => f.setFiles(f.files.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-rose-50"><X size={16} /></button></li>)}</ul>}
    </div>
  );
}

export function ShippingList({ list, go }: { list: PortalShipping[] | null; go: (h: string) => void }) {
  if (!list?.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-ink-900">Shipping requests</h2>
      <ul className="space-y-3" data-testid="portal-shipping-list">
        {list.map((r) => { const st = srShown(r); return (
          <li key={r.id}><button onClick={() => go(`#/s/${r.id}`)} className="w-full rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-sm hover:border-brand-200">
            <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold text-brand-700">{r.reference}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${['REJECTED', 'CANCELLED'].includes(st) ? 'bg-ink-100 text-ink-500' : st === 'NEEDS_INFO' || r.quoteWaiting ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-700'}`}>{SR_STATUS[st] ?? st}</span></div>
            <div className="mt-1 flex items-center justify-between gap-2"><span className="line-clamp-2 text-ink-900">{r.goods}</span><ChevronRight size={18} className="shrink-0 text-ink-300" /></div>
            <div className="mt-1 text-xs text-ink-400">{r.kind === 'SOURCED' ? `Our order ${r.leadReference ?? ''} · ` : 'Your own goods · '}to {r.destCity ?? '—'} · {when(r.createdAt)}</div>
            {r.workflow && <div className="mt-2"><WorkflowTracker flow={r.workflow} compact /></div>}
          </button></li>
        ); })}
      </ul>
    </section>
  );
}

export function NewShipping({ api, done, cancel }: { api: PortalApi; done: (r: PortalShipping) => void; cancel: () => void }) {
  const [kind, setKind] = useState<'FREIGHT_ONLY' | 'SOURCED'>('FREIGHT_ONLY'), [orders, setOrders] = useState<PortalShippableOrder[] | null>(null), [busy, setBusy] = useState(false);
  const f = useFiles();
  useEffect(() => { void api.shippableOrders().then(setOrders).catch(() => setOrders([])); }, [api]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set('kind', kind);
    if (kind === 'SOURCED' && !fd.get('orderId')) return f.setErr('Choose the order to ship.');
    if (kind === 'FREIGHT_ONLY' && !String(fd.get('goods') ?? '').trim()) return f.setErr('Describe the goods.');
    if (!String(fd.get('destCity') ?? '').trim()) return f.setErr('Destination city is required.');
    for (const [k, v] of [...fd.entries()]) if (v === '') fd.delete(k);
    fd.delete('files'); f.files.forEach((x) => fd.append('files', x, x.name)); f.setErr(null); setBusy(true);
    try { done(await api.createShipping(fd)); } catch (x) { f.setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="portal-shipping-form">
      <button type="button" onClick={cancel} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft size={16} />Back</button>
      <h1 className="text-xl font-semibold text-ink-900">New shipping request</h1>
      <div role="radiogroup" aria-label="What are we shipping?" className="grid grid-cols-2 gap-2">
        {([['FREIGHT_ONLY', 'My own goods'], ['SOURCED', 'An order from Source Easy']] as const).map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} data-testid={`sr-kind-${k}`}
            className={`min-h-[48px] rounded-xl border px-3 text-sm font-medium ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600'}`}>{t}</button>))}
      </div>
      {kind === 'SOURCED' ? (
        <div><label className={lbl} htmlFor="s-order">Order *</label>
          {orders && !orders.length ? <p className="text-sm text-ink-500">No confirmed orders waiting for shipping.</p>
            : <select id="s-order" name="orderId" className={field} required>{(orders ?? []).map((o) => <option key={o.id} value={o.id}>{o.leadReference} · {o.product} · {o.qty}</option>)}</select>}</div>
      ) : (
        <>
          <div><label className={lbl} htmlFor="s-goods">Goods *</label><textarea id="s-goods" name="goods" rows={2} required className={`${field} py-3`} placeholder="What is being shipped" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl} htmlFor="s-qty">Quantity</label><input id="s-qty" name="quantity" inputMode="decimal" className={field} /></div>
            <div><label className={lbl} htmlFor="s-unit">Unit</label><input id="s-unit" name="unit" placeholder="cartons, pcs…" className={field} /></div>
            <div><label className={lbl} htmlFor="s-pk">Packages</label><input id="s-pk" name="packages" inputMode="numeric" className={field} /></div>
            <div><label className={lbl} htmlFor="s-kg">Weight (kg)</label><input id="s-kg" name="weightKg" inputMode="decimal" className={field} /></div>
            <div><label className={lbl} htmlFor="s-cbm">Volume (CBM)</label><input id="s-cbm" name="cbm" inputMode="decimal" className={field} /></div>
            <div><label className={lbl} htmlFor="s-ready">Ready date</label><input id="s-ready" name="readyDate" type="date" className={field} /></div>
          </div>
          <fieldset className="space-y-3"><legend className="mb-1 text-sm font-semibold text-ink-800">Pickup (your supplier)</legend>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl} htmlFor="s-sn">Shipper name</label><input id="s-sn" name="shipperName" className={field} /></div>
              <div><label className={lbl} htmlFor="s-sp">Shipper phone</label><input id="s-sp" name="shipperPhone" type="tel" className={field} /></div>
            </div>
            <div><label className={lbl} htmlFor="s-pc">Pickup city *</label><input id="s-pc" name="pickupCity" required className={field} placeholder="e.g. Yiwu" /></div>
            <div><label className={lbl} htmlFor="s-pa">Pickup address</label><textarea id="s-pa" name="pickupAddress" rows={2} className={`${field} py-3`} /></div>
          </fieldset>
        </>
      )}
      <fieldset className="space-y-3"><legend className="mb-1 text-sm font-semibold text-ink-800">Destination</legend>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl} htmlFor="s-dc">City *</label><input id="s-dc" name="destCity" required className={field} /></div>
          <div><label className={lbl} htmlFor="s-dp">Pincode</label><input id="s-dp" name="destPincode" inputMode="numeric" className={field} /></div>
        </div>
        <div><label className={lbl} htmlFor="s-da">Address</label><textarea id="s-da" name="destAddress" rows={2} className={`${field} py-3`} /></div>
      </fieldset>
      <div><label className={lbl} htmlFor="s-mode">Mode</label><select id="s-mode" name="mode" className={field}>{MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      <div><label className={lbl} htmlFor="s-note">Notes</label><textarea id="s-note" name="customerNote" rows={2} className={`${field} py-3`} /></div>
      <FilePicker f={f} label="Invoice, packing list, photos" />
      {f.err && <p role="alert" className="text-sm text-rose-600">{f.err}</p>}
      <button disabled={busy} className={`${primary} w-full`}><Send size={16} />{busy ? 'Sending…' : 'Send shipping request'}</button>
    </form>
  );
}

function FreightCard({ q, api, reasons, onChange, reload }: { q: PortalFreightQuote; api: PortalApi; reasons: string[]; onChange: (r: PortalShipping) => void; reload: () => void }) {
  const [mode, setMode] = useState<'idle' | 'accept' | 'reject'>('idle'), [code, setCode] = useState('PRICE'), [why, setWhy] = useState(''), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<PortalShipping>) => { setBusy(true); setErr(null); try { onChange(await f()); setMode('idle'); } catch (x) { setErr((x as Error).message); if ((x as PortalHttpError).status === 409) { setMode('idle'); reload(); } } finally { setBusy(false); } };
  const tone = q.status === 'ACCEPTED' ? 'bg-accent-50 text-accent-700' : q.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : q.status === 'WITHDRAWN' ? 'bg-ink-100 text-ink-500' : 'bg-amber-50 text-amber-800';
  return (
    <div className="rounded-xl border border-ink-100 p-4" data-testid={`portal-fq-${q.id}`}>
      <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-ink-500">{q.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{q.status === 'SENT' ? 'Waiting for you' : q.status === 'ACCEPTED' ? 'Accepted' : q.status === 'REJECTED' ? 'Declined' : 'Replaced'}</span></div>
      <div className="mt-1 text-lg font-semibold text-ink-900">{inr(q.amount)}</div>
      <div className="text-xs text-ink-500">{[q.mode && MODES.find(([k]) => k === q.mode)?.[1], q.incoterm, q.transit && `Transit ${q.transit}`, q.validUntil && `Valid until ${day(q.validUntil)}`].filter(Boolean).join(' · ')}</div>
      {q.note && <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{q.note}</p>}
      <button type="button" onClick={() => void api.freightPdf(q.id).catch(() => setErr('Could not open the PDF'))} className={`${ghost} mt-3`} data-testid="fq-pdf">Freight quote PDF</button>
      {q.canDecide && mode === 'idle' && <div className="mt-3 flex gap-2"><button onClick={() => setMode('accept')} className={primary} data-testid="fq-accept">Accept</button><button onClick={() => setMode('reject')} className={ghost} data-testid="fq-reject">Decline</button></div>}
      {mode === 'accept' && <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm"><p className="text-ink-700">Accept {q.label} for {inr(q.amount)}? Source Easy will then book the shipment.</p>
        <div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => run(() => api.acceptFreight(q))} className={primary} data-testid="fq-accept-confirm">Yes, accept</button><button onClick={() => setMode('idle')} className={ghost}>Cancel</button></div></div>}
      {mode === 'reject' && <div className="mt-3 space-y-2 rounded-xl bg-ink-50 p-3 text-sm">
        <select value={code} onChange={(e) => setCode(e.target.value)} className={field} aria-label="Reason">{reasons.map((r) => <option key={r} value={r}>{REASONS[r] ?? r}</option>)}</select>
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="Anything we should know? (optional)" className={`${field} py-3`} />
        <div className="flex gap-2"><button disabled={busy} onClick={() => run(() => api.rejectFreight(q.id, code, why))} className={primary} data-testid="fq-reject-confirm">Decline quote</button><button onClick={() => setMode('idle')} className={ghost}>Cancel</button></div></div>}
      {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
    </div>
  );
}

export function ShippingDetail({ api, id, back, reasons }: { api: PortalApi; id: string; back: () => void; reasons: string[] }) {
  const [r, setR] = useState<PortalShipping | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  const f = useFiles();
  const load = useCallback(() => api.shipping(id).then(setR).catch((x) => setErr((x as Error).message)), [api, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = (e: Event) => { if ((e as CustomEvent).detail === id) void load(); }; addEventListener('portal-change', h); return () => removeEventListener('portal-change', h); }, [id, load]);
  if (err && !r) return <div className="space-y-3"><button onClick={back} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft size={16} />Back</button><p className="text-sm text-rose-600">{err}</p></div>;
  if (!r) return <p className="text-sm text-ink-400">Loading…</p>;
  const st = srShown(r), si = STEPS.indexOf(st === 'NEEDS_INFO' || st === 'QUOTED' ? 'UNDER_REVIEW' : st === 'CUSTOMS' ? 'ARRIVED' : st === 'OUT_FOR_DELIVERY' ? 'CLEARED' : st === 'PENDING' ? 'ACCEPTED' : st);
  const closed = ['REJECTED', 'CANCELLED'].includes(st);
  const reply = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    if (!String(fd.get('message') ?? '').trim() && !f.files.length) return f.setErr('Write a reply or attach a file.');
    fd.delete('files'); f.files.forEach((x) => fd.append('files', x, x.name)); setBusy(true); f.setErr(null);
    try { setR(await api.replyShipping(r.id, fd)); f.setFiles([]); } catch (x) { f.setErr((x as Error).message); } finally { setBusy(false); }
  };
  const t = r.tracking;
  return (
    <div className="space-y-5" data-testid="portal-shipping-detail">
      <button onClick={back} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft size={16} />Back</button>
      <div><div className="flex items-center gap-2"><Ship size={18} className="text-brand-600" /><span className="font-mono text-sm font-semibold text-brand-700">{r.reference}</span>
        {r.leadReference && <span className="text-xs text-ink-400">for order {r.leadReference}</span>}</div>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">{r.goods}</h1>
        <p className="text-sm text-ink-500">{SR_STATUS[st] ?? st} · {r.kind === 'SOURCED' ? 'Order from Source Easy' : 'Your own goods'}</p></div>
      {r.workflow ? <WorkflowTracker flow={r.workflow} /> : !closed && <ol className="flex flex-wrap gap-1.5" aria-label="Progress">{STEPS.map((k, i) => <li key={k} className={`rounded-full px-2.5 py-1 text-xs font-medium ${i < si ? 'bg-brand-100 text-brand-700' : i === si ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-400'}`} aria-current={i === si ? 'step' : undefined}>{SR_STATUS[k]}</li>)}</ol>}
      {r.canReply && <form onSubmit={reply} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="sr-reply">
        <p className="text-sm font-medium text-amber-900">Source Easy needs more information</p>
        {r.question && <p className="whitespace-pre-line text-sm text-amber-900">{r.question}</p>}
        <textarea name="message" rows={3} className={`${field} py-3`} placeholder="Your answer" />
        <FilePicker f={f} label="Files" />
        {f.err && <p role="alert" className="text-sm text-rose-600">{f.err}</p>}
        <button disabled={busy} className={primary}><Send size={16} />{busy ? 'Sending…' : 'Send'}</button>
      </form>}
      {!!r.freightQuotes?.length && <section className="space-y-3"><h2 className="font-semibold text-ink-900">Freight quotes</h2>
        {[...r.freightQuotes].reverse().map((q) => <FreightCard key={q.id} q={q} api={api} reasons={reasons} onChange={setR} reload={() => void load()} />)}</section>}
      {t && <section className="rounded-2xl border border-ink-100 bg-white p-4 text-sm"><h2 className="mb-2 font-semibold text-ink-900">Tracking</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-ink-500">Stage</dt><dd>{SR_STATUS[t.stage] ?? t.stage}</dd>
          {t.carrier && <><dt className="text-ink-500">Carrier</dt><dd>{t.carrier}</dd></>}
          {t.tracking && <><dt className="text-ink-500">Tracking</dt><dd className="font-mono">{t.tracking}</dd></>}
          {t.container && <><dt className="text-ink-500">Container</dt><dd className="font-mono">{t.container}</dd></>}
          <dt className="text-ink-500">ETD</dt><dd>{day(t.etd)}</dd><dt className="text-ink-500">ETA</dt><dd>{day(t.eta)}</dd>
          {t.deliveredAt && <><dt className="text-ink-500">Delivered</dt><dd>{day(t.deliveredAt)}</dd></>}
        </dl></section>}
      <section className="rounded-2xl border border-ink-100 bg-white p-4 text-sm"><h2 className="mb-2 font-semibold text-ink-900">Details</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          {r.quantity != null && <><dt className="text-ink-500">Quantity</dt><dd>{r.quantity} {r.unit ?? ''}</dd></>}
          {r.packages != null && <><dt className="text-ink-500">Packages</dt><dd>{r.packages}</dd></>}
          {r.weightKg != null && <><dt className="text-ink-500">Weight</dt><dd>{r.weightKg} kg</dd></>}
          {r.cbm != null && <><dt className="text-ink-500">Volume</dt><dd>{r.cbm} CBM</dd></>}
          {(r.pickupCity || r.pickupAddress) && <><dt className="text-ink-500">Pickup</dt><dd>{[r.shipperName, r.pickupAddress, r.pickupCity].filter(Boolean).join(', ')}</dd></>}
          <dt className="text-ink-500">Destination</dt><dd>{[r.destAddress, r.destCity, r.destPincode].filter(Boolean).join(', ') || '—'}</dd>
          {r.mode && <><dt className="text-ink-500">Mode</dt><dd>{MODES.find(([k]) => k === r.mode)?.[1] ?? r.mode}</dd></>}
          {r.readyDate && <><dt className="text-ink-500">Ready</dt><dd>{day(r.readyDate)}</dd></>}
        </dl>
        {r.customerNote && <p className="mt-2 whitespace-pre-line text-ink-600">{r.customerNote}</p>}</section>
      {!!r.files?.length && <section><h2 className="mb-2 font-semibold text-ink-900">Your files</h2><ul className="space-y-1">{r.files.map((x) => <li key={x.id}><button onClick={() => void api.openFile(r.id, x, 'shipping-requests')} className="text-sm text-brand-600 underline">{x.name}</button> <span className="text-xs text-ink-400">{fmtSize(x.size)}</span></li>)}</ul></section>}
      {!!r.timeline?.length && <section><h2 className="mb-2 font-semibold text-ink-900">Timeline</h2><ol className="space-y-2 border-l-2 border-brand-100 pl-4" data-testid="sr-timeline">
        {[...r.timeline].reverse().map((e, i) => <li key={i} className="text-sm"><div className="whitespace-pre-line text-ink-900">{e.text}</div><div className="text-xs text-ink-400">{when(e.at)}</div></li>)}</ol></section>}
      {r.canCancel && (confirmCancel
        ? <div className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm"><span className="flex-1 text-rose-800">Cancel this shipping request?</span><button className={ghost} onClick={() => void api.cancelShipping(r.id).then(setR).catch((x) => setErr((x as Error).message))} data-testid="sr-cancel-confirm">Yes, cancel</button><button className={ghost} onClick={() => setConfirmCancel(false)}>No</button></div>
        : <button className="text-sm text-rose-600 underline" onClick={() => setConfirmCancel(true)} data-testid="sr-cancel">Cancel request</button>)}
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    </div>
  );
}
