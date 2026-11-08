import { useCallback, useEffect, useState } from 'react';
import { Ship } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { ShippingRequestChina } from '../lib/types';

// China office: booking details of accepted shipping requests (EN / 中文, csr.*). The server sends an allowlist only:
// pickup, cargo, routing city and booking fields; never customer identity, destination address/contact, notes, files or prices.
// China sets Booked / In transit for freight-only requests; India takes over from arrival. Sourced requests are booked on the Shipping board below.
const CH = ['BOOKED', 'IN_TRANSIT'];
const dash = (v: unknown) => (v == null || v === '' ? '—' : String(v));

export function ChinaShippingRequests() {
  const { api, session, perms } = useApp(); const { t } = useTranslation();
  const [list, setList] = useState<ShippingRequestChina[] | null>(null), [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api.chinaShippingRequests?.().then(setList).catch(() => setList([])), [api]);
  useEffect(() => { void load(); }, [load]);
  const china = session?.role === 'CHINA_ADMIN' || session?.role === 'CHINA_STAFF' || session?.role === 'SUPER_ADMIN';
  if (!api.chinaShippingRequests || !china) return null;
  return (
    <div className="card mb-6 p-4" data-testid="china-shipping-requests">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Ship size={16} />{t('csr.title')}</h2>
      <p className="mb-3 text-xs text-ink-500">{t('csr.hint')}</p>
      {list === null ? <p className="text-sm text-ink-400">{t('sr.loading')}</p> : !list.length ? <p className="text-sm text-ink-500">{t('csr.none')}</p> : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">{list.map((r) => <li key={r.id} className="py-2">
          <button className="flex w-full flex-wrap items-center gap-2 text-left text-sm" onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`csr-${r.ref}`}>
            <span className="font-mono text-xs">{r.ref}</span><span className="font-medium">{r.goods}</span>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs dark:bg-ink-800">{t(`sr.kind.${r.kind}`, { defaultValue: r.kind })}</span>
            <span className="text-xs text-ink-500">{r.pickupCity ?? '—'} → {r.destCity ?? '—'}</span>
            <span className="ml-auto text-xs">{t(`sr.st.${r.status}`, { defaultValue: r.status })}</span></button>
          {open === r.id && <ChinaSr r={r} canEdit={perms.can('orders.production')} onSaved={(n) => setList((x) => x && x.map((y) => (y.id === n.id ? n : y)))} />}
        </li>)}</ul>)}
    </div>);
}

function ChinaSr({ r, canEdit, onSaved }: { r: ShippingRequestChina; canEdit: boolean; onSaved: (n: ShippingRequestChina) => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const next = r.status === 'ACCEPTED' ? 'BOOKED' : r.status;
  const [f, setF] = useState<Record<string, string>>({ status: next, carrier: r.carrier ?? '', tracking: r.tracking ?? '', container: r.container ?? '', etd: r.etd ?? '', eta: r.eta ?? '' });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const row = (k: string, v: unknown) => <div className="flex gap-2 text-xs"><span className="w-32 shrink-0 text-ink-500">{k}</span><span>{dash(v)}</span></div>;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const b: Record<string, unknown> = {}; for (const k of ['carrier', 'tracking', 'container', 'etd', 'eta']) if ((f[k] ?? '') !== ((r as any)[k] ?? '')) b[k] = f[k];
      if (f.status !== r.status) b.status = f.status;
      onSaved(await api.chinaSrStage!(r.id, b)); setMsg(t('csr.saved'));
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (<div className="mt-2 grid gap-3 rounded-lg border border-ink-100 p-3 sm:grid-cols-2 dark:border-ink-800" data-testid="csr-panel">
    <div className="space-y-1"><div className="text-xs font-medium uppercase text-ink-400">{t('csr.pickup')}</div>
      {row(t('csr.contact'), r.pickupContact)}{row(t('csr.phone'), r.pickupPhone)}{row(t('csr.address'), r.pickupAddress)}{row(t('csr.city'), r.pickupCity)}{row(t('csr.ready'), r.readyDate)}
      <div className="pt-2 text-xs font-medium uppercase text-ink-400">{t('csr.cargo')}</div>
      {row(t('csr.qty'), r.quantity != null ? `${r.quantity} ${r.unit ?? ''}` : null)}{row(t('csr.packages'), r.packages)}{row(t('csr.weight'), r.weightKg)}{row('CBM', r.cbm)}
      {row(t('csr.mode'), [r.mode, r.incoterm].filter(Boolean).join(' · '))}{row(t('csr.dest'), r.destCity)}</div>
    <div className="space-y-1"><div className="text-xs font-medium uppercase text-ink-400">{t('csr.booking')}</div>
      {r.kind === 'SOURCED' ? <>{row(t('csr.shipment'), r.shipmentRef)}{row(t('sr.stage'), t(`ship.st.${r.stage}`, { defaultValue: r.stage }))}<p className="text-xs text-ink-500">{t('csr.sourced')}</p></>
        : r.canUpdate && canEdit ? <>
          <label className="block text-xs">{t('sr.stage')}<select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="csr-stage">
            {CH.filter((s) => CH.indexOf(s) >= CH.indexOf(next)).map((s) => <option key={s} value={s}>{t(`sr.st.${s}`, { defaultValue: s })}</option>)}</select></label>
          {(['carrier', 'tracking', 'container'] as const).map((k) => <label key={k} className="block text-xs">{t(`sr.${k}`)}<input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`csr-${k}`} /></label>)}
          <label className="block text-xs">ETD<input className="input" type="date" value={f.etd} onChange={(e) => setF({ ...f, etd: e.target.value })} /></label>
          <label className="block text-xs">ETA<input className="input" type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></label>
          <button className="btn-primary !py-1 text-xs" disabled={busy} onClick={() => void save()} data-testid="csr-save">{t('sr.save')}</button>
          <p className="text-xs text-ink-500">{t('csr.handover')}</p></>
        : <>{row(t('sr.carrier'), r.carrier)}{row(t('sr.tracking'), r.tracking)}{row(t('sr.container'), r.container)}{row('ETD', r.etd)}{row('ETA', r.eta)}
          {!r.canUpdate && <p className="text-xs text-ink-500">{t('csr.indiaOwns')}</p>}</>}
      {msg && <p role="status" className="text-xs text-ink-500">{msg}</p>}</div>
  </div>);
}
