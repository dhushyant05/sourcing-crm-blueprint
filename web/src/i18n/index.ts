import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import zh from './zh-CN.json';

export const LANGS = ['en', 'zh-CN'] as const;
export type Lang = (typeof LANGS)[number];
const KEY = 'se.lang';
/** Per-device choice (localStorage); falls back to the browser language. */
export const deviceLang = (): Lang | null => (LANGS.includes(localStorage.getItem(KEY) as Lang) ? (localStorage.getItem(KEY) as Lang) : null);
const initial: Lang = deviceLang() ?? (navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, 'zh-CN': { translation: zh } },
  lng: initial, fallbackLng: 'en', interpolation: { escapeValue: false },
});
const sync = (l: string) => { document.documentElement.lang = l; };
sync(initial);
i18n.on('languageChanged', sync);

export function setLang(l: Lang) { localStorage.setItem(KEY, l); void i18n.changeLanguage(l); }
/** Locale for dates/numbers that follows the UI language. */
export const dateLocale = () => (i18n.language === 'zh-CN' ? 'zh-CN' : 'en-IN');
export const fmtDate = (d?: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => (d ? new Date(d).toLocaleDateString(dateLocale(), o) : '—');
export default i18n;
