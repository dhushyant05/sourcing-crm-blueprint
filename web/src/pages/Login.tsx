import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { login } from '../lib/api';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { AppDownloadButton } from './Download';
import { deviceLang, LANGS, setLang, type Lang } from '../i18n';

export function Login() {
  const { signIn } = useApp();
  const { t } = useTranslation();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await login(email, password);
      if (!deviceLang() && LANGS.includes(r.user.language as Lang)) setLang(r.user.language as Lang);
      signIn({ id: r.user.id, name: r.user.name, email: r.user.email, role: r.user.role, demo: false }, r.token);
    } catch (e) { setError((e as Error).message || t('login.failed')); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-accent-600 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5"><div className="grid h-11 w-11 place-items-center rounded-xl bg-white p-1 shadow"><img src="/brand/mark.png" alt="" className="h-full w-full object-contain" /></div><span className="text-lg font-semibold">{t('app.name')}</span></div>
        <div className="mt-auto max-w-md"><h1 className="text-3xl font-semibold leading-tight tracking-tight">{t('login.tagline')}</h1><p className="mt-4 text-brand-100">{t('login.sub')}</p></div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
      </div>
      <div className="relative flex items-center justify-center p-8">
        <LanguageSwitch className="absolute right-6 top-6" />
        <form className="w-full max-w-sm animate-fade-in" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <img src="/brand/lockup.png" alt="Source Easy" data-testid="login-logo" className="mb-8 h-24 w-auto object-contain" />
          <h2 className="text-xl font-semibold tracking-tight text-ink-900 dark:text-white">{t('login.title')}</h2>
          <p className="mt-1 text-sm text-ink-500">{t('login.hint')}</p>
          <div className="mt-6 space-y-4">
            <div><label className="label">{t('common.email')}</label><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><label className="label">{t('login.password')}</label><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          <button disabled={busy} className="btn-primary mt-6 w-full justify-center py-2.5 disabled:opacity-60">{busy ? t('login.signingIn') : t('login.title')} <ArrowRight size={16} /></button>
          <div className="my-6 flex items-center gap-3 text-xs text-ink-400"><span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />{t('login.or')}<span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" /></div>
          <button type="button" className="btn-outline w-full justify-center py-2.5" onClick={() => signIn({ name: 'Dhushyanth Kumar', email: 'demo@sourceeasy.app', role: 'SUPER_ADMIN', demo: true })}>{t('login.demo')}</button>
          <div className="mt-6 text-center"><AppDownloadButton variant="outline" /></div>
        </form>
      </div>
    </div>
  );
}
