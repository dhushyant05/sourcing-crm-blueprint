import { Coins, HardDriveDownload, KeyRound, ShieldCheck } from 'lucide-react';
import { SlaSettingsCard } from '../components/Workflow';
import { useState, type FormEvent } from 'react';
import { AvatarEditor } from '../components/AvatarEditor';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import { CURRENCIES, label, symbol } from '../lib/currency';
import { PageHeader } from '../components/ui';
import { LanguageSwitch } from '../components/LanguageSwitch';

export function Settings() {
  const { api, perms, session, updateSession, refreshPeople } = useApp();
  const { t } = useTranslation();
  const backups = useLoad(() => (perms.backups ? api.backups() : Promise.resolve([])), [api, perms.backups]);
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('settings.profile')}</h2>
          {!session?.demo && <div className="mt-4"><AvatarEditor name={session?.name ?? ''} src={session?.avatarUrl}
            onSave={async (b) => { updateSession({ avatarUrl: await api.setAvatar(b) }); refreshPeople(); }}
            onRemove={async () => { await api.removeAvatar(); updateSession({ avatarUrl: null }); refreshPeople(); }} /></div>}
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-ink-500">{t('common.name')}</dt><dd className="font-medium">{session?.name}</dd></div>
            <div><dt className="text-ink-500">{t('common.email')}</dt><dd className="font-medium">{session?.email}</dd></div>
            <div><dt className="text-ink-500">{t('common.role')}</dt><dd className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-200"><ShieldCheck size={13} />{session && t(`role.${session.role}`)}</dd></div>
            <div><dt className="text-ink-500">{t('lang.label')}</dt><dd className="mt-1"><LanguageSwitch className="w-fit" /><p className="mt-1 text-xs text-ink-400">{t('settings.languageHint')}</p></dd></div>
          </dl>
        </section>
        {!session?.demo && <PasswordCard />}
        {!session?.demo && <SlaSettingsCard />}
        <section className="card p-6 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Coins size={18} className="text-ink-400" />{t('settings.currencies')}</h2>
          <p className="mt-1 text-sm text-ink-500">{t('settings.currenciesHint')}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {CURRENCIES.map((c) => (
              <div key={c} className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
                <div className="text-2xl font-semibold">{symbol(c)}</div><div className="mt-1 text-sm text-ink-500">{label(c)}{c === 'CNY' && ' (CNY)'}</div>
              </div>
            ))}
          </div>
        </section>
        {perms.backups && (
          <section className="card p-6 lg:col-span-3">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><HardDriveDownload size={20} /></div>
              <div><h2 className="font-semibold text-ink-900 dark:text-white">{t('settings.backups')}</h2>
                <p className="text-sm text-ink-500">{t('settings.backupsHint')}</p>
                <div className="mt-3 flex flex-wrap gap-2">{backups.data?.map((b) => <a key={b.url} href={b.url} target="_blank" rel="noreferrer" className="btn-outline">{b.label}</a>)}</div></div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function PasswordCard() {
  const { api, replaceToken } = useApp();
  const { t } = useTranslation();
  const [f, setF] = useState({ cur: '', next: '', conf: '' }), [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (f.next.length < 10) return setMsg({ ok: false, text: t('pw.min') });
    if (f.next !== f.conf) return setMsg({ ok: false, text: t('pw.mismatch') });
    setBusy(true);
    try { replaceToken(await api.changePassword(f.cur, f.next)); setF({ cur: '', next: '', conf: '' }); setMsg({ ok: true, text: t('pw.done') }); }
    catch (err) { setMsg({ ok: false, text: /current/i.test((err as Error).message) ? t('pw.wrong') : (err as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><KeyRound size={18} className="text-ink-400" />{t('pw.title')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('pw.hint')}</p>
      <form className="mt-4 space-y-3" onSubmit={(e) => void submit(e)} data-testid="pw-form">
        <input className="input" type="password" autoComplete="current-password" placeholder={t('pw.current')} value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} required data-testid="pw-current" />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('pw.new')} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required data-testid="pw-new" />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('pw.confirm')} value={f.conf} onChange={(e) => setF({ ...f, conf: e.target.value })} required data-testid="pw-confirm" />
        <button className="btn-primary" disabled={busy} data-testid="pw-submit">{t('pw.submit')}</button>
        {msg && <p className={msg.ok ? 'text-sm text-emerald-600' : 'text-sm text-red-600'} data-testid="pw-msg">{msg.text}</p>}
      </form>
    </section>
  );
}
