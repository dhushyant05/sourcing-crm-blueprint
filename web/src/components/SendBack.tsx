import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Send } from 'lucide-react';
import { useApp } from '../lib/store';
import type { Lead, LeadQuote } from '../lib/types';
import { fmtDate } from '../i18n';

const sides = (role: string) => ({ india: role.startsWith('INDIA') || role === 'SUPER_ADMIN', china: role.startsWith('CHINA') || role === 'SUPER_ADMIN' });
const when = (at: string) => fmtDate(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Note box shared by the four send-back actions. The note is required and shown to both offices. */
function NoteBox({ id, label, hint, onSend, onCancel, required = true }: { id: string; label: string; hint?: string; required?: boolean; onSend: (note: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const go = async () => { if (required && !note.trim()) { setErr(t('sb.noteRequired')); return; } setBusy(true); setErr(null); try { await onSend(note.trim()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return <div className="mt-2 space-y-2">
    <textarea data-testid={`${id}-note`} className="input min-h-[72px] text-sm" maxLength={2000} placeholder={required ? t('sb.notePh') : t('sb.noteOpt')} value={note} onChange={(e) => setNote(e.target.value)} />
    <p className="text-[11px] text-ink-500">{hint ?? t('sb.privacy')}</p>
    {err && <p role="alert" className="text-xs text-rose-600">{err}</p>}
    <div className="flex gap-2"><button data-testid={`${id}-confirm`} className="btn-primary !py-1 text-xs" disabled={busy} onClick={() => void go()}><Send size={13} />{label}</button>
      <button className="btn-outline !py-1 text-xs" onClick={onCancel}>{t('common.cancel')}</button></div>
  </div>;
}

/** Lead drawer: "Needs info" banner with the latest note, China's "Send back to India" and India's "Answer & re-send to China". */
export function LeadSendBack({ lead, onChange }: { lead: Lead; onChange: (l: Lead) => void }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!api.sendBackLead) return null;
  const s = sides(session?.role ?? ''), sb = lead.sendBack, done = ['CLOSED', 'LOST', 'COMPLETED', 'DELIVERED'].includes(lead.status);
  const chinaCan = s.china && lead.ownerOffice === 'CHINA' && !done;
  const indiaAnswer = s.india && sb?.side === 'INDIA' && !sb.quoteId;
  if (!sb && !chinaCan) return null;
  return <div data-testid="sendback-panel" className={`mt-4 rounded-xl border p-3 text-sm ${sb ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-ink-200 dark:border-ink-800'}`}>
    {sb ? <>
      <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200"><CornerDownLeft size={15} />
        {sb.side === 'INDIA' ? t('sb.needsInfo') : t('sb.revisionRequested')}<span className="ml-auto text-xs font-normal text-ink-500">{sb.byName ? `${sb.byName} · ` : ''}{when(sb.at)}</span></div>
      <p data-testid="sendback-note" className="mt-1 whitespace-pre-wrap text-ink-800 dark:text-ink-100">{sb.note}</p>
    </> : null}
    {!open && <div className="mt-2 flex flex-wrap gap-2">
      {chinaCan && !sb && <button data-testid="sendback-india" className="btn-outline !py-1 text-xs" onClick={() => setOpen(true)}><CornerDownLeft size={13} />{t('sb.toIndia')}</button>}
      {indiaAnswer && <button data-testid="resend-china" className="btn-primary !py-1 text-xs" onClick={() => setOpen(true)}><Send size={13} />{t('sb.resend')}</button>}
    </div>}
    {open && <NoteBox id={indiaAnswer ? 'resend' : 'sendback'} label={indiaAnswer ? t('sb.resend') : t('sb.toIndia')} hint={indiaAnswer ? t('sb.resendHint') : undefined} onCancel={() => setOpen(false)}
      onSend={async (n) => { onChange(await (indiaAnswer ? api.resendLead!(lead.id, n) : api.sendBackLead!(lead.id, n))); setOpen(false); }} />}
  </div>;
}

/** Quote card: revision badge, open revision note, India's "Send back to China" and China's "Resubmit revision". */
export function QuoteSendBack({ q, onChange }: { q: LeadQuote; onChange: (q: LeadQuote) => void }) {
  const { api, session, perms } = useApp(); const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!api.sendBackQuote) return null;
  const s = sides(session?.role ?? ''), r = q.revRequest;
  const indiaCan = s.india && !r && q.status !== 'ACCEPTED' && !(q as any).orderId && perms.can('quotes.view');
  const chinaCan = s.china && !!r && perms.can('quotes.create');
  if (!r && !indiaCan) return null;
  return <div data-testid="quote-sendback" className="mt-2">
    {r && <div data-testid="quote-rev-request" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <b>{t('sb.revisionRequested')}</b>{r.byName ? ` · ${r.byName}` : ''} · {when(r.at)}<p className="mt-0.5 whitespace-pre-wrap">{r.note}</p></div>}
    {!open && <div className="mt-2 flex gap-2">
      {indiaCan && <button data-testid="sendback-china" className="btn-outline !py-1 text-xs" onClick={() => setOpen(true)}><CornerDownLeft size={13} />{t('sb.toChina')}</button>}
      {chinaCan && <button data-testid="resubmit-quote" className="btn-primary !py-1 text-xs" onClick={() => setOpen(true)}><Send size={13} />{t('sb.resubmit')}</button>}
    </div>}
    {open && <NoteBox id={chinaCan ? 'resubmit' : 'sendbackq'} required={!chinaCan} label={chinaCan ? t('sb.resubmit') : t('sb.toChina')} hint={chinaCan ? t('sb.resubmitHint') : undefined} onCancel={() => setOpen(false)}
      onSend={async (n) => { onChange(await (chinaCan ? api.resubmitQuote!(q.id, n) : api.sendBackQuote!(q.id, n))); setOpen(false); }} />}
  </div>;
}
