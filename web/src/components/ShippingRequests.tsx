import { useCallback, useEffect, useState } from 'react';
import { Plus, Ship, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { Customer, ShippingRequestStaff, StaffLite } from '../lib/types';
import { SlideOver } from './ui';

// India office: Shipping Requests (SH-YYMM-NNNN). Staff labels in EN / 中文 (sr.*). China never gets here (server 403).
const OPEN = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED', 'ACCEPTED'];
const STAGES = ['BOOKED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const MODES = ['', 'SEA', 'AIR', 'EXPRESS', 'ROAD'], TERMS = ['', 'EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'];
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '—');
const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

export function ShippingRequests() {
  const { api, perms } = useApp(); const { t } = useTranslation(); const st = (x: string) => t(`sr.st.${x}`, { defaultValue: x });
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState<ShippingRequestStaff[] | null>(null), [all, setAll] = useState(false), [openId, setOpenId] = useState<string | null>(() => { const x = sessionStorage.openShippingRequest ?? null; delete sessionStorage.openShippingRequest; return x; });
  const load = useCallback(() => api.shippingRequests?.().then(setList).catch(() => setList([])), [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = (e: Event) => { delete sessionStorage.openShippingRequest; setOpenId((e as CustomEvent<string>).detail); }; addEventListener('open-shipping-request', h); return () => removeEventListener('open-shipping-request', h); }, []);
  if (!api.shippingRequests || !perms.customers) return null;
  const rows = (list ?? []).filter((r) => all || OPEN.includes(r.status));
  return (
    <div className="card mb-6 p-4" data-testid="shipping-requests">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Ship size={16} />{t('sr.title')}</h2>
        <span className="text-xs text-ink-500">{(list ?? []).filter((r) => OPEN.includes(r.status)).length} open</span>
        {api.createShippingRequest && <button className="btn-primary !py-1 text-xs" onClick={() => setCreating(true)} data-testid="sr-new"><Plus size={13} />{t('sr.new')}</button>}
        <label className="ml-auto flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('sr.showClosed')}</label></div>
      {list === null ? <p className="text-sm text-ink-400">{t('sr.loading')}</p> : !rows.length ? <p className="text-sm text-ink-500">{t('sr.none')}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink-500"><th className="py-1 pr-3">{t('sr.col.ref')}</th><th className="pr-3">{t('sr.col.customer')}</th><th className="pr-3">{t('sr.col.goods')}</th><th className="pr-3">{t('sr.col.type')}</th><th className="pr-3">{t('sr.col.status')}</th><th className="pr-3">{t('sr.col.owner')}</th><th className="pr-3">{t('sr.col.sla')}</th><th>{t('sr.col.raised')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="cursor-pointer border-t border-ink-100 hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => setOpenId(r.id)} data-testid={`sr-row-${r.ref}`}>
            <td className="py-2 pr-3 font-mono font-semibold text-brand-700 dark:text-brand-300">{r.ref}</td><td className="pr-3">{r.customer?.company || r.customer?.name}</td>
            <td className="max-w-[16rem] truncate pr-3">{r.goods}</td><td className="pr-3 text-xs">{r.kind === 'SOURCED' ? `${t('sr.sourced')} ${r.leadRef ?? ''}` : t('sr.freightOnly')}</td>
            <td className="pr-3"><span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{st(r.status)}</span></td>
            <td className="pr-3 text-xs">{r.assignedToName ?? t('sr.unclaimed')}</td><td className={`pr-3 text-xs ${r.sla?.breached ? 'font-semibold text-rose-600' : r.sla?.warned ? 'text-amber-700' : 'text-ink-500'}`} data-testid={`sr-sla-${r.ref}`}>{r.sla ? (r.sla.breached ? t('sr.slaBreached') : t('sr.slaDue', { at: when(r.sla.dueAt) })) : '—'}</td><td className="text-xs text-ink-500">{when(r.createdAt)}</td></tr>)}</tbody></table></div>)}
      {creating && <NewSr onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void load(); setOpenId(id); }} />}
      {openId && <SrPanel id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
    </div>
  );
}

function SrPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, session, perms } = useApp(); const { t } = useTranslation(); const st = (x: string) => t(`sr.st.${x}`, { defaultValue: x });
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
    <SlideOver open onClose={onClose} title={r ? <span className="font-mono">{r.ref}</span> : t('sr.one')} subtitle={r ? `${r.kind === 'SOURCED' ? t('sr.sourcedOrder') : t('sr.freightOnly')} · ${st(r.status)}` : undefined}>
      {!r ? <p className="text-sm text-ink-400">{err ?? t('sr.loading')}</p> : <div className="space-y-5 text-sm" data-testid="sr-panel">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          {row(t('sr.f.customer'), `${r.customer?.company || r.customer?.name || '—'}${r.customer?.phone ? ` · ${r.customer.phone}` : ''}`)}
          {row(t('sr.f.raisedBy'), r.createdByKind === 'CUSTOMER' ? t('sr.byCustomer') : t('sr.byStaff'))}
          {row(t('sr.f.lead'), r.leadRef)}{row(t('sr.f.goods'), r.goods)}{row(t('sr.f.qty'), r.quantity != null ? `${r.quantity} ${r.unit ?? ''}` : null)}
          {row(t('sr.f.packages'), r.packages)}{row(t('sr.f.weight'), r.weightKg != null ? `${r.weightKg} kg` : null)}{row(t('sr.f.volume'), r.cbm != null ? `${r.cbm} CBM` : null)}
          {row(t('sr.f.shipper'), [r.shipperName, r.shipperPhone].filter(Boolean).join(' · '))}{row(t('sr.f.pickup'), [r.pickupAddress, r.pickupCity].filter(Boolean).join(', '))}
          {row(t('sr.f.dest'), [r.destAddress, r.destCity, r.destPincode].filter(Boolean).join(', '))}{row(t('sr.f.modeTerm'), [r.mode, r.incoterm].filter(Boolean).join(' · '))}
          {row(t('sr.f.ready'), r.readyDate)}{row(t('sr.f.note'), r.customerNote)}{r.sla && row(t('sr.col.sla'), r.sla.breached ? t('sr.slaBreached') : t('sr.slaDue', { at: when(r.sla.dueAt) }))}{row(t('sr.f.owner'), r.assignedToName ?? t('sr.unclaimed'))}{row(t('sr.f.rejectReason'), r.rejectReason)}
          {r.progress && row(t('sr.f.shipment'), `${st(r.progress.stage)}${r.progress.shipmentRef ? ` · ${r.progress.shipmentRef}` : ''}${r.progress.container ? ` · ${r.progress.container}` : ''}`)}
        </dl>
        <div className="flex flex-wrap gap-2">
          {!r.assignedTo && <button disabled={busy} className="btn-primary !py-1 text-xs" onClick={() => void act('assign')} data-testid="sr-claim"><UserCheck size={13} />{t('sr.claim')}</button>}
          {admin && staff.length > 0 && <select className="input !w-auto !py-1 text-xs" value={r.assignedTo ?? ''} onChange={(e) => void act('assign', { userId: e.target.value || null })} aria-label={t('sr.assign')}>
            <option value="">{t('sr.unassigned')}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          {r.kind === 'SOURCED' && ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) && <button disabled={busy} className="btn-primary !py-1 text-xs" onClick={() => void act('accept')} data-testid="sr-accept">{t('sr.acceptSourced')}</button>}
          {r && [...['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'QUOTED'], 'ACCEPTED'].includes(r.status) && <button disabled={busy} className="btn-ghost !py-1 text-xs" onClick={() => void act('cancel')}>{t('sr.cancel')}</button>}
        </div>
        {open && r.status !== 'NEEDS_INFO' && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800"><div className="text-xs font-medium">{t('sr.ask')}</div>
          <p className="text-[11px] text-ink-500">{t('sr.askHint')}</p>
          <textarea className="input" rows={2} value={q} onChange={(e) => setQ(e.target.value)} data-testid="sr-question" />
          <button disabled={busy || !q.trim()} className="btn-ghost !py-1 text-xs" onClick={() => void act('needs-info', { question: q }).then(() => setQ(''))}>{t('sr.sendQ')}</button></div>}
        {r.status === 'NEEDS_INFO' && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('sr.waiting', { q: r.question })}</p>}
        {r.kind === 'FREIGHT_ONLY' && ['SUBMITTED', 'UNDER_REVIEW', 'QUOTED'].includes(r.status) && perms.can('quotes.customer') && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800" data-testid="sr-fq-form">
          <div className="text-xs font-medium">{t(r.status === 'QUOTED' ? 'sr.fqReplace' : 'sr.fqSend')}</div>
          <p className="text-[11px] text-ink-500">{t('sr.fqHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">{t('sr.fqAmount')}<input className="input" inputMode="decimal" value={fq.amount} onChange={(e) => setFq({ ...fq, amount: e.target.value })} data-testid="sr-fq-amount" /></label>
            {perms.can('prices.inr') && <label className="text-xs">{t('sr.fqCost')}<input className="input" inputMode="decimal" value={fq.internalCost} onChange={(e) => setFq({ ...fq, internalCost: e.target.value })} /></label>}
            <label className="text-xs">{t('sr.mode')}<select className="input" value={fq.mode} onChange={(e) => setFq({ ...fq, mode: e.target.value })}>{MODES.map((m) => <option key={m} value={m}>{m || '—'}</option>)}</select></label>
            <label className="text-xs">{t('sr.incoterm')}<select className="input" value={fq.incoterm} onChange={(e) => setFq({ ...fq, incoterm: e.target.value })}>{TERMS.map((m) => <option key={m} value={m}>{m || '—'}</option>)}</select></label>
            <label className="text-xs">{t('sr.transit')}<input className="input" value={fq.transit} onChange={(e) => setFq({ ...fq, transit: e.target.value })} placeholder="25 days" /></label>
            <label className="text-xs">{t('sr.validUntil')}<input className="input" type="date" value={fq.validUntil} onChange={(e) => setFq({ ...fq, validUntil: e.target.value })} /></label>
          </div>
          <label className="block text-xs">{t('sr.fqNote')}<textarea className="input" rows={2} value={fq.customerNote} onChange={(e) => setFq({ ...fq, customerNote: e.target.value })} /></label>
          <button disabled={busy || !fq.amount} className="btn-primary !py-1 text-xs" onClick={() => void act('freight-quotes', clean(fq))} data-testid="sr-fq-send">{t('sr.fqSendBtn')}</button></div>}
        {!!r.freightQuotes?.length && <div><div className="mb-1 text-xs font-medium">{t('sr.fqs')}</div><ul className="space-y-1 text-xs">{r.freightQuotes.map((x) => <li key={x.id} className="flex flex-wrap gap-x-2">
          <span className="font-mono">{x.label}</span><b>{inr(x.amount)}</b>{x.internalCost != null && <span className="text-ink-500">{t('sr.costLabel')} {inr(x.internalCost)}</span>}<span>{t(`sr.fqSt.${x.status}`, { defaultValue: x.status })}</span>
          {x.reasonCode && <span className="text-rose-600">{t(`sr.reason.${x.reasonCode}`, { defaultValue: x.reasonCode })}{x.reason ? `: ${x.reason}` : ''}</span>}<span className="text-ink-400">{when(x.createdAt)}</span>
          <button className="text-brand-600 underline" onClick={() => void api.srFqPdfUrl!(r.id, x.id).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => setErr((e as Error).message))} data-testid="sr-fq-pdf">{t('sr.pdf')}</button></li>)}</ul></div>}
        {r.kind === 'FREIGHT_ONLY' && (r.status === 'ACCEPTED' || STAGES.slice(0, -1).includes(r.status)) && perms.can('orders.production') && <div className="space-y-2 rounded-lg border border-ink-100 p-3 dark:border-ink-800" data-testid="sr-stage-form">
          <div className="text-xs font-medium">{t(r.status === 'ACCEPTED' ? 'sr.book' : 'sr.updateTracking')}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">{t('sr.stage')}<select className="input" value={stg.status} onChange={(e) => setStg({ ...stg, status: e.target.value })} data-testid="sr-stage">{STAGES.filter((s) => STAGES.indexOf(s) >= STAGES.indexOf(r.status)).map((s) => <option key={s} value={s}>{st(s)}</option>)}</select></label>
            {(['carrier', 'tracking', 'container'] as const).map((k) => <label key={k} className="text-xs">{t(`sr.${k}`)}<input className="input" value={stg[k]} onChange={(e) => setStg({ ...stg, [k]: e.target.value })} /></label>)}
            <label className="text-xs">ETD<input className="input" type="date" value={stg.etd} onChange={(e) => setStg({ ...stg, etd: e.target.value })} /></label>
            <label className="text-xs">ETA<input className="input" type="date" value={stg.eta} onChange={(e) => setStg({ ...stg, eta: e.target.value })} /></label>
          </div>
          <button disabled={busy} className="btn-primary !py-1 text-xs" onClick={() => void act('stage', clean(stg))} data-testid="sr-stage-save">{t('sr.save')}</button></div>}
        {r.kind === 'SOURCED' && r.status === 'ACCEPTED' && <p className="text-xs text-ink-500">{t('sr.sourcedTrack')}</p>}
        {open && <div className="space-y-2 rounded-lg border border-rose-100 p-3 dark:border-rose-500/20"><div className="text-xs font-medium">{t('sr.rejectTitle')}</div>
          <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('sr.reason')} />
          <button disabled={busy || !why.trim()} className="btn-ghost !py-1 text-xs text-rose-600" onClick={() => void act('reject', { reason: why })}>{t('sr.rejectBtn')}</button></div>}
        <div className="space-y-1"><div className="text-xs font-medium">{t('sr.internalNote')}</div><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy || note === (r.internalNote ?? '')} className="btn-ghost !py-1 text-xs" onClick={() => void run(() => api.srPatch!(id, { internalNote: note }))}>{t('sr.saveNote')}</button></div>
        {!!r.files?.length && <div><div className="mb-1 text-xs font-medium">{t('sr.files')}</div><ul className="space-y-1 text-xs">{r.files.map((f) => <li key={f.id}>
          <button className="text-brand-600 underline" onClick={() => void api.srFileUrl!(r.id, f.id).then((u) => window.open(u, '_blank', 'noopener'))}>{f.name}</button>
          <span className="ml-2 text-ink-400">{f.customerVisible ? t('sr.fromCustomer') : t('sr.internal')}</span></li>)}</ul></div>}
        {!!r.events?.length && <div><div className="mb-1 text-xs font-medium">{t('sr.timeline')}</div><ol className="space-y-1 border-l-2 border-ink-100 pl-3 text-xs dark:border-ink-800">{[...r.events].reverse().map((e, i) => <li key={i}>
          <span className="font-medium">{e.kind.replace(/^SR_|^FQ_/, '').replace(/_/g, ' ').toLowerCase()}</span>{e.by && <span className="text-ink-500"> · {e.by}</span>} <span className="text-ink-400">{when(e.at)}</span>
          {typeof e.data?.message === 'string' && e.data.message && <div className="text-ink-600 dark:text-ink-300">“{e.data.message}”</div>}
          <span className={e.customerVisible ? 'ml-1 text-accent-700' : 'ml-1 text-ink-400'}>{e.customerVisible ? t('sr.customerSees', { text: e.customerText }) : t('sr.internal')}</span></li>)}</ol></div>}
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>}
    </SlideOver>
  );
}

