import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, FileText, ImagePlus, LogOut, Package, Plus, RefreshCw, Send, Truck, X } from 'lucide-react';
import { PortalApi, PortalHttpError, portalToken, type PortalMe, type PortalQuote, type PortalRequest } from './api';
import { ACCEPT, EXT, MAX_FILES, fmtSize, tooBig } from '../components/EnquiryForm';
import { NewShipping, ShippingDetail, ShippingList } from './Shipping';
import type { PortalShipping } from './api';

// Customer portal (English only, mobile-first). Separate login from the staff app; every call goes to /api/portal/*.
const STAGES: [string, string][] = [['RECEIVED', 'Received'], ['SOURCING', 'Sourcing'], ['QUOTE_READY', 'Quote ready'], ['DECIDED', 'Decided'], ['ORDER', 'Order'], ['SHIPPED', 'Shipped'], ['DELIVERED', 'Delivered']];
const stageLabel = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? s;
const PAY: Record<string, string> = { PENDING: 'Payment pending', ADVANCE: 'Advance received', PARTIAL: 'Partly paid', PAID: 'Paid' };
const SHIP: Record<string, string> = { PENDING: 'Preparing', BOOKED: 'Booked', IN_TRANSIT: 'In transit', ARRIVED: 'Arrived', CUSTOMS: 'In customs', CLEARED: 'Cleared', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered' };
const REASONS: Record<string, string> = { PRICE: 'Price too high', QUALITY: 'Quality / specification', LEAD_TIME: 'Delivery time', MOQ: 'Minimum quantity', SUPPLIER: 'Other source', NO_NEED: 'No longer needed', OTHER: 'Other reason' };
const UNITS = ['pcs', 'kg', 'ton', 'm', 'sqm', 'sets', 'cartons', 'containers'];
const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '');
const field = 'min-h-[48px] w-full rounded-xl border border-ink-200 bg-white px-4 text-[16px] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10';
const btn = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 font-medium transition disabled:opacity-60';
const primary = `${btn} bg-brand-600 text-white hover:bg-brand-700`;
const ghost = `${btn} border border-ink-200 text-ink-700 hover:bg-ink-50`;

type View = { name: 'home' } | { name: 'new' } | { name: 'request'; id: string } | { name: 'newShipping' } | { name: 'shipping'; id: string };
const fromHash = (): View => {
  const h = location.hash, m = /^#\/r\/([\w-]+)$/.exec(h), s = /^#\/s\/([\w-]+)$/.exec(h);
  return h === '#/s/new' ? { name: 'newShipping' } : s ? { name: 'shipping', id: s[1] } : m ? { name: 'request', id: m[1] } : h === '#/new' ? { name: 'new' } : { name: 'home' };
};

function Brand() { return <a href="/" className="flex items-center gap-2"><img src="/brand/mark.png" alt="" className="h-8 w-8 object-contain" /><span className="font-semibold text-ink-900">Source Easy</span><span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Customer portal</span></a>; }

function Login({ api, onIn }: { api: PortalApi; onIn: (mustChange: boolean) => void }) {
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); setErr(null); setBusy(true);
    try { const r = await api.login(String(fd.get('phone') ?? ''), String(fd.get('password') ?? '')); onIn(r.customer.mustChangePassword); }
    catch (x) { setErr(x instanceof PortalHttpError && x.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : 'Wrong mobile number or password.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8"><Brand /></div>
      <h1 className="text-2xl font-semibold text-ink-900">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">Track your sourcing requests, quotes and shipments.</p>
      <form onSubmit={submit} className="space-y-4" data-testid="portal-login">
        <div><label htmlFor="p-phone" className="mb-1 block text-xs font-medium text-ink-600">Mobile number</label>
          <input id="p-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="98765 43210" className={field} /></div>
        <div><label htmlFor="p-pw" className="mb-1 block text-xs font-medium text-ink-600">Password</label>
          <input id="p-pw" name="password" type="password" autoComplete="current-password" required className={field} /></div>
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
        <button disabled={busy} className={`${primary} w-full`}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-sm text-ink-500">No login yet? Tick “Request a customer portal login” when you send an enquiry on <a className="text-brand-600 underline" href="/#contact">our website</a>. Forgot your password? Contact Source Easy and we will reset it.</p>
    </div>
  );
}

