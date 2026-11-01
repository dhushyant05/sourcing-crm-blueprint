import { clsx } from 'clsx';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGS, setLang, type Lang } from '../i18n';
import { useApp } from '../lib/store';

/** EN | 中文 switch. Saved per device; also saved to the signed-in user's account (PATCH /api/me). */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const { session, api } = useApp();
  const pick = (l: Lang) => {
    setLang(l);
    if (session && !session.demo) api.setLanguage(l).catch(() => {});
  };
  return (
    <div role="group" aria-label={t('lang.label')} data-testid="lang-switch"
      className={clsx('flex items-center rounded-lg border border-ink-200 bg-white p-0.5 text-xs dark:border-ink-700 dark:bg-ink-900', className)}>
      <Languages size={14} className="mx-1.5 text-ink-400" />
      {LANGS.map((l) => (
        <button key={l} type="button" onClick={() => pick(l)} aria-pressed={i18n.language === l} title={t(`lang.${l}`)}
          className={clsx('rounded-md px-2 py-1 font-medium transition', i18n.language === l ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-100')}>
          {l === 'en' ? 'EN' : '中文'}
        </button>
      ))}
    </div>
  );
}
