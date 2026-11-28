/**
 * Staff presence for the customer support desk ("Online" only when someone is really there).
 *
 * Redis keys (all with a TTL, so a crashed browser or phone simply drops off):
 *   se:presence:seen:<userId>  → "1", TTL 120 s. Refreshed by the staff live stream (every ping), the web app heartbeat and the
 *                                 Available/Away toggle. Missing = not connected.
 *   se:presence:away:<userId>  → "manual" (TTL 16 h, set by the Away toggle) or "auto" (TTL 150 s, kept alive by idle heartbeats
 *                                 from the web app; the user came back as soon as an active heartbeat clears it).
 *
 * A person counts as available when they are connected, not away, and can use the Customer support inbox (never China,
 * never suppliers: the caller supplies only those ids). The public answer is a single boolean: no names, no counts.
 */
import type { Bus } from './bus.js';

export const PRESENCE_SEEN_TTL = 120;
export const PRESENCE_MANUAL_AWAY_TTL = 16 * 3600;
export const PRESENCE_AUTO_AWAY_TTL = 150;
export const PUBLIC_ONLINE_CACHE_MS = 10_000;

const seenKey = (id: string) => `se:presence:seen:${id}`;
const awayKey = (id: string) => `se:presence:away:${id}`;

export type PresenceState = 'available' | 'away' | 'offline';

export class Presence {
  private cache: { at: number; online: boolean } | null = null;
  constructor(private bus: Bus, private supportStaffIds: () => Promise<string[]>) {}

  /** The user has a live connection or sent a heartbeat. `active:false` = idle (auto-away); `active:true` clears auto-away. */
  async touch(userId: string, opts: { active?: boolean } = {}) {
    await this.bus.set(seenKey(userId), '1', PRESENCE_SEEN_TTL);
    if (opts.active === false) {
      if ((await this.bus.get(awayKey(userId))) !== 'manual') await this.bus.set(awayKey(userId), 'auto', PRESENCE_AUTO_AWAY_TTL);
    } else if (opts.active === true) {
      if ((await this.bus.get(awayKey(userId))) === 'auto') await this.bus.del(awayKey(userId));
    }
    this.cache = null;
  }

  async setAway(userId: string, away: boolean) {
    if (away) await this.bus.set(awayKey(userId), 'manual', PRESENCE_MANUAL_AWAY_TTL);
    else await this.bus.del(awayKey(userId));
    await this.bus.set(seenKey(userId), '1', PRESENCE_SEEN_TTL);
    this.cache = null;
  }

  async stateOf(userId: string): Promise<{ state: PresenceState; away: 'manual' | 'auto' | null }> {
    const away = (await this.bus.get(awayKey(userId))) as 'manual' | 'auto' | null;
    const seen = await this.bus.get(seenKey(userId));
    if (away) return { state: 'away', away };
    return { state: seen ? 'available' : 'offline', away: null };
  }

  /** True when at least one eligible, connected, non-away staff member exists. Cached for a few seconds. */
  async anyOnline(): Promise<boolean> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < PUBLIC_ONLINE_CACHE_MS) return this.cache.online;
    let online = false;
    try {
      for (const id of await this.supportStaffIds()) {
        if ((await this.stateOf(id)).state === 'available') { online = true; break; }
      }
    } catch { online = false; }
    this.cache = { at: now, online };
    return online;
  }
}
