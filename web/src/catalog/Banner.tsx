import { useEffect, useRef, useState } from 'react';
import type { Banner, BannerSettings } from './types';

const SLIDE_MS = 700;
const FADE_MS = 200;

export function BannerCarousel({ banners, settings, variant = 'hero' }: { banners: Banner[]; settings: BannerSettings; variant?: 'hero' | 'card' | 'wide' }) {
  const slides = banners.filter((b) => b.source !== 'greeting');
  const n = slides.length;
  // Extended track: [last, ...slides, first]. Resting positions are 1..n.
  const [position, setPosition] = useState(1);
  const [instant, setInstant] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [paused, setPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const animatingRef = useRef(false);
  const positionRef = useRef(1);
  const swipeStartX = useRef(0);
  const swiped = useRef(false);

  const realIndex = (pos = position) => {
    if (n <= 1) return 0;
    if (pos === 0) return n - 1;
    if (pos === n + 1) return 0;
    return pos - 1;
  };
  const i = n ? realIndex() : 0;
  const srcOf = (b: Banner) => (b.mobileUrl && isMobile ? b.mobileUrl : b.imageUrl);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 639px)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setIsMobile(mobile.matches);
      setReduceMotion(motion.matches);
    };
    sync();
    mobile.addEventListener('change', sync);
    motion.addEventListener('change', sync);
    return () => {
      mobile.removeEventListener('change', sync);
      motion.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { animatingRef.current = animating; }, [animating]);

  const goTo = (targetIndex: number, direction: 1 | -1) => {
    if (n <= 1 || targetIndex < 0 || targetIndex >= n) return;
    if (animatingRef.current) return;
    const cur = realIndex(positionRef.current);
    if (targetIndex === cur && positionRef.current >= 1 && positionRef.current <= n) return;
    const steps = direction === 1 ? (targetIndex - cur + n) % n : (cur - targetIndex + n) % n;
    if (!steps) return;
    const dest = direction === 1 ? positionRef.current + steps : positionRef.current - steps;
    if (reduceMotion) {
      setInstant(true);
      setPosition(targetIndex + 1);
      return;
    }
    setAnimating(true);
    setPosition(dest);
  };

  useEffect(() => {
    if (n <= 1 || paused) return;
    const ms = Math.max(3, Math.min(10, settings.intervalSeconds || 5)) * 1000;
    const t = setInterval(() => {
      if (animatingRef.current) return;
      const cur = realIndex(positionRef.current);
      if (settings.direction === 'RTL') goTo((cur - 1 + n) % n, -1);
      else goTo((cur + 1) % n, 1);
    }, ms);
    return () => clearInterval(t);
  }, [n, paused, settings.direction, settings.intervalSeconds, reduceMotion]);

  useEffect(() => {
    if (!instant) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    return () => cancelAnimationFrame(id);
  }, [instant]);

  // Preload the neighbouring slides so the next move has no blank frame.
  useEffect(() => {
    if (n <= 1) return;
    const cur = realIndex();
    for (const idx of [(cur + 1) % n, (cur - 1 + n) % n]) {
      const url = srcOf(slides[idx]);
      if (!url) continue;
      const img = new Image();
      img.src = url;
    }
  }, [i, isMobile, n]);

  if (!n) return null;

  const extended = n === 1 ? slides : [slides[n - 1], ...slides, slides[0]];

  const finishSlide = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.propertyName !== 'transform') return;
    if (position === n + 1) {
      setInstant(true);
      setPosition(1);
    } else if (position === 0) {
      setInstant(true);
      setPosition(n);
    }
    setAnimating(false);
  };

  const onStart = (e: React.TouchEvent) => { swipeStartX.current = e.touches[0].clientX; swiped.current = false; };
  const onEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    if (Math.abs(dx) < 40) return;
    swiped.current = true;
    const cur = realIndex(positionRef.current);
    if (dx < 0) goTo((cur + 1) % n, 1);
    else goTo((cur - 1 + n) % n, -1);
  };
  const hoverPause = (on: boolean) => {
    // Only pause for real hover pointers. A tap on a phone can fire mouseenter
    // and never mouseleave, which used to freeze the carousel.
    if (on && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    setPaused(on);
  };

  const frame = variant === 'card'
    ? 'relative h-full min-h-[220px] w-full overflow-hidden'
    : variant === 'wide'
      ? 'relative h-full w-full overflow-hidden'
      : 'relative mx-auto h-[220px] max-w-7xl overflow-hidden sm:h-[280px] lg:h-[340px]';

  return (
    <section className={`relative min-w-0 overflow-hidden bg-ink-50 ${variant === 'card' ? 'h-full w-full rounded-2xl' : variant === 'wide' ? 'h-full w-full rounded-xl' : ''}`}
      onMouseEnter={() => hoverPause(true)} onMouseLeave={() => hoverPause(false)}
      onTouchStart={onStart} onTouchEnd={onEnd} aria-roledescription="carousel" aria-label="Featured banners"
      data-testid="banner-carousel" data-active-index={i} data-slide-count={n} data-animating={animating ? '1' : '0'}>
      {reduceMotion ? (
        <div className={frame}>
          {slides.map((b, idx) => (
            <a key={b.id} href={b.href || '/products'} onClick={(e) => { if (b.href?.startsWith('/')) { e.preventDefault(); history.pushState({}, '', b.href); dispatchEvent(new PopStateEvent('popstate')); } }}
              className={`absolute inset-0 transition-opacity ease-in-out ${idx === i ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              style={{ transitionDuration: `${FADE_MS}ms` }}
              aria-hidden={idx !== i}>
              <img src={srcOf(b)} alt={b.altText} className={`h-full w-full object-cover ${variant === 'card' ? 'object-left' : 'object-center'}`} />
            </a>
          ))}
        </div>
      ) : (
        <div className={frame}>
          <div
            className="flex h-full w-full"
            style={{
              transform: `translateX(-${position * 100}%)`,
              transition: instant ? 'none' : `transform ${SLIDE_MS}ms ease-in-out`,
            }}
            onTransitionEnd={finishSlide}
            data-testid="banner-track"
          >
            {extended.map((b, idx) => (
              <a key={`${b.id}-${idx}`} href={b.href || '/products'}
                onClick={(e) => {
                  if (swiped.current) { e.preventDefault(); return; }
                  if (b.href?.startsWith('/')) { e.preventDefault(); history.pushState({}, '', b.href); dispatchEvent(new PopStateEvent('popstate')); }
                }}
                className="relative h-full w-full shrink-0 basis-full"
                aria-hidden={realIndex(idx) !== i}
              >
                <img src={srcOf(b)} alt={b.altText} draggable={false} className={`h-full w-full object-cover ${variant === 'card' ? 'object-left' : 'object-center'}`} />
              </a>
            ))}
          </div>
        </div>
      )}
      {n > 1 && (
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-2">
          {slides.map((b, idx) => (
            <button key={b.id} type="button" aria-label={`Slide ${idx + 1}`} onClick={() => {
              const cur = realIndex(positionRef.current);
              const forward = (idx - cur + n) % n;
              const backward = (cur - idx + n) % n;
              if (!forward) return;
              goTo(idx, forward <= backward ? 1 : -1);
            }}
              className={`h-2 rounded-full transition-all ${idx === i ? 'w-6 bg-white shadow' : 'w-2 bg-white/60 hover:bg-white'}`} />
          ))}
        </div>
      )}
    </section>
  );
}
