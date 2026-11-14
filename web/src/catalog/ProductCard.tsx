import { useRef, useState } from 'react';
import { useCurrency, priceLabel } from './currency';
import { coverImage, photoSrc, type Product } from './types';

export function ProductCard({ product, variant = 'grid' }: { product: Product; variant?: 'grid' | 'compact' }) {
  const { currency } = useCurrency();
  const photos = product.images ?? [];
  const start = Math.max(0, photos.findIndex((p) => p.id === coverImage(photos)?.id));
  const [i, setI] = useState(start < 0 ? 0 : start);
  const open = (e: React.MouseEvent) => { e.preventDefault(); history.pushState({}, '', `/p/${product.slug}`); dispatchEvent(new PopStateEvent('popstate')); };
  const img = photos[i] ?? photos[0];
  const startX = useRef(0);
  const onStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onEnd = (e: React.TouchEvent) => {
    if (photos.length < 2) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) < 30) return;
    setI((x) => (x + (dx < 0 ? 1 : -1) + photos.length) % photos.length);
  };
  return (
    <a href={`/p/${product.slug}`} onClick={open} data-testid={`product-${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-100 bg-white transition duration-300 hover:-translate-y-0.5 hover:shadow-lift">
      <div className="relative aspect-square overflow-hidden bg-ink-50" onTouchStart={onStart} onTouchEnd={onEnd}
        onMouseEnter={() => { if (photos.length > 1) setI((x) => (x + 1) % photos.length); }}
        onMouseLeave={() => setI(start < 0 ? 0 : start)}>
        {img ? <img src={photoSrc(img, true)} alt={img.altText || product.title} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-ink-100" />}
        {product.isSample && <span className="absolute left-2 top-2 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">Sample</span>}
        {(product.pinned || product.trending) && <span className="absolute right-2 top-2 rounded bg-warm-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">Trending</span>}
        {photos.length > 1 && (
          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
            {photos.map((ph, idx) => (
              <span key={ph.id} className={`h-1 rounded-full ${idx === i ? 'w-3 bg-white' : 'w-1 bg-white/70'}`} />
            ))}
          </div>
        )}
      </div>
      <div className={`flex flex-1 flex-col ${variant === 'compact' ? 'p-2.5' : 'p-3'}`}>
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-800">{product.title}</h3>
        <p className="mt-1 text-sm font-semibold text-brand-700">{priceLabel(product.price, currency)}</p>
        {product.moq != null && <p className="mt-0.5 text-[11px] text-ink-500">MOQ {product.moq} {product.unit || 'pcs'}</p>}
        <p className="mt-1 text-[11px] text-ink-400">Sourced in China</p>
      </div>
    </a>
  );
}
