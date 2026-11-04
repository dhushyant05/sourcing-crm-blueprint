import { Camera, Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './ui';

const MAX = 5 * 1024 * 1024, VIEW = 240;

/** Pick an image, crop it to a square (drag + zoom), then hand back a JPEG blob. The server resizes to 256 px. */
export function AvatarEditor({ name, src, onSave, onRemove, testid = 'avatar' }: {
  name: string; src?: string | null; onSave(b: Blob): Promise<void>; onRemove(): Promise<void>; testid?: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1), [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const base = img ? VIEW / Math.min(img.width, img.height) : 1, scale = base * zoom;
  const clamp = (o: { x: number; y: number }, z = zoom) => {
    if (!img) return o;
    const s = base * z, mx = Math.max(0, (img.width * s - VIEW) / 2), my = Math.max(0, (img.height * s - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  const pick = (f?: File) => {
    setErr(null);
    if (!f) return;
    if (!f.type.startsWith('image/')) return setErr(t('profile.notImage'));
    if (f.size > MAX) return setErr(t('profile.tooBig'));
    const url = URL.createObjectURL(f), i = new Image();
    i.onload = () => { setImg(i); setZoom(1); setOff({ x: 0, y: 0 }); };
    i.onerror = () => setErr(t('profile.notImage'));
    i.src = url;
  };
  const save = async () => {
    if (!img) return;
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const k = 512 / VIEW, ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
    const w = img.width * scale * k, h = img.height * scale * k;
    ctx.drawImage(img, 256 - w / 2 + off.x * k, 256 - h / 2 + off.y * k, w, h);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) return;
    setBusy(true); setErr(null);
    try { await onSave(blob); setImg(null); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const down = (e: PointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; };
  const move = (e: PointerEvent) => { const d = drag.current; if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })); };
  return (
    <div data-testid={testid}>
      <input ref={input} type="file" accept="image/*" className="hidden" data-testid={`${testid}-file`} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {!img ? (
        <div className="flex items-center gap-4">
          <Avatar name={name || '?'} src={src} className="!h-16 !w-16 text-lg" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline" onClick={() => input.current?.click()} data-testid={`${testid}-upload`}><Camera size={15} />{src ? t('profile.change') : t('profile.upload')}</button>
            {src && <button type="button" className="btn-ghost text-red-600" disabled={busy} data-testid={`${testid}-remove`}
              onClick={async () => { setBusy(true); try { await onRemove(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}><Trash2 size={15} />{t('profile.remove')}</button>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative cursor-move touch-none overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800" style={{ width: VIEW, height: VIEW }}
            onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} data-testid={`${testid}-crop`}>
            <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none"
              style={{ width: img.width * scale, height: img.height * scale, left: VIEW / 2 - (img.width * scale) / 2 + off.x, top: VIEW / 2 - (img.height * scale) / 2 + off.y }} />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-500" style={{ width: VIEW }}>{t('profile.zoom')}
            <input type="range" min={1} max={4} step={0.01} value={zoom} className="flex-1" onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOff((o) => clamp(o, z)); }} /></label>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()} data-testid={`${testid}-save`}>{t('common.save')}</button>
            <button type="button" className="btn-outline" onClick={() => setImg(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-400">{t('profile.hint')}</p>
      {err && <p className="mt-1 text-xs text-red-600" data-testid={`${testid}-err`}>{err}</p>}
    </div>
  );
}
