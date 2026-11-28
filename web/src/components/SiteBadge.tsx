import { useTranslation } from 'react-i18next';

export type SourceSite = 'sourceeasy' | 'fortune_engineering';

/** Which public site a customer support chat came from (shared Customer support desk). */
export function SiteBadge({ site, className = '' }: { site?: string | null; className?: string }) {
  const { t } = useTranslation();
  if (!site) return null;
  const fe = site === 'fortune_engineering';
  return (
    <span data-testid="chat-site-badge" data-site={site}
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${fe
        ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'} ${className}`}>
      {fe ? t('chat.siteFortune') : t('chat.siteSourceEasy')}
    </span>
  );
}
