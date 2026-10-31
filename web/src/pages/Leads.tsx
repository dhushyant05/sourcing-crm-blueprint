import { clsx } from 'clsx';
import { KanbanSquare, Plus, Rows3 } from 'lucide-react';
import { useState } from 'react';
import { useApp, useLoad } from '../lib/store';
import { PIPELINE, type Lead, type LeadStatus } from '../lib/types';
import { money } from '../lib/currency';
import { Avatar, Chip, dot, Empty, Field, PageHeader, Skeleton, SlideOver, TableSkeleton, pretty } from '../components/ui';

const who = (l: Lead, customers: boolean) => (customers ? l.clientName ?? l.name : `Lead ${l.id}`);
export const matches = (l: Lead, q: string) => !q || [l.name, l.clientName, l.productInterest, l.assignedChinaAgent].some((v) => v?.toLowerCase().includes(q.toLowerCase()));

export function Leads({ search, openLead }: { search: string; openLead: (l: Lead) => void }) {
  const { api, perms } = useApp();
  const { data, setData } = useLoad(() => api.leads(), [api]);
  const [view, setView] = useState<'board' | 'table'>(() => (localStorage.leadView as 'board') ?? 'board');
  const [drag, setDrag] = useState<string | null>(null);
  const leads = data?.filter((l) => matches(l, search));
  const pick = (v: 'board' | 'table') => { setView(v); localStorage.leadView = v; };

  const move = async (id: string, status: LeadStatus) => {
    setData((d) => d && d.map((l) => (l.id === id ? { ...l, status } : l)));
    await api.updateLeadStatus(id, status);
  };

  return (
    <>
      <PageHeader title="Leads" subtitle={data ? `${data.length} leads · drag cards to move between stages` : 'Loading…'}
        actions={<>
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900">
            {([['board', KanbanSquare], ['table', Rows3]] as const).map(([v, I]) => (
              <button key={v} onClick={() => pick(v)} className={clsx('rounded-lg px-2.5 py-1.5 text-sm transition', view === v ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-white' : 'text-ink-500')}><I size={16} /></button>
            ))}
          </div>
          {perms.customers && <button className="btn-primary"><Plus size={16} />New lead</button>}
        </>} />

      {view === 'board' ? (
        <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-4">
          {PIPELINE.map((s) => {
            const col = leads?.filter((l) => l.status === s) ?? [];
            return (
              <div key={s} onDragOver={(e) => e.preventDefault()} onDrop={() => drag && move(drag, s)}
                className="flex w-72 shrink-0 flex-col rounded-2xl bg-ink-100/60 p-2 dark:bg-ink-900/50">
                <div className="flex items-center gap-2 px-2 py-2 text-sm font-medium text-ink-700 dark:text-ink-200">
                  <span className={`h-2 w-2 rounded-full ${dot[s]}`} />{pretty(s)}<span className="ml-auto rounded-full bg-white px-2 text-xs text-ink-500 dark:bg-ink-800">{data ? col.length : '·'}</span>
                </div>
                <div className="flex min-h-24 flex-col gap-2">
                  {!data && [0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                  {col.map((l) => (
                    <article key={l.id} draggable onDragStart={() => setDrag(l.id)} onDragEnd={() => setDrag(null)} onClick={() => openLead(l)}
                      className={clsx('cursor-pointer rounded-xl border border-ink-200/70 bg-white p-3.5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift dark:border-ink-800 dark:bg-ink-900', drag === l.id && 'opacity-50')}>
                      <div className="text-sm font-medium text-ink-900 dark:text-white">{who(l, perms.customers)}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{l.productInterest}</div>
                      <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                        <span>{l.quantity?.toLocaleString()} pcs</span>
                        <Avatar name={l.assignedChinaAgent ?? 'NA'} className="h-6 w-6 text-[10px]" />
                      </div>
                    </article>
                  ))}
                  {data && !col.length && <div className="rounded-xl border border-dashed border-ink-200 py-6 text-center text-xs text-ink-400 dark:border-ink-800">No leads</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {!data ? <TableSkeleton /> : !leads?.length ? <Empty title="No leads match" hint="Try a different search." /> : (
            <div className="max-h-[calc(100vh-220px)] overflow-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">{perms.customers ? 'Client' : 'Lead'}</th><th className="th">Product</th><th className="th text-right">Qty</th>{perms.clientPricing && <th className="th text-right">Target</th>}<th className="th">Status</th><th className="th">China agent</th><th className="th">Created</th></tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} onClick={() => openLead(l)} className="cursor-pointer transition hover:bg-ink-50 dark:hover:bg-ink-800/40">
                      <td className="td"><div className="flex items-center gap-3"><Avatar name={who(l, perms.customers)} /><span className="font-medium text-ink-900 dark:text-white">{who(l, perms.customers)}</span></div></td>
                      <td className="td text-ink-600 dark:text-ink-300">{l.productInterest}</td>
                      <td className="td text-right tabular-nums">{l.quantity?.toLocaleString()}</td>
                      {perms.clientPricing && <td className="td text-right tabular-nums">{l.targetPrice ? money(l.targetPrice, l.targetCurrency ?? 'INR') : '—'}</td>}
                      <td className="td"><Chip value={l.status} /></td>
                      <td className="td text-ink-600 dark:text-ink-300">{l.assignedChinaAgent ?? '—'}</td>
                      <td className="td text-ink-500">{new Date(l.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function LeadPanel({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const { perms } = useApp();
  return (
    <SlideOver open={!!lead} onClose={onClose} title={lead && who(lead, perms.customers)}
      subtitle={lead && <div className="flex items-center gap-2"><Chip value={lead.status} /><span>{lead.productInterest}</span></div>}
      footer={<><button className="btn-outline" onClick={onClose}>Close</button>{perms.suppliers && <button className="btn-primary">New sourcing request</button>}{perms.customers && <button className="btn-primary">Assign to China</button>}</>}>
      {lead && (
        <>
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">Request</h3>
          <dl className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
            <Field label="Product">{lead.productInterest}</Field>
            <Field label="Quantity">{lead.quantity?.toLocaleString()} pcs</Field>
            {perms.clientPricing && <Field label="Target price">{lead.targetPrice ? money(lead.targetPrice, lead.targetCurrency ?? 'INR') : '—'}</Field>}
            <Field label="Channel">{lead.sourceChannel}</Field>
            <Field label="China agent">{lead.assignedChinaAgent}</Field>
          </dl>
          {perms.customers && (<>
            <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">Customer</h3>
            <dl className="mt-1 divide-y divide-ink-100 dark:divide-ink-800">
              <Field label="Phone">{lead.contactPhone}</Field><Field label="Email">{lead.contactEmail}</Field>
            </dl>
          </>)}
          <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-400">Timeline</h3>
          <ol className="mt-3 space-y-4 border-l border-ink-200 pl-4 dark:border-ink-800">
            {[['Lead created', lead.createdAt], ['Assigned to ' + (lead.assignedChinaAgent ?? 'China'), lead.createdAt]].map(([t, d]) => (
              <li key={t} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-white dark:ring-ink-900" /><div className="text-ink-800 dark:text-ink-100">{t}</div><div className="text-xs text-ink-500">{new Date(d).toLocaleString('en-IN', { dateStyle: 'medium' })}</div></li>
            ))}
          </ol>
        </>
      )}
    </SlideOver>
  );
}
