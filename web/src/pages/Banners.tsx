import { useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import { PageHeader } from '../components/ui';
import { staffReq } from '../catalog/api';
import { FIXTURE_BANNERS } from '../catalog/fixtures';
import type { Banner } from '../catalog/types';

export function Banners() {
  const { session } = useApp();
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
  const upload = async (id: string, file: File) => {
    const fd = new FormData(); fd.append('file', file);
    await staffReq('POST', `/api/banners/${id}/image`, fd);
    await load();
  };

  return (
    <>
      <PageHeader title="Banners" />
      <p className="mb-4 text-sm text-ink-500">Up to 6 live slides. They auto-scroll on the marketplace homepage. Festival greetings also appear in the same banner.</p>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
      <button className="btn-primary mb-4" onClick={() => void add()}>Add slide</button>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((b) => (
          <article key={b.id} className="overflow-hidden rounded-2xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
            {b.imageUrl && <img src={b.imageUrl.startsWith('/') && !demo ? b.imageUrl : b.imageUrl} alt={b.altText} className="h-36 w-full object-cover" />}
            <div className="p-4">
              <p className="font-medium text-ink-900 dark:text-white">{b.altText}</p>
              {b.isSample && <p className="text-xs text-brand-700">Sample</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!demo && <label className="btn-outline !py-1 text-xs">Upload image<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(b.id, f); }} /></label>}
                <button className="btn-outline !py-1 text-xs text-red-600" onClick={() => void remove(b.id)}>Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
