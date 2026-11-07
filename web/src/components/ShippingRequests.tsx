import { useCallback, useEffect, useState } from 'react';
import { Ship, UserCheck } from 'lucide-react';
import { useApp } from '../lib/store';
import type { ShippingRequestStaff, StaffLite } from '../lib/types';
import { SlideOver } from './ui';

// India office: Shipping Requests (SH-YYMM-NNNN) from the customer portal. English labels (India-only feature). China never gets here (server 403).
const ST: Record<string, string> = { SUBMITTED: 'New', UNDER_REVIEW: 'Under review', NEEDS_INFO: 'Waiting for customer', QUOTED: 'Freight quote sent', ACCEPTED: 'Accepted, to book',
  BOOKED: 'Booked', IN_TRANSIT: 'In transit', ARRIVED: 'Arrived', CUSTOMS: 'Customs', CLEARED: 'Cleared', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const OPEN = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED', 'ACCEPTED'];
const STAGES = ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const MODES = ['', 'SEA', 'AIR', 'EXPRESS', 'ROAD'], TERMS = ['', 'EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'];
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '—');
const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

export function ShippingRequests() {
  const { api, perms } = useApp();
  const [list, setList] = useState<ShippingRequestStaff[] | null>(null), [all, setAll] = useState(false), [openId, setOpenId] = useState<string | null>(() => { const x = sessionStorage.openShippingRequest ?? null; delete sessionStorage.openShippingRequest; return x; });
  const load = useCallback(() => api.shippingRequests?.().then(setList).catch(() => setList([])), [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = (e: Event) => { delete sessionStorage.openShippingRequest; setOpenId((e as CustomEvent<string>).detail); }; addEventListener('open-shipping-request', h); return () => removeEventListener('open-shipping-request', h); }, []);
  if (!api.shippingRequests || !perms.customers) return null;
  const rows = (list ?? []).filter((r) => all || OPEN.includes(r.status));
  return (
    <div className="card mb-6 p-4" data-testid="shipping-requests">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Ship size={16} />Shipping requests</h2>
        <span className="text-xs text-ink-500">{(list ?? []).filter((r) => OPEN.includes(r.status)).length} open</span>
        <label className="ml-auto flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show closed / in transit</label></div>
      {list === null ? <p className="text-sm text-ink-400">Loading…</p> : !rows.length ? <p className="text-sm text-ink-500">No shipping requests.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink-500"><th className="py-1 pr-3">Ref</th><th className="pr-3">Customer</th><th className="pr-3">Goods</th><th className="pr-3">Type</th><th className="pr-3">Status</th><th className="pr-3">Owner</th><th>Raised</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="cursor-pointer border-t border-ink-100 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => setOpenId(r.id)} data-testid={`sr-row-${r.ref}`}>
            <td className="py-2 pr-3 font-mono font-semibold text-brand-700 dark:text-brand-300">{r.ref}</td><td className="pr-3">{r.customer?.company || r.customer?.name}</td>
            <td className="max-w-[16rem] truncate pr-3">{r.goods}</td><td className="pr-3 text-xs">{r.kind === 'SOURCED' ? `Sourced ${r.leadRef ?? ''}` : 'Freight only'}</td>
            <td className="pr-3"><span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{ST[r.status] ?? r.status}</span></td>
            <td className="pr-3 text-xs">{r.assignedToName ?? 'Unclaimed'}</td><td className="text-xs text-ink-500">{when(r.createdAt)}</td></tr>)}</tbody></table></div>)}
      {openId && <SrPanel id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
    </div>
  );
}

function SrPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, session, perms } = useApp();
  const admin = session?.role === 'SUPER_ADMIN' || session?.role === 'INDIA_ADMIN';
  const [r, setR] = useState<ShippingRequestStaff | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [staff, setStaff] = useState<StaffLite[]>([]);
  const [q, setQ] = useState(''), [why, setWhy] = useState(''), [fq, setFq] = useState<Record<string, string>>({ amount: '', internalCost: '', mode: '', incoterm: '', transit: '', validUntil: '', customerNote: '' });
  const [stg, setStg] = useState<Record<string, string>>({ status: 'BOOKED', carrier: '', tracking: '', container: '', etd: '', eta: '' }), [note, setNote] = useState('');
  const load = useCallback(() => api.shippingRequest!(id).then((x) => { setR(x); setNote(x.internalNote ?? ''); setStg((s) => ({ ...s, carrier: x.carrier ?? '', tracking: x.tracking ?? '', container: x.container ?? '', etd: x.etd ?? '', eta: x.eta ?? '',
    status: STAGES[Math.min(STAGES.length - 1, Math.max(0, STAGES.indexOf(x.status) + 1))] })); }).catch((e) => setErr((e as Error).message)), [api, id]);
  useEffect(() => { void load(); if (admin) void api.staff('INDIA').then(setStaff).catch(() => undefined); }, [load, api, admin]);
  const run = async (f: () => Promise<ShippingRequestStaff>) => { setBusy(true); setErr(null); try { const x = await f(); setR(x); onChanged(); void load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const act = (a: Parameters<NonNullable<typeof api.srAction>>[1], b: Record<string, unknown> = {}) => run(() => api.srAction!(id, a, b));
  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
  const open = r && ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED'].includes(r.status);
  const row = (k: string, v: React.ReactNode) => v == null || v === '' ? null : <><dt className="text-ink-500">{k}</dt><dd className="text-ink-900 dark:text-ink-100">{v}</dd></>;
  return (
    <SlideOver open onClose={onClose} title={r ? <span className="font-mono">{r.ref}</span> : 'Shipping request'} subtitle={r ? `${r.kind === 'SOURCED' ? 'Sourced order' : 'Freight only'} · ${ST[r.status] ?? r.status}` : undefined}>
      {!r ? <p className="text-sm text-ink-400">{err ?? 'Loading…'}</p> : <div className="space-y-5 text-sm" data-testid="sr-panel">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          {row('Customer', `${r.customer?.company || r.customer?.name || '—'}${r.customer?.phone ? ` · ${r.customer.phone}` : ''}`)}
          {row('Raised by', r.createdByKind === 'CUSTOMER' ? 'Customer (portal)' : 'Staff')}
          {row('Sourcing lead', r.leadRef)}{row('Goods', r.goods)}{row('Quantity', r.quantity != null ? `${r.quantity} ${r.unit ?? ''}` : null)}
          {row('Packages', r.packages)}{row('Weight', r.weightKg != null ? `${r.weightKg} kg` : null)}{row('Volume', r.cbm != null ? `${r.cbm} CBM` : null)}
          {row('Shipper', [r.shipperName, r.shipperPhone].filter(Boolean).join(' · '))}{row('Pickup', [r.pickupAddress, r.pickupCity].filter(Boolean).join(', '))}
          {row('Destination', [r.destAddress, r.destCity, r.destPincode].filter(Boolean).join(', '))}{row('Mode / term', [r.mode, r.incoterm].filter(Boolean).join(' · '))}
          {row('Ready', r.readyDate)}{row('Customer note', r.customerNote)}{row('Owner', r.assignedToName ?? 'Unclaimed')}{row('Reject reason (internal)', r.rejectReason)}
          {r.progress && row('Shipment', `${ST[r.progress.stage] ?? r.progress.stage}${r.progress.shipmentRef ? ` · ${r.progress.shipmentRef}` : ''}${r.progress.container ? ` · ${r.progress.container}` : ''}`)}
        </dl>
        <div className="flex flex-wrap gap-2">
          {!r.assignedTo && <button disabled={busy} className="btn-primary !py-1 text-xs" onClick={() => void act('assign')} data-testid="sr-claim"><UserCheck size={13} />Claim</button>}
          {admin && staff.length > 0 && <select className="input !w-auto !py-1 text-xs" value={r.assignedTo ?? ''} onChange={(e) => void act('assign', { userId: e.target.value || null })} aria-label="Assign">
            <option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          {r.kind === 'SOURCED' && ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) && <button disabled={busy} className="btn-primary !py-1 text-xs" onClick={() => void act('accept')} data-testid="sr-accept">Accept (ship with the order)</button>}
          {r && [...['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED'], 'ACCEPTED'].includes(r.status) && <button disabled={busy} className="btn-ghost !py-1 text-xs" onClick={() => void act('cancel')}>Cancel</button>}
        </div>
        {open && r.status !== 'NEEDS_INFO' && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800"><div className="text-xs font-medium">Ask the customer for more information</div>
          <p className="text-[11px] text-ink-500">The customer sees this question exactly as written.</p>
          <textarea className="input" rows={2} value={q} onChange={(e) => setQ(e.target.value)} data-testid="sr-question" />
          <button disabled={busy || !q.trim()} className="btn-ghost !py-1 text-xs" onClick={() => void act('needs-info', { question: q }).then(() => setQ(''))}>Send question</button></div>}
        {r.status === 'NEEDS_INFO' && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Waiting for the customer: “{r.question}”</p>}
        {r.kind === 'FREIGHT_ONLY' && ['SUBMITTED', 'UNDER_REVIEW', 'QUOTED'].includes(r.status) && perms.can('quotes.customer') && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800" data-testid="sr-fq-form">
          <div className="text-xs font-medium">Send a freight quote{r.status === 'QUOTED' ? ' (replaces the open one)' : ''}</div>
          <p className="text-[11px] text-ink-500">The customer must accept it in the portal before you can book.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Amount (INR) *<input className="input" inputMode="decimal" value={fq.amount} onChange={(e) => setFq({ ...fq, amount: e.target.value })} data-testid="sr-fq-amount" /></label>
            {perms.can('prices.inr') && <label className="text-xs">Our cost (internal)<input className="input" inputMode="decimal" value={fq.internalCost} onChange={(e) => setFq({ ...fq, internalCost: e.target.value })} /></label>}
            <label className="text-xs">Mode<select className="input" value={fq.mode} onChange={(e) => setFq({ ...fq, mode: e.target.value })}>{MODES.map((m) => <option key={m} value={m}>{m || '—'}</option>)}</select></label>
            <label className="text-xs">Incoterm<select className="input" value={fq.incoterm} onChange={(e) => setFq({ ...fq, incoterm: e.target.value })}>{TERMS.map((m) => <option key={m} value={m}>{m || '—'}</option>)}</select></label>
            <label className="text-xs">Transit<input className="input" value={fq.transit} onChange={(e) => setFq({ ...fq, transit: e.target.value })} placeholder="25 days" /></label>
            <label className="text-xs">Valid until<input className="input" type="date" value={fq.validUntil} onChange={(e) => setFq({ ...fq, validUntil: e.target.value })} /></label>
          </div>
          <label className="block text-xs">Note for the customer<textarea className="input" rows={2} value={fq.customerNote} onChange={(e) => setFq({ ...fq, customerNote: e.target.value })} /></label>
          <button disabled={busy || !fq.amount} className="btn-primary !py-1 text-xs" onClick={() => void act('freight-quotes', clean(fq))} data-testid="sr-fq-send">Send freight quote</button></div>}
        {!!r.freightQuotes?.length && <div><div className="mb-1 text-xs font-medium">Freight quotes</div><ul className="space-y-1 text-xs">{r.freightQuotes.map((x) => <li key={x.id} className="flex flex-wrap gap-x-2">
          <span className="font-mono">{x.label}</span><b>{inr(x.amount)}</b>{x.internalCost != null && <span className="text-ink-500">cost {inr(x.internalCost)}</span>}<span>{x.status}</span>
          {x.reasonCode && <span className="text-rose-600">{x.reasonCode}{x.reason ? `: ${x.reason}` : ''}</span>}<span className="text-ink-400">{when(x.createdAt)}</span></li>)}</ul></div>}
        {r.kind === 'FREIGHT_ONLY' && (r.status === 'ACCEPTED' || STAGES.slice(0, -1).includes(r.status)) && perms.can('orders.production') && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800" data-testid="sr-stage-form">
          <div className="text-xs font-medium">{r.status === 'ACCEPTED' ? 'Book the shipment' : 'Update tracking'}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Stage<select className="input" value={stg.status} onChange={(e) => setStg({ ...stg, status: e.target.value })} data-testid="sr-stage">{STAGES.filter((s) => STAGES.indexOf(s) >= STAGES.indexOf(r.status)).map((s) => <option key={s} value={s}>{ST[s]}</option>)}</select></label>
            {(['carrier', 'tracking', 'container'] as const).map((k) => <label key={k} className="text-xs capitalize">{k}<input className="input" value={stg[k]} onChange={(e) => setStg({ ...stg, [k]: e.target.value })} /></label>)}
            <label className="text-xs">ETD<input className="input" type="date" value={stg.etd} onChange={(e) => setStg({ ...stg, etd: e.target.value })} /></label>
            <label className="text-xs">ETA<input className="input" type="date" value={stg.eta} onChange={(e) => setStg({ ...stg, eta: e.target.value })} /></label>
          </div>
          <button disabled={busy} className="btn-primary !py-1 text-xs" onClick={() => void act('stage', clean(stg))} data-testid="sr-stage-save">Save</button></div>}
        {r.kind === 'SOURCED' && r.status === 'ACCEPTED' && <p className="text-xs text-ink-500">Tracking for this request follows the order's shipment on the Shipping page.</p>}
        {open && <div className="space-y-2 rounded-lg border border-rose-100 p-3 dark:border-rose-500/20"><div className="text-xs font-medium">Reject (reason stays internal)</div>
          <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason" />
          <button disabled={busy || !why.trim()} className="btn-ghost !py-1 text-xs text-rose-600" onClick={() => void act('reject', { reason: why })}>Reject request</button></div>}
        <div className="space-y-1"><div className="text-xs font-medium">Internal note</div><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy || note === (r.internalNote ?? '')} className="btn-ghost !py-1 text-xs" onClick={() => void run(() => api.srPatch!(id, { internalNote: note }))}>Save note</button></div>
        {!!r.files?.length && <div><div className="mb-1 text-xs font-medium">Files</div><ul className="space-y-1 text-xs">{r.files.map((f) => <li key={f.id}>
          <button className="text-brand-600 underline" onClick={() => void api.srFileUrl!(r.id, f.id).then((u) => window.open(u, '_blank', 'noopener'))}>{f.name}</button>
          <span className="ml-2 text-ink-400">{f.customerVisible ? 'from customer' : 'internal'}</span></li>)}</ul></div>}
        {!!r.events?.length && <div><div className="mb-1 text-xs font-medium">Timeline</div><ol className="space-y-1 border-l-2 border-ink-100 pl-3 text-xs dark:border-ink-800">{[...r.events].reverse().map((e, i) => <li key={i}>
          <span className="font-medium">{e.kind.replace(/^SR_|^FQ_/, '').replace(/_/g, ' ').toLowerCase()}</span>{e.by && <span className="text-ink-500"> · {e.by}</span>} <span className="text-ink-400">{when(e.at)}</span>
          {typeof e.data?.message === 'string' && e.data.message && <div className="text-ink-600 dark:text-ink-300">“{e.data.message}”</div>}
          <span className={e.customerVisible ? 'ml-1 text-accent-700' : 'ml-1 text-ink-400'}>{e.customerVisible ? `customer sees: ${e.customerText}` : 'internal'}</span></li>)}</ol></div>}
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>}
    </SlideOver>
  );
}
