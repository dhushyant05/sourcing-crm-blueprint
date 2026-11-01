import { Coins, HardDriveDownload, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp, useLoad } from '../lib/store';
import { CURRENCIES, label, symbol } from '../lib/currency';
import { PageHeader } from '../components/ui';
import { LanguageSwitch } from '../components/LanguageSwitch';

export function Settings() {
  const { api, perms, session } = useApp();
  const { t } = useTranslation();
  const backups = useLoad(() => (perms.backups ? api.backups() : Promise.resolve([])), [api, perms.backups]);
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-6">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('settings.profile')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-ink-500">{t('common.name')}</dt><dd className="font-medium">{session?.name}</dd></div>
            <div><dt className="text-ink-500">{t('common.email')}</dt><dd className="font-medium">{session?.email}</dd></div>
            <div><dt className="text-ink-500">{t('common.role')}</dt><dd className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-200"><ShieldCheck size={13} />{session && t(`role.${session.role}`)}</dd></div>
            <div><dt className="text-ink-500">{t('lang.label')}</dt><dd className="mt-1"><LanguageSwitch className="w-fit" /><p className="mt-1 text-xs text-ink-400">{t('settings.languageHint')}</p></dd></div>
          </dl>
        </section>
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
