/**
 * Cross-origin embed of the customer support chat for partner sites that share the
 * Source Easy "Customer support" desk (today: the Fortune Engineering website).
 *
 * - Only origins on an explicit allowlist get CORS headers; everything else is refused.
 *   No cookies and no credentials: the widget keeps a signed visitor token in its own
 *   localStorage and sends it in the `X-Support-Token` header.
 * - Tokens are scoped to one site: `v1.<site>.<random>.<hmac(site, random)>`. Only the hash of
 *   the random part is stored, and the visitor row is tagged with its site, so a token minted
 *   for one site is rejected on another (and Source Easy cookies never work here).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SourceSite } from './support-chat.js';
import { newVisitorToken } from './support-chat.js';

export const EMBED_TOKEN_HEADER = 'x-support-token';
export const EMBED_PREFIX = '/api/embed/support';
export const EMBED_MAX_MESSAGE = 2000;
export const EMBED_MAX_LINKS = 3;
export const EMBED_IP_MESSAGES_PER_WINDOW = 60;

/** Default allowlist. Override with SUPPORT_EMBED_ORIGINS="https://a.example=fortune_engineering,...". */
export const DEFAULT_EMBED_ORIGINS = 'https://fortuneengineering.in=fortune_engineering,https://www.fortuneengineering.in=fortune_engineering';

const EMBED_SITES: readonly SourceSite[] = ['fortune_engineering'];

/** Parses the allowlist into exact origin → site. Only https origins (http only for localhost in dev/tests). */
export function parseEmbedOrigins(spec: string | undefined | null): Map<string, SourceSite> {
  const out = new Map<string, SourceSite>();
  for (const part of String(spec ?? '').split(',')) {
    const [rawOrigin, rawSite] = part.split('=').map((x) => (x ?? '').trim());
    if (!rawOrigin || !rawSite) continue;
    if (!EMBED_SITES.includes(rawSite as SourceSite)) continue;
    let u: URL;
    try { u = new URL(rawOrigin); } catch { continue; }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) continue;
    if (u.origin === 'null' || rawOrigin.includes('*')) continue;
    out.set(u.origin.toLowerCase(), rawSite as SourceSite);
  }
  return out;
}

const keyOf = (secret: string) => createHmac('sha256', secret).update('support-embed-token:v1').digest();
const sign = (secret: string, site: SourceSite, raw: string) =>
  createHmac('sha256', keyOf(secret)).update(`${site}:${raw}`).digest('base64url').slice(0, 43);

export function issueEmbedToken(secret: string, site: SourceSite, raw = newVisitorToken()) {
  return { token: `v1.${site}.${raw}.${sign(secret, site, raw)}`, raw };
}

/** Returns the random part if the token is well-formed, correctly signed and issued for `site`; otherwise null. */
export function readEmbedToken(secret: string, site: SourceSite, token: string | string[] | undefined | null): string | null {
  const t = Array.isArray(token) ? token[0] : token;
  if (!t || typeof t !== 'string' || t.length > 200) return null;
  const parts = t.split('.');
  if (parts.length !== 4) return null;
  const [v, s, raw, sig] = parts as [string, string, string, string];
  if (v !== 'v1' || s !== site || !/^[A-Za-z0-9_-]{20,64}$/.test(raw)) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(secret, site, raw));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return raw;
}

/** Crude link-spam check for guest messages. */
export const linkCount = (s: string) => (s.match(/https?:\/\/|www\./gi) ?? []).length;
