import { useEffect, useState } from 'react';
import { publicCatalog } from './api';
import { CurrencyProvider } from './currency';
import { HomePage, ListingPage, ProductPage } from './pages';
import { TopBar } from './TopBar';
import type { Banner, BannerSettings, Category, Product } from './types';

function pathOf() {
  const p = location.pathname.replace(/\/$/, '') || '/';
  const q = new URLSearchParams(location.search).get('q') || '';
  const hash = location.hash;
  return { p, q, hash };
}

export function Marketplace() {
  const [loc, setLoc] = useState(pathOf);
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [settings, setSettings] = useState<BannerSettings>({ direction: 'LTR', intervalSeconds: 5 });
  const [homeProducts, setHomeProducts] = useState<Product[]>([]);
  useEffect(() => {
    const h = () => setLoc(pathOf());
    addEventListener('popstate', h);
    addEventListener('hashchange', h);
    return () => { removeEventListener('popstate', h); removeEventListener('hashchange', h); };
  }, []);
  useEffect(() => {
    void publicCatalog.categories().then(setCategories).catch(() => setCategories([]));
    void publicCatalog.banners().then((r) => { setBanners(r.data); setSettings({ direction: r.direction, intervalSeconds: r.intervalSeconds }); }).catch(() => undefined);
    void publicCatalog.products({ limit: 24 }).then((r) => setHomeProducts(r.data)).catch(() => setHomeProducts([]));
  }, []);
  useEffect(() => { document.title = 'Source Easy — Marketplace'; document.documentElement.classList.remove('dark'); }, []);
  useEffect(() => {
    if (loc.hash && (loc.p === '/' || loc.p === '')) {
      const id = loc.hash.slice(1);
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    } else window.scrollTo(0, 0);
  }, [loc]);

  let page: React.ReactNode;
  const m = loc.p.match(/^\/p\/([^/]+)$/);
  const c = loc.p.match(/^\/c\/([^/]+)$/);
  if (m) page = <ProductPage slug={decodeURIComponent(m[1])} />;
  else if (c) {
    const slug = decodeURIComponent(c[1]);
    const cat = categories.find((x) => x.slug === slug);
    page = <ListingPage title={cat?.name || 'Category'} category={slug} />;
  } else if (loc.p === '/products') page = <ListingPage title="All products" query={loc.q} />;
  else page = <HomePage products={homeProducts} banners={banners} settings={settings} categories={categories} />;

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-white text-ink-800 antialiased">
        <TopBar categories={categories} query={loc.q} onSearch={(q) => { history.pushState({}, '', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`); setLoc(pathOf()); }} />
        {page}
        <footer className="border-t border-ink-100 py-10 text-center text-sm text-ink-500">
          <img src="/brand/lockup.png" alt="Source Easy" className="mx-auto mb-4 h-14 w-auto object-contain" />
          <p>© {new Date().getFullYear()} Source Easy. Sample catalog items are labelled and are not live offers.</p>
        </footer>
      </div>
    </CurrencyProvider>
  );
}
