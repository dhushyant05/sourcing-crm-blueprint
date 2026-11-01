import { clsx } from 'clsx';
import { NotificationBell } from './NotificationBell';
import { Menu, X, ChevronsLeft, ChevronsRight, FileText, LayoutDashboard, LogOut, Moon, Search, Settings, Ship, Sun, Users, Factory, UserCog, Package } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../lib/store';
import { ROLES, type Role } from '../lib/roles';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from './LanguageSwitch';
import { Avatar } from './ui';

export type Route = 'dashboard' | 'leads' | 'quotations' | 'orders' | 'shipping' | 'suppliers' | 'users' | 'settings';

export function Layout({ route, go, search, setSearch, children, openLeadId }: {
  route: Route; go: (r: Route) => void; search: string; setSearch: (s: string) => void; children: ReactNode; openLeadId: (id: string) => void;
}) {
  const { session, perms, signOut, setRole } = useApp();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.sidebar === 'collapsed');
  const [drawer, setDrawer] = useState(false);
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
    { id: 'quotations', icon: FileText, show: perms.can('quotes.view') },
    { id: 'orders', icon: Package, show: true },
    { id: 'shipping', icon: Ship, show: true },
    { id: 'suppliers', icon: Factory, show: perms.suppliers && perms.can('suppliers.view') },
    { id: 'users', icon: UserCog, show: perms.manageUsers },
    { id: 'settings', icon: Settings, show: true },
  ];

  const shown = nav.filter((n) => n.show);
  const goto = (r: Route) => { setDrawer(false); go(r); };
  const bottom = shown.filter((n) => ['dashboard', 'leads', 'quotations', 'orders'].includes(n.id));

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink-900/30 animate-fade-in" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-lift animate-fade-in dark:bg-ink-900">
            <div className="flex h-14 items-center gap-2.5 px-4">
              <img src="/brand/mark.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
              <span className="flex-1 leading-tight"><span className="block font-semibold text-ink-900 dark:text-white">Source Easy</span><span className="block text-[11px] text-ink-500">{t('app.tagline')}</span></span>
              <button className="btn-ghost p-2" onClick={() => setDrawer(false)} aria-label={t('common.close')}><X size={20} /></button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-2">
              {shown.map(({ id, icon: I }) => (
                <button key={id} onClick={() => goto(id)} className={clsx('flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium',
                  route === id ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200' : 'text-ink-700 dark:text-ink-300')}>
                  <I size={20} />{t(`nav.${id}`)}
                </button>
              ))}
            </nav>
            <div className="border-t border-ink-100 p-3 dark:border-ink-800">
              <div className="mb-2 flex items-center gap-3 px-2"><Avatar name={session?.name ?? '?'} src={session?.avatarUrl} /><div className="leading-tight"><div className="text-sm font-medium text-ink-900 dark:text-white">{session?.name}</div><div className="text-xs text-ink-500">{session && t(`role.${session.role}`)}</div></div></div>
              <button className="btn-ghost w-full" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}{t('header.theme')}</button>
              <button className="btn-ghost w-full" onClick={signOut}><LogOut size={18} />{t('header.signOut')}</button>
            </div>
          </aside>
        </div>
      )}
      <aside className={clsx('hidden shrink-0 md:flex flex-col border-r border-ink-200/70 bg-white/80 backdrop-blur transition-[width] duration-300 dark:border-ink-800 dark:bg-ink-900/60', collapsed ? 'w-[72px]' : 'w-60')}>
        <div className="flex h-16 items-center gap-2.5 px-5">
          <img src="/brand/mark.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
          {!collapsed && <span className="min-w-0 leading-tight"><span className="block truncate text-[15px] font-semibold tracking-tight text-ink-900 dark:text-white">Source Easy</span><span className="block truncate text-[11px] text-ink-500">{t('app.tagline')}</span></span>}
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
        <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-ink-200/70 bg-white/70 px-3 md:h-16 md:gap-4 md:px-6 backdrop-blur dark:border-ink-800 dark:bg-ink-900/40">
          <button className="btn-ghost p-2.5 md:hidden" onClick={() => setDrawer(true)} aria-label={t('nav.toggleSidebar')}><Menu size={22} /></button>
          <label className="relative w-full min-w-0 max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input id="global-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('header.search')} className="input rounded-xl bg-ink-50 pl-9 pr-14 dark:bg-ink-850" />
            <kbd className="absolute hidden md:block right-3 top-1/2 -translate-y-1/2 rounded-md border border-ink-200 bg-white px-1.5 text-[10px] font-medium text-ink-400 dark:border-ink-700 dark:bg-ink-800">⌘K</kbd>
          </label>
          <div className="ml-auto flex items-center gap-1">
            {session?.demo && (
              <select value={session.role} onChange={(e) => setRole(e.target.value as Role)} title={t('header.demoPreview')}
                className="mr-2 hidden rounded-lg border border-dashed md:block border-ink-300 bg-transparent px-2 py-1 text-xs text-ink-500 dark:border-ink-700">
                {ROLES.map((k) => <option key={k} value={k}>{t('header.viewAs', { role: t(`role.${k}`) })}</option>)}
              </select>
            )}
            <LanguageSwitch className="md:mr-1" />
            <button className="btn-ghost hidden p-2 md:inline-flex" onClick={() => setDark(!dark)} aria-label={t('header.theme')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <NotificationBell openLead={openLeadId} />
            <div className="ml-2 hidden items-center gap-2.5 border-l md:flex border-ink-200 pl-4 dark:border-ink-800">
              <Avatar name={session?.name ?? '?'} src={session?.avatarUrl} />
              <div className="hidden leading-tight lg:block"><div className="text-sm font-medium text-ink-900 dark:text-white">{session?.name}</div><div className="text-xs text-ink-500">{session && t(`role.${session.role}`)}</div></div>
              <button className="btn-ghost p-2" onClick={signOut} aria-label={t('header.signOut')}><LogOut size={16} /></button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto"><div key={route} className="mx-auto max-w-[1400px] p-4 pb-24 md:p-6 md:pb-6 lg:p-8 animate-fade-in">{children}</div></main>
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 grid border-t border-ink-200 bg-white/95 backdrop-blur md:hidden dark:border-ink-800 dark:bg-ink-900/95" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, 1fr)` }}>
          {bottom.map(({ id, icon: I }) => (
            <button key={id} onClick={() => goto(id)} className={clsx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium', route === id ? 'text-brand-600 dark:text-brand-300' : 'text-ink-500')}>
              <I size={20} />{t(`nav.${id}`)}
            </button>
          ))}
          <button onClick={() => setDrawer(true)} className={clsx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium', bottom.some((b) => b.id === route) ? 'text-ink-500' : 'text-brand-600')}>
            <Menu size={20} />{t('nav.more')}
          </button>
        </nav>
      </div>
    </div>
  );
}
