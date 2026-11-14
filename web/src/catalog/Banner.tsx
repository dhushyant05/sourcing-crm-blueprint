import { useEffect, useState } from 'react';
import type { Banner, BannerSettings } from './types';

export function BannerCarousel({ banners, settings, variant = 'hero' }: { banners: Banner[]; settings: BannerSettings; variant?: 'hero' | 'card' }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = banners.length;
  useEffect(() => {
    if (n <= 1 || paused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((x) => (settings.direction === 'RTL' ? (x - 1 + n) % n : (x + 1) % n)), (settings.intervalSeconds || 5) * 1000);
    return () => clearInterval(t);
  }, [n, paused, settings.direction, settings.intervalSeconds]);
  if (!n) return null;
  let startX = 0;
  const onStart = (e: React.TouchEvent) => { startX = e.touches[0].clientX; };
  const onEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < 40) return;
    setI((x) => (dx < 0 ? (x + 1) % n : (x - 1 + n) % n));
  };
  return (
    <section className={`relative overflow-hidden bg-ink-50 ${variant === 'card' ? 'h-full rounded-2xl' : ''}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={onStart} onTouchEnd={onEnd} aria-roledescription="carousel" aria-label="Featured banners">
      <div className={variant === 'card' ? 'relative h-full min-h-[220px]' : 'relative mx-auto h-[220px] max-w-7xl sm:h-[280px] lg:h-[340px]'}>
        {banners.map((b, idx) => (
          <a key={b.id} href={b.href || '/products'} onClick={(e) => { if (b.href?.startsWith('/')) { e.preventDefault(); history.pushState({}, '', b.href); dispatchEvent(new PopStateEvent('popstate')); } }}
            className={`absolute inset-0 transition-opacity duration-700 ease-out ${idx === i ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-hidden={idx !== i}>
            <img src={b.mobileUrl && window.innerWidth < 640 ? b.mobileUrl : b.imageUrl} alt={b.altText} className={`h-full w-full object-cover ${variant === 'card' ? 'object-left' : ''}`} />
          </a>
        ))}
      </div>
      {n > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
          {banners.map((b, idx) => (
            <button key={b.id} type="button" aria-label={`Slide ${idx + 1}`} onClick={() => setI(idx)}
              className={`h-2 rounded-full transition-all ${idx === i ? 'w-6 bg-white shadow' : 'w-2 bg-white/60 hover:bg-white'}`} />
          ))}
        </div>
      )}
    </section>
  );
}
