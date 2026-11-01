import { RefTag } from './Leads';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import type { Lead, Order } from '../lib/types';
import { fmtDate } from '../i18n';
import { Chip, Empty, PageHeader, TableSkeleton } from '../components/ui';
import { inr } from '../components/CustomerQuote';

const PROD = ['NEW', 'DEPOSIT_PAID', 'IN_PRODUCTION', 'READY'], IND = ['IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED'], PAY = ['PENDING', 'PARTIAL', 'PAID'];

function OrderCard({ o, onChange, openLead }: { o: Order; onChange: (o: Order) => void; openLead: (id: string) => void }) {
  const { api, session, perms } = useApp(); const { t } = useTranslation();
  const role = session?.role ?? '', sa = role === 'SUPER_ADMIN', china = role.startsWith('CHINA') || sa, india = role.startsWith('INDIA') || sa;
  const [f, setF] = useState<Record<string, string>>(() => ({ production: o.production, tracking: o.tracking ?? '', container: o.container ?? '', etd: o.etd ?? '', eta: o.eta ?? '',
    indiaStatus: o.indiaStatus, paymentStatus: o.paymentStatus ?? 'PENDING', advance: String(o.advance ?? ''), expectedShip: o.expectedShip ?? '' }));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const shipped = o.production === 'SHIPPED', canShip = !!(f.tracking.trim() || f.container.trim()) && !!f.etd;
  const save = async (keys: string[], extra: Record<string, unknown> = {}) => { setBusy(true); setMsg(null); try { const b: Record<string, unknown> = { ...extra }; keys.forEach((k) => { b[k] = f[k] === '' ? null : f[k]; }); onChange(await api.updateOrder(o.id, b)); setMsg(t('orders.saved')); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  // Shipping (orders.production) and payment (orders.payment) are separate permissions → separate requests, each only if allowed and changed.
  const saveIndia = async () => {
    const v = (k: string) => (f[k] === '' ? null : f[k]), was: Record<string, unknown> = { indiaStatus: o.indiaStatus, expectedShip: o.expectedShip ?? null, paymentStatus: o.paymentStatus ?? 'PENDING', advance: o.advance ?? null };
    const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => String(v(k) ?? '') !== String(was[k] ?? '')).map((k) => [k, v(k)]));
    const ship = perms.can('orders.production') ? pick(shipped ? ['indiaStatus', 'expectedShip'] : ['expectedShip']) : {};
    const pay = perms.can('orders.payment') ? pick(['paymentStatus', 'advance']) : {};
    setBusy(true); setMsg(null);
    try { let r: Order | null = null; if (Object.keys(ship).length) r = await api.updateOrder(o.id, ship); if (Object.keys(pay).length) r = await api.updateOrder(o.id, pay); if (r) onChange(r); setMsg(t('orders.saved')); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const sel = (k: string, opts: string[], ns: string, label: string) => (<div><label className="label">{label}</label><select data-testid={`o-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map((v) => <option key={v} value={v}>{t(`orders.${ns}.${v}`)}</option>)}</select></div>);
  const inp = (k: string, label: string, type = 'text') => (<div><label className="label">{label}</label><input data-testid={`o-${k}`} type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>);
  return (<div data-testid="order-card" className="card p-4">
    <div className="flex flex-wrap items-center gap-2"><button onClick={() => openLead(o.leadId)}>{o.leadRef && <RefTag v={o.leadRef} />}</button><b className="text-ink-900 dark:text-white">{o.product}</b>
      {o.shipmentRef && <span data-testid="o-shipref" className="font-mono text-xs text-ink-500">{t('orders.shipmentRef')}: {o.shipmentRef}</span>}<span className="text-sm text-ink-500">× {o.qty.toLocaleString('en-IN')}</span>{o.leadStatus && <Chip value={o.leadStatus} />}
      <span className="ml-auto text-xs text-ink-400">{fmtDate(o.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-3 dark:text-ink-300">
      {o.customer != null && <div>{t('orders.customer')}: <b>{o.customer || '—'}</b></div>}
      {o.agreedPrice != null && <div>{t('orders.agreed')}: <b>{inr(o.agreedPrice)}</b> · {t('orders.total')}: <b>{inr(o.total)}</b></div>}
      {o.supplier && <div>{t('orders.supplier')}: <b>{o.supplier.name}</b></div>}
      {o.unitPrice != null && <div>{t('orders.chinaCost')}: <b>{o.unitPrice} {o.currency}</b></div>}
      <div>{t('orders.production')}: <b>{t(`orders.prod.${o.production}`)}</b></div><div>{t('orders.shipment')}: <b>{t(`orders.ind.${o.indiaStatus}`)}</b></div>
      <div>{t('orders.tracking')}: <b>{o.tracking || '—'}</b>{o.container && ` · ${o.container}`}</div><div>ETD {o.etd ? fmtDate(o.etd) : '—'} · ETA {o.eta ? fmtDate(o.eta) : '—'}</div>
    </div>
    {china && perms.can('orders.production') && <div className="mt-3 rounded-lg border border-ink-100 p-2 dark:border-ink-800"><div className="mb-1 text-xs font-medium uppercase text-ink-400">{t('orders.chinaPart')}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{!shipped && sel('production', PROD, 'prod', t('orders.production'))}{inp('tracking', t('orders.tracking'))}{inp('container', t('orders.container'))}{inp('etd', t('orders.etd'), 'date')}{inp('eta', t('orders.eta'), 'date')}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button data-testid="o-save-china" className="btn-outline !py-1 text-xs" disabled={busy} onClick={() => void save(shipped ? ['tracking', 'container', 'etd', 'eta'] : ['production', 'tracking', 'container', 'etd', 'eta'])}>{t('orders.save')}</button>
        {!shipped && <button data-testid="o-mark-shipped" className="btn-primary !py-1 text-xs" disabled={busy || !canShip} onClick={() => void save(['tracking', 'container', 'etd', 'eta'], { production: 'SHIPPED' })}>{t('ship.markShipped')}</button>}
        {!shipped && !canShip && <span className="text-xs text-amber-600">{t('ship.needForShip')}</span>}
        {shipped && <span className="text-xs text-emerald-600" data-testid="o-shipped">✓ {t('ship.shippedNote')}</span>}
      </div></div>}
    {india && (perms.can('orders.payment') || perms.can('orders.production')) && <div className="mt-3 rounded-lg border border-ink-100 p-2 dark:border-ink-800"><div className="mb-1 text-xs font-medium uppercase text-ink-400">{t('orders.indiaPart')}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{shipped ? sel('indiaStatus', IND.includes(f.indiaStatus) ? IND : [f.indiaStatus, ...IND], 'ind', t('orders.shipment')) : <div data-testid="o-india-locked" className="col-span-2 self-end pb-2 text-xs text-ink-500">🔒 {t('ship.indiaLocked')}</div>}{perms.can('orders.payment') && sel('paymentStatus', PAY, 'pay', t('orders.payment'))}{perms.can('orders.payment') && inp('advance', t('orders.advance'))}{perms.can('orders.production') && inp('expectedShip', t('orders.expectedShip'), 'date')}</div>
      <button data-testid="o-save-india" className="btn-primary mt-2 !py-1 text-xs" disabled={busy} onClick={() => void saveIndia()}>{t('orders.save')}</button></div>}
    {msg && <p role="status" className="mt-1 text-xs text-ink-500">{msg}</p>}
  </div>);
}

export function Orders({ search, openLead }: { search: string; openLead: (l: Lead) => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const { data, setData } = useLoad(() => api.orders(), [api]);
  const rows = data?.filter((o) => !search || `${o.leadRef ?? ''} ${o.product} ${o.tracking ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const open = (id: string) => { void api.lead(id).then((l) => l && openLead(l)); };
  return (<>
    <PageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />
    {!data ? <div className="card"><TableSkeleton /></div> : !rows?.length ? <div className="card"><Empty title={t('orders.none')} hint={t('orders.noneHint')} /></div>
      : <div className="space-y-3">{rows.map((o) => <OrderCard key={`${o.id}${o.updatedAt}`} o={o} openLead={open} onChange={(n) => setData((d) => d && d.map((x) => (x.id === n.id ? n : x)))} />)}</div>}
  </>);
}
