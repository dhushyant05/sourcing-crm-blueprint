import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, ClipboardList, Factory, FileText, Globe2, Languages, Mail, MapPin, MessageCircle, Phone, Radar, Receipt, Ship, ShieldCheck, Sofa, Shirt, Package, Plug, Wrench, Cog, Gift, CookingPot } from 'lucide-react';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { AppDownloadButton } from './Download';
import { EnquiryForm } from '../components/EnquiryForm';

const PHONE = '+91 72995 41489', TEL = '+917299541489', EMAIL = 'fortuneengineering05@gmail.com';
const WA = `https://wa.me/917299541489`, WA_DISPLAY = '+91 72995 41489';

export function Landing() {
  const { t } = useTranslation();
  const l = (k: string) => t(`landing.${k}`);
  const cats = t('landing.cat.items', { returnObjects: true }) as string[];
  const catIcons = [CookingPot, Plug, Package, Shirt, Wrench, Sofa, Cog, Gift];
  return (
    <div className="min-h-screen bg-white text-ink-800 antialiased">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-ink-950/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/brand/mark.png" alt="" className="h-9 w-9 object-contain" />
            <span className="hidden text-[17px] font-semibold tracking-tight text-white sm:inline">Source Easy</span>
          </a>
          <nav className="ml-8 hidden gap-6 text-sm text-white/70 lg:flex">
            {(['how', 'services', 'categories', 'contact'] as const).map((k) => <a key={k} href={`#${k}`} className="transition hover:text-white">{l(`nav.${k}`)}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch />
            <AppDownloadButton className="hidden sm:inline-flex" />
            <a href="/app" data-testid="staff-login" className="whitespace-nowrap inline-flex min-h-[36px] whitespace-nowrap items-center rounded-lg bg-white px-3 text-sm font-medium text-ink-900 transition hover:bg-brand-50">{l('staffLogin')}</a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-ink-950 pb-24 pt-32 text-white sm:pb-32 sm:pt-40">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand-600/40 blur-3xl animate-[pulse_8s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute -right-32 top-20 h-[28rem] w-[28rem] rounded-full bg-accent-500/25 blur-3xl animate-[pulse_10s_ease-in-out_infinite]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 animate-fade-in">
          <img src="/brand/lockup.png" alt="Source Easy" data-testid="hero-logo" className="mb-8 h-28 w-auto object-contain sm:h-36" />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80"><Globe2 size={14} />{l('hero.badge')}</span>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            {l('hero.title')}<br /><span className="bg-gradient-to-r from-brand-200 via-brand-300 to-accent-300 bg-clip-text text-transparent">{l('hero.titleAccent')}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">{l('hero.sub')}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#contact" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-accent-500 px-6 font-medium shadow-lg shadow-brand-600/30 transition hover:brightness-110">{l('hero.cta')}<ArrowRight size={18} /></a>
            <a href={WA} target="_blank" rel="noreferrer" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 font-medium transition hover:bg-white/10"><MessageCircle size={18} />{l('hero.whatsapp')}</a>
            <AppDownloadButton className="min-h-[48px] rounded-xl px-6 text-base" />
          </div>
        </div>
      </section>

      <Section id="how" title={l('how.title')} sub={l('how.sub')}>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[ClipboardList, Factory, FileText, Ship].map((I, i) => (
            <li key={i} className="group relative rounded-2xl border border-ink-100 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lift">
              <div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white"><I size={20} /></span><span className="text-4xl font-semibold text-ink-100">0{i + 1}</span></div>
              <h3 className="mt-5 font-semibold text-ink-900">{l(`how.s${i + 1}`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{l(`how.d${i + 1}`)}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="services" title={l('svc.title')} sub={l('svc.sub')} tint>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([['a', BadgeCheck], ['b', ShieldCheck], ['c', Receipt], ['d', Ship], ['e', Radar], ['f', Languages]] as const).map(([k, I]) => (
            <div key={k} className="flex gap-4 rounded-2xl bg-white p-5 ring-1 ring-ink-100">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><I size={20} /></span>
              <div><h3 className="font-semibold text-ink-900">{l(`svc.${k}`)}</h3><p className="mt-1 text-sm text-ink-500">{l(`svc.${k}d`)}</p></div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="categories" title={l('cat.title')} sub={l('cat.sub')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cats.map((c, i) => { const I = catIcons[i] ?? Package; return (
            <div key={c} className="flex items-center gap-3 rounded-xl border border-ink-100 px-4 py-4 text-sm font-medium text-ink-700 transition hover:border-brand-200 hover:bg-brand-50/50"><I size={18} className="shrink-0 text-brand-500" />{c}</div>
          ); })}
        </div>
      </Section>

      <section className="bg-gradient-to-r from-brand-700 via-brand-600 to-accent-600 py-14 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-lg font-medium text-white/80">{l('stats.title')}</h2>
          <dl className="mt-8 grid grid-cols-2 gap-6 text-center lg:grid-cols-4">
            {(['a', 'b', 'c', 'd'] as const).map((k) => <div key={k}><dt className="text-xs uppercase tracking-widest text-white/60">{l(`stats.${k}`)}</dt><dd className="mt-2 text-xl font-semibold sm:text-2xl">{l(`stats.${k}v`)}</dd></div>)}
          </dl>
        </div>
      </section>

      <Section id="contact" title={l('contact.title')} sub={l('contact.sub')}>
        <div className="grid gap-8 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl bg-ink-950 p-6 text-white">
              <div className="text-lg font-semibold">{l('contact.company')}</div>
              <ul className="mt-5 space-y-4 text-sm text-white/80">
                <li className="flex gap-3"><MapPin size={18} className="shrink-0 text-accent-300" />{l('contact.city')}</li>
                <li><a className="flex gap-3 hover:text-white" href={`tel:${TEL}`}><Phone size={18} className="shrink-0 text-accent-300" />{PHONE}</a></li>
                <li><a className="flex gap-3 break-all hover:text-white" href={`mailto:${EMAIL}`}><Mail size={18} className="shrink-0 text-accent-300" />{EMAIL}</a></li>
                <li><a className="flex gap-3 hover:text-white" href={WA} target="_blank" rel="noreferrer"><MessageCircle size={18} className="shrink-0 text-accent-300" />{l('hero.whatsapp')} · {WA_DISPLAY}</a></li>
              </ul>
            </div>
          </div>
          <EnquiryForm />
        </div>
      </Section>

      <footer className="border-t border-ink-100 py-10 text-center text-sm text-ink-500"><img src="/brand/lockup.png" alt="Source Easy" loading="lazy" className="mx-auto mb-4 h-16 w-auto object-contain" /><div className="mb-4"><AppDownloadButton variant="outline" /></div>{t('landing.footer', { year: new Date().getFullYear() })}</footer>
    </div>
  );
}

function Section({ id, title, sub, tint, children }: { id: string; title: string; sub: string; tint?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-16 py-20 sm:py-24 ${tint ? 'bg-ink-50' : ''}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-ink-500">{sub}</p>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

