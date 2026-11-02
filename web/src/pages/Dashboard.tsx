import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { PIPELINE, isOpenLead } from '../lib/types';
import { money, totalsByCurrency } from '../lib/currency';
import { useTranslation } from 'react-i18next';
import { Avatar, Chip, dot, PageHeader, Skeleton, Sparkline, pretty } from '../components/ui';
import type { Lead, LeadQuote, Shipment } from '../lib/types';
import { SlaWidget, SlaChip, slaState } from '../components/Workflow';
import { useState } from 'react';
import { createPortal } from 'react-dom';

/** Dashboard drill-down: the exact leads behind a count; "Open in Leads page" applies the same filter there. */
export const LEAD_FILTER_KEY = 'se.leadFilter';
export function showInLeads(label: string, ids: string[]) {
  sessionStorage.setItem(LEAD_FILTER_KEY, JSON.stringify({ label, ids }));
  window.dispatchEvent(new CustomEvent('se:lead-filter'));
  location.hash = '/leads';
}
function LeadList({ label, leads, onClose, openLead, customers }: { label: string; leads: Lead[]; onClose: () => void; openLead: (l: Lead) => void; customers: boolean }) {
  const { t } = useTranslation();
  return createPortal(<div className="fixed inset-0 z-[90] flex items-start justify-center bg-ink-900/30 p-4 pt-[10vh]" onClick={onClose}>
    <div data-testid="dash-list" role="dialog" className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center"><h2 className="font-semibold text-ink-900 dark:text-white">{t('dashboard.listTitle', { label, n: leads.length })}</h2><button className="ml-auto text-ink-400" aria-label="close" onClick={onClose}>✕</button></div>
      <ul className="mt-3 max-h-[55vh] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
        {leads.map((l) => <li key={l.id}><button data-testid="dash-list-item" onClick={() => { onClose(); openLead(l); }} className="flex w-full items-center gap-2 py-2.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800/60">
          <span className="font-mono text-xs text-brand-700 dark:text-brand-300">{l.leadRef ?? l.id.slice(0, 6)}</span>
          <span className="min-w-0 flex-1 truncate text-ink-800 dark:text-ink-100">{customers ? `${l.clientName ?? l.name} · ` : ''}{l.productInterest}</span>
          {l.sla && <SlaChip sla={l.sla} compact />}<Chip value={l.status} /></button></li>)}
        {!leads.length && <li className="py-4 text-sm text-ink-500">{t('dashboard.none')}</li>}
      </ul>
      {!!leads.length && <button data-testid="dash-view-all" className="btn-primary mt-4" onClick={() => { onClose(); showInLeads(label, leads.map((l) => l.id)); }}>{t('dashboard.viewAll')}</button>}
    </div></div>, document.body);
}

