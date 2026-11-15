import { FavoriteButton } from './FavoriteButton';
import { useEffect, useState } from 'react';
import { Factory, FileText, GitCompare, Home, Lamp, MessageCircle, Package, Search, Share2, ShieldCheck, Shirt, Sparkles, TrendingUp, UtensilsCrossed, Warehouse, Wrench } from 'lucide-react';
import { publicCatalog } from './api';
import { CategoryExplorer } from './CategoryExplorer';
import { MarketplaceGreeting } from './GreetingStrip';
import { CompanySections } from './CompanySections';
import { EnquireForm } from './EnquireForm';
import { Gallery } from './Gallery';
import { ProductCard } from './ProductCard';
import { DEFAULT_TRUST } from './fixtures';
import { priceLabel, useCurrency } from './currency';
import { type Banner, type BannerSettings, type Breadcrumb, type Category, type Product, type TrustItem } from './types';
import { breadcrumbOf, childrenOf, categoryBySlug, topLevel } from './tree';

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
            <QuickLink icon={FileText} label="Request for quotation" onClick={() => go('/#quote')} />
            <QuickLink icon={TrendingUp} label="Trending" onClick={() => go('/#recommended')} />
            <QuickLink icon={Sparkles} label="Custom sourcing" onClick={() => go('/#quote')} />
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
          <button type="button" onClick={() => go('/#quote')} className="rounded-full bg-warm-500 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-warm-600">
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
  const current = categoryBySlug(categories, category);
  const crumbs = current ? breadcrumbOf(categories, current) : [];
  const siblingParent = current?.parentId ?? null;
  const sidebarRoots = siblingParent ? childrenOf(categories, siblingParent) : topLevel(categories);
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CatalogBreadcrumbs items={[{ href: '/', label: 'Home' }, { href: '/products', label: 'Products' }, ...crumbs.map((c) => ({ href: `/c/${c.slug}`, label: c.name }))]} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-800">{title}</h1>
      <form onSubmit={search} className="mt-6 max-w-xl">
        <input className="input rounded-full px-4" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this catalog" />
      </form>
      <p className="mt-3 text-sm text-ink-500">{busy ? 'Loading…' : `${total} product${total === 1 ? '' : 's'}`}</p>
      <div className="mt-6 grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        {categories.length > 0 && (
          <aside className="rounded-2xl border border-ink-100 bg-white" aria-label="Categories">
            <div className="border-b border-ink-100 px-4 py-3 text-sm font-semibold text-ink-800">Categories</div>
            <button type="button" onClick={() => go('/products')}
              className={`block w-full px-4 py-2.5 text-left text-sm ${!category ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>All products</button>
            <CategoryTree items={sidebarRoots} all={categories} current={category} />
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

function CategoryTree({ items, all, current, depth = 0 }: { items: Category[]; all: Category[]; current?: string; depth?: number }) {
  return (
    <>
      {items.map((c) => {
        const kids = childrenOf(all, c.id);
        const on = current === c.slug;
        return (
          <div key={c.id}>
            <button type="button" onClick={() => go(`/c/${c.slug}`)}
              style={{ paddingLeft: `${16 + depth * 12}px` }}
              className={`block w-full py-2 pr-4 text-left text-sm ${on ? 'bg-warm-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-warm-50'}`}>{c.name}</button>
            {kids.length > 0 && <CategoryTree items={kids} all={all} current={current} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

function CatalogBreadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-ink-300">/</span>}
          {it.href && i < items.length - 1
            ? <button type="button" className="hover:text-brand-700" onClick={() => go(it.href!)}>{it.label}</button>
            : <span className="text-ink-700">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const { currency } = useCurrency();
  const [p, setP] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'attributes' | 'description' | 'packaging' | 'customization' | 'samples'>('attributes');
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => {
    let on = true; setP(null); setErr(null); setChatOpen(false);
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
  const crumbs: Breadcrumb[] = p.breadcrumbs?.length ? p.breadcrumbs : (p.category?.slug && p.category.name ? [{ id: p.category.id || p.category.slug, slug: p.category.slug, name: p.category.name }] : []);
  const scrollQuote = () => {
    document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setChatOpen(false);
  };
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <CatalogBreadcrumbs items={[{ href: '/', label: 'Home' }, { href: '/products', label: 'Products' }, ...crumbs.map((c) => ({ href: `/c/${c.slug}`, label: c.name })), { label: p.title }]} />

        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <Gallery product={p} />
          <div>
            {p.isSample && <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">Sample</span>}
            {(p.pinned || p.trending) && <span className="ml-2 inline-flex rounded-full bg-warm-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warm-600">Trending</span>}
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-800 sm:text-3xl">{p.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <FavoriteButton productId={p.id} />
                <a href={`https://wa.me/?text=${encodeURIComponent(`${p.title}\nhttps://sourceeasy.in/p/${p.slug}`)}`}
                  target="_blank" rel="noreferrer" data-testid="share-whatsapp"
                  className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 hover:border-brand-200 hover:text-brand-700">
                  <Share2 size={16} /> Share on WhatsApp
                </a>
              </div>
            </div>

            <p className="mt-4 text-2xl font-semibold text-brand-700">{priceLabel(p.price, currency)}</p>
            <p className="mt-1 text-sm text-ink-400">Sourced in China · Prices in USD, RMB and INR</p>

            {tiers.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-ink-100">
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

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              {p.moq != null && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Minimum order</dt><dd className="font-medium text-ink-800">{p.moq} {p.unit || 'pcs'}</dd></div>}
              {p.capacity && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Supply capacity</dt><dd className="font-medium text-ink-800">{p.capacity}</dd></div>}
              {p.leadTime && <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3"><dt className="text-ink-500">Lead time</dt><dd className="font-medium text-ink-800">{p.leadTime}</dd></div>}
            </dl>

            {specs.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-ink-100">
                <div className="bg-ink-50 px-4 py-2 text-sm font-medium text-ink-600">Key attributes</div>
                <table className="w-full text-sm">
                  <tbody>
                    {specs.slice(0, 6).map(([k, v]) => (
                      <tr key={k} className="border-t border-ink-100">
                        <th className="w-40 px-4 py-2 text-left font-medium capitalize text-ink-500">{k}</th>
                        <td className="px-4 py-2 text-ink-700">{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="relative mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={scrollQuote} className="rounded-full bg-warm-500 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-warm-600">
                Request a quote
              </button>
              <button type="button" data-testid="product-chat" onClick={() => setChatOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-5 py-2.5 text-sm font-semibold text-ink-800 hover:border-brand-200 hover:text-brand-700">
                <MessageCircle size={16} /> Chat
              </button>
              {chatOpen && (
                <div data-testid="product-chat-panel" className="absolute left-0 top-full z-10 mt-2 w-80 rounded-2xl border border-ink-100 bg-white p-4 text-sm shadow-soft">
                  <p className="font-medium text-ink-800">Chat with Source Easy</p>
                  <p className="mt-1 text-ink-500">Use the request-a-quote form on this product and the Source Easy team will reply.</p>
                  <button type="button" className="mt-3 text-sm font-medium text-brand-700 hover:underline" onClick={scrollQuote}>Open enquiry form</button>
                </div>
              )}
            </div>

            <SupplierCard product={p} />
          </div>
        </div>

        <div className="mt-12 border-t border-ink-100 pt-8">
          <div className="flex flex-wrap gap-2 border-b border-ink-100" role="tablist">
            {([
              ['attributes', 'Attributes'],
              ['description', 'Description'],
              ['packaging', 'Packaging & delivery'],
              ['customization', 'Customization'],
              ['samples', 'Samples'],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`px-4 py-2 text-sm font-medium ${tab === id ? 'border-b-2 border-brand-600 text-brand-700' : 'text-ink-500 hover:text-ink-800'}`}>{label}</button>
            ))}
          </div>
          <div className="py-6 text-ink-700">
            {tab === 'attributes' && (specs.length ? (
              <table className="w-full max-w-3xl text-sm">
                <tbody>
                  {specs.map(([k, v]) => (
                    <tr key={k} className="border-b border-ink-100">
                      <th className="w-48 py-2 pr-4 text-left font-medium capitalize text-ink-500">{k}</th>
                      <td className="py-2">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-ink-500">No key attributes have been added for this product yet.</p>)}
            {tab === 'description' && <p className="max-w-3xl leading-relaxed">{p.summary || 'No description has been added for this product yet.'}</p>}
            {tab === 'packaging' && <p className="max-w-3xl whitespace-pre-line leading-relaxed">{p.packaging || 'Packaging and delivery details will be confirmed with your quote.'}</p>}
            {tab === 'customization' && <p className="max-w-3xl whitespace-pre-line leading-relaxed">{p.customization || 'Ask about logos, colours, packing and other custom options in your enquiry.'}</p>}
            {tab === 'samples' && <p className="max-w-3xl whitespace-pre-line leading-relaxed">{p.samplePolicy || 'Sample availability can be confirmed when you request a quote.'}</p>}
          </div>
        </div>

        <div id="quote" className="mt-4 scroll-mt-56 rounded-2xl border border-ink-100 bg-white p-5 shadow-soft">
          <h2 className="font-semibold text-ink-800">Send enquiry</h2>
          <p className="mt-1 text-sm text-ink-500">This enquiry is for {p.title}. We’ll come back with a Source Easy quote. This is not a checkout.</p>
          <div className="mt-4"><EnquireForm product={p} /></div>
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
    </div>
  );
}

function SupplierCard({ product }: { product: Product }) {
  const s = product.supplier;
  if (s) {
    return (
      <div data-testid="supplier-card" className="mt-8 rounded-2xl border border-ink-100 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Supplier</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-ink-800">{s.company}</h2>
          {s.verified && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">Verified</span>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {s.region && <div><dt className="text-ink-500">Location</dt><dd className="font-medium text-ink-800">{s.region}</dd></div>}
          {s.years != null && <div><dt className="text-ink-500">Years in business</dt><dd className="font-medium text-ink-800">{s.years}</dd></div>}
        </dl>
        {s.about && <p className="mt-3 text-sm text-ink-600">{s.about}</p>}
      </div>
    );
  }
  if (product.supplierAvailable) {
    return (
      <div data-testid="supplier-members-only" className="mt-8 rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-600">
        Supplier details are visible to Source Easy members.{' '}
        <a href="/portal" className="font-medium text-brand-700 hover:underline">Sign in to the customer portal</a>
      </div>
    );
  }
  return null;
}

