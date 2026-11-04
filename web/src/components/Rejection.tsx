import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../lib/store';
import type { Lead } from '../lib/types';
import { fmtDate } from '../i18n';

/** "Rejected – action needed" banner + history. India chooses: ask China for a revised quote, or close as LOST. */
export function RejectionPanel({ lead, onChange }: { lead: Lead; onChange: (l: Lead) => void }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const r = lead.rejection; const role = session?.role ?? '', india = role.startsWith('INDIA') || role === 'SUPER_ADMIN';
  const [mode, setMode] = useState<'revise' | null>(null), [tp, setTp] = useState(''), [cur, setCur] = useState('INR'), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  if (!r) return null;
  const run = async (f: () => Promise<Lead>) => { setBusy(true); setErr(null); try { onChange(await f()); setMode(null); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const why = (x: typeof r.last) => `${t(`rej.r.${x.reasonCode}`)}${x.reasonText ? ` — ${x.reasonText}` : ''}`;
  return (<div data-testid="rejection-panel" className={`mt-4 rounded-xl border p-3 text-sm ${r.actionNeeded ? 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10' : 'border-ink-200 dark:border-ink-800'}`}>
    <div className="flex items-center gap-2 font-medium text-ink-900 dark:text-white"><AlertTriangle size={15} className="text-rose-600" />
      {r.actionNeeded ? t('rej.actionNeeded') : r.revising ? t('rej.revising') : t('rej.title')}<span className="ml-auto text-xs text-ink-500" data-testid="rej-count">{t('rej.count', { n: r.count })}</span></div>
    <div className="mt-1 text-ink-700 dark:text-ink-200">{why(r.last)}</div>
    {r.revising && (r.last.targetPrice != null || r.last.notes) && <div data-testid="rej-target" className="mt-1 text-xs text-ink-600 dark:text-ink-300">{r.last.targetPrice != null && <>{t('rej.target')}: <b>{r.last.targetPrice} {r.last.targetCurrency === 'CNY' ? 'RMB' : r.last.targetCurrency}</b> </>}{r.last.notes && <>· {r.last.notes}</>}</div>}
    {r.actionNeeded && india && !mode && <div className="mt-2 flex flex-wrap gap-2">
      <button data-testid="rej-revise" className="btn-primary !py-1 text-xs" disabled={busy} onClick={() => setMode('revise')}>{t('rej.revise')}</button>
      <button data-testid="rej-close" className="btn-outline !py-1 text-xs text-rose-600" disabled={busy} onClick={() => { if (confirm(t('rej.closeConfirm'))) void run(() => api.closeRejected!(lead.id)); }}>{t('rej.close')}</button></div>}
    {mode === 'revise' && <div className="mt-2 grid gap-2 sm:grid-cols-4">
      <input data-testid="rej-tp" className="input !py-1 text-xs" inputMode="decimal" placeholder={t('rej.targetOpt')} value={tp} onChange={(e) => setTp(e.target.value)} />
      <select className="input !py-1 text-xs" value={cur} onChange={(e) => setCur(e.target.value)}>{['INR', 'USD', 'CNY'].map((c) => <option key={c} value={c}>{c === 'CNY' ? 'RMB' : c}</option>)}</select>
      <input data-testid="rej-notes" className="input !py-1 text-xs sm:col-span-2" placeholder={t('rej.notesOpt')} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="text-xs text-ink-500 sm:col-span-4">{t('rej.reviseHint')}</p>
      <div className="flex gap-2 sm:col-span-4"><button data-testid="rej-revise-confirm" className="btn-primary !py-1 text-xs" disabled={busy} onClick={() => void run(() => api.reviseRejected!(lead.id, { targetPrice: tp ? Number(tp) : null, targetCurrency: cur, notes }))}>{t('rej.send')}</button>
        <button className="btn-outline !py-1 text-xs" onClick={() => setMode(null)}>{t('common.cancel')}</button></div></div>}
    {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    {r.history.length > 1 && <details className="mt-2 text-xs text-ink-600 dark:text-ink-300"><summary className="cursor-pointer">{t('rej.history')}</summary><ol className="mt-1 list-decimal pl-5">
      {r.history.map((x) => <li key={x.id}>{fmtDate(x.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {why(x)} · {x.resolution ? t(`rej.res.${x.resolution}`) : t('rej.open')}</li>)}</ol></details>}
  </div>);
}
