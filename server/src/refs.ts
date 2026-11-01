/**
 * One shared lead reference, SE-YYMM-NNNN. Generated only on the server, sequential per month,
 * never reused: the counter is persisted (write temp + fsync + rename) before a number is handed out,
 * and calls are serialised so two concurrent creations can never get the same number.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export const REF_RE = /^SE-(\d{4})-(\d{4,})$/;
export const formatRef = (yymm: string, n: number) => `SE-${yymm}-${String(n).padStart(4, '0')}`;
export const yymmOf = (d: Date) => `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export class RefCounter {
  private state: Record<string, number> = {};
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private file?: string) {
    if (file && existsSync(file)) this.state = JSON.parse(readFileSync(file, 'utf8'));
  }
  /** Never go below numbers already in use (e.g. after restoring Twenty without the counter file). */
  seen(ref: unknown) {
    const m = REF_RE.exec(String(ref ?? ''));
    if (m && Number(m[2]) > (this.state[m[1]] ?? 0)) { this.state[m[1]] = Number(m[2]); this.persist(); }
  }
  next(at = new Date()): Promise<string> {
    const p = this.chain.then(() => {
      const k = yymmOf(at), n = (this.state[k] ?? 0) + 1;
      this.state[k] = n; this.persist();
      return formatRef(k, n);
    });
    this.chain = p.catch(() => undefined);
    return p;
  }
  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`, fd = openSync(tmp, 'w', 0o600);
    try { writeSync(fd, JSON.stringify(this.state)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.file);
  }
}
