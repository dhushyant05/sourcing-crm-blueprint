import { AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HttpError } from '../lib/api';
import { useApp } from '../lib/store';
import type { Lead } from '../lib/types';

/** Confirm-and-delete dialog for one lead (type its SE reference) or many (type the count). Orders in progress block the
 *  delete; a super admin sees a warning and can delete anyway. The server cascades quotes, orders, shipments, files and
 *  notifications, writes an audit row and pushes a live update to everyone else. */
export function DeleteLeadDialog({ leads, onClose, onDeleted }: { leads: Lead[]; onClose: () => void; onDeleted: (ids: string[]) => void }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const one = leads.length === 1 ? leads[0] : null;
  const want = one ? (one.leadRef || one.name || one.id) : String(leads.length);
  const [typed, setTyped] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ refs: string[]; n: number } | null>(null);
  const sa = session?.role === 'SUPER_ADMIN';
  const run = async (force: boolean) => {
    setBusy(true); setErr(null);
    try {
      if (one) { await api.deleteLead(one.id, force); onDeleted([one.id]); }
      else {
        const r = await api.bulkDeleteLeads(leads.map((l) => l.id), force);
        const inProg = r.failed.filter((f) => f.code === 'ORDER_IN_PROGRESS');
        if (r.deleted.length) onDeleted(r.deleted);
        if (inProg.length && !force) { setBlocked({ refs: inProg.map((f) => f.leadRef ?? f.id), n: inProg.reduce((a, f) => a + (f.activeOrders ?? 1), 0) }); return; }
        if (r.failed.length) { setErr(r.failed.map((f) => `${f.leadRef ?? f.id}: ${f.error}`).join('; ')); return; }
      }
      window.dispatchEvent(new Event('se:leads-changed')); onClose();
    } catch (e) {
      if (e instanceof HttpError && e.body?.code === 'ORDER_IN_PROGRESS') setBlocked({ refs: [e.body.leadRef ?? want], n: e.body.activeOrders ?? 1 });
      else setErr((e as Error).message);
    } finally { setBusy(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/50 p-4" role="dialog" aria-modal="true" data-testid="delete-lead-dialog" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-lg font-semibold text-rose-700"><Trash2 size={18} />{one ? t('del.titleOne', { ref: want }) : t('del.titleMany', { n: leads.length })}</div>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t('del.body')}</p>
        {!one && <ul className="mt-2 max-h-28 overflow-auto font-mono text-xs text-ink-500">{leads.map((l) => <li key={l.id}>{l.leadRef ?? l.id} · {l.productInterest}</li>)}</ul>}
        {blocked ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="delete-blocked">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle size={16} />{t('del.inProgress', { n: blocked.n, refs: blocked.refs.join(', ') })}</div>
            <p className="mt-1">{sa ? t('del.forceHint') : t('del.onlySa')}</p>
          </div>
        ) : (
          <label className="mt-3 block text-sm">{one ? t('del.typeRef', { ref: want }) : t('del.typeCount', { n: want })}
            <input autoFocus className="input mt-1 font-mono" data-testid="delete-confirm-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={want} /></label>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>{t('common.cancel')}</button>
          {blocked ? (sa && <button className="btn-primary !bg-rose-600 hover:!bg-rose-700" data-testid="delete-force" disabled={busy} onClick={() => void run(true)}><AlertTriangle size={15} />{t('del.force')}</button>)
            : <button className="btn-primary !bg-rose-600 hover:!bg-rose-700 disabled:opacity-50" data-testid="delete-confirm" disabled={busy || typed.trim().toUpperCase() !== want.toUpperCase()} onClick={() => void run(false)}><Trash2 size={15} />{t('del.confirm')}</button>}
        </div>
      </div>
    </div>, document.body);
}
