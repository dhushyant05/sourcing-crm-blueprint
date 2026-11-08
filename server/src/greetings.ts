/**
 * Festival / event greetings shown as a banner on the public website, the customer portal and (API-ready) the customer app.
 * Content is plain text + uploaded raster artwork (PNG / JPEG / WebP, sniffed by magic bytes; never SVG or HTML) in one of
 * a few preset layouts. Only PUBLISHED greetings inside [starts_at, ends_at) are ever delivered; expiry is enforced here and
 * the delivery DTO carries `endsAt` so clients drop cached banners offline too.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export const LAYOUTS = ['IMAGE', 'CLASSIC', 'FESTIVE', 'MINIMAL'] as const;   // IMAGE = artwork only; the other three are presets
export const THEMES = ['BRAND', 'GOLD', 'NIGHT', 'ROSE'] as const;
export const SURFACES = ['PUBLIC', 'PORTAL', 'APP'] as const;
export const GREETING_IMAGE_BYTES = 10 * 1024 * 1024;
/** Decoded-size guard (clients decode the artwork): longest side ≤ 8000 px and ≤ 40 megapixels. */
export const GREETING_MAX_SIDE = 8000, GREETING_MAX_PIXELS = 40_000_000;

/** Width × height from the image header (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X) without decoding. Null if unreadable. */
export function imageSize(b: Buffer, mime: string): { w: number; h: number } | null {
  try {
    if (mime === 'image/png') return b.length >= 24 && b.toString('latin1', 12, 16) === 'IHDR' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
    if (mime === 'image/webp') {
      const c = b.toString('latin1', 12, 16);
      if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (c === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
      if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
        const len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
      return null;
    }
  } catch { /* truncated */ }
  return null;
}
/** Full artwork check: raster type by magic bytes, ≤ 10 MB, readable dimensions inside the decode limits. */
export function checkArtwork(data: Buffer): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; w: number; h: number } {
  if (data.length > GREETING_IMAGE_BYTES) throw new GreetingError('Image too large (max 10 MB)', 413, 'size');
  const mime = sniffImage(data); if (!mime) throw new GreetingError('Only PNG, JPEG or WebP images are allowed', 415, 'type');
  const d = imageSize(data, mime); if (!d || d.w < 1 || d.h < 1) throw new GreetingError('This image could not be read', 415, 'type');
  if (Math.max(d.w, d.h) > GREETING_MAX_SIDE || d.w * d.h > GREETING_MAX_PIXELS) throw new GreetingError(`Image is ${d.w}×${d.h}px; max ${GREETING_MAX_SIDE}px per side and 40 megapixels`, 413, 'dimensions');
  return { mime, ...d };
}
export class GreetingError extends Error { constructor(msg: string, public status = 400, public code?: string) { super(msg); } }

