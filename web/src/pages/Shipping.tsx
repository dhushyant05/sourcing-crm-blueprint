import { clsx } from 'clsx';
import { Check, Ship as ShipIcon } from 'lucide-react';
import { useState } from 'react';
import { useApp, useLoad } from '../lib/store';
import { SHIP_STAGES, type Shipment } from '../lib/types';
import { Chip, Empty, Field, PageHeader, SlideOver, TableSkeleton, pretty } from '../components/ui';

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

export function Shipping({ search }: { search: string }) {
  const { api, perms } = useApp();
  const { data } = useLoad(() => api.shipments(), [api]);
  const [sel, setSel] = useState<Shipment | null>(null);
  const rows = data?.filter((s) => !search || `${s.name} ${s.clientName} ${s.trackingNumber}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHeader title="Shipping" subtitle="Orders from supplier pickup to client delivery" />
      <div className="card overflow-hidden">
        {!data ? <TableSkeleton /> : !rows?.length ? <Empty title="No shipments" hint="Shipping orders are created when a client approves a quote." /> : (
          <div className="max-h-[calc(100vh-220px)] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Order</th>{perms.customers && <th className="th">Client</th>}<th className="th">Route</th><th className="th">Progress</th><th className="th">Stage</th><th className="th">ETA</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const i = SHIP_STAGES.indexOf(s.stage);
                  return (
                    <tr key={s.id} onClick={() => setSel(s)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                      <td className="td"><div className="font-medium text-ink-900 dark:text-white">{s.name}</div><div className="text-xs text-ink-500">{s.carrier} · {s.trackingNumber}</div></td>
                      {perms.customers && <td className="td text-ink-600 dark:text-ink-300">{s.clientName}</td>}
                      <td className="td text-ink-600 dark:text-ink-300">{s.origin} → {s.destination}</td>
                      <td className="td w-48"><div className="h-1.5 rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-1.5 rounded-full bg-gradient-to-r from-brand-500 to-cyan-500" style={{ width: `${((i + 1) / SHIP_STAGES.length) * 100}%` }} /></div></td>
                      <td className="td"><Chip value={s.stage} /></td>
                      <td className="td tabular-nums text-ink-600 dark:text-ink-300">{fmt(s.eta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SlideOver open={!!sel} onClose={() => setSel(null)} title={sel?.name} subtitle={sel && `${sel.origin} → ${sel.destination}`}
        footer={<><button className="btn-outline" onClick={() => setSel(null)}>Close</button>{perms.suppliers && <button className="btn-primary">Update stage</button>}</>}>
        {sel && (<>
          <ol className="space-y-0">
            {SHIP_STAGES.map((st, i) => {
              const cur = SHIP_STAGES.indexOf(sel.stage), done = i < cur, now = i === cur;
              return (
                <li key={st} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < SHIP_STAGES.length - 1 && <span className={clsx('absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5', done ? 'bg-brand-500' : 'bg-ink-200 dark:bg-ink-800')} />}
                  <span className={clsx('relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs', done ? 'bg-brand-600 text-white' : now ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-500 dark:bg-brand-500/10' : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>
                    {done ? <Check size={14} /> : now ? <ShipIcon size={14} /> : i + 1}
                  </span>
                  <div className="pt-1"><div className={clsx('text-sm font-medium', now ? 'text-brand-700 dark:text-brand-300' : done ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400')}>{pretty(st)}</div>{now && <div className="text-xs text-ink-500">Updated {fmt(sel.updatedAt)}</div>}</div>
                </li>
              );
            })}
          </ol>
          <dl className="mt-6 divide-y divide-ink-100 border-t border-ink-100 dark:divide-ink-800 dark:border-ink-800">
            <Field label="Carrier">{sel.carrier}</Field><Field label="Tracking">{sel.trackingNumber}</Field><Field label="ETA">{fmt(sel.eta)}</Field>
          </dl>
        </>)}
      </SlideOver>
    </>
  );
}
