import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { roleLabel, type Role } from '../lib/roles';
import { Avatar, Chip, Empty, PageHeader, TableSkeleton } from '../components/ui';

/** Admin user management. The server only returns/permits users on the admin's own side. */
export function Team() {
  const { api, session } = useApp();
  const { data, error, reload } = useLoad(() => api.users(), [api]);
  const role = session!.role;
  const allowed: Role[] = role === 'SUPER_ADMIN' ? (Object.keys(roleLabel) as Role[]) : role === 'INDIA_ADMIN' ? ['INDIA_STAFF', 'INDIA_ADMIN'] : ['CHINA_STAFF', 'CHINA_ADMIN'];
  const [form, setForm] = useState({ email: '', name: '', role: allowed[0], password: '' });
  const [open, setOpen] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    try { await api.createUser(form); setOpen(false); setForm({ ...form, email: '', name: '', password: '' }); setMsg('User created'); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const reset = async (id: string) => {
    const pw = prompt('New password (min 10 characters)');
    if (!pw) return;
    try { await api.resetPassword(id, pw); setMsg('Password reset; existing sessions signed out'); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <PageHeader title="Team" subtitle={role === 'SUPER_ADMIN' ? 'All offices' : `${roleLabel[role].split(' ')[0]} office users`}
        actions={<button className="btn-primary" onClick={() => setOpen(!open)}><Plus size={16} />Add user</button>} />
      {msg && <p className="mb-4 text-sm text-ink-600 dark:text-ink-300">{msg}</p>}
      {open && (
        <form className="card mb-6 grid gap-3 p-5 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{allowed.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
          <input className="input" type="password" placeholder="Initial password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <button className="btn-primary justify-center">Create</button>
        </form>
      )}
      <div className="card overflow-hidden">
        {error ? <Empty title="Could not load users" hint={error} /> : !data ? <TableSkeleton /> : !data.length ? <Empty title="No users yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">User</th><th className="th">Role</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="td"><div className="flex items-center gap-3"><Avatar name={u.name} /><div><div className="font-medium text-ink-900 dark:text-white">{u.name}</div><div className="text-xs text-ink-500">{u.email}</div></div></div></td>
                  <td className="td">{roleLabel[u.role]}</td>
                  <td className="td"><Chip value={u.active ? 'ACTIVE' : 'DISABLED'} /></td>
                  <td className="td text-right">
                    <button className="btn-ghost" onClick={() => reset(u.id)}><KeyRound size={14} />Reset password</button>
                    {u.email !== session?.email && <button className="btn-ghost" onClick={async () => { await api.setUserActive(u.id, !u.active); reload(); }}>{u.active ? 'Disable' : 'Enable'}</button>}
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
