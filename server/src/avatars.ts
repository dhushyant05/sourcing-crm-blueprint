/** Profile pictures: validated, cropped by the client, resized here to 256×256 WebP and stored in SQLite. */
import type { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export class BadImage extends Error {}
export class AvatarStore {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS avatars (user_id TEXT PRIMARY KEY, data BLOB NOT NULL, updated_at TEXT NOT NULL)');
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
    this.db.prepare('INSERT INTO avatars (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(userId, out, at);
    return at;
  }
  get(userId: string) { const r = this.db.prepare('SELECT data, updated_at FROM avatars WHERE user_id = ?').get(userId) as any; return r ? { data: Buffer.from(r.data), at: r.updated_at as string } : null; }
  remove(userId: string) { this.db.prepare('DELETE FROM avatars WHERE user_id = ?').run(userId); }
  /** userId → versioned URL, for everyone who has a picture. */
  urls(): Map<string, string> {
    return new Map((this.db.prepare('SELECT user_id, updated_at FROM avatars').all() as any[]).map((r) => [r.user_id, `/api/avatars/${r.user_id}?v=${Date.parse(r.updated_at)}`]));
  }
}
