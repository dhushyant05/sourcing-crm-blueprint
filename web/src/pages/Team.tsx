import { useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { ROLES, type Role } from '../lib/roles';
import type { User } from '../lib/types';
import { useTranslation } from 'react-i18next';
import { AvatarEditor } from '../components/AvatarEditor';
import { Avatar, Chip, Empty, Field, PageHeader, SlideOver, TableSkeleton } from '../components/ui';

/** Admin user management. The server only returns/permits users on the admin's own side; remove is super admin only. */
export function Team() {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const { data, error, reload } = useLoad(() => api.users(), [api]);
  const role = session!.role, isSuper = role === 'SUPER_ADMIN';
  const allowed: Role[] = isSuper ? ROLES : role === 'INDIA_ADMIN' ? ['INDIA_STAFF', 'INDIA_ADMIN'] : ['CHINA_STAFF', 'CHINA_ADMIN'];
  const [form, setForm] = useState({ email: '', name: '', role: allowed[0], password: '' });
  const [open, setOpen] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null), [removing, setRemoving] = useState<User | null>(null);
  const create = async () => {
    try { await api.createUser(form); setOpen(false); setForm({ ...form, email: '', name: '', password: '' }); setMsg(t('team.created')); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const reset = async (id: string) => {
    const pw = prompt(t('team.newPassword'));
    if (!pw) return;
    if (pw.length < 10) { setMsg(t('team.pwShort')); return; }
    try { await api.resetPassword(id, pw); setMsg(t('team.resetDone')); } catch (e) { setMsg((e as Error).message); }
  };
  const remove = async (u: User) => {
    try { await api.deleteUser(u.id); setRemoving(null); setMsg(t('team.removed')); reload(); } catch (e) { setMsg((e as Error).message); setRemoving(null); }
  };
  const isMe = (u: User) => u.email === session?.email;
  return (
    <>
      <PageHeader title={t('team.title')} subtitle={t(`office.${role}`)}
        actions={<button className="btn-primary" onClick={() => setOpen(!open)}><Plus size={16} />{t('team.add')}</button>} />
      {msg && <p className="mb-4 text-sm text-ink-600 dark:text-ink-300" data-testid="team-msg">{msg}</p>}
      {open && (
        <form className="card mb-6 grid gap-3 p-5 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input className="input" placeholder={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" type="email" placeholder={t('common.email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{allowed.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>
          <input className="input" type="password" placeholder={t('team.initialPassword')} minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <button className="btn-primary justify-center">{t('team.create')}</button>
        </form>
      )}
      <div className="card overflow-hidden">
        {error ? <Empty title={t('team.loadFail')} hint={error} /> : !data ? <TableSkeleton /> : !data.length ? <Empty title={t('team.none')} /> : (
          <table className="rtable w-full text-sm">
            <thead><tr><th className="th">{t('team.user')}</th><th className="th">{t('common.role')}</th><th className="th">{t('common.status')}</th><th className="th text-right">{t('team.actions')}</th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} data-testid={`staff-${u.email}`}>
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={u.name} src={u.avatarUrl} /><div><div className="font-medium text-ink-900 dark:text-white">{u.name}{isMe(u) && <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600 dark:bg-ink-800 dark:text-ink-300">{t('team.you')}</span>}</div><div className="text-xs text-ink-500">{u.email}</div></div></div></td>
                  <td className="td">{t(`role.${u.role}`)}</td>
                  <td className="td"><Chip value={u.active ? 'ACTIVE' : 'DISABLED'} /></td>
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-ghost" data-testid="staff-edit" onClick={() => setEditing(u)}><Pencil size={14} />{t('common.edit')}</button>
                    <button className="btn-ghost" onClick={() => reset(u.id)}><KeyRound size={14} />{t('team.reset')}</button>
                    {!isMe(u) && <button className="btn-ghost" onClick={async () => { try { await api.setUserActive(u.id, !u.active); reload(); } catch (e) { setMsg((e as Error).message); } }}>{u.active ? t('team.disable') : t('team.enable')}</button>}
                    {isSuper && !isMe(u) && <button className="btn-ghost text-red-600" data-testid="staff-remove" onClick={() => setRemoving(u)}><Trash2 size={14} />{t('team.remove')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <EditStaff key={editing.id} user={editing} me={isMe(editing)} isSuper={isSuper} roles={allowed}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg(t('team.saved')); reload(); }} />}
      {removing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-testid="remove-dialog">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-ink-900 dark:text-white">{t('team.removeTitle', { name: removing.name })}</h3>
            <p className="mt-1 text-xs text-ink-500">{removing.email} · {t(`role.${removing.role}`)}</p>
            <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">{t('team.removeBody')}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setRemoving(null)}>{t('common.cancel')}</button>
              <button className="btn-primary bg-red-600 hover:bg-red-700" data-testid="remove-confirm" onClick={() => void remove(removing)}><Trash2 size={14} />{t('team.removeConfirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EditStaff({ user, me, isSuper, roles, onClose, onSaved }: { user: User; me: boolean; isSuper: boolean; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { api, refreshPeople } = useApp();
  const [pic, setPic] = useState(user.avatarUrl ?? null);
  const { t } = useTranslation();
  const [f, setF] = useState({ name: user.name, email: user.email, role: user.role, active: user.active, password: '' });
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.password && f.password.length < 10) { setErr(t('team.pwShort')); return; }
    setBusy(true); setErr(null);
    try {
      const patch: { name?: string; email?: string; role?: Role; active?: boolean } = {};
      if (f.name.trim() !== user.name) patch.name = f.name.trim();
      if (isSuper && f.email.trim().toLowerCase() !== user.email) patch.email = f.email.trim();
      if (!me && f.role !== user.role) patch.role = f.role;
      if (!me && f.active !== user.active) patch.active = f.active;
      if (Object.keys(patch).length) await api.updateUser(user.id, patch);
      if (f.password) await api.resetPassword(user.id, f.password);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <SlideOver open onClose={onClose} title={t('team.editTitle', { name: user.name })} subtitle={user.email}
      footer={<><button className="btn-outline" onClick={onClose}>{t('common.cancel')}</button><button className="btn-primary" data-testid="staff-save" disabled={busy} onClick={() => void save()}>{t('common.save')}</button></>}>
      <div className="space-y-4" data-testid="staff-edit-form">
        {isSuper && <Field label={t('profile.picture')}><AvatarEditor testid="staff-avatar" name={user.name} src={pic}
          onSave={async (b) => { setPic(await api.setAvatar(b, user.id)); refreshPeople(); }}
          onRemove={async () => { await api.removeAvatar(user.id); setPic(null); refreshPeople(); }} /></Field>}
        <Field label={t('common.name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('common.email')}><input className="input" type="email" value={f.email} disabled={!isSuper} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t('common.role')}>
          <select className="input" value={f.role} disabled={me} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(roles.includes(user.role) ? roles : [user.role, ...roles]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} disabled={me} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t('team.active')}</label>
        <Field label={t('team.passwordOptional')}><input className="input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <p className="text-xs text-ink-500">{t('team.sessionsNote')}</p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </SlideOver>
  );
}
