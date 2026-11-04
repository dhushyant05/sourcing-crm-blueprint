import { useCallback, useEffect, useState } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { PermMatrix, User } from '../lib/types';

/** Staff × permission checkbox matrix. Role gives the defaults; the super admin grants/revokes per user. Side-locked cells (data separation) can't be granted. */
export function PermissionMatrix({ users }: { users: User[] }) {
  const { api, session } = useApp(); const { t } = useTranslation();
  const staff = users.filter((u) => u.role !== 'SUPER_ADMIN');
  const [m, setM] = useState<Record<string, PermMatrix>>({});
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!api.userPermissions) return;
    const rs = await Promise.all(staff.map((u) => api.userPermissions!(u.id).catch(() => null)));
    setM(Object.fromEntries(rs.filter(Boolean).map((r) => [r!.userId, r!])));
  }, [api, users]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail?.type === 'perms') void load(); };
    addEventListener('se:data', h); return () => removeEventListener('se:data', h);
  }, [load]);
  if (!api.userPermissions || !staff.length) return null;
  const cols = staff.filter((u) => m[u.id]);
  const first = cols[0] && m[cols[0].id];
  if (!first) return null;
  const editable = session?.role === 'SUPER_ADMIN';
  const set = async (uid: string, changes: Record<string, boolean | null>) => {
    setBusy(uid); setErr(null);
    try { await api.setUserPermissions!(uid, changes); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const groups = [...new Set(first.permissions.map((p) => p.group))];
  const audit = cols.flatMap((u) => (m[u.id].audit ?? []).map((a) => ({ ...a, who: u.name }))).sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, 12);
  return <div className="card mt-6 p-5" data-testid="perm-matrix">
    <h2 className="font-semibold text-ink-900 dark:text-white">{t('perm.title')}</h2>
    <p className="mt-1 text-sm text-ink-500">{editable ? t('perm.hint') : t('perm.readOnly')}</p>
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-500"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />{t('perm.legendOverride')}</span><span><Lock size={11} className="mr-1 inline" />{t('perm.legendLocked')}</span></div>
    {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th sticky left-0 bg-white dark:bg-ink-900">{t('perm.permission')}</th>
          {cols.map((u) => { const over = m[u.id].permissions.some((p) => p.override != null); return <th key={u.id} className="th text-center align-bottom">
            <div className="font-medium normal-case text-ink-800 dark:text-ink-100">{u.name}</div><div className="text-[10px] normal-case text-ink-400">{t(`role.${u.role}`)}</div>
            {editable && over && <button data-testid={`perm-reset-${u.email}`} title={t('perm.reset')} className="mt-1 inline-flex items-center gap-1 text-[10px] normal-case text-brand-600 hover:underline" disabled={busy === u.id}
              onClick={() => void set(u.id, Object.fromEntries(m[u.id].permissions.filter((p) => p.override != null).map((p) => [p.key, null])))}><RotateCcw size={10} />{t('perm.reset')}</button>}
          </th>; })}</tr></thead>
        <tbody>{groups.map((g) => [
          <tr key={g}><td colSpan={cols.length + 1} className="bg-ink-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/50">{t(`perm.group.${g}`)}</td></tr>,
          ...first.permissions.filter((p) => p.group === g).map((p) => <tr key={p.key} className="border-t border-ink-100 dark:border-ink-800">
            <td className="td sticky left-0 bg-white dark:bg-ink-900"><div className="text-ink-800 dark:text-ink-100">{t(`perm.k.${p.key}`)}</div><div className="font-mono text-[10px] text-ink-400">{p.key}</div></td>
            {cols.map((u) => { const c = m[u.id].permissions.find((x) => x.key === p.key)!; return <td key={u.id} className="td text-center">
              {c.locked ? <span title={t('perm.locked')} className="inline-flex text-ink-300" data-testid={`perm-${u.email}-${p.key}-locked`}><Lock size={14} /></span> :
                <label className="relative inline-flex items-center" title={c.override != null ? t('perm.overridden', { d: c.default ? t('perm.on') : t('perm.off') }) : t('perm.default')}>
                  <input type="checkbox" data-testid={`perm-${u.email}-${p.key}`} className="h-4 w-4 accent-brand-600" checked={c.effective} disabled={!editable || busy === u.id}
                    onChange={() => void set(u.id, { [p.key]: !c.effective })} />
                  {c.override != null && <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-amber-500" />}
                </label>}
            </td>; })}
          </tr>)])}</tbody>
      </table>
    </div>
    {audit.length > 0 && <div className="mt-4" data-testid="perm-audit"><h3 className="text-xs font-semibold uppercase text-ink-400">{t('perm.audit')}</h3>
      <ul className="mt-1 space-y-0.5 text-xs text-ink-600 dark:text-ink-300">{audit.map((a) => <li key={a.id}>
        {new Date(a.changedAt).toLocaleString()} · <b>{a.changedByName ?? '—'}</b> → {a.who}: {t(`perm.k.${a.perm}`)} {a.before == null ? t('perm.default') : a.before ? t('perm.on') : t('perm.off')} → {a.after == null ? t('perm.default') : a.after ? t('perm.on') : t('perm.off')}</li>)}</ul></div>}
  </div>;
}
