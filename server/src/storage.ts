import { lstatSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { Attachment } from './uploads.js';

/**
 * Storage Manager inventory. Read-only walk of the managed upload root: one level of owner folders, each with a
 * manifest. Only manifest-listed files are ever candidates; anything else (staging, dotfiles, symlinks, odd names,
 * unlisted files) is ignored — never scanned for deletion. Nothing here deletes.
 */
export const KEY_RE = /^[\w-]{1,64}$/, FILE_RE = /^[\w-]{1,32}$/;
export type OwnerKind = 'LEAD' | 'QUOTE' | 'SHIPPING' | 'GREETING' | 'PRODUCT' | 'BANNER';
export const ownerKind = (key: string): OwnerKind => key.startsWith('q_') ? 'QUOTE' : key.startsWith('sr_') ? 'SHIPPING' : key.startsWith('gr_') ? 'GREETING' : key.startsWith('p_') ? 'PRODUCT' : key.startsWith('bn_') ? 'BANNER' : 'LEAD';
export const fileType = (mime: string) => mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document';

export interface StoredFile { key: string; id: string; name: string; mime: string; type: string; size: number; createdAt: string; missing: boolean; owner: OwnerKind }

/** Real filesystem figures for the volume that holds the upload root (as seen by this process). */
export function diskOf(root: string) {
  const s = statfsSync(root); const bs = Number(s.bsize);
  const total = Number(s.blocks) * bs, free = Number(s.bavail) * bs, used = total - Number(s.bfree) * bs;
  return { total, used, free };
}

export function inventory(root: string): StoredFile[] {
  const out: StoredFile[] = [];
  let dirs: string[] = []; try { dirs = readdirSync(root); } catch { return out; }
  for (const key of dirs) {
    if (!KEY_RE.test(key)) continue; // skips .staging and anything odd
    const d = join(root, key);
    try { if (!lstatSync(d).isDirectory()) continue; } catch { continue; } // lstat: a symlinked folder is not a directory
    let list: Attachment[] = [];
    try { const m = join(d, 'manifest.json'); if (!lstatSync(m).isFile()) continue; list = JSON.parse(readFileSync(m, 'utf8')); } catch { continue; }
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (!a || typeof a.id !== 'string' || !FILE_RE.test(a.id)) continue;
      let size = 0, missing = false;
      try { const st = lstatSync(join(d, a.id)); if (!st.isFile()) continue; size = st.size; } catch { missing = true; }
      out.push({ key, id: a.id, name: String(a.name ?? 'file'), mime: String(a.mime ?? 'application/octet-stream'), type: fileType(String(a.mime ?? '')), size, createdAt: String(a.createdAt ?? ''), missing, owner: ownerKind(key) });
    }
  }
  return out;
}
