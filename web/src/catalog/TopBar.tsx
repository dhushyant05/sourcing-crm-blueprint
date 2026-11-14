import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Menu, Search, UserRound, X } from 'lucide-react';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { CurrencySwitch } from './currency';
import type { Category, Product } from './types';
import { CategoryMegaMenu } from './CategoryExplorer';

const PORTAL = '/portal';
const WA = 'https://wa.me/917299541489';

export function TopBar({ categories, products = [], onSearch, query = '' }: { categories: Category[]; products?: Product[]; onSearch: (q: string) => void; query?: string }) {
  const [q, setQ] = useState(query);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { setQ(query); }, [query]);
  const go = (path: string) => { setOpen(false); setMenu(null); if (path.startsWith('http')) location.href = path; else history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); };
  const openQuote = () => { const path = location.pathname.replace(/\/$/, '') || '/'; go(/^\/p\//.test(path) ? `${path}${location.search}#quote` : '/#quote'); };
  const submit = (e: React.FormEvent) => { e.preventDefault(); go(`/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); onSearch(q.trim()); };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md">
      <div className="border-b border-ink-100">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <a href="/" onClick={(e) => { e.preventDefault(); go('/'); }} className="flex shrink-0 items-center gap-2.5">
            <img src="/brand/mark.png" alt="" className="h-9 w-9 object-contain" />
            <span className="hidden leading-tight sm:block">
              <span className="block text-[17px] font-semibold tracking-tight text-ink-800">Source Easy</span>
              <span className="block text-[11px] text-ink-500">Sourcing, made simple</span>
            </span>
          </a>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-1 lg:flex">
              <MenuBtn label="Company" open={menu === 'co'} onToggle={() => setMenu(menu === 'co' ? null : 'co')}>
                <div className="min-w-[14rem] p-2">
                  <button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50" onClick={() => go('/#how')}>How Source Easy works</button>
                  <button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50" onClick={() => go('/#services')}>Services</button>
                  <button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50" onClick={() => go('/#contact')}>Contact</button>
                </div>
              </MenuBtn>
              <MenuBtn label="For customers" open={menu === 'cu'} onToggle={() => setMenu(menu === 'cu' ? null : 'cu')}>
                <div className="min-w-[14rem] p-2">
                  <a href={PORTAL} className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">Customer Portal</a>
                  <a href={`${PORTAL}#/requests`} className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">Shipping requests</a>
                  <a href={`${PORTAL}#/orders`} className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">Order tracking</a>
                  <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50" onClick={() => go('/favorites')}>Saved favourites</button>
                  <a href={WA} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">WhatsApp</a>
                </div>
              </MenuBtn>
            </div>
            <CurrencySwitch className="hidden md:inline-flex" />
            <LanguageSwitch className="hidden shrink-0 lg:flex" />
            <a href={PORTAL} data-testid="nav-customer-portal" className="hidden min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 sm:inline-flex"><UserRound size={16} />Customer Portal</a>
            <a href="/app" data-testid="staff-login" className="hidden min-h-[36px] shrink-0 items-center rounded-lg border border-brand-200 bg-white px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 sm:inline-flex">Staff login</a>
            <button type="button" onClick={openQuote} className="hidden min-h-[36px] shrink-0 items-center rounded-lg bg-warm-500 px-3 text-sm font-semibold text-white shadow-sm hover:bg-warm-600 sm:inline-flex">Request quote</button>
            <button type="button" className="rounded-lg p-2 text-ink-700 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={22} /></button>
          </div>
        </div>
      </div>
      <div className="border-b border-ink-100 bg-warm-50">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <nav className="mb-3 flex gap-1 overflow-x-auto text-sm font-medium text-ink-600 md:overflow-visible">
            <button type="button" onClick={() => go('/products')} className="shrink-0 rounded-full px-3 py-1.5 hover:bg-white hover:text-brand-700">Products</button>
            <MenuBtn label="Categories" open={menu === 'cat'} onToggle={() => setMenu(menu === 'cat' ? null : 'cat')}>
              <CategoryMegaMenu categories={categories} products={products} onGo={go} />
            </MenuBtn>
            <button type="button" onClick={() => go('/#how')} className="shrink-0 rounded-full px-3 py-1.5 hover:bg-white hover:text-brand-700">How Source Easy works</button>
          </nav>
          <form onSubmit={submit} className="flex items-center gap-2 rounded-full border border-ink-200 bg-white p-1.5 shadow-soft">
            <Search size={18} className="ml-3 shrink-0 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, categories or materials" aria-label="Search products"
              className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink-800 outline-none" />
            <button type="button" onClick={openQuote} className="hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 sm:inline-flex">
              <FileText size={16} />Search with file
            </button>
            <button className="h-11 shrink-0 rounded-full bg-warm-500 px-5 text-sm font-semibold text-white hover:bg-warm-600">Search</button>
          </form>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-800/25" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-80 max-w-[90vw] flex-col bg-white shadow-lift">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <span className="font-semibold text-ink-800">Menu</span>
              <button className="rounded-lg p-2" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Browse</p>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/products')}>Products</button>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#categories')}>Categories</button>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#how')}>How Source Easy works</button>
              {categories.map((c) => <button key={c.id} className="block w-full rounded-lg px-2 py-2 text-left text-ink-600 hover:bg-ink-50" onClick={() => go(`/c/${c.slug}`)}>{c.name}</button>)}
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">Company</p>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#services')}>Services</button>
              <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/#contact')}>Contact</button>
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">For customers</p>
              <a href={PORTAL} className="block rounded-lg px-2 py-2 hover:bg-ink-50">Customer Portal</a>
              <a href={`${PORTAL}#/requests`} className="block rounded-lg px-2 py-2 hover:bg-ink-50">Shipping requests</a>
              <button type="button" className="block w-full rounded-lg px-2 py-2 text-left hover:bg-ink-50" onClick={() => go('/favorites')}>Saved favourites</button>
              <a href={`${PORTAL}#/orders`} className="block rounded-lg px-2 py-2 hover:bg-ink-50">Order tracking</a>
              <a href={WA} target="_blank" rel="noreferrer" className="block rounded-lg px-2 py-2 hover:bg-ink-50">WhatsApp</a>
              <div className="mt-4"><CurrencySwitch /></div>
            </div>
            <div className="space-y-2 border-t border-ink-100 p-4">
              <button type="button" onClick={openQuote} className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-warm-500 font-semibold text-white">Request quote</button>
              <a href={PORTAL} className="flex min-h-[44px] items-center justify-center rounded-lg border border-brand-200 font-semibold text-brand-700">Customer Portal</a>
              <a href="/app" className="flex min-h-[44px] items-center justify-center rounded-lg border border-brand-200 font-semibold text-brand-700">Staff login</a>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}

function MenuBtn({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const btn = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const mw = menu.current?.offsetWidth ?? Math.min(window.innerWidth * 0.9, 832);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return (
    <div className="relative" ref={btn}>
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-white hover:text-brand-700">
        {label}<ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={menu} className="fixed z-50 rounded-2xl border border-ink-100 bg-white shadow-lift" style={{ top: pos.top, left: pos.left }}>
          {children}
        </div>
      )}
    </div>
  );
}
