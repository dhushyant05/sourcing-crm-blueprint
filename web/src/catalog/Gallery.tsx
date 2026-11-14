import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { photoSrc, type Product, type ProductImage } from './types';

export function Gallery({ product }: { product: Product }) {
  const photos = product.images ?? [];
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const n = photos.length;
  const cur = photos[i] ?? photos[0];
  const go = (d: number) => setI((x) => (x + d + n) % n);
  const startX = useRef(0);
  const onStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onEnd = (e: React.TouchEvent) => {
    if (n < 2) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) < 40) return;
    go(dx < 0 ? 1 : -1);
  };
  useEffect(() => { setI(0); }, [product.id]);

  return (
    <div data-testid="product-gallery">
      <div className="relative overflow-hidden rounded-2xl border border-ink-100 bg-ink-50 shadow-soft"
        onTouchStart={onStart} onTouchEnd={onEnd}>
        {cur && (
          <button type="button" className="block w-full" onClick={() => setOpen(true)} aria-label="Open photo full screen">
            <img src={photoSrc(cur)} alt={cur.altText || product.title} className="aspect-square w-full object-cover" />
          </button>
        )}
        {n > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => go(-1)}
              className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink-800 shadow-soft hover:bg-white">
              <ChevronLeft size={20} />
            </button>
            <button type="button" aria-label="Next photo" onClick={() => go(1)}
              className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink-800 shadow-soft hover:bg-white">
              <ChevronRight size={20} />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-ink-900/75 px-2.5 py-0.5 text-xs font-medium text-white">{i + 1} / {n}</span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {photos.map((ph, idx) => (
            <button key={ph.id} type="button" onClick={() => setI(idx)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border ${idx === i ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-200'}`}>
              <img src={photoSrc(ph, true)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && cur && <Lightbox photos={photos} index={i} title={product.title} onIndex={setI} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Lightbox({ photos, index, title, onIndex, onClose }: {
  photos: ProductImage[]; index: number; title: string; onIndex: (i: number) => void; onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const n = photos.length;
  const cur = photos[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % n);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + n) % n);
    };
    addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [index, n, onClose, onIndex]);
  useEffect(() => { setZoom(1); }, [index]);
  return (
    <div className="fixed inset-0 z-50 bg-ink-800/80" data-testid="product-lightbox" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <p className="text-sm">{index + 1} / {n}</p>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Zoom out" className="rounded-lg p-2 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><ZoomOut size={18} /></button>
            <button type="button" aria-label="Zoom in" className="rounded-lg p-2 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(3, z + 0.5))}><ZoomIn size={18} /></button>
            <button type="button" aria-label="Close" className="rounded-lg p-2 hover:bg-white/10" onClick={onClose}><X size={20} /></button>
          </div>
        </div>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-12">
          {n > 1 && (
            <>
              <button type="button" aria-label="Previous photo" onClick={() => onIndex((index - 1 + n) % n)}
                className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><ChevronLeft /></button>
              <button type="button" aria-label="Next photo" onClick={() => onIndex((index + 1) % n)}
                className="absolute right-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><ChevronRight /></button>
            </>
          )}
          <img src={photoSrc(cur)} alt={cur.altText || title}
            className="max-h-full max-w-full object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }} />
        </div>
      </div>
    </div>
  );
}