/** Raster only: PNG, JPEG, WebP by magic bytes. Anything else (SVG, HTML, GIF, polyglots without the header) is refused. */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export interface Greeting {
  id: string; name: string; status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'; layout: string; theme: string; heading: string | null; message: string | null; altText: string | null;
  linkPath: string | null; linkLabel: string | null; imageDesktop: string | null; imageMobile: string | null; surfaces: string[]; startsAt: string; endsAt: string;
  priority: number; dismissible: boolean; version: number; createdBy: string | null; updatedBy: string | null; publishedBy: string | null; publishedAt: string | null;
  createdAt: string; updatedAt: string;
}
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString());
const row = (r: any): Greeting => ({ id: r.id, name: r.name, status: r.status, layout: r.layout, theme: r.theme, heading: r.heading, message: r.message, altText: r.alt_text,
  linkPath: r.link_path, linkLabel: r.link_label, imageDesktop: r.image_desktop, imageMobile: r.image_mobile, surfaces: Array.isArray(r.surfaces) ? r.surfaces : String(r.surfaces ?? '').replace(/[{}]/g, '').split(',').filter(Boolean),
  startsAt: iso(r.starts_at)!, endsAt: iso(r.ends_at)!, priority: Number(r.priority), dismissible: !!r.dismissible, version: Number(r.version), createdBy: r.created_by, updatedBy: r.updated_by,
  publishedBy: r.published_by, publishedAt: iso(r.published_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! });

/** Plain text only: control characters and angle brackets are stripped (rendered as text anyway, never as HTML). */
const text = (v: unknown, max: number) => { const t = v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').trim(); return t ? t.slice(0, max) : null; };
/** A greeting may only link inside our own site: an absolute path, no scheme, no protocol-relative `//`. */
export const safePath = (v: unknown) => { const t = text(v, 200); if (!t) return null; if (!/^\/(?!\/)[\w\-./#?=&%]*$/.test(t) || /\\/.test(t)) throw new GreetingError('Link must be a path on our site, like /portal', 400, 'invalid'); return t; };
/** Accepts an ISO timestamp, or a local "YYYY-MM-DDTHH:mm" read as IST (+05:30). */
export const istTime = (v: unknown, what: string) => {
  const t = String(v ?? '').trim(); if (!t) throw new GreetingError(`${what} is required`, 400, 'required');
  const s = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t) ? `${t}${t.length === 16 ? ':00' : ''}+05:30` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+05:30` : t;
  const d = new Date(s); if (Number.isNaN(d.getTime())) throw new GreetingError(`${what} is not a valid date`, 400, 'invalid');
  return d.toISOString();
};

export function cleanGreeting(b: Record<string, unknown>, cur?: Greeting) {
  const v: Record<string, unknown> = {};
  if ('name' in b) { v.name = text(b.name, 120); if (!v.name) throw new GreetingError('Name is required', 400, 'required'); }
  if ('layout' in b) { const l = String(b.layout ?? '').toUpperCase(); if (!LAYOUTS.includes(l as never)) throw new GreetingError('Unknown layout', 400, 'invalid'); v.layout = l; }
  if ('theme' in b) { const l = String(b.theme ?? '').toUpperCase(); if (!THEMES.includes(l as never)) throw new GreetingError('Unknown theme', 400, 'invalid'); v.theme = l; }
  if ('heading' in b) v.heading = text(b.heading, 120);
  if ('message' in b) v.message = text(b.message, 400);
  if ('altText' in b) v.altText = text(b.altText, 200);
  if ('linkPath' in b) v.linkPath = safePath(b.linkPath);
  if ('linkLabel' in b) v.linkLabel = text(b.linkLabel, 40);
  if ('surfaces' in b) {
    const l = (Array.isArray(b.surfaces) ? b.surfaces : String(b.surfaces ?? '').split(',')).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    if (!l.length || l.some((x) => !SURFACES.includes(x as never))) throw new GreetingError('Choose where to show it: PUBLIC, PORTAL, APP', 400, 'invalid');
    v.surfaces = [...new Set(l)];
  }
  if ('startsAt' in b) v.startsAt = istTime(b.startsAt, 'Start');
  if ('endsAt' in b) v.endsAt = istTime(b.endsAt, 'End');
  if ('priority' in b) { const n = Number(b.priority); if (!Number.isInteger(n) || n < 0 || n > 100) throw new GreetingError('Priority must be 0–100', 400, 'invalid'); v.priority = n; }
  if ('dismissible' in b) v.dismissible = b.dismissible === true || b.dismissible === 'true';
  const s = (v.startsAt ?? cur?.startsAt) as string | undefined, e = (v.endsAt ?? cur?.endsAt) as string | undefined;
  if (s && e && new Date(e) <= new Date(s)) throw new GreetingError('End must be after start', 400, 'invalid');
  return v;
}
/** What publishing requires (checked on the server). */
/** Stable codes for the publish checks (the web shows them in EN / 中文). */
export const PROBLEM_CODES: Record<string, string> = { 'An IMAGE greeting needs the desktop artwork': 'needDesktop', 'Describe the artwork (alt text)': 'needAlt', 'A heading is required': 'needHeading',
  'The end date is in the past': 'ended', 'Add a label for the link': 'needLinkLabel' };
export const problemCodes = (g: Greeting) => publishProblems(g).map((m) => PROBLEM_CODES[m] ?? 'other');
export function publishProblems(g: Greeting): string[] {
  const p: string[] = [];
  if (g.layout === 'IMAGE' && !g.imageDesktop) p.push('An IMAGE greeting needs the desktop artwork');
  if (g.layout === 'IMAGE' && !g.altText) p.push('Describe the artwork (alt text)');
  if (g.layout !== 'IMAGE' && !g.heading) p.push('A heading is required');
  if ((g.imageDesktop || g.imageMobile) && !g.altText) p.push('Describe the artwork (alt text)');
  if (new Date(g.endsAt) <= new Date()) p.push('The end date is in the past');
  if (g.linkPath && !g.linkLabel) p.push('Add a label for the link');
  return [...new Set(p)];
}

const COL: Record<string, string> = { name: 'name', layout: 'layout', theme: 'theme', heading: 'heading', message: 'message', altText: 'alt_text', linkPath: 'link_path', linkLabel: 'link_label',
  surfaces: 'surfaces', startsAt: 'starts_at', endsAt: 'ends_at', priority: 'priority', dismissible: 'dismissible', imageDesktop: 'image_desktop', imageMobile: 'image_mobile' };

export class GreetingStore {
  constructor(private db: Db) {}
  async list() { return (await this.db.all('SELECT * FROM greetings ORDER BY starts_at DESC, id')).map(row); }
  async get(id: string) { const r = await this.db.get('SELECT * FROM greetings WHERE id = ?', id); return r ? row(r) : null; }
  async create(v: Record<string, unknown>, by: string) {
    const id = randomUUID(), now = Date.now();
    const d = { name: 'Greeting', layout: 'CLASSIC', theme: 'BRAND', surfaces: ['PUBLIC'], startsAt: new Date(now).toISOString(), endsAt: new Date(now + 7 * 864e5).toISOString(), priority: 0, dismissible: true, ...v };
    if (new Date(d.endsAt as string) <= new Date(d.startsAt as string)) throw new GreetingError('End must be after start', 400, 'invalid');
    const ks = Object.keys(d).filter((k) => COL[k]);
    await this.db.run(`INSERT INTO greetings (id, created_by, updated_by, ${ks.map((k) => COL[k]).join(', ')}) VALUES (?,?,?,${ks.map(() => '?').join(',')})`, id, by, by, ...ks.map((k) => (d as any)[k]));
    return (await this.get(id))!;
  }
  async update(id: string, v: Record<string, unknown>, by: string) {
    const ks = Object.keys(v).filter((k) => COL[k]); if (!ks.length) return this.get(id);
    await this.db.run(`UPDATE greetings SET ${ks.map((k) => `${COL[k]} = ?`).join(', ')}, updated_by = ?, updated_at = now() WHERE id = ?`, ...ks.map((k) => v[k]), by, id);
    return this.get(id);
  }
  async setStatus(id: string, from: string[], to: 'PUBLISHED' | 'UNPUBLISHED', by: string) {
    const n = await this.db.run(`UPDATE greetings SET status = ?, updated_by = ?, updated_at = now()${to === 'PUBLISHED' ? ', version = version + 1, published_by = ?, published_at = now()' : ''}
      WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`, to, by, ...(to === 'PUBLISHED' ? [by] : []), id, ...from);
    if (!n) throw new GreetingError('This greeting changed, refresh and try again', 409, 'state');
    return (await this.get(id))!;
  }
  async remove(id: string) { return this.db.run("DELETE FROM greetings WHERE id = ? AND status <> 'PUBLISHED'", id); }
  /** Delivery feed: published, inside its window, for one surface; highest priority first. */
  async live(surface: string, at = new Date()) {
    return (await this.db.all(`SELECT * FROM greetings WHERE status = 'PUBLISHED' AND starts_at <= ? AND ends_at > ? AND ? = ANY(surfaces) ORDER BY priority DESC, starts_at DESC, id LIMIT 5`,
      at.toISOString(), at.toISOString(), surface)).map(row);
  }
  async isLive(id: string, at = new Date()) { return !!(await this.db.get(`SELECT 1 FROM greetings WHERE id = ? AND status = 'PUBLISHED' AND starts_at <= ? AND ends_at > ?`, id, at.toISOString(), at.toISOString())); }
  async audit(id: string, actor: string | null, action: string, detail: Record<string, unknown> = {}) {
    await this.db.run('INSERT INTO greeting_audit (greeting_id, actor_id, action, detail) VALUES (?,?,?,?)', id, actor, action, JSON.stringify(detail));
  }
  async auditFor(id: string) { return this.db.all('SELECT at, actor_id, action, detail FROM greeting_audit WHERE greeting_id = ? ORDER BY id DESC LIMIT 100', id); }
}
/** Customer-safe delivery DTO (no internal name, authors or audit). */
export const greetingDto = (g: Greeting, imgBase: string) => ({
  id: g.id, version: g.version, layout: g.layout, theme: g.theme, heading: g.heading, message: g.message, alt: g.altText, link: g.linkPath ? { path: g.linkPath, label: g.linkLabel } : null,
  imageDesktop: g.imageDesktop ? `${imgBase}/${g.id}/image/desktop?v=${g.version}` : null, imageMobile: g.imageMobile ? `${imgBase}/${g.id}/image/mobile?v=${g.version}` : null,
  dismissible: g.dismissible, startsAt: g.startsAt, endsAt: g.endsAt, priority: g.priority,
});
export const grKey = (id: string) => `gr_${id}`;
