import { useEffect, useState } from 'react';
import { ChevronDown, Menu, Search, UserRound, X } from 'lucide-react';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { CurrencySwitch } from './currency';
import type { Category } from './types';

const PORTAL = '/portal';
const WA = 'https://wa.me/917299541489';

export function TopBar({ categories, onSearch, query = '' }: { categories: Category[]; onSearch: (q: string) => void; query?: string }) {
  const [q, setQ] = useState(query);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { setQ(query); }, [query]);
  const go = (path: string) => { setOpen(false); setMenu(null); if (path.startsWith('http')) location.href = path; else history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); };
  const submit = (e: React.FormEvent) => { e.preventDefault(); go(`/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); onSearch(q.trim()); };

  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <a href="/" onClick={(e) => { e.preventDefault(); go('/'); }} className="flex shrink-0 items-center gap-2.5">
          <img src="/brand/mark.png" alt="" className="h-9 w-9 object-contain" />
          <span className="hidden leading-tight sm:block"><span className="block text-[17px] font-semibold tracking-tight text-ink-900">Source Easy</span><span className="block text-[11px] text-ink-500">Sourcing, made simple</span></span>
        </a>
        <form onSubmit={submit} className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products"
            className="h-11 w-full rounded-full border border-ink-200 bg-ink-50 pl-10 pr-4 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-200" />
        </form>
        <nav className="hidden items-center gap-1 lg:flex">
          <MenuBtn label="Categories" open={menu === 'cat'} onToggle={() => setMenu(menu === 'cat' ? null : 'cat')}>
            <div className="grid min-w-[16rem] grid-cols-2 gap-1 p-2">
              <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => go('/products')}>All products</button>
              {categories.map((c) => <button key={c.id} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => go(`/c/${c.slug}`)}>{c.name}</button>)}
            </div>
          </MenuBtn>
          <MenuBtn label="Company" open={menu === 'co'} onToggle={() => setMenu(menu === 'co' ? null : 'co')}>
            <div className="min-w-[12rem] p-2">
              <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => go('/#how')}>How it works</button>
              <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => go('/#services')}>Services</button>
              <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50" onClick={() => go('/#contact')}>Contact</button>
            </div>
          </MenuBtn>
          <MenuBtn label="For customers" open={menu === 'cu'} onToggle={() => setMenu(menu === 'cu' ? null : 'cu')}>
            <div className="min-w-[14rem] p-2">
              <a href={PORTAL} className="block rounded-lg px-3 py-2 text-sm hover:bg-ink-50">Customer Portal</a>
              <a href={`${PORTAL}#/requests`} className="block rounded-lg px-3 py-2 text-sm hover:bg-ink-50">Shipping requests</a>
              <a href={`${PORTAL}#/orders`} className="block rounded-lg px-3 py-2 text-sm hover:bg-ink-50">Order tracking</a>
              <a href={WA} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 text-sm hover:bg-ink-50">WhatsApp</a>
            </div>
          </MenuBtn>
        </nav>
        <CurrencySwitch className="hidden md:inline-flex" />
        <a href={PORTAL} data-testid="nav-customer-portal" className="hidden min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500 to-accent-500 px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 sm:inline-flex"><UserRound size={16} />Customer Portal</a>
        <a href="/app" data-testid="staff-login" className="hidden min-h-[36px] shrink-0 items-center rounded-lg bg-gradient-to-r from-brand-500 to-accent-500 px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 sm:inline-flex">Staff login</a>
        <LanguageSwitch className="hidden shrink-0 lg:block" />
        <button type="button" className="rounded-lg p-2 text-ink-700 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={22} /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-80 max-w-[90vw] flex-col bg-white shadow-lift">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <span className="font-semibold text-ink-900">Menu</span>
              <button className="rounded-lg p-2" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Categories</p>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/products')}>All products</button>
              {categories.map((c) => <button key={c.id} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go(`/c/${c.slug}`)}>{c.name}</button>)}
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">Company</p>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#how')}>How it works</button>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#services')}>Services</button>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#contact')}>Contact</button>
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">For customers</p>
              <a href={PORTAL} className="block rounded-lg px-2 py-2 hover:bg-ink-50">Customer Portal</a>
              <a href={`${PORTAL}#/requests`} className="block rounded-lg px-2 py-2 hover:bg-ink-50">Shipping requests</a>
              <a href={`${PORTAL}#/orders`} className="block rounded-lg px-2 py-2 hover:bg-ink-50">Order tracking</a>
              <a href={WA} target="_blank" rel="noreferrer" className="block rounded-lg px-2 py-2 hover:bg-ink-50">WhatsApp</a>
              <div className="mt-4"><CurrencySwitch /></div>
            </div>
            <div className="space-y-2 border-t border-ink-100 p-4">
              <a href={PORTAL} className="flex min-h-[44px] items-center justify-center rounded-lg bg-gradient-to-r from-brand-500 to-accent-500 font-semibold text-white">Customer Portal</a>
              <a href="/app" className="flex min-h-[44px] items-center justify-center rounded-lg bg-gradient-to-r from-brand-500 to-accent-500 font-semibold text-white">Staff login</a>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}

function MenuBtn({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">
        {label}<ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="absolute right-0 top-full z-20 mt-1 rounded-2xl border border-ink-100 bg-white shadow-lift">{children}</div>}
    </div>
  );
}
