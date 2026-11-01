import { clsx } from 'clsx';
import { Bell, ChevronsLeft, ChevronsRight, FileText, LayoutDashboard, LogOut, Moon, Search, Settings, Ship, Sun, Users, Factory, UserCog } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../lib/store';
import { ROLES, type Role } from '../lib/roles';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from './LanguageSwitch';
import { Avatar } from './ui';

export type Route = 'dashboard' | 'leads' | 'quotations' | 'shipping' | 'suppliers' | 'users' | 'settings';

export function Layout({ route, go, search, setSearch, children }: {
  route: Route; go: (r: Route) => void; search: string; setSearch: (s: string) => void; children: ReactNode;
}) {
  const { session, perms, signOut, setRole } = useApp();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.sidebar === 'collapsed');
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => { localStorage.sidebar = collapsed ? 'collapsed' : 'open'; }, [collapsed]);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  const nav: { id: Route; icon: typeof Users; show: boolean }[] = [
    { id: 'dashboard', icon: LayoutDashboard, show: true },
    { id: 'leads', icon: Users, show: true },
    { id: 'quotations', icon: FileText, show: true },
    { id: 'shipping', icon: Ship, show: true },
    { id: 'suppliers', icon: Factory, show: perms.suppliers },
    { id: 'users', icon: UserCog, show: perms.manageUsers },
    { id: 'settings', icon: Settings, show: true },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={clsx('flex shrink-0 flex-col border-r border-ink-200/70 bg-white/80 backdrop-blur transition-[width] duration-300 dark:border-ink-800 dark:bg-ink-900/60', collapsed ? 'w-[72px]' : 'w-60')}>
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">S</div>
          {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-ink-900 dark:text-white">Source Easy</span>}
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {nav.filter((n) => n.show).map(({ id, icon: I }) => { const label = t(`nav.${id}`); return (
            <button key={id} onClick={() => go(id)} title={collapsed ? label : undefined}
              className={clsx('group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                route === id ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100')}>
              <I size={18} className={clsx('shrink-0', route === id ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400 group-hover:text-ink-600')} />
              {!collapsed && label}
            </button>
          ); })}
        </nav>
        <div className="border-t border-ink-100 p-3 dark:border-ink-800">
          <button onClick={() => setCollapsed(!collapsed)} className="btn-ghost w-full justify-center" aria-label={t('nav.toggleSidebar')}>
            {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /><span className="flex-1 text-left">{t('nav.collapse')}</span></>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-ink-200/70 bg-white/70 px-6 backdrop-blur dark:border-ink-800 dark:bg-ink-900/40">
          <label className="relative w-full max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input id="global-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('header.search')} className="input rounded-xl bg-ink-50 pl-9 pr-14 dark:bg-ink-850" />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-ink-200 bg-white px-1.5 text-[10px] font-medium text-ink-400 dark:border-ink-700 dark:bg-ink-800">⌘K</kbd>
          </label>
          <div className="ml-auto flex items-center gap-1">
            {session?.demo && (
              <select value={session.role} onChange={(e) => setRole(e.target.value as Role)} title={t('header.demoPreview')}
                className="mr-2 rounded-lg border border-dashed border-ink-300 bg-transparent px-2 py-1 text-xs text-ink-500 dark:border-ink-700">
                {ROLES.map((k) => <option key={k} value={k}>{t('header.viewAs', { role: t(`role.${k}`) })}</option>)}
              </select>
            )}
            <LanguageSwitch className="mr-1" />
            <button className="btn-ghost p-2" onClick={() => setDark(!dark)} aria-label={t('header.theme')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="btn-ghost relative p-2" aria-label={t('header.notifications')}><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-500" /></button>
            <div className="ml-2 flex items-center gap-2.5 border-l border-ink-200 pl-4 dark:border-ink-800">
              <Avatar name={session?.name ?? '?'} />
              <div className="hidden leading-tight sm:block"><div className="text-sm font-medium text-ink-900 dark:text-white">{session?.name}</div><div className="text-xs text-ink-500">{session && t(`role.${session.role}`)}</div></div>
              <button className="btn-ghost p-2" onClick={signOut} aria-label={t('header.signOut')}><LogOut size={16} /></button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto"><div key={route} className="mx-auto max-w-[1400px] p-6 lg:p-8 animate-fade-in">{children}</div></main>
      </div>
    </div>
  );
}
