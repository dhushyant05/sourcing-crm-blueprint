import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { ROLES, type Role } from '../lib/roles';
import { useTranslation } from 'react-i18next';
import { Avatar, Chip, Empty, PageHeader, TableSkeleton } from '../components/ui';

/** Admin user management. The server only returns/permits users on the admin's own side. */
export function Team() {
  const { api, session } = useApp();
  const { t } = useTranslation();
  const { data, error, reload } = useLoad(() => api.users(), [api]);
  const role = session!.role;
  const allowed: Role[] = role === 'SUPER_ADMIN' ? ROLES : role === 'INDIA_ADMIN' ? ['INDIA_STAFF', 'INDIA_ADMIN'] : ['CHINA_STAFF', 'CHINA_ADMIN'];
  const [form, setForm] = useState({ email: '', name: '', role: allowed[0], password: '' });
  const [open, setOpen] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    try { await api.createUser(form); setOpen(false); setForm({ ...form, email: '', name: '', password: '' }); setMsg(t('team.created')); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const reset = async (id: string) => {
    const pw = prompt(t('team.newPassword'));
    if (!pw) return;
    try { await api.resetPassword(id, pw); setMsg(t('team.resetDone')); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <PageHeader title={t('team.title')} subtitle={t(`office.${role}`)}
        actions={<button className="btn-primary" onClick={() => setOpen(!open)}><Plus size={16} />{t('team.add')}</button>} />
      {msg && <p className="mb-4 text-sm text-ink-600 dark:text-ink-300">{msg}</p>}
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
          <table className="w-full text-sm">
            <thead><tr><th className="th">{t('team.user')}</th><th className="th">{t('common.role')}</th><th className="th">{t('common.status')}</th><th className="th" /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={u.name} /><div><div className="font-medium text-ink-900 dark:text-white">{u.name}</div><div className="text-xs text-ink-500">{u.email}</div></div></div></td>
                  <td className="td">{t(`role.${u.role}`)}</td>
                  <td className="td"><Chip value={u.active ? 'ACTIVE' : 'DISABLED'} /></td>
                  <td className="td text-right">
                    <button className="btn-ghost" onClick={() => reset(u.id)}><KeyRound size={14} />{t('team.reset')}</button>
                    {u.email !== session?.email && <button className="btn-ghost" onClick={async () => { await api.setUserActive(u.id, !u.active); reload(); }}>{u.active ? t('team.disable') : t('team.enable')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