/** India staff: raise a Shipping Request for a customer (sourced order or freight-only). */
function NewSr({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const [cs, setCs] = useState<Customer[]>([]), [orders, setOrders] = useState<{ id: string; leadReference: string | null; product: string; qty: number }[]>([]);
  const [f, setF] = useState<Record<string, string>>({ customerId: '', kind: 'FREIGHT_ONLY', orderId: '', goods: '', quantity: '', unit: '', packages: '', weightKg: '', cbm: '', shipperName: '', shipperPhone: '',
    pickupAddress: '', pickupCity: '', destAddress: '', destCity: '', destPincode: '', mode: '', incoterm: '', readyDate: '', customerNote: '', internalNote: '' });
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { void api.customers().then(setCs).catch(() => undefined); }, [api]);
  useEffect(() => { setOrders([]); if (f.customerId && f.kind === 'SOURCED') void api.shippableOrders!(f.customerId).then(setOrders).catch(() => undefined); }, [api, f.customerId, f.kind]);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ok = f.customerId && (f.kind === 'SOURCED' ? f.orderId : f.goods.trim());
  const submit = async () => { setBusy(true); setErr(null);
    try { const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')); const r = await api.createShippingRequest!(body); onCreated(r.id); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const inp = (k: string, label: string, type = 'text') => <label key={k} className="text-xs">{label}<input className="input" type={type} value={f[k]} onChange={set(k)} data-testid={`sr-new-${k}`} /></label>;
  return (
    <SlideOver open onClose={onClose} title={t('sr.new')} subtitle={t('sr.newSub')}>
      <div className="space-y-3 text-sm" data-testid="sr-new-form">
        <label className="block text-xs">{t('sr.col.customer')} *<select className="input" value={f.customerId} onChange={set('customerId')} data-testid="sr-new-customer">
          <option value="">{t('sr.chooseCustomer')}</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.company ? `${c.company} · ${c.name}` : c.name}</option>)}</select></label>
        <div className="flex gap-3 text-xs">{(['FREIGHT_ONLY', 'SOURCED'] as const).map((k) => <label key={k} className="flex items-center gap-1"><input type="radio" checked={f.kind === k} onChange={() => setF((x) => ({ ...x, kind: k, orderId: '' }))} />{t(k === 'SOURCED' ? 'sr.sourcedOrder' : 'sr.freightOnly')}</label>)}</div>
        {f.kind === 'SOURCED' && <label className="block text-xs">{t('sr.order')} *<select className="input" value={f.orderId} onChange={set('orderId')} data-testid="sr-new-order">
          <option value="">{f.customerId && !orders.length ? t('sr.noOrders') : t('sr.chooseOrder')}</option>{orders.map((o) => <option key={o.id} value={o.id}>{`${o.leadReference ?? ''} · ${o.product} × ${o.qty}`}</option>)}</select></label>}
        <div className="grid grid-cols-2 gap-2">
          {inp('goods', `${t('sr.f.goods')}${f.kind === 'FREIGHT_ONLY' ? ' *' : ''}`)}{inp('quantity', t('sr.f.qty'), 'number')}{inp('unit', t('sr.unit'))}{inp('packages', t('sr.f.packages'), 'number')}
          {inp('weightKg', t('sr.weightKg'), 'number')}{inp('cbm', t('sr.cbm'), 'number')}{inp('shipperName', t('sr.shipperName'))}{inp('shipperPhone', t('sr.shipperPhone'))}
          {inp('pickupAddress', t('sr.pickupAddress'))}{inp('pickupCity', t('sr.pickupCity'))}{inp('destAddress', t('sr.destAddress'))}{inp('destCity', t('sr.destCity'))}{inp('destPincode', t('sr.destPincode'))}
          <label className="text-xs">{t('sr.mode')}<select className="input" value={f.mode} onChange={set('mode')}>{MODES.map((m) => <option key={m} value={m}>{m || '—'}</option>)}</select></label>
          <label className="text-xs">{t('sr.incoterm')}<select className="input" value={f.incoterm} onChange={set('incoterm')}>{TERMS.map((m) => <option key={m} value={m}>{m || '—'}</option>)}</select></label>
          {inp('readyDate', t('sr.f.ready'), 'date')}
        </div>
        <label className="block text-xs">{t('sr.customerNoteEn')}<textarea className="input" rows={2} value={f.customerNote} onChange={set('customerNote')} /></label>
        <label className="block text-xs">{t('sr.internalNote')}<textarea className="input" rows={2} value={f.internalNote} onChange={set('internalNote')} /></label>
        <p className="text-[11px] text-ink-500">{t('sr.newHint')}</p>
        <button disabled={busy || !ok} className="btn-primary" onClick={() => void submit()} data-testid="sr-new-submit">{t('sr.create')}</button>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    </SlideOver>
  );
}