function ChangePassword({ api, forced, onDone, onCancel }: { api: PortalApi; forced: boolean; onDone: () => void; onCancel?: () => void }) {
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const n = String(fd.get('new') ?? '');
    if (n !== String(fd.get('again') ?? '')) return setErr('The new passwords do not match.');
    setErr(null); setBusy(true);
    try { await api.changePassword(String(fd.get('current') ?? ''), n); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-md px-5 py-10">
      <h1 className="text-xl font-semibold text-ink-900">{forced ? 'Choose your own password' : 'Change password'}</h1>
      {forced && <p className="mt-1 text-sm text-ink-500">You signed in with a temporary password from Source Easy. Please set a new one (at least 8 characters).</p>}
      <form onSubmit={submit} className="mt-6 space-y-4" data-testid="portal-change-password">
        <input name="current" type="password" autoComplete="current-password" required placeholder={forced ? 'Temporary password' : 'Current password'} className={field} />
        <input name="new" type="password" autoComplete="new-password" minLength={8} required placeholder="New password" className={field} />
        <input name="again" type="password" autoComplete="new-password" minLength={8} required placeholder="New password again" className={field} />
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
        <div className="flex gap-3"><button disabled={busy} className={`${primary} flex-1`}>Save password</button>{onCancel && <button type="button" onClick={onCancel} className={ghost}>Cancel</button>}</div>
      </form>
    </div>
  );
}

function Progress({ r }: { r: PortalRequest }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Progress">
      {STAGES.map(([k, label], i) => (
        <li key={k} className={`rounded-full px-2.5 py-1 text-xs font-medium ${r.closed ? 'bg-ink-100 text-ink-400' : i < r.stageIndex ? 'bg-brand-100 text-brand-700' : i === r.stageIndex ? 'bg-brand-600 text-white' : 'bg-ink-50 text-ink-400'}`}
          aria-current={i === r.stageIndex ? 'step' : undefined}>{label}</li>
      ))}
    </ol>
  );
}

function Home({ list, ships, go }: { list: PortalRequest[] | null; ships: PortalShipping[] | null; go: (h: string) => void }) {
  const waiting = (list ?? []).filter((r) => r.quotesWaiting > 0), fqWaiting = (ships ?? []).filter((r) => r.quoteWaiting).length, info = (ships ?? []).filter((r) => r.canReply).length;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-900">My requests</h1>
        <div className="flex flex-wrap gap-2"><button onClick={() => go('#/new')} className={primary} data-testid="portal-new"><Plus size={18} />Sourcing</button>
          <button onClick={() => go('#/s/new')} className={ghost} data-testid="portal-new-shipping"><Truck size={18} />Shipping</button></div>
      </div>
      {(fqWaiting > 0 || info > 0) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="portal-shipping-waiting">{[fqWaiting && `${fqWaiting} freight quote${fqWaiting > 1 ? 's' : ''} waiting for your decision`, info && `${info} shipping request${info > 1 ? 's need' : ' needs'} more information`].filter(Boolean).join(' · ')}.</div>}
      {waiting.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="portal-waiting">{waiting.length === 1 ? 'A quote is waiting for your decision.' : `${waiting.length} quotes are waiting for your decision.`}</div>}
      {list === null ? <p className="text-sm text-ink-400">Loading…</p> : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">No requests yet. Tap “New request” to tell us what you need.</div>
      ) : (
        <ul className="space-y-3" data-testid="portal-list">
          {list.map((r) => (
            <li key={r.id}><button onClick={() => go(`#/r/${r.id}`)} className="w-full rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-sm hover:border-brand-200">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold text-brand-700">{r.reference}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.closed ? 'bg-ink-100 text-ink-500' : 'bg-brand-50 text-brand-700'}`}>{r.closed ? 'Closed' : stageLabel(r.stage)}</span></div>
              <div className="mt-1 flex items-center justify-between gap-2"><span className="line-clamp-2 text-ink-900">{r.product}</span><ChevronRight size={18} className="shrink-0 text-ink-300" /></div>
              <div className="mt-1 text-xs text-ink-400">{r.quantity ? `${r.quantity} ${r.unit ?? ''} · ` : ''}{when(r.createdAt)}{r.quotesWaiting > 0 && <span className="ml-2 font-medium text-amber-700">· Quote waiting</span>}</div>
            </button></li>
          ))}
        </ul>
      )}
      <ShippingList list={ships} go={go} />
    </div>
  );
}

