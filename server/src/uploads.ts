import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Allowed enquiry attachments. Type is decided by the file's magic bytes, never by the browser's content-type. */
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export interface Attachment { id: string; name: string; mime: string; size: number; createdAt: string }

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const starts = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, s: string, at = 0) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s;

/** Returns the detected kind ("jpg", "png", "webp", "heic", "pdf", "zip", "ole") or null. */
export function sniff(b: Buffer): string | null {
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 'RIFF') && ascii(b, 'WEBP', 8)) return 'webp';
  if (ascii(b, 'ftyp', 4) && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b.toString('latin1', 8, 12))) return 'heic';
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
  const ok: Record<string, string[]> = { jpg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'], heic: ['heic', 'heif'], pdf: ['pdf'], zip: ['docx', 'xlsx'], ole: ['doc', 'xls'] };
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
}
