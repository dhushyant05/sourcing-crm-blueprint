/** Profile pictures: validated, cropped by the client, resized here to 256×256 WebP and stored in PostgreSQL (bytea). */
import sharp from 'sharp';
import type { Db } from './db.js';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export class BadImage extends Error {}
export class AvatarStore {
  private urlCache = new Map<string, string>();
  constructor(private db: Db) {}
  /** Loads the picture URL index (call once at start; kept fresh after writes). */
  async load() {
    const rs = await this.db.all('SELECT user_id, updated_at FROM avatars');
    this.urlCache = new Map(rs.map((r) => [r.user_id, `/api/avatars/${r.user_id}?v=${Date.parse(r.updated_at)}`]));
    return this;
  }
  async set(userId: string, buf: Buffer) {
    if (buf.length > AVATAR_MAX_BYTES) throw new BadImage('Image must be 5 MB or smaller');
    let out: Buffer;
    try {
      const meta = await sharp(buf, { limitInputPixels: 50e6 }).metadata();
      if (!meta.format || !['jpeg', 'png', 'webp', 'gif', 'heif', 'avif'].includes(meta.format)) throw new Error('format');
      out = await sharp(buf, { limitInputPixels: 50e6 }).rotate().resize(256, 256, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer();
    } catch { throw new BadImage('Upload an image (JPG, PNG, WebP or HEIC)'); }
    const at = new Date().toISOString();
    await this.db.run('INSERT INTO avatars (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', userId, out, at);
    await this.load();
    return at;
  }
  async get(userId: string) { const r = await this.db.get('SELECT data, updated_at FROM avatars WHERE user_id = ?', userId); return r ? { data: Buffer.from(r.data), at: r.updated_at as string } : null; }
  async remove(userId: string) { await this.db.run('DELETE FROM avatars WHERE user_id = ?', userId); await this.load(); }
  /** userId → versioned URL, for everyone who has a picture. */
  urls(): Map<string, string> { return this.urlCache; }
}
