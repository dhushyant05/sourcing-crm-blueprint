import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, BellRing, Copy, RotateCcw } from 'lucide-react';
import { useApp } from '../lib/store';
const sides = (role: string) => ({ india: role.startsWith('INDIA') || role === 'SUPER_ADMIN' });
import type { Lead } from '../lib/types';

/** LOST / CLOSED lead actions for the India office and the super admin: reopen, copy to a new lead, close permanently, follow-up. */
export function LostActions({ lead, onChange, openLead }: { lead: Lead; onChange: (l: Lead) => void; openLead: (l: Lead) => void }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  const [fu, setFu] = useState<string>(lead.followUp ?? '');
  const role = session?.role ?? '', s = sides(role), sa = role === 'SUPER_ADMIN';
  const closed = lead.status === 'CLOSED';
  const from = lead.createdFromRef ? <p data-testid="created-from" className="mt-3 text-xs text-ink-500">{t('lost.createdFrom', { ref: lead.createdFromRef })}</p> : null;
  if (!api.reopenLead || !s.india || (lead.status !== 'LOST' && !closed)) return from;
  const run = async (f: () => Promise<Lead>, after?: (l: Lead) => void) => {
    setBusy(true); setErr(null); setMsg(null);
    try { const l = await f(); (after ?? onChange)(l); window.dispatchEvent(new Event('se:leads-changed')); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  return <section data-testid="lost-actions" className="mt-6 rounded-xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/5">
    {from}
    <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">{closed ? t('status.CLOSED') : t('lost.title')}</h3>
    {closed && <p className="mt-1 text-xs text-ink-500">{t('lost.closedOn', { when: lead.closedAt ? new Date(lead.closedAt).toLocaleString() : '', who: lead.closedByName ?? '—' })}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {(!closed || sa) && <>
        <button data-testid="lost-reopen-india" disabled={busy} className={`${btn} border-ink-200 bg-white`} onClick={() => void run(() => api.reopenLead!(lead.id, 'INDIA'))}><RotateCcw size={14} />{t('lost.reopenIndia')}</button>
        <button data-testid="lost-reopen-china" disabled={busy} className={`${btn} border-ink-200 bg-white`} onClick={() => void run(() => api.reopenLead!(lead.id, 'CHINA'))}><RotateCcw size={14} />{t('lost.reopenChina')}</button></>}
      <button data-testid="lost-copy" disabled={busy} className={`${btn} border-brand-500 bg-brand-500 text-white`} onClick={() => void run(() => api.copyLead!(lead.id), (l) => { setMsg(t('lost.copied', { ref: l.leadRef ?? '' })); openLead(l); })}><Copy size={14} />{t('lost.copy')}</button>
      {!closed && <button data-testid="lost-close" disabled={busy} className={`${btn} border-ink-700 bg-ink-800 text-white`} onClick={() => { if (window.confirm(t('lost.closeConfirm'))) void run(() => api.closeLeadPermanently!(lead.id, fu || null)); }}><Archive size={14} />{t('lost.close')}</button>}
    </div>
    {closed && !sa && <p className="mt-2 text-xs text-ink-500">{t('lost.onlySa')}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><BellRing size={14} className="text-ink-400" /><label htmlFor="fu" className="text-ink-600 dark:text-ink-300">{t('lost.followUp')}</label>
      <input id="fu" data-testid="lost-followup" type="date" value={fu} onChange={(e) => setFu(e.target.value)} className="input w-auto py-1" />
      <button data-testid="lost-followup-save" disabled={busy} className={`${btn} border-ink-200 bg-white`} onClick={() => void run(() => api.setFollowUp!(lead.id, fu || null))}>{t('lost.save')}</button></div>
    {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
    {err && <p role="alert" className="mt-2 text-xs text-rose-600">{err}</p>}
  </section>;
}
