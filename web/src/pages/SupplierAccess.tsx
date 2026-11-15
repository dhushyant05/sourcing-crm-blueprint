import { useState, type FormEvent } from 'react';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { login } from '../lib/api';
import { useApp } from '../lib/store';

const goApp = () => { location.assign(`${location.origin}/app`); };

export function SupplierAccess() {
  const { signIn } = useApp();
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState({
    company: '', contactName: '', email: '', password: '', phone: '',
    publicRegion: '', publicYears: '', publicAbout: '', catalogConsent: false,
  });
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const onSignup = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await fetch('/api/public/supplier/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company: f.company, contactName: f.contactName, email: f.email, password: f.password, phone: f.phone,
          publicRegion: f.publicRegion || undefined, publicYears: f.publicYears || undefined, publicAbout: f.publicAbout || undefined,
          catalogConsent: f.catalogConsent,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not create the account');
      setMsg({ ok: true, text: 'Account created. Sign in after the Marketplace Team verifies you, or sign in now to check your status.' });
      setMode('login');
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await login(f.email, f.password);
      if (r.user.role !== 'SUPPLIER') {
        setMsg({ ok: false, text: 'This page is for supplier accounts. Staff should use Staff login.' });
        return;
      }
      signIn({
        id: r.user.id, name: r.user.name, email: r.user.email, role: r.user.role, demo: false,
        permissions: r.user.permissions, supplierStatus: r.user.supplierStatus ?? null, supplierRejectReason: r.user.supplierRejectReason ?? null,
      }, r.token);
      goApp();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message || 'Could not sign in' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-lg items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2">
          <img src="/brand/mark.png" alt="" className="h-8 w-8 object-contain" />
          <span className="font-semibold text-ink-800">Source Easy</span>
        </a>
        <LanguageSwitch />
      </header>
      <main className="mx-auto max-w-lg px-6 pb-16">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-800">{mode === 'signup' ? 'Supplier signup' : 'Supplier login'}</h1>
        <p className="mt-2 text-sm text-ink-500">
          {mode === 'signup'
            ? 'Create a supplier account. The Marketplace Team will review it before you can add products.'
            : 'Sign in to check your application or manage your products once you are verified.'}
        </p>
        <form className="mt-6 space-y-3" onSubmit={mode === 'signup' ? (e) => void onSignup(e) : (e) => void onLogin(e)} data-testid="supplier-access-form">
          {mode === 'signup' && (
            <>
              <input className="input" required placeholder="Company name" value={f.company} onChange={(e) => set('company', e.target.value)} data-testid="supplier-company" />
              <input className="input" required placeholder="Contact name" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} data-testid="supplier-contact" />
            </>
          )}
          <input className="input" required type="email" placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)} data-testid="supplier-email" autoComplete="username" />
          <input className="input" required type="password" placeholder={mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'} value={f.password} onChange={(e) => set('password', e.target.value)} data-testid="supplier-password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {mode === 'signup' && (
            <>
              <input className="input" placeholder="Phone (optional)" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
              <input className="input" placeholder="Public location (optional)" value={f.publicRegion} onChange={(e) => set('publicRegion', e.target.value)} />
              <input className="input" placeholder="Years in business (optional)" value={f.publicYears} onChange={(e) => set('publicYears', e.target.value)} />
              <textarea className="input min-h-[80px]" placeholder="Public about (optional)" value={f.publicAbout} onChange={(e) => set('publicAbout', e.target.value)} />
              <label className="flex items-start gap-2 text-sm text-ink-600">
                <input type="checkbox" className="mt-1" checked={f.catalogConsent} onChange={(e) => set('catalogConsent', e.target.checked)} />
                I agree that Source Easy may show a public catalog card for my company to paying members
              </label>
            </>
          )}
          {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`} data-testid="supplier-access-msg">{msg.text}</p>}
          <button className="btn-primary w-full justify-center" disabled={busy} data-testid="supplier-access-submit">
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create supplier account' : 'Sign in'}
          </button>
        </form>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMsg(null); }}>
            {mode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
          </button>
          <a href="/app" className="text-ink-500 hover:underline">Staff login</a>
        </div>
      </main>
    </div>
  );
}
