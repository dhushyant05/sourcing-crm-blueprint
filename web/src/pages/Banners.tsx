import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';
import { PageHeader } from '../components/ui';
import { ImageSizeGuide } from '../components/ImageSizeGuide';
import { staffReq } from '../catalog/api';
import { FIXTURE_BANNERS } from '../catalog/fixtures';
import type { Banner } from '../catalog/types';

export function Banners() {
  const { session } = useApp();
  const { t } = useTranslation();
  const demo = !!session?.demo;
  const [rows, setRows] = useState<(Banner & { id: string })[]>(demo ? FIXTURE_BANNERS : []);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    if (demo) return;
    const r = await staffReq<{ data: Banner[] }>('GET', '/api/banners');
    setRows(r.data);
  };
  useEffect(() => { void load().catch((e) => setErr((e as Error).message)); }, [demo]); // eslint-disable-line

  const add = async () => {
    const altText = prompt('Banner alt text (required)');
    if (!altText) return;
    if (demo) { setRows((xs) => [...xs, { id: `b-${Date.now()}`, sort: xs.length, altText, imageUrl: '', source: 'banner' }]); return; }
    await staffReq('POST', '/api/banners', { altText });
    await load();
  };
  const remove = async (id: string) => {
    if (!confirm('Remove this banner slide?')) return;
    if (demo) { setRows((xs) => xs.filter((x) => x.id !== id)); return; }
    await staffReq('DELETE', `/api/banners/${id}`);
    await load();
  };
  const upload = async (id: string, file: File, kind: 'file' | 'mobile' = 'file') => {
    const fd = new FormData(); fd.append(kind, file);
    await staffReq('POST', `/api/banners/${id}/image`, fd);
    await load();
  };

  return (
    <>
      <PageHeader title="Banners" />
      <ImageSizeGuide title={t('banners.sizeTitle')}>
        <p>{t('banners.sizeDesktop')}</p>
        <p>{t('banners.sizeMobile')}</p>
        <p>{t('banners.sizeSafe')}</p>
        <p>{t('banners.sizeFiles')}</p>
      </ImageSizeGuide>
      <p className="mb-4 text-sm text-ink-500">{t('banners.intro')}</p>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
      <button className="btn-primary mb-4" onClick={() => void add()}>Add slide</button>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((b) => (
          <article key={b.id} className="overflow-hidden rounded-2xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900" data-testid={`banner-slide-${b.id}`}>
            <div className={`grid ${b.mobileUrl ? 'grid-cols-2' : 'grid-cols-1'} gap-px bg-ink-100`}>
              <div className="bg-ink-50">
                {b.imageUrl
                  ? <img src={b.imageUrl} alt={`${b.altText} (desktop)`} className="aspect-[3/1] w-full object-cover" data-testid="banner-desktop-preview" />
                  : <div className="flex aspect-[3/1] items-center justify-center px-3 text-center text-xs text-ink-400">No desktop image yet</div>}
                {b.imageUrl && <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-500">Desktop</p>}
              </div>
              {b.mobileUrl && (
                <div className="bg-ink-50">
                  <img src={b.mobileUrl} alt={`${b.altText} (mobile)`} className="aspect-[3/2] w-full object-cover" data-testid="banner-mobile-preview" />
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-500">Mobile</p>
                </div>
              )}
            </div>
            <div className="p-4">
              <p className="font-medium text-ink-900 dark:text-white">{b.altText}</p>
              {b.isSample && <p className="text-xs text-brand-700">Sample</p>}
              <p className="mt-2 text-xs text-ink-500">{t('banners.uploadHint')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!demo && <label className="btn-outline !py-1 text-xs">Upload desktop image (1920×640)<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(b.id, f, 'file'); }} /></label>}
                {!demo && <label className="btn-outline !py-1 text-xs">Upload mobile image (1080×720, optional)<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(b.id, f, 'mobile'); }} /></label>}
                <button className="btn-outline !py-1 text-xs text-red-600" onClick={() => void remove(b.id)}>Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
