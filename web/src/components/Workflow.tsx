import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Flame, Timer } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { STAGES, type Lead, type Sla, type SlaSettings, type Timeline } from '../lib/types';
import { Avatar } from './ui';

/** Re-render every `ms` so countdowns move. */
function useNow(ms = 30000) { const [n, setN] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
const sides = (role: string) => ({ india: role.startsWith('INDIA') || role === 'SUPER_ADMIN', admin: role.endsWith('ADMIN'), sa: role === 'SUPER_ADMIN' });
export const slaState = (s: Sla, now: number) => {
  const start = Date.parse(s.startedAt), due = Date.parse(s.dueAt), left = due - now;
  return { left, level: (s.breached || left <= 0 ? 'breach' : now >= start + (due - start) * 0.8 ? 'warn' : 'ok') as 'ok' | 'warn' | 'breach' };
};
const fmtLeft = (ms: number) => { const m = Math.round(Math.abs(ms) / 60000), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
const tone = { ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300', warn: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200', breach: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' };

/** SLA countdown chip: green → amber at 80% → red when breached. */
export function SlaChip({ sla, compact }: { sla?: Sla | null; compact?: boolean }) {
  const { t } = useTranslation(); const now = useNow();
  if (!sla) return null;
  const { left, level } = slaState(sla, now);
  return <span data-testid="sla-chip" data-level={level} title={t('sla.due', { d: new Date(sla.dueAt).toLocaleString() })} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tone[level])}>
    <Timer className="h-3 w-3" />{compact ? '' : `${t(`sla.office.${sla.office}`)} · `}{level === 'breach' ? t('sla.overdue', { t: fmtLeft(left) }) : t('sla.left', { t: fmtLeft(left) })}</span>;
}
export const PriorityBadge = () => { const { t } = useTranslation(); return <span data-testid="priority-badge" className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"><Flame className="h-3 w-3" />{t('sla.priority')}</span>; };

/** Progress bar across the whole workflow. */
export function Progress({ p }: { p: Timeline['progress'] }) {
  const { t } = useTranslation();
  return <div data-testid="wf-progress" data-stage={p.stage}>
    <div className="flex gap-1">{STAGES.map((s, i) => <div key={s} title={t(`wf.stage.${s}`)} className={clsx('h-2 flex-1 rounded-full', i <= p.index ? (p.lost ? 'bg-rose-400' : 'bg-brand-500') : 'bg-ink-100 dark:bg-ink-800')} />)}</div>
    <div className="mt-1 flex justify-between text-[11px] text-ink-500"><span>{t('wf.stageN', { n: p.index + 1, of: STAGES.length })}</span><b className={p.lost ? 'text-rose-600' : 'text-brand-700 dark:text-brand-300'}>{p.lost ? t('wf.lost') : t(`wf.stage.${p.stage}`)}</b></div>
  </div>;
}

const evText = (t: (k: string, o?: any) => string, kind: string, d: Record<string, any>) => {
  const office = d.office ? t(`sla.office.${d.office}`) : '';
  const extra: Record<string, string> = {
    QUOTE_ADDED: d.supplier ? ` · ${d.supplier}` : '', CQ_REJECTED: d.reason ? ` — “${d.reason}”` : '', REVISE_REQUESTED: [d.reason && `“${d.reason}”`, d.targetPrice && `${t('wf.target')} ${d.targetPrice} ${d.targetCurrency ?? ''}`, d.notes].filter(Boolean).join(' · '),
    LEAD_CLOSED: d.reason ? ` — “${d.reason}”` : '', SHIPPED: [d.tracking || d.container, d.etd && `ETD ${d.etd}`].filter(Boolean).join(' · '),
  };
  const base = t(`wf.ev.${kind}`, { n: d.n ?? '', office, to: d.to ?? office, from: d.from ? t(`status.${d.from}`) : '', st: d.to && kind === 'STATUS' ? t(`status.${d.to}`) : '', ship: d.status ? t(`ship.st.${d.status}`, { defaultValue: d.status }) : '', on: d.on ? t('wf.on') : t('wf.off'), defaultValue: kind });
  const x = extra[kind]; return x ? (kind === 'REVISE_REQUESTED' || kind === 'SHIPPED' ? `${base} — ${x}` : base + x) : base;
};

/** Lead drawer section: progress, SLA clock, priority toggle and the role-filtered event log. */
export function WorkflowPanel({ lead, onPriority }: { lead: Lead; onPriority?: (on: boolean) => void }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const { data, setData, reload } = useLoad(() => (api.timeline ? api.timeline(lead.id) : Promise.resolve(null)), [api, lead.id, lead.status, lead.assignedTo, lead.ownerOffice]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  if (!api.timeline) return null;
  const s = sides(session?.role ?? '');
  const toggle = async () => {
    if (!data || !api.setPriority) return; setBusy(true); setErr(null);
    try { const r = await api.setPriority(lead.id, !data.priority); setData({ ...data, ...r }); onPriority?.(r.priority); void reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <section data-testid="workflow" className="mt-6">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">{t('leads.timeline')}</h3>
      {data?.priority && <PriorityBadge />}{data?.sla && <SlaChip sla={data.sla} />}
      {s.india && data && <button data-testid="priority-toggle" disabled={busy} onClick={() => void toggle()} className={clsx('ml-auto rounded-lg border px-2 py-0.5 text-xs', data.priority ? 'border-orange-300 text-orange-700' : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300')}>{data.priority ? t('sla.unmark') : t('sla.mark', { h: Math.round((data.settings.priorityMinutes / 60) * 10) / 10 })}</button>}</div>
    {err && <p role="alert" className="mt-1 text-xs text-rose-600">{err}</p>}
    {!data ? <div className="mt-3 h-16 skeleton" /> : <>
      <div className="mt-3"><Progress p={data.progress} /></div>
      {data.sla && <p className="mt-2 text-xs text-ink-500" data-testid="sla-line">{t('sla.line', { office: t(`sla.office.${data.sla.office}`), who: data.sla.assigneeName || t('sla.queue'), d: new Date(data.sla.dueAt).toLocaleString() })}</p>}
      <ol data-testid="wf-events" className="mt-3 space-y-3 border-l border-ink-200 pl-4 dark:border-ink-800">
        {data.events.map((e) => <li key={e.id} data-kind={e.kind} className="relative text-sm">
          <span className={clsx('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-white dark:ring-ink-900', e.kind.startsWith('SLA') ? 'bg-rose-500' : e.kind === 'SHIPPED' || e.kind === 'CQ_ACCEPTED' ? 'bg-emerald-500' : e.kind === 'CQ_REJECTED' || e.kind === 'LEAD_CLOSED' ? 'bg-rose-400' : 'bg-brand-500')} />
          <div className="flex items-start gap-2 text-ink-800 dark:text-ink-100">{e.actorName && <Avatar name={e.actorName} person className="h-5 w-5 text-[9px]" />}<span>{evText(t, e.kind, e.data)}</span></div>
          <div className="text-xs text-ink-400">{e.actorName ? `${e.actorName} · ` : ''}{new Date(e.at).toLocaleString()}</div></li>)}
      </ol></>}
  </section>;
}

/** Dashboard widget (admins): running clocks at risk + on-time % per office. */
export function SlaWidget({ leads, openLead }: { leads: Lead[] | null; openLead: (l: Lead) => void }) {
  const { api, session } = useApp(); const { t } = useTranslation(); const now = useNow();
  const admin = sides(session?.role ?? '').admin;
  const { data: rep } = useLoad(() => (admin && api.slaReport ? api.slaReport(30) : Promise.resolve(null)), [api, admin]);
  const running = (leads ?? []).filter((l) => l.sla).map((l) => ({ l, ...slaState(l.sla!, now) })).sort((a, b) => a.left - b.left);
  const risk = running.filter((r) => r.level !== 'ok');
  return <div data-testid="sla-widget" className="card p-5">
    <div className="flex items-center gap-2"><Timer className="h-4 w-4 text-brand-600" /><h2 className="font-semibold text-ink-900 dark:text-white">{t('sla.widget')}</h2>
      <span className="ml-auto text-xs text-ink-500">{t('sla.counts', { run: running.length, warn: risk.filter((r) => r.level === 'warn').length, breach: risk.filter((r) => r.level === 'breach').length })}</span></div>
    {rep && <div className="mt-3 grid grid-cols-2 gap-2">{rep.office.map((o) => <div key={o.office} data-testid={`sla-office-${o.office}`} className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
      <div className="text-xs text-ink-500">{t(`sla.office.${o.office}`)} · {t('sla.days', { n: rep.days })}</div>
      <div className="mt-1 text-xl font-semibold text-ink-900 dark:text-white">{o.onTimePct == null ? '—' : `${o.onTimePct}%`}</div>
      <div className="text-[11px] text-ink-500">{t('sla.onTime', { ok: o.onTime, total: o.total, b: o.breached })}</div></div>)}</div>}
    <ul className="mt-3 divide-y divide-ink-100 dark:divide-ink-800">
      {(risk.length ? risk : running).slice(0, 6).map(({ l }) => <li key={l.id}><button onClick={() => openLead(l)} className="flex w-full items-center gap-2 py-2 text-left text-sm">
        <span className="font-mono text-xs text-brand-700 dark:text-brand-300">{l.leadRef ?? l.id.slice(0, 6)}</span>{l.priority && <PriorityBadge />}<span className="truncate text-ink-700 dark:text-ink-200">{l.productInterest}</span>
        <span className="ml-auto"><SlaChip sla={l.sla} /></span></button></li>)}
      {!running.length && <li className="py-3 text-sm text-ink-500">{t('sla.none')}</li>}
    </ul>
    {rep && rep.members.some((m) => m.breached) && <div className="mt-3 text-xs text-ink-500">{t('sla.topBreach')}: {rep.members.filter((m) => m.breached).slice(0, 3).map((m) => `${m.name ?? t('sla.queue')} (${m.breached})`).join(', ')}</div>}
  </div>;
}

/** Super admin: SLA hours. */
export function SlaSettingsCard() {
  const { api, session } = useApp(); const { t } = useTranslation();
  const { data, setData } = useLoad(() => (api.slaSettings ? api.slaSettings() : Promise.resolve(null)), [api]);
  const [f, setF] = useState<{ n: string; p: string } | null>(null), [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ n: String(data.normalMinutes / 60), p: String(data.priorityMinutes / 60) }); }, [data]);
  if (session?.role !== 'SUPER_ADMIN' || !data || !f) return null;
  const save = async () => {
    setMsg(null);
    try { const s: SlaSettings = await api.saveSlaSettings!({ normalMinutes: Math.round(Number(f.n) * 60), priorityMinutes: Math.round(Number(f.p) * 60) }); setData(s); setMsg(t('orders.saved')); } catch (e) { setMsg((e as Error).message); }
  };
  return <div data-testid="sla-settings" className="card p-5">
    <h2 className="font-semibold text-ink-900 dark:text-white">{t('sla.settings')}</h2><p className="mt-1 text-sm text-ink-500">{t('sla.settingsHint')}</p>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div><label className="label">{t('sla.normalH')}</label><input data-testid="sla-normal" type="number" min="0.1" step="0.5" className="input" value={f.n} onChange={(e) => setF({ ...f, n: e.target.value })} /></div>
      <div><label className="label">{t('sla.priorityH')}</label><input data-testid="sla-priority" type="number" min="0.1" step="0.5" className="input" value={f.p} onChange={(e) => setF({ ...f, p: e.target.value })} /></div></div>
    <button data-testid="sla-save" className="btn-primary mt-3" onClick={() => void save()}>{t('orders.save')}</button>{msg && <span role="status" className="ml-3 text-sm text-ink-500">{msg}</span>}
  </div>;
}