export function Dashboard({ openLead }: { openLead: (l: Lead) => void }) {
  const { api, perms } = useApp();
  const { t } = useTranslation();
  const { data } = useLoad(() => Promise.all([api.leads(), api.allQuotes(), api.shipments()]), [api]);
  const [leads, quotes, ships] = (data ?? [null, null, null]) as [Lead[] | null, LeadQuote[] | null, Shipment[] | null];

  const open = leads?.filter(isOpenLead).length ?? 0;
  const completed = leads?.filter((l) => l.status === 'COMPLETED' || l.status === 'DELIVERED').length ?? 0;
  const won = leads?.filter((l) => ['WON', 'COMPLETED', 'DELIVERED'].includes(l.status)).length ?? 0;
  const closed = leads?.filter((l) => ['WON', 'COMPLETED', 'DELIVERED', 'LOST'].includes(l.status)).length || 1;
  // Per currency — amounts in different currencies are never added together.
  // Quoted pipeline = customer quotes (INR, incl. GST) that are sent or accepted.
  const pipeline = totalsByCurrency((quotes ?? []).filter((q) => q.cqTotals && (q.status === 'SENT' || q.status === 'ACCEPTED')), (q) => ['INR', q.cqTotals?.total]);
  const transitIds = new Set((ships ?? []).filter((s) => s.status !== 'DELIVERED').map((s) => s.leadId));
  const transit = ships?.filter((s) => s.status !== 'DELIVERED').length ?? 0;
  const quotedIds = new Set((quotes ?? []).filter((q) => q.status === 'SENT' || q.status === 'ACCEPTED').map((q) => q.leadId));
  const [list, setList] = useState<{ label: string; leads: Lead[] } | null>(null);
  const L = leads ?? [];
  const drill = [
    () => L.filter(isOpenLead),
    () => L.filter((l) => quotedIds.has(l.id) && isOpenLead(l)),
    () => L.filter((l) => !isOpenLead(l)),
    () => L.filter((l) => transitIds.has(l.id)),
    () => L.filter((l) => l.status === 'COMPLETED' || l.status === 'DELIVERED'),
  ];
  const drillLabel = [t('dashboard.openLeads'), t('dashboard.quotedLeads'), t('dashboard.closedLeads'), t('dashboard.transitLeads'), t('dashboard.completed')];
  const now = Date.now();
  const atRisk = L.filter((l) => isOpenLead(l) && l.sla && slaState(l.sla, now).level !== 'ok');

  const kpis = [
    { label: t('dashboard.openLeads'), value: String(open), delta: 12.5, series: [4, 6, 5, 8, 7, 9, 11, open], color: '#2a9fd6' },
    perms.clientPricing
      ? { label: t('dashboard.quotedPipeline'), hint: t('dashboard.perCurrency'), value: pipeline.map(([c, v]) => money(v, c, true)).join(' · ') || '—', delta: 8.2, series: [3, 4, 4, 6, 5, 7, 8, 9], color: '#14b8a6' }
      : { label: t('dashboard.quotesSent'), value: String(quotes?.filter((q) => q.status === 'SENT' || q.status === 'ACCEPTED').length ?? 0), delta: 8.2, series: [1, 2, 2, 3, 3, 4, 5, 6], color: '#14b8a6' },
    { label: t('dashboard.winRate'), value: `${Math.round((won / closed) * 100)}%`, delta: -3.1, series: [60, 58, 62, 55, 57, 52, 54, 50], color: '#f59e0b' },
    { label: t('dashboard.inTransit'), value: String(transit), delta: 4.0, series: [1, 2, 1, 3, 2, 3, 2, transit], color: '#06b6d4' },
    { label: t('dashboard.completed'), value: String(completed), delta: 0, series: [1, 1, 2, 2, 3, 3, 4, completed], color: '#10b981' },
  ];
  const counts = PIPELINE.map((s) => ({ s, n: leads?.filter((l) => l.status === s).length ?? 0 }));
  const max = Math.max(1, ...counts.map((c) => c.n));

  return (
    <>
      <PageHeader title={t('dashboard.greeting')} subtitle={t('dashboard.subtitle')} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k, i) => (
          <button type="button" key={k.label} data-testid={`kpi-${i}`} title={t('dashboard.click')} disabled={!leads} onClick={() => setList({ label: drillLabel[i], leads: drill[i]() })} className="card cursor-pointer p-5 text-left transition-shadow hover:shadow-lift hover:ring-1 hover:ring-brand-300">
            <div className="text-sm text-ink-500" title={(k as { hint?: string }).hint}>{k.label}</div>
            <div className="mt-2 flex items-end justify-between gap-2">
              {data ? <div className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">{k.value}</div> : <Skeleton className="h-8 w-20" />}
              <Sparkline data={k.series} color={k.color} />
            </div>
            <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${k.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {k.delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(k.delta)}% <span className="font-normal text-ink-400">{t('common.vsLastMonth')}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6"><SlaWidget leads={leads} openLead={openLead} onCounts={() => setList({ label: t('dashboard.slaRisk'), leads: atRisk })} /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="card p-6 lg:col-span-3">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('dashboard.pipeline')}</h2>
          <p className="text-sm text-ink-500">{t('dashboard.byStage')}</p>
          <div className="mt-6 flex items-end gap-3">
            {counts.map(({ s, n }) => (
              <button type="button" key={s} data-testid={`stage-${s}`} title={t('dashboard.click')} onClick={() => setList({ label: t('dashboard.stage', { s: pretty(s) }), leads: L.filter((l) => l.status === s) })} className="flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg hover:bg-ink-50 dark:hover:bg-ink-800/40">
                <span className="text-xs font-medium text-ink-600 dark:text-ink-300">{data ? n : ''}</span>
                <div className="flex h-36 w-full items-end rounded-lg bg-ink-100/70 dark:bg-ink-800/60">
                  <div className={`w-full rounded-lg ${dot[s]} opacity-80 transition-[height] duration-700`} style={{ height: data ? `${(n / max) * 100}%` : '0%' }} />
                </div>
                <span className="text-[11px] text-ink-500">{pretty(s)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card p-6 lg:col-span-2">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('dashboard.recentLeads')}</h2>
          <ul className="mt-4 divide-y divide-ink-100 dark:divide-ink-800">
            {!leads && Array.from({ length: 5 }).map((_, i) => <li key={i} className="flex gap-3 py-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-8 flex-1" /></li>)}
            {leads?.slice(0, 6).map((l) => (
              <li key={l.id}>
                <button onClick={() => openLead(l)} className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800/60">
                  <Avatar name={perms.customers ? l.clientName ?? l.name : l.productInterest ?? '?'} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink-900 dark:text-white">{perms.customers ? l.clientName : t('common.leadN', { id: l.id })}</div><div className="truncate text-xs text-ink-500">{l.productInterest} · {t('common.pcs', { n: l.quantity?.toLocaleString() })}</div></div>
                  <Chip value={l.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {list && <LeadList label={list.label} leads={list.leads} onClose={() => setList(null)} openLead={openLead} customers={perms.customers} />}
    </>
  );
}