function NewRequest({ api, done, cancel }: { api: PortalApi; done: (r: PortalRequest) => void; cancel: () => void }) {
  const [files, setFiles] = useState<File[]>([]), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
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
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    if (!String(fd.get('product') ?? '').trim()) return setErr('Describe the product you need.');
    fd.delete('files'); files.forEach((f) => fd.append('files', f, f.name)); setErr(null); setBusy(true);
    try { done(await api.create(fd)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="portal-new-form">
      <button type="button" onClick={cancel} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft size={16} />Back</button>
      <h1 className="text-xl font-semibold text-ink-900">New sourcing request</h1>
      <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-prod">What do you need? *</label><textarea id="n-prod" name="product" rows={3} required className={`${field} py-3`} placeholder="Product, size, material, colour…" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-qty">Quantity</label><input id="n-qty" name="quantity" inputMode="numeric" className={field} /></div>
        <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-unit">Unit</label><select id="n-unit" name="unit" className={field}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-price">Target price (optional)</label><input id="n-price" name="targetPrice" inputMode="decimal" className={field} /></div>
        <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-cur">Currency</label><select id="n-cur" name="currency" className={field}><option>INR</option><option>USD</option><option>CNY</option></select></div>
      </div>
      <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-city">Delivery city</label><input id="n-city" name="deliveryCity" className={field} /></div>
      <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-ref">Reference link (optional)</label><input id="n-ref" name="referenceUrl" type="url" placeholder="https://" className={field} /></div>
      <div><label className="mb-1 block text-xs font-medium text-ink-600" htmlFor="n-msg">Notes</label><textarea id="n-msg" name="message" rows={2} className={`${field} py-3`} /></div>
      <div>
        <span className="mb-1 block text-xs font-medium text-ink-600">Photos, videos, documents (up to {MAX_FILES})</span>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => cam.current?.click()} className={`${ghost} w-full`}><Camera size={18} />Camera</button>
          <button type="button" onClick={() => pick.current?.click()} className={`${ghost} w-full`}><ImagePlus size={18} />Choose files</button>
        </div>
        <input ref={pick} type="file" multiple accept={ACCEPT} className="hidden" data-testid="portal-file-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref={cam} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((f, i) => <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm"><span className="truncate">{f.name} <span className="text-xs text-ink-400">{fmtSize(f.size)}</span></span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-rose-50"><X size={16} /></button></li>)}</ul>}
      </div>
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      <button disabled={busy} className={`${primary} w-full`}><Send size={16} />{busy ? 'Sending…' : 'Send request'}</button>
    </form>
  );
}

