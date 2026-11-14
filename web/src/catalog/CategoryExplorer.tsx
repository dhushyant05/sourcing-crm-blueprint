import { useState } from 'react';
import { ChevronRight, Warehouse } from 'lucide-react';
import { BannerCarousel } from './Banner';
import { ProductCard } from './ProductCard';
import type { Banner, BannerSettings, Category, Product } from './types';

const CAT_ICON: Record<string, typeof Warehouse> = {};

function go(path: string) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }

function inCategory(p: Product, cat: Category) {
  return p.category?.slug === cat.slug || p.category?.id === cat.id || p.categoryId === cat.id || p.categorySlug === cat.slug;
}

function uniqueByCategory(products: Product[]) {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    const key = p.category?.slug || p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Left category list + filled right panel (frequently searched + banner, or the hovered category's products). */
export function CategoryExplorer({ categories, products, banners, settings, icons }: {
  categories: Category[]; products: Product[]; banners: Banner[]; settings: BannerSettings;
  icons?: Record<string, typeof Warehouse>;
}) {
  const [active, setActive] = useState<string | null>(null);
  const cat = categories.find((c) => c.slug === active) ?? null;
  const children = cat ? categories.filter((c) => c.parentId && (c.parentId === cat.id || c.parentId === cat.slug)) : [];
  const shown = cat ? products.filter((p) => inCategory(p, cat)) : uniqueByCategory(products);
  const Icons = icons ?? CAT_ICON;

  return (
    <section id="categories" className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
      <div
        className="grid overflow-hidden rounded-2xl border border-ink-100 bg-white md:grid-cols-[230px_minmax(0,1fr)]"
        onMouseLeave={() => setActive(null)}
      >
        <aside className="bg-white">
          <div className="border-b border-ink-100 px-4 py-3 text-sm font-semibold text-ink-800">Categories for you</div>
          <ul className="flex gap-1 overflow-x-auto px-2 py-2 md:block md:divide-y md:divide-ink-50 md:overflow-visible md:px-0 md:py-0">
            {categories.map((c) => {
              const Icon = Icons[c.name] ?? Warehouse;
              const on = active === c.slug;
              return (
                <li key={c.id} className="shrink-0">
                  <button type="button"
                    onMouseEnter={() => setActive(c.slug)}
                    onFocus={() => setActive(c.slug)}
                    onClick={() => go(`/c/${c.slug}`)}
                    aria-expanded={on}
                    className={`flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm md:rounded-none md:px-4 md:py-2.5 ${on ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>
                    <Icon size={16} className="shrink-0 text-brand-600" />
                    <span className="flex-1 whitespace-nowrap">{c.name}</span>
                    <ChevronRight size={14} className="hidden text-ink-300 md:block" />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-h-[260px] flex-col gap-3 border-t border-ink-100 p-3 sm:min-h-[300px] md:min-h-[380px] md:border-l md:border-t-0 md:p-4" data-testid="category-panel">
          {!cat && banners.length > 0 && (
            <div className="relative h-[150px] shrink-0 overflow-hidden rounded-xl sm:h-[180px] lg:h-[200px]">
              <BannerCarousel banners={banners} settings={settings} variant="wide" />
              <button type="button" onClick={() => go('/products')}
                className="absolute bottom-3 left-3 z-10 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-brand-700 shadow-soft hover:bg-warm-50">View more</button>
            </div>
          )}
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-800 sm:text-base">{cat ? cat.name : 'Frequently searched'}</h2>
            <button type="button" onClick={() => go(cat ? `/c/${cat.slug}` : '/products')} className="text-sm font-medium text-brand-700 hover:underline">View all</button>
          </div>
          {children.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {children.map((c) => (
                <button key={c.id} type="button" onClick={() => go(`/c/${c.slug}`)}
                  className="rounded-full border border-ink-100 bg-white px-3 py-1 text-sm text-ink-700 hover:border-warm-300 hover:text-warm-600">{c.name}</button>
              ))}
            </div>
          )}
          {shown.length > 0 ? (
            <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} variant="compact" />)}
            </div>
          ) : (
            <p className="py-8 text-sm text-ink-500">No products in this category yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Wide Categories dropdown: list on the left, products on the right. */
export function CategoryMegaMenu({ categories, products, onGo }: {
  categories: Category[]; products: Product[]; onGo: (path: string) => void;
}) {
  const [active, setActive] = useState<string | null>(categories[0]?.slug ?? null);
  const cat = categories.find((c) => c.slug === active) ?? null;
  const shown = cat ? products.filter((p) => inCategory(p, cat)) : products;
  const children = cat ? categories.filter((c) => c.parentId && (c.parentId === cat.id || c.parentId === cat.slug)) : [];
  return (
    <div className="flex w-[min(90vw,52rem)] flex-col md:min-h-[22rem] md:flex-row" data-testid="categories-mega">
      <div className="max-h-64 overflow-y-auto border-b border-ink-100 md:max-h-none md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <button type="button" className="block w-full px-4 py-2.5 text-left text-sm font-medium text-ink-800 hover:bg-warm-50" onClick={() => onGo('/products')}>All products</button>
        {categories.map((c) => (
          <button key={c.id} type="button"
            onMouseEnter={() => setActive(c.slug)}
            onFocus={() => setActive(c.slug)}
            onClick={() => onGo(`/c/${c.slug}`)}
            className={`block w-full px-4 py-2.5 text-left text-sm ${active === c.slug ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>{c.name}</button>
        ))}
      </div>
      <div className="min-w-0 flex-1 p-4">
        <div className="mb-3 flex items-end justify-between gap-3">
          <p className="text-sm font-semibold text-ink-800">{cat?.name || 'All products'}</p>
          <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => onGo(cat ? `/c/${cat.slug}` : '/products')}>View all</button>
        </div>
        {children.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {children.map((c) => (
              <button key={c.id} type="button" onClick={() => onGo(`/c/${c.slug}`)} className="rounded-full border border-ink-100 px-3 py-1 text-sm text-ink-700 hover:border-warm-300">{c.name}</button>
            ))}
          </div>
        )}
        {shown.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.slice(0, 6).map((p) => <ProductCard key={p.id} product={p} variant="compact" />)}
          </div>
        ) : (
          <p className="py-6 text-sm text-ink-500">No products in this category yet.</p>
        )}
      </div>
    </div>
  );
}
