import { FavoriteButton } from './FavoriteButton';
import { useEffect, useState } from 'react';
import { Factory, FileText, GitCompare, Home, Lamp, Package, Search, Share2, ShieldCheck, Shirt, Sparkles, TrendingUp, UtensilsCrossed, Warehouse, Wrench } from 'lucide-react';
import { publicCatalog } from './api';
import { CategoryExplorer } from './CategoryExplorer';
import { MarketplaceGreeting } from './GreetingStrip';
import { CompanySections } from './CompanySections';
import { EnquireForm } from './EnquireForm';
import { Gallery } from './Gallery';
import { ProductCard } from './ProductCard';
import { DEFAULT_TRUST } from './fixtures';
import { priceLabel, useCurrency } from './currency';
import { type Banner, type BannerSettings, type Category, type Product, type TrustItem } from './types';

const CAT_ICON: Record<string, typeof Factory> = {
  Hardware: Wrench, Housewares: Home, Kitchenware: UtensilsCrossed, Lighting: Lamp, Packaging: Package, Textiles: Shirt,
};

function go(path: string) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }

export function HomePage({ products, banners, settings, categories, trust }: {
  products: Product[]; banners: Banner[]; settings: BannerSettings; categories: Category[]; trust?: TrustItem[];
}) {
  const items = (trust && trust.length ? trust : DEFAULT_TRUST);
  const recommended = products.filter((p) => p.pinned).concat(products).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i).slice(0, 10);
  return (
    <>
      <MarketplaceGreeting />
      <section className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <h1 className="text-base font-semibold text-ink-800 sm:text-lg">Welcome to Source Easy</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            <QuickLink icon={FileText} label="Request for quotation" onClick={() => go('/#contact')} />
            <QuickLink icon={TrendingUp} label="Trending" onClick={() => go('/#recommended')} />
            <QuickLink icon={Sparkles} label="Custom sourcing" onClick={() => go('/#contact')} />
          </div>
        </div>
      </section>

      <CategoryExplorer categories={categories} products={products} banners={banners} settings={settings} icons={CAT_ICON} />

      <section id="recommended" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold text-ink-800">Recommended for your business</h2>
          <button type="button" onClick={() => go('/products')} className="text-sm font-medium text-brand-700 hover:underline">View all</button>
        </div>
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
          {recommended.map((p) => (
            <div key={p.id} className="w-36 shrink-0 sm:w-40"><ProductCard product={p} variant="compact" /></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <h2 className="text-lg font-semibold text-ink-800">Products</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      <section className="mt-6 border-y border-ink-100 bg-warm-50/60">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {items.map((it, i) => {
            const Icon = [Factory, Warehouse, GitCompare, ShieldCheck][i % 4];
            return (
              <div key={it.title} className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-soft"><Icon size={18} /></span>
                <div>
                  <h3 className="font-semibold text-ink-800">{it.title}</h3>
                  <p className="mt-0.5 text-sm text-ink-500">{it.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-warm-50">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 px-4 py-12 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">Need something that isn’t listed?</h2>
            <p className="mt-2 max-w-xl text-ink-600">Request a custom sourcing quote and the Source Easy team will come back to you with options, lead time and a price.</p>
          </div>
          <button type="button" onClick={() => go('/#contact')} className="rounded-full bg-warm-500 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-warm-600">
            Request a custom sourcing quote
          </button>
        </div>
      </section>
      <CompanySections />
    </>
  );
}

function QuickLink({ icon: Icon, label, onClick }: { icon: typeof Search; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-3 py-1.5 text-ink-700 hover:border-warm-300 hover:text-warm-600">
      <Icon size={14} className="text-warm-500" />{label}
    </button>
  );
}


export function ListingPage({ title, category, query, categories = [] }: { title: string; category?: string; query?: string; categories?: Category[] }) {
  const [q, setQ] = useState(query ?? '');
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => { setQ(query ?? ''); }, [query]);
  useEffect(() => {
    let on = true; setBusy(true);
    publicCatalog.products({ q: q || undefined, category, limit: 48, sort: 'trending' }).then((r) => { if (on) { setData(r.data); setTotal(r.total); } })
      .catch(() => { if (on) { setData([]); setTotal(0); } })
      .finally(() => { if (on) setBusy(false); });
    return () => { on = false; };
  }, [q, category]);
  const search = (e: React.FormEvent) => { e.preventDefault(); history.replaceState({}, '', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`); dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Catalog</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-800">{title}</h1>
      <form onSubmit={search} className="mt-6 max-w-xl">
        <input className="input rounded-full px-4" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this catalog" />
      </form>
      <p className="mt-3 text-sm text-ink-500">{busy ? 'Loading…' : `${total} product${total === 1 ? '' : 's'}`}</p>
      <div className="mt-6 grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        {categories.length > 0 && (
          <aside className="rounded-2xl border border-ink-100 bg-white" aria-label="Categories">
            <div className="border-b border-ink-100 px-4 py-3 text-sm font-semibold text-ink-800">Categories</div>
            <button type="button" onClick={() => go('/products')}
              className={`block w-full px-4 py-2.5 text-left text-sm ${!category ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>All products</button>
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => go(`/c/${c.slug}`)}
                className={`block w-full px-4 py-2.5 text-left text-sm ${category === c.slug ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>{c.name}</button>
            ))}
          </aside>
        )}
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          {!busy && !data.length && <p className="mt-10 text-ink-500">No products match that search yet.</p>}
        </div>
      </div>
    </div>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const { currency } = useCurrency();
  const [p, setP] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true; setP(null); setErr(null);
    publicCatalog.product(slug).then((d) => {
      if (!on) return;
      setP(d);
      publicCatalog.related(d.slug).then((rows) => { if (on) setRelated(rows.slice(0, 8)); }).catch(() => undefined);
    }).catch((e) => { if (on) setErr((e as Error).message); });
    return () => { on = false; };
  }, [slug]);
  if (err) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-500">This product is not available.</div>;
  if (!p) return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-400">Loading…</div>;
  const specs = p.specs && typeof p.specs === 'object' ? Object.entries(p.specs).filter(([, v]) => v != null && String(v).trim()) : [];
  const tiers = p.tiers ?? [];
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-500"><a href="/products" className="hover:text-brand-700" onClick={(e) => { e.preventDefault(); go('/products'); }}>Products</a>
        {p.category?.name && <> / <button type="button" className="hover:text-brand-700" onClick={() => go(`/c/${p.category!.slug}`)}>{p.category.name}</button></>}</p>
      <div className="mt-6 grid items-start gap-10 lg:grid-cols-2">
        <Gallery product={p} />
        <div className="lg:sticky lg:top-24">
          {p.isSample && <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">Sample</span>}
          {(p.pinned || p.trending) && <span className="ml-2 inline-flex rounded-full bg-warm-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warm-600">Trending</span>}
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-800">{p.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <FavoriteButton productId={p.id} />
              <a href={`https://wa.me/?text=${encodeURIComponent(`${p.title}\nhttps://sourceeasy.in/p/${p.slug}`)}`}
                target="_blank" rel="noreferrer" data-testid="share-whatsapp"
                className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 hover:border-brand-200 hover:text-brand-700">
                <Share2 size={16} /> Share on WhatsApp
              </a>
            </div>
          </div>
          <p className="mt-3 text-2xl font-semibold text-brand-700">{priceLabel(p.price, currency)}</p>
          <p className="mt-1 text-sm text-ink-400">Sourced in China</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {p.moq != null && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Minimum order</dt><dd className="font-medium text-ink-800">{p.moq} {p.unit || 'pcs'}</dd></div>}
            {p.leadTime && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Lead time</dt><dd className="font-medium text-ink-800">{p.leadTime}</dd></div>}
          </dl>
          {p.summary && <p className="mt-6 leading-relaxed text-ink-600">{p.summary}</p>}
          {tiers.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-ink-100">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-ink-500"><tr><th className="px-4 py-2">Quantity</th><th className="px-4 py-2">USD</th><th className="px-4 py-2">RMB</th><th className="px-4 py-2">INR</th></tr></thead>
                <tbody>
                  {tiers.map((t, i) => (
                    <tr key={i} className="border-t border-ink-100">
                      <td className="px-4 py-2">{t.minQty}{t.maxQty ? `–${t.maxQty}` : '+'} {p.unit || 'pcs'}</td>
                      {(['USD', 'CNY', 'INR'] as const).map((cur) => (
                        <td key={cur} className={`px-4 py-2 font-medium ${cur === currency ? 'text-brand-700' : 'text-ink-800'}`}>
                          {t.amounts?.[cur] != null ? priceLabel({ mode: 'RANGE', base: cur, amounts: { USD: { min: t.amounts.USD ?? null, max: t.amounts.USD ?? null }, CNY: { min: t.amounts.CNY ?? null, max: t.amounts.CNY ?? null }, INR: { min: t.amounts.INR ?? null, max: t.amounts.INR ?? null } } } as any, cur) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {specs.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-ink-100">
              <table className="w-full text-sm">
                <tbody>
                  {specs.map(([k, v]) => (
                    <tr key={k} className="border-t border-ink-100 first:border-0">
                      <th className="w-40 bg-ink-50 px-4 py-2 text-left font-medium capitalize text-ink-500">{k}</th>
                      <td className="px-4 py-2 text-ink-700">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-5 shadow-soft">
            <h2 className="font-semibold text-ink-800">Request a quote</h2>
            <p className="mt-1 text-sm text-ink-500">We’ll come back with a Source Easy quote. This is not a checkout.</p>
            <div className="mt-4"><EnquireForm product={p} /></div>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-800">Related products</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {related.map((r) => <ProductCard key={r.id} product={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}
