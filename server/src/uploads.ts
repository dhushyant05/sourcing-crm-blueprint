import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** Allowed enquiry attachments. Type is decided by the file's magic bytes, never by the browser's content-type. */
export const MAX_FILES = 5;
/** Photos and documents. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Product videos (stored as uploaded, no re-encoding). Also the multipart per-file hard limit. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Staff may attach more files to a lead than the public form. */
export const MAX_STAFF_FILES = 10;
export const isVideo = (mime: string) => mime.startsWith('video/');
export interface Attachment { id: string; name: string; mime: string; size: number; createdAt: string }

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/x-matroska',
};

const starts = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, s: string, at = 0) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s;

/** Returns the detected kind ("jpg", "png", "webp", "heic", "pdf", "zip", "ole") or null. */
export function sniff(b: Buffer): string | null {
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 'RIFF') && ascii(b, 'WEBP', 8)) return 'webp';
  if (ascii(b, 'ftyp', 4) && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b.toString('latin1', 8, 12))) return 'heic';
  if (ascii(b, 'ftyp', 4)) return 'mp4'; // ISO base media (mp4 / mov / 3gp)
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'mkv'; // EBML (webm / mkv)
  if (ascii(b, '%PDF-')) return 'pdf';
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  return null;
}

/** Checks extension + magic bytes agree. Returns the MIME type to store, or null when rejected. */
export function validateFile(name: string, b: Buffer): string | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const kind = sniff(b), mime = EXT_MIME[ext];
  if (!kind || !mime) return null;
  const ok: Record<string, string[]> = { jpg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'], heic: ['heic', 'heif'], pdf: ['pdf'], mp4: ['mp4', 'm4v', 'mov', '3gp'], mkv: ['webm', 'mkv'], zip: ['docx', 'xlsx'], ole: ['doc', 'xls'] };
  if (!ok[kind].includes(ext)) return null;
  if (kind === 'zip' && !b.includes(Buffer.from(ext === 'docx' ? 'word/' : 'xl/'))) return null; // must really be an Office file
  return mime;
}

const safeName = (n: string) => n.replace(/[^\w.\- ()\u4e00-\u9fff]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';

/** Files live on the API's private data volume (never served statically). One folder per lead + a manifest. */
export class UploadStore {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true }); }
  private leadDir(leadId: string) {
    if (!/^[\w-]{1,64}$/.test(leadId)) throw Object.assign(new Error('Bad lead id'), { status: 400 });
    return join(this.dir, leadId);
  }
  list(leadId: string): Attachment[] {
    const m = join(this.leadDir(leadId), 'manifest.json');
    return existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')) : [];
  }
  save(leadId: string, files: { name: string; mime: string; data: Buffer }[]): Attachment[] {
    const d = this.leadDir(leadId); mkdirSync(d, { recursive: true });
    const list = this.list(leadId);
    for (const f of files) {
      const id = randomBytes(9).toString('base64url');
      writeFileSync(join(d, id), f.data, { mode: 0o600 });
      list.push({ id, name: safeName(f.name), mime: f.mime, size: f.data.length, createdAt: new Date().toISOString() });
    }
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(list, null, 1));
    return list;
  }
  read(leadId: string, id: string): { meta: Attachment; data: Buffer } | null {
    const meta = this.list(leadId).find((a) => a.id === id);
    return meta ? { meta, data: readFileSync(join(this.leadDir(leadId), meta.id)) } : null;
  }
  /** Path + metadata (for streaming / HTTP Range, e.g. video playback). */
  file(leadId: string, id: string): { meta: Attachment; path: string; size: number } | null {
    const meta = this.list(leadId).find((a) => a.id === id);
    if (!meta) return null;
    const path = join(this.leadDir(leadId), meta.id);
    return existsSync(path) ? { meta, path, size: statSync(path).size } : null;
  }
  remove(leadId: string, id: string): Attachment[] | null {
    const list = this.list(leadId), meta = list.find((a) => a.id === id);
    if (!meta) return null;
    rmSync(join(this.leadDir(leadId), meta.id), { force: true });
    const rest = list.filter((a) => a.id !== id);
    writeFileSync(join(this.leadDir(leadId), 'manifest.json'), JSON.stringify(rest, null, 1));
    return rest;
  }

  /** Streams one upload to a staging file (never the whole video in RAM), then validates type + per-kind size. */
  async stage(name: string, stream: Readable & { truncated?: boolean }): Promise<Staged> {
    const sd = join(this.dir, '.staging'); mkdirSync(sd, { recursive: true });
    const path = join(sd, randomBytes(12).toString('base64url'));
    try { await pipeline(stream, createWriteStream(path, { mode: 0o600 })); } catch (e) { rmSync(path, { force: true }); throw e; }
    const size = statSync(path).size;
    const fail = (code: Staged['error']): Staged => { rmSync(path, { force: true }); return { name, path, size, mime: '', error: code }; };
    if (stream.truncated) return fail('size');
    if (!size) return fail('empty');
    const head = Buffer.alloc(Math.min(size, 64)); const fd = openSync(path, 'r'); readSync(fd, head, 0, head.length, 0); closeSync(fd);
    const k = sniff(head);
    const video = k === 'mp4' || k === 'mkv'; // sniff() already returns 'heic' for HEIF photos
    if (!video && size > MAX_FILE_BYTES) return fail('size');
    const mime = validateFile(name, video ? head : readFileSync(path));
    if (!mime) return fail('type');
    return { name, path, size, mime };
  }
  /** Moves staged files into the lead's folder and records them in the manifest. */
  commit(leadId: string, files: Staged[]): Attachment[] {
    const d = this.leadDir(leadId); mkdirSync(d, { recursive: true });
    const list = this.list(leadId);
    for (const f of files) {
      const id = randomBytes(9).toString('base64url');
      renameSync(f.path, join(d, id));
      list.push({ id, name: safeName(f.name), mime: f.mime, size: f.size, createdAt: new Date().toISOString() });
    }
    writeFileSync(join(d, 'manifest.json'), JSON.stringify(list, null, 1));
    return list;
  }
  /** Deletes every file kept under [key] (e.g. when a quote is deleted). */
  removeAll(key: string) { rmSync(this.leadDir(key), { recursive: true, force: true }); }
  discard(files: Staged[]) { for (const f of files) rmSync(f.path, { force: true }); }
}
export interface Staged { name: string; path: string; size: number; mime: string; error?: 'size' | 'type' | 'empty' }

