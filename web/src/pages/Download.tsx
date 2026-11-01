import { useEffect, useState } from 'react';
import { ArrowLeft, Download as DownloadIcon, ShieldCheck, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { LanguageSwitch } from '../components/LanguageSwitch';

export const APK_URL = '/download/source-easy.apk';
export const DOWNLOAD_PAGE = '/download';

type Version = { version?: string; build?: number; size?: number | null; published?: string; minAndroid?: string };

const mb = (n?: number | null) => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '—');

/** Small "Download Android app" link used on the landing page and the staff login. */
export function AppDownloadButton({ variant = 'light', className = '' }: { variant?: 'light' | 'dark' | 'outline'; className?: string }) {
  const { t } = useTranslation();
  const cls = {
    light: 'bg-white/10 text-white border border-white/20 hover:bg-white/20',
    dark: 'bg-ink-900 text-white hover:bg-ink-800',
    outline: 'border border-ink-200 text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800',
  }[variant];
  return (
    <a href={DOWNLOAD_PAGE} data-testid="android-download" className={`inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition ${cls} ${className}`}>
      <Smartphone size={16} />{t('download.button')}
    </a>
  );
}

export function DownloadPage() {
  const { t } = useTranslation();
  const [v, setV] = useState<Version | null>(null), [missing, setMissing] = useState(false), [qr, setQr] = useState('');
  useEffect(() => {
    fetch('/download/version.json').then((r) => (r.ok ? r.json() : Promise.reject())).then(setV).catch(() => setMissing(true));
    QRCode.toDataURL(`${location.origin}${DOWNLOAD_PAGE}`, { margin: 1, width: 240, color: { dark: '#0f172a', light: '#ffffff' } }).then(setQr).catch(() => {});
  }, []);
  const steps = t('download.steps', { returnObjects: true }) as string[];
  return (
    <div className="min-h-screen bg-gradient-to-b from-ink-950 to-ink-900 text-white">
      <header className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5"><img src="/brand/mark.png" alt="" className="h-9 w-9 object-contain" /><span className="text-[17px] font-semibold">Source Easy</span></a>
        <div className="ml-auto flex items-center gap-2"><LanguageSwitch /></div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"><ArrowLeft size={14} />{t('download.back')}</a>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_300px]">
          <section>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('download.title')}</h1><div data-testid="brand-tagline" className="mt-1 text-sm font-medium text-brand-200">{t('app.tagline')}</div>
            <p className="mt-3 max-w-xl text-white/70">{t('download.sub')}</p>
            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm" data-testid="apk-meta">
              <div><dt className="text-white/50">{t('download.version')}</dt><dd className="font-medium">{v?.version ? `${v.version}${v.build ? ` (${v.build})` : ''}` : '—'}</dd></div>
              <div><dt className="text-white/50">{t('download.size')}</dt><dd className="font-medium">{mb(v?.size)}</dd></div>
              {v?.published && <div><dt className="text-white/50">{t('download.published')}</dt><dd className="font-medium">{v.published}</dd></div>}
              <div><dt className="text-white/50">{t('download.requires')}</dt><dd className="font-medium">Android {v?.minAndroid ?? '7.0'}+</dd></div>
            </dl>
            {missing
              ? <p className="mt-8 rounded-xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">{t('download.notYet')}</p>
              : <a href={APK_URL} download="source-easy.apk" data-testid="apk-link" className="mt-8 inline-flex min-h-[52px] items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-accent-500 px-6 text-base font-medium shadow-lg shadow-brand-600/30 hover:brightness-110"><DownloadIcon size={20} />{t('download.cta')}</a>}
            <h2 className="mt-10 text-lg font-semibold">{t('download.howTitle')}</h2>
            <ol className="mt-3 space-y-3">
              {steps.map((s, i) => <li key={i} className="flex gap-3 text-sm text-white/80"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{i + 1}</span><span>{s}</span></li>)}
            </ol>
            <p className="mt-6 flex items-start gap-2 text-xs text-white/50"><ShieldCheck size={16} className="shrink-0" />{t('download.safety')}</p>
          </section>
          <aside className="hidden lg:block" data-testid="apk-qr">
            <div className="rounded-2xl bg-white p-5 text-center text-ink-800 shadow-xl">
              {qr && <img src={qr} alt="QR" className="mx-auto h-56 w-56" />}
              <p className="mt-3 text-sm font-medium">{t('download.scan')}</p>
              <p className="mt-1 text-xs text-ink-500">{t('download.scanHint')}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
