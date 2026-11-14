import { useEffect, useState } from 'react';
import { publicCatalog } from './api';
import { CurrencyProvider } from './currency';
import { HomePage, ListingPage, ProductPage } from './pages';
import { FavoritesPage } from './FavoriteButton';
import { TopBar } from './TopBar';
import type { Banner, BannerSettings, Category, Product, TrustItem } from './types';

function pathOf() {
  const p = location.pathname.replace(/\/$/, '') || '/';
  const q = new URLSearchParams(location.search).get('q') || '';
  const hash = location.hash;
  return { p, q, hash };
}

const WA = 'https://wa.me/917299541489';
const PORTAL = '/portal';

export function Marketplace() {
  const [loc, setLoc] = useState(pathOf);
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [settings, setSettings] = useState<BannerSettings>({ direction: 'LTR', intervalSeconds: 5 });
  const [homeProducts, setHomeProducts] = useState<Product[]>([]);
  const [trust, setTrust] = useState<TrustItem[] | undefined>();
  useEffect(() => {
    const h = () => setLoc(pathOf());
    addEventListener('popstate', h);
    addEventListener('hashchange', h);
    return () => { removeEventListener('popstate', h); removeEventListener('hashchange', h); };
  }, []);
  useEffect(() => {
    void publicCatalog.categories().then(setCategories).catch(() => setCategories([]));
    void publicCatalog.banners().then((r) => { setBanners(r.data); setSettings({ direction: r.direction, intervalSeconds: r.intervalSeconds }); }).catch(() => undefined);
    void publicCatalog.products({ limit: 48, sort: 'trending', window: 7 }).then((r) => setHomeProducts(r.data)).catch(() => setHomeProducts([]));
    void publicCatalog.status().then((s) => { setTrust(s.trust); }).catch(() => undefined);
  }, []);
  useEffect(() => { document.title = 'Source Easy — Marketplace'; document.documentElement.classList.remove('dark'); }, []);
  useEffect(() => {
    const id = loc.hash.replace(/^#/, '');
    if (!id) { window.scrollTo(0, 0); return; }
    let n = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (n++ < 25) setTimeout(tryScroll, 80);
    };
    tryScroll();
  }, [loc]);

  let page: React.ReactNode;
  const m = loc.p.match(/^\/p\/([^/]+)$/);
  const c = loc.p.match(/^\/c\/([^/]+)$/);
  if (m) page = <ProductPage slug={decodeURIComponent(m[1])} />;
  else if (c) {
    const slug = decodeURIComponent(c[1]);
    const cat = categories.find((x) => x.slug === slug);
    page = <ListingPage title={cat?.name || 'Category'} category={slug} categories={categories} />;
  } else if (loc.p === '/products') page = <ListingPage title="All products" query={loc.q} categories={categories} />;
  else if (loc.p === '/favorites') page = <FavoritesPage />;
  else page = <HomePage products={homeProducts} banners={banners} settings={settings} categories={categories} trust={trust} />;

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-white text-ink-700 antialiased">
        <TopBar categories={categories} products={homeProducts} query={loc.q} onSearch={(q) => { history.pushState({}, '', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`); setLoc(pathOf()); }} />
        {page}
        <footer className="border-t border-ink-100 bg-ink-50/50">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            <div>
              <img src="/brand/lockup.png" alt="Source Easy" className="h-14 w-auto object-contain" />
              <p className="mt-3 text-sm text-ink-500">Sourcing from China, quoted and managed for customers in India and worldwide.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-800">Catalog</h3>
              <div className="mt-3 space-y-2 text-sm">
                <button type="button" className="block text-ink-600 hover:text-brand-700" onClick={() => { history.pushState({}, '', '/products'); setLoc(pathOf()); }}>All products</button>
                {categories.map((cat) => (
                  <button key={cat.id} type="button" className="block text-ink-600 hover:text-brand-700" onClick={() => { history.pushState({}, '', `/c/${cat.slug}`); setLoc(pathOf()); }}>{cat.name}</button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-800">Company</h3>
              <div className="mt-3 space-y-2 text-sm">
                <button type="button" className="block text-ink-600 hover:text-brand-700" onClick={() => { history.pushState({}, '', '/#how'); setLoc(pathOf()); }}>How Source Easy works</button>
                <button type="button" className="block text-ink-600 hover:text-brand-700" onClick={() => { history.pushState({}, '', '/#services'); setLoc(pathOf()); }}>Services</button>
                <button type="button" className="block text-ink-600 hover:text-brand-700" onClick={() => { history.pushState({}, '', '/#contact'); setLoc(pathOf()); }}>Contact</button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-800">For customers</h3>
              <div className="mt-3 space-y-2 text-sm">
                <a href={PORTAL} className="block text-ink-600 hover:text-brand-700">Customer Portal</a>
                <a href={`${PORTAL}#/requests`} className="block text-ink-600 hover:text-brand-700">Shipping requests</a>
                <a href={`${PORTAL}#/orders`} className="block text-ink-600 hover:text-brand-700">Order tracking</a>
                <a href={WA} target="_blank" rel="noreferrer" className="block text-ink-600 hover:text-brand-700">WhatsApp</a>
                <a href="/app" className="block text-ink-600 hover:text-brand-700">Staff login</a>
              </div>
            </div>
          </div>
          <p className="border-t border-ink-100 py-5 text-center text-sm text-ink-500">© {new Date().getFullYear()} Source Easy. Sample catalog items are labelled and are not live offers.</p>
        </footer>
      </div>
    </CurrencyProvider>
  );
}