function QuoteCard({ q, api, reasons, onChange }: { q: PortalQuote; api: PortalApi; reasons: string[]; onChange: (r: PortalRequest) => void }) {
  const [mode, setMode] = useState<'idle' | 'accept' | 'reject'>('idle'), [code, setCode] = useState('PRICE'), [why, setWhy] = useState(''), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<PortalRequest>) => { setBusy(true); setErr(null); try { onChange(await f()); setMode('idle'); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  return (
    <div className="rounded-xl border border-ink-100 p-4" data-testid={`portal-quote-${q.id}`}>
      <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-ink-500">{q.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${q.status === 'ACCEPTED' ? 'bg-accent-50 text-accent-700' : q.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{q.status === 'SENT' ? 'Waiting for you' : q.status === 'ACCEPTED' ? 'Accepted' : 'Declined'}</span></div>
      <div className="mt-1 text-ink-900">{q.product}</div>
      <div className="mt-1 text-sm text-ink-600">{q.qty ?? '—'} × {inr(q.unitPrice)} · <span className="font-semibold text-ink-900">Total {inr(q.total)}</span></div>
      {(q.moq || q.leadTime || q.validity) && <div className="mt-1 text-xs text-ink-400">{[q.moq && `MOQ ${q.moq}`, q.leadTime && `Lead time ${q.leadTime}`, q.validity && `Valid ${q.validity}`].filter(Boolean).join(' · ')}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void api.openPath(q.pdfUrl).catch(() => setErr('Could not open the PDF'))} className={ghost}><FileText size={16} />Quote PDF</button>
        {q.canDecide && mode === 'idle' && <><button onClick={() => setMode('accept')} className={primary} data-testid="portal-accept">Accept</button><button onClick={() => setMode('reject')} className={ghost} data-testid="portal-reject">Decline</button></>}
      </div>
      {mode === 'accept' && <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">
        <p className="text-ink-700">Accept {q.label} for {inr(q.total)}? Our team will check it and confirm your order.</p>
        <div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => run(() => api.accept(q.id))} className={primary} data-testid="portal-accept-confirm">Yes, accept</button><button onClick={() => setMode('idle')} className={ghost}>Cancel</button></div></div>}
      {mode === 'reject' && <div className="mt-3 space-y-2 rounded-xl bg-ink-50 p-3 text-sm">
        <select value={code} onChange={(e) => setCode(e.target.value)} className={field} aria-label="Reason">{reasons.map((r) => <option key={r} value={r}>{REASONS[r] ?? r}</option>)}</select>
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={500} placeholder={code === 'OTHER' ? 'Tell us why (required)' : 'Anything else? (optional)'} className={`${field} py-3`} />
        <div className="flex gap-2"><button disabled={busy || (code === 'OTHER' && !why.trim())} onClick={() => run(() => api.reject(q.id, code, why))} className={primary} data-testid="portal-reject-confirm">Decline quote</button><button onClick={() => setMode('idle')} className={ghost}>Cancel</button></div></div>}
      {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
    </div>
  );
}

function Detail({ api, id, back, reasons }: { api: PortalApi; id: string; back: () => void; reasons: string[] }) {
  const [r, setR] = useState<PortalRequest | null>(null), [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.request(id).then(setR).catch((x) => setErr((x as Error).message)), [api, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = (e: Event) => { if ((e as CustomEvent).detail === id) void load(); }; addEventListener('portal-change', h); return () => removeEventListener('portal-change', h); }, [id, load]);
  if (err) return <div className="space-y-3"><button onClick={back} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft size={16} />Back</button><p className="text-sm text-rose-600">{err}</p></div>;
  if (!r) return <p className="text-sm text-ink-400">Loading…</p>;
  return (
    <div className="space-y-5" data-testid="portal-detail">
      <button onClick={back} className="inline-flex items-center gap-1 text-sm text-ink-500"><ArrowLeft size={16} />My requests</button>
      <div><div className="font-mono text-sm font-semibold text-brand-700">{r.reference}</div><h1 className="mt-1 text-xl font-semibold text-ink-900">{r.product}</h1>
        <div className="mt-1 text-sm text-ink-500">{[r.quantity && `${r.quantity} ${r.unit ?? ''}`, r.deliveryCity && `to ${r.deliveryCity}`, r.targetPrice && `target ${r.targetPrice.amount} ${r.targetPrice.currency}`].filter(Boolean).join(' · ')}</div></div>
      {r.closed ? <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600">This request is closed.</p> : <Progress r={r} />}
      {!!r.quotes?.length && <section><h2 className="mb-2 font-semibold text-ink-900">Quotes</h2><div className="space-y-3">{r.quotes.map((q) => <QuoteCard key={q.id} q={q} api={api} reasons={reasons} onChange={setR} />)}</div></section>}
      {!!r.orders?.length && <section><h2 className="mb-2 font-semibold text-ink-900">Order</h2><div className="space-y-3">{r.orders.map((o) => (
        <div key={o.id} className="rounded-xl border border-ink-100 p-4 text-sm" data-testid="portal-order">
          <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-ink-900"><Package size={16} />{o.product}</span><span className="font-semibold">{inr(o.value)}</span></div>
          <div className="mt-1 text-ink-500">{o.qty} units · {PAY[o.paymentStatus] ?? o.paymentStatus}</div>
          {o.shipment && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-ink-50 p-2 text-ink-600"><Truck size={16} /><span className="font-medium">{SHIP[o.shipment.status] ?? o.shipment.status}</span>
            {o.shipment.tracking && <span>Tracking {o.shipment.tracking}</span>}{o.shipment.container && <span>Container {o.shipment.container}</span>}{o.shipment.etd && <span>ETD {o.shipment.etd}</span>}{o.shipment.eta && <span>ETA {o.shipment.eta}</span>}</div>}
        </div>))}</div></section>}
      {!!r.files?.length && <section><h2 className="mb-2 font-semibold text-ink-900">Your files</h2><ul className="space-y-1">{r.files.map((f) => <li key={f.id}><button onClick={() => void api.openFile(r.id, f)} className="text-sm text-brand-600 underline">{f.name}</button> <span className="text-xs text-ink-400">{fmtSize(f.size)}</span></li>)}</ul></section>}
      {!!r.timeline?.length && <section><h2 className="mb-2 font-semibold text-ink-900">Timeline</h2><ol className="space-y-2 border-l-2 border-brand-100 pl-4" data-testid="portal-timeline">
        {[...r.timeline].reverse().map((e, i) => <li key={i} className="text-sm"><div className="text-ink-900">{e.text}</div><div className="text-xs text-ink-400">{when(e.at)}</div></li>)}</ol></section>}
    </div>
  );
}

export function Portal() {
  const api = useMemo(() => new PortalApi(), []);
  const [signedIn, setSignedIn] = useState(!!portalToken.get()), [me, setMe] = useState<PortalMe | null>(null), [pw, setPw] = useState(false);
  const [view, setView] = useState<View>(fromHash), [list, setList] = useState<PortalRequest[] | null>(null), [reasons, setReasons] = useState<string[]>(Object.keys(REASONS)), [flash, setFlash] = useState<string | null>(null);
  api.onAuthError = () => { portalToken.set(null); setSignedIn(false); setMe(null); };
  useEffect(() => { const h = () => setView(fromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  const [ships, setShips] = useState<PortalShipping[] | null>(null);
  const refresh = useCallback(() => Promise.all([api.requests().then(setList), api.shippingList().then(setShips)]).catch(() => undefined), [api]);
  useEffect(() => { if (signedIn) void api.me().then(setMe).catch(() => undefined); }, [api, signedIn]);
  const ready = signedIn && me && !me.mustChangePassword;
  useEffect(() => { if (!ready) return; void refresh(); void api.reasons().then(setReasons).catch(() => undefined); }, [ready, api, refresh]);
  // Live updates for this customer's own requests; reconnects after a drop.
  useEffect(() => {
    if (!ready) return; const ctl = new AbortController(); let stop = false;
    const loop = async () => { while (!stop) { try { await api.stream((id) => { void refresh(); dispatchEvent(new CustomEvent('portal-change', { detail: id })); }, ctl.signal); } catch { /* retry */ } if (!stop) await new Promise((r) => setTimeout(r, 3000)); } };
    void loop(); return () => { stop = true; ctl.abort(); };
  }, [ready, api, refresh]);
  const go = (h: string) => { location.hash = h; };
  if (!signedIn) return <Login api={api} onIn={() => { setSignedIn(true); }} />;
  if (!me) return <p className="p-8 text-sm text-ink-400">Loading…</p>;
  if (me.mustChangePassword || pw) return <ChangePassword api={api} forced={me.mustChangePassword} onDone={() => { setPw(false); void api.me().then(setMe); setFlash('Password saved.'); }} onCancel={me.mustChangePassword ? undefined : () => setPw(false)} />;
  return (
    <div className="min-h-screen bg-ink-50/40">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3"><Brand />
          <div className="flex items-center gap-1 text-sm"><span className="hidden text-ink-500 sm:inline">{me.company || me.name}</span>
            <button onClick={() => void refresh()} aria-label="Refresh" className="grid h-10 w-10 place-items-center rounded-lg text-ink-500 hover:bg-ink-50"><RefreshCw size={18} /></button>
            <button onClick={() => setPw(true)} className="rounded-lg px-2 py-2 text-ink-600 hover:bg-ink-50">Password</button>
            <button onClick={() => { api.logout(); setSignedIn(false); setMe(null); }} aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-lg text-ink-500 hover:bg-ink-50" data-testid="portal-logout"><LogOut size={18} /></button></div></div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {flash && <div role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-accent-50 p-3 text-sm text-accent-800"><CheckCircle2 size={16} />{flash}<button className="ml-auto" aria-label="Dismiss" onClick={() => setFlash(null)}><X size={14} /></button></div>}
        {view.name === 'home' && <Home list={list} ships={ships} go={go} />}
        {view.name === 'newShipping' && <NewShipping api={api} cancel={() => go('#/')} done={(r) => { setFlash(`Shipping request ${r.reference} sent. Our team will review it.`); void refresh(); go(`#/s/${r.id}`); }} />}
        {view.name === 'shipping' && <ShippingDetail api={api} id={view.id} reasons={reasons} back={() => go('#/')} />}
        {view.name === 'new' && <NewRequest api={api} cancel={() => go('#/')} done={(r) => { setFlash(`Request ${r.reference} sent. Our team will get back to you.`); void refresh(); go(`#/r/${r.id}`); }} />}
        {view.name === 'request' && <Detail api={api} id={view.id} reasons={reasons} back={() => go('#/')} />}
      </main>
    </div>
  );
}
