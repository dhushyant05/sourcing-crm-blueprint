import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../lib/store';
import { login } from '../lib/api';

export function Login() {
  const { signIn } = useApp();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { const r = await login(email, password); signIn({ name: r.user.name, email: r.user.email, role: r.user.role, demo: false }, r.token); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-ink-900 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 font-bold backdrop-blur">S</div><span className="text-lg font-semibold">Source Easy</span></div>
        <div className="mt-auto max-w-md"><h1 className="text-3xl font-semibold leading-tight tracking-tight">From WhatsApp enquiry to delivered container — one shared pipeline.</h1><p className="mt-4 text-brand-100">India captures leads, China sources and quotes, everyone tracks the shipment.</p></div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-8">
        <form className="w-full max-w-sm animate-fade-in" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">Use the account your office admin created for you.</p>
          <div className="mt-6 space-y-4">
            <div><label className="label">Email</label><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><label className="label">Password</label><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          <button disabled={busy} className="btn-primary mt-6 w-full justify-center py-2.5 disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
          <div className="my-6 flex items-center gap-3 text-xs text-ink-400"><span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />or<span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" /></div>
          <button type="button" className="btn-outline w-full justify-center py-2.5" onClick={() => signIn({ name: 'Dhushyanth Kumar', email: 'demo@sourceeasy.app', role: 'SUPER_ADMIN', demo: true })}>Explore with demo data</button>
        </form>
      </div>
    </div>
  );
}
