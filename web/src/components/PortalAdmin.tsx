import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, KeyRound, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { useApp } from '../lib/store';
import type { PortalLogin, PortalLoginRequest } from '../lib/types';

/** India admin / super admin with portal.logins.manage. */
export function usePortalAdmin() {
  const { session, perms, api } = useApp();
  return !!api.portalRequests && (session?.role === 'SUPER_ADMIN' || session?.role === 'INDIA_ADMIN') && perms.can('portal.logins.manage');
}
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Shown once after issuing / resetting: the team passes it on by hand (phone / WhatsApp). Never stored or shown again. */
function TempPassword({ phone, pw, onClose }: { phone: string; pw: string; onClose: () => void }) {
  const { t } = useTranslation(); const [copied, setCopied] = useState(false);
  return (
    <div role="status" data-testid="portal-temp-password" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="font-medium">{t('portal.tempTitle', { phone })}</p>
      <div className="mt-2 flex items-center gap-2"><code className="select-all rounded bg-white px-2 py-1 font-mono text-base dark:bg-ink-900">{pw}</code>
        <button className="btn-ghost !py-1 text-xs" onClick={() => { void navigator.clipboard?.writeText(pw); setCopied(true); }}><Copy size={13} />{copied ? t('portal.copied') : t('portal.copy')}</button></div>
      <p className="mt-2 text-xs text-ink-600 dark:text-ink-300">{t('portal.tempHint')}</p>
      <button className="btn-ghost mt-2 !py-1 text-xs" onClick={onClose}>{t('portal.done')}</button>
    </div>
  );
}

/** Pending login requests from the public enquiry form. */
export function LoginRequests({ onChanged }: { onChanged?: () => void }) {
  const { api } = useApp(); const { t } = useTranslation();
  const [list, setList] = useState<PortalLoginRequest[] | null>(null), [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ phone: string; pw: string } | null>(null), [rejecting, setRejecting] = useState<string | null>(null), [reason, setReason] = useState('');
  const load = useCallback(() => api.portalRequests!('PENDING').then(setList).catch((e) => setErr((e as Error).message)), [api]);
  useEffect(() => { void load(); }, [load]);
  const approve = async (r: PortalLoginRequest) => {
    setErr(null);
    try { const x = await api.approvePortalRequest!(r.id, r.customer?.id); setIssued({ phone: x.login.phone, pw: x.tempPassword }); await load(); onChanged?.(); } catch (e) { setErr((e as Error).message); }
  };
  const reject = async (id: string) => { setErr(null); try { await api.rejectPortalRequest!(id, reason); setRejecting(null); setReason(''); await load(); } catch (e) { setErr((e as Error).message); } };
  if (!list?.length && !issued && !err) return null;
  return (
    <div data-testid="portal-requests" className="card mb-4 p-4">
      <h3 className="mb-2 flex items-center gap-2 font-semibold"><UserPlus size={16} />{t('portal.requestsTitle', { n: list?.length ?? 0 })}</h3>
      {issued && <TempPassword phone={issued.phone} pw={issued.pw} onClose={() => setIssued(null)} />}
      <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
        {(list ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid={`portal-request-${r.id}`}>
            <div className="min-w-0"><div className="font-medium">{r.name}{r.company ? ` · ${r.company}` : ''} · {r.phone}</div>
              <div className="text-xs text-ink-500">{r.leadRef ?? '—'} · {r.product ?? ''} · {when(r.createdAt)}{r.customer ? ` · ${t('portal.linkedTo', { name: r.customer.name })}` : ` · ${t('portal.newCustomer')}`}{r.hasLogin ? ` · ${t('portal.hasLogin')}` : ''}</div></div>
            {rejecting === r.id ? <div className="flex flex-wrap gap-2"><input className="input !py-1 text-xs" placeholder={t('portal.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn-ghost !py-1 text-xs text-rose-600" disabled={!reason.trim()} onClick={() => void reject(r.id)}>{t('portal.reject')}</button><button className="btn-ghost !py-1 text-xs" onClick={() => setRejecting(null)}>{t('common.cancel')}</button></div>
              : <div className="flex gap-2"><button data-testid="portal-approve" className="btn-primary !py-1 text-xs" disabled={r.hasLogin} onClick={() => void approve(r)}><KeyRound size={13} />{t('portal.approve')}</button>
                <button className="btn-ghost !py-1 text-xs" onClick={() => setRejecting(r.id)}>{t('portal.reject')}</button></div>}
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
    </div>
  );
}

/** Portal login of one directory customer: status, issue, reset, enable / disable, audit. */
export function PortalLoginCard({ customerId, phone }: { customerId: string; phone: string | null }) {
  const { api } = useApp(); const { t } = useTranslation(); const admin = usePortalAdmin();
  const [st, setSt] = useState<{ login: PortalLogin | null; audit: { at: string; action: string; by: string | null }[] } | null>(null);
  const [issued, setIssued] = useState<{ phone: string; pw: string } | null>(null), [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.portalLogin?.(customerId).then(setSt).catch(() => setSt(null)), [api, customerId]);
  useEffect(() => { void load(); }, [load]);
  if (!api.portalLogin || !st) return null;
  const run = async (f: () => Promise<{ login: PortalLogin; tempPassword?: string }>) => {
    setErr(null); try { const x = await f(); if (x.tempPassword) setIssued({ phone: x.login.phone, pw: x.tempPassword }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const l = st.login;
  return (
    <div data-testid="portal-login-card" className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
      <h3 className="mb-1 font-semibold">{t('portal.loginTitle')}</h3>
      {issued && <TempPassword phone={issued.phone} pw={issued.pw} onClose={() => setIssued(null)} />}
      {l ? <div className="text-sm"><div>{l.phone} · <span className={l.active ? 'text-accent-700' : 'text-rose-600'}>{l.active ? t('portal.active') : t('portal.disabled')}</span>{l.mustChangePassword ? ` · ${t('portal.tempPending')}` : ''}</div>
        <div className="text-xs text-ink-500">{t('portal.lastLogin')}: {when(l.lastLoginAt)}</div></div>
        : <div className="text-sm text-ink-500">{t('portal.noLogin')}</div>}
      {admin && <div className="mt-2 flex flex-wrap gap-2">
        {!l && <button data-testid="portal-issue" className="btn-primary !py-1 text-xs" disabled={!phone} title={phone ? undefined : t('portal.needPhone')} onClick={() => void run(() => api.issuePortalLogin!(customerId))}><KeyRound size={13} />{t('portal.issue')}</button>}
        {l && <button className="btn-ghost !py-1 text-xs" onClick={() => void run(() => api.resetPortalLogin!(customerId))}><KeyRound size={13} />{t('portal.reset')}</button>}
        {l && <button className="btn-ghost !py-1 text-xs" onClick={() => void run(() => api.setPortalLoginActive!(customerId, !l.active))}>{l.active ? <><ShieldOff size={13} />{t('portal.disable')}</> : <><ShieldCheck size={13} />{t('portal.enable')}</>}</button>}
      </div>}
      {admin && st.audit.length > 0 && <details className="mt-2 text-xs text-ink-500"><summary className="cursor-pointer">{t('portal.audit')}</summary>
        <ul className="mt-1 space-y-0.5">{st.audit.slice(0, 20).map((a, i) => <li key={i}>{when(a.at)} · {t(`portal.act.${a.action}`, { defaultValue: a.action })}{a.by ? ` · ${a.by}` : ''}</li>)}</ul></details>}
      {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
    </div>
  );
}
