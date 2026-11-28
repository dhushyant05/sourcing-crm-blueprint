import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import type { CustomRole, TeamInboxAdmin, User } from '../lib/types';
const CHAT_KEYS = [
  'chat.view_own', 'chat.view_team', 'chat.view_all', 'chat.start',
  'chat.reference_quotes', 'chat.send_attachments', 'chat.manage_canned',
  'chat.dm', 'chat.channels', 'chat.manage_channels',
  'chat.see_customer_fields', 'chat.see_supplier_fields',
];

/** Super-admin custom roles and team-inbox membership. Roles set defaults; the per-person matrix still wins. */
export function ChatRoles({ users, onUsersChange }: { users: User[]; onUsersChange?: () => void }) {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [boxes, setBoxes] = useState<TeamInboxAdmin[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  if (session?.role !== 'SUPER_ADMIN' || !api.customRoles) return null;

  const load = async () => {
    try {
      const [r, b] = await Promise.all([api.customRoles!(), api.teamInboxes?.() ?? Promise.resolve([])]);
      setRoles(r); setBoxes(b); setErr(null);
      if (!sel && r[0]) setSel(r[0].id);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail?.type === 'perms') void load(); };
    addEventListener('se:data', h); return () => removeEventListener('se:data', h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const role = roles.find((r) => r.id === sel) ?? null;
  const staff = users.filter((u) => u.role !== 'SUPER_ADMIN');

  const togglePerm = async (key: string, on: boolean) => {
    if (!role) return;
    try { const r = await api.setCustomRolePermissions!(role.id, { [key]: on }); setRoles((xs) => xs.map((x) => x.id === r.id ? r : x)); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="card mt-6 p-5" data-testid="roles-screen">
      <h2 className="font-semibold text-ink-900 dark:text-white">{t('roles.title')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('roles.hint')}</p>
      {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void api.createCustomRole!(name.trim(), desc || undefined).then((r) => { setRoles((xs) => [...xs, r]); setSel(r.id); setName(''); setDesc(''); }).catch((er) => setErr((er as Error).message)); }}>
        <input className="input max-w-xs" placeholder={t('roles.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input max-w-xs" placeholder={t('roles.description')} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="btn-primary">{t('roles.create')}</button>
      </form>
      <div className="mt-4 grid gap-4 lg:grid-cols-[16rem_1fr]">
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button type="button" data-testid={`custom-role-${r.name}`} onClick={() => setSel(r.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${sel === r.id ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
                <span className="font-medium">{r.name}</span>
                <span className="text-[11px] text-ink-400">{t('roles.members', { n: r.members })}</span>
              </button>
            </li>
          ))}
          {roles.length === 0 && <li className="text-sm text-ink-400">{t('roles.none')}</li>}
        </ul>
        {role && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input className="input max-w-xs !py-1" defaultValue={role.name} key={role.id + '-n'}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== role.name) void api.updateCustomRole!(role.id, { name: v }).then(() => void load()); }} />
              <button type="button" className="btn-ghost text-rose-600 text-sm" onClick={() => { if (confirm(t('roles.deleteConfirm', { name: role.name }))) void api.deleteCustomRole!(role.id).then(() => { setSel(null); void load(); }); }}>{t('common.delete')}</button>
            </div>
            <p className="mb-2 text-xs text-ink-500">{t('roles.permHint')}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {CHAT_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" data-testid={`role-perm-${k}`} checked={!!role.permissions[k]} onChange={(e) => void togglePerm(k, e.target.checked)} />
                  <span>{t(`perm.k.${k}`)}</span>
                </label>
              ))}
            </div>
            <h3 className="mt-4 text-xs font-semibold uppercase text-ink-400">{t('roles.assignPeople')}</h3>
            <ul className="mt-1 max-h-48 overflow-y-auto text-sm">
              {staff.map((u) => (
                <li key={u.id} className="flex items-center justify-between border-b border-ink-50 py-1 dark:border-ink-800">
                  <span>{u.name} <span className="text-xs text-ink-400">{t(`role.${u.role}`)}</span></span>
                  <select className="input !w-auto !py-0.5 text-xs" value={u.customRoleId ?? ''}
                    onChange={(e) => void api.assignCustomRole!(u.id, e.target.value || null).then(() => { void load(); onUsersChange?.(); })}>
                    <option value="">{t('roles.noCustom')}</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <h3 className="mt-6 font-medium text-ink-900 dark:text-white">{t('roles.teamInboxes')}</h3>
      <p className="mb-2 text-sm text-ink-500">{t('roles.teamHint')}</p>
      <div className="grid gap-4 md:grid-cols-3">
        {boxes.map((b) => (
          <div key={b.id} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800" data-testid={`team-inbox-${b.slug}`}>
            <div className="mb-2 font-medium text-ink-800 dark:text-ink-100">{b.name}</div>
            <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
              {staff.map((u) => (
                <li key={u.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={b.memberIds.includes(u.id)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...b.memberIds, u.id] : b.memberIds.filter((id) => id !== u.id);
                        void api.setTeamInboxMembers!(b.id, next).then(() => setBoxes((xs) => xs.map((x) => x.id === b.id ? { ...x, memberIds: next } : x)));
                      }} />
                    {u.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

