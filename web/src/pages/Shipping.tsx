import { RefTag } from './Leads';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import { CHINA_SHIP, INDIA_SHIP, SHIP_STAGES, type Lead, type Shipment } from '../lib/types';
import { fmtDate } from '../i18n';
import { Empty, PageHeader, TableSkeleton } from '../components/ui';

const MODES = ['', 'AIR', 'SEA', 'EXPRESS', 'ROAD'], TERMS = ['', 'EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'DOOR'];
const d = (v?: string | null) => (v ? fmtDate(v, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function ShipCard({ s, onChange, openLead }: { s: Shipment; onChange: (s: Shipment) => void; openLead: (id: string) => void }) {
  const { api, session, perms } = useApp(); const { t } = useTranslation();
  const role = session?.role ?? '', sa = role === 'SUPER_ADMIN', china = role.startsWith('CHINA') || sa, india = role.startsWith('INDIA') || sa;
  const [f, setF] = useState<Record<string, string>>(() => ({ status: s.status, mode: s.mode ?? '', incoterm: s.incoterm ?? '', port: s.port ?? '', transit: s.transit ?? '',
    carrier: s.carrier ?? '', tracking: s.tracking ?? '', container: s.container ?? '', etd: s.etd ?? '', eta: s.eta ?? '', customsNote: s.customsNote ?? '', deliveredAt: s.deliveredAt ?? '' }));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const cur = SHIP_STAGES.indexOf(s.status), shipped = cur >= SHIP_STAGES.indexOf('IN_TRANSIT');
  const canShip = !!(f.tracking.trim() || f.container.trim()) && !!f.etd;
  const CKEYS = ['mode', 'incoterm', 'port', 'transit', 'carrier', 'tracking', 'container', 'etd', 'eta'];
  const save = async (keys: string[], status?: string) => {
    setBusy(true); setMsg(null);
    try { const b: Record<string, unknown> = {}; keys.forEach((k) => { b[k] = f[k] === '' ? null : f[k]; }); if (status) b.status = status;
      onChange(await api.updateShipment!(s.id, b)); setMsg(t('orders.saved')); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const sel = (k: string, opts: string[], label: string, fmt: (v: string) => string) => (<div><label className="label">{label}</label><select data-testid={`s-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map((v) => <option key={v} value={v}>{v ? fmt(v) : '—'}</option>)}</select></div>);
  const inp = (k: string, label: string, type = 'text') => (<div><label className="label">{label}</label><input data-testid={`s-${k}`} type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>);
  const st = (v: string) => t(`ship.st.${v}`);
  return (<div data-testid="ship-card" className="card p-4">
    <div className="flex flex-wrap items-center gap-2">
      <button data-testid="ship-open" onClick={() => openLead(s.leadId)} className="font-mono text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">{s.ref}</button>
      {s.leadRef && <RefTag v={s.leadRef} />}<b className="text-ink-900 dark:text-white">{s.product}</b>{s.qty != null && <span className="text-sm text-ink-500">× {s.qty.toLocaleString('en-IN')}</span>}
      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{st(s.status)}</span>
      <span className="ml-auto text-xs text-ink-400">{t('shipping.updated', { d: d(s.updatedAt) })}</span></div>
    <div className="mt-3 flex gap-1" aria-label={t('shipping.progress')}>{SHIP_STAGES.slice(1).map((x, i) => <div key={x} title={st(x)} className={clsx('h-1.5 flex-1 rounded-full', i + 1 <= cur ? 'bg-brand-500' : 'bg-ink-100 dark:bg-ink-800')} />)}</div>
    <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-3 dark:text-ink-300">
      {s.customer !== undefined && <div>{t('orders.customer')}: <b>{s.customer || '—'}</b>{s.deliveryCity && ` · ${s.deliveryCity}`}</div>}
      {s.supplier !== undefined && <div>{t('orders.supplier')}: <b>{s.supplier || '—'}</b></div>}
      <div>{t('ship.mode')}: <b>{s.mode ? t(`ship.m.${s.mode}`) : '—'}</b> · {s.incoterm || '—'}</div>
      <div>{t('ship.port')}: <b>{s.port || '—'}</b> · {t('ship.transit')}: <b>{s.transit || '—'}</b></div>
      <div>{t('shipping.carrier')}: <b>{s.carrier || '—'}</b></div>
      <div>{t('shipping.tracking')}: <b>{s.tracking || '—'}</b>{s.container && ` · ${s.container}`}</div>
      <div>ETD {d(s.etd)} · ETA {d(s.eta)}</div>
      {s.deliveredAt && <div>{t('ship.deliveredAt')}: <b>{d(s.deliveredAt)}</b></div>}
      {s.customsNote && <div className="sm:col-span-3">{t('ship.customsNote')}: {s.customsNote}</div>}
    </div>
    {china && perms.can('orders.production') && <div className="mt-3 rounded-lg border border-ink-100 p-2 dark:border-ink-800"><div className="mb-1 text-xs font-medium uppercase text-ink-400">{t('ship.chinaPart')}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{!shipped && sel('status', CHINA_SHIP, t('shipping.stage'), st)}{sel('mode', MODES, t('ship.mode'), (v) => t(`ship.m.${v}`))}{sel('incoterm', TERMS, t('ship.incoterm'), (v) => v)}
        {inp('port', t('ship.port'))}{inp('transit', t('ship.transit'))}{inp('carrier', t('shipping.carrier'))}{inp('tracking', t('shipping.tracking'))}{inp('container', t('orders.container'))}{inp('etd', 'ETD', 'date')}{inp('eta', 'ETA', 'date')}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button data-testid="s-save-china" className="btn-outline !py-1 text-xs" disabled={busy} onClick={() => void save(CKEYS, !shipped && CHINA_SHIP.includes(f.status) && f.status !== s.status ? f.status : undefined)}>{t('orders.save')}</button>
        {!shipped && <button data-testid="s-mark-shipped" className="btn-primary !py-1 text-xs" disabled={busy || !canShip} onClick={() => void save(CKEYS, 'IN_TRANSIT')}>{t('ship.markShipped')}</button>}
        {!shipped && !canShip && <span className="text-xs text-amber-600">{t('ship.needForShip')}</span>}
        {shipped && <span className="text-xs text-emerald-600" data-testid="s-shipped">✓ {t('ship.shippedNote')}</span>}
      </div></div>}
    {india && perms.can('orders.production') && <div className="mt-3 rounded-lg border border-ink-100 p-2 dark:border-ink-800"><div className="mb-1 text-xs font-medium uppercase text-ink-400">{t('ship.indiaPart')}</div>
      {!shipped ? <p data-testid="s-india-locked" className="text-xs text-ink-500">🔒 {t('ship.indiaLocked')}</p> : <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{sel('status', INDIA_SHIP.includes(f.status) ? INDIA_SHIP : [f.status, ...INDIA_SHIP], t('shipping.stage'), st)}{inp('deliveredAt', t('ship.deliveredAt'), 'date')}<div className="col-span-2">{inp('customsNote', t('ship.customsNote'))}</div></div>
      <button data-testid="s-save-india" className="btn-primary mt-2 !py-1 text-xs" disabled={busy} onClick={() => void save(['customsNote', 'deliveredAt'], INDIA_SHIP.includes(f.status) && f.status !== s.status ? f.status : undefined)}>{t('orders.save')}</button></>}</div>}
    {msg && <p role="status" className="mt-1 text-xs text-ink-500">{msg}</p>}
  </div>);
}

export function Shipping({ search, openLead }: { search: string; openLead: (l: Lead) => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const { data, setData } = useLoad(() => api.shipments(), [api]);
  const [filter, setFilter] = useState('');
  const q = search.toLowerCase();
  const rows = data?.filter((s) => (!filter || s.status === filter) && (!q || `${s.ref} ${s.leadRef ?? ''} ${s.product ?? ''} ${s.customer ?? ''} ${s.supplier ?? ''} ${s.tracking ?? ''} ${s.container ?? ''}`.toLowerCase().includes(q)));
  const open = (id: string) => { void api.lead(id).then((l) => l && openLead(l)); };
  return (<>
    <PageHeader title={t('shipping.title')} subtitle={t('shipping.subtitle')} />
    <div className="mb-3 flex flex-wrap gap-1">{['', ...SHIP_STAGES].map((x) => <button key={x || 'all'} onClick={() => setFilter(x)} className={clsx('rounded-full px-3 py-1 text-xs', filter === x ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>{x ? t(`ship.st.${x}`) : t('ship.all')}{data && ` (${data.filter((s) => !x || s.status === x).length})`}</button>)}</div>
    {!data ? <div className="card"><TableSkeleton /></div> : !rows?.length ? <div className="card"><Empty title={t('shipping.none')} hint={t('shipping.noneHint')} /></div>
      : <div className="space-y-3">{rows.map((s) => <ShipCard key={`${s.id}${s.updatedAt}`} s={s} openLead={open} onChange={(n) => setData((x) => x && x.map((y) => (y.id === n.id ? n : y)))} />)}</div>}
  </>);
}
