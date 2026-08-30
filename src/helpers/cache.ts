/**
 * Read-through caching for third-party lookups.
 *
 * Everything the bot fetches from Last.fm or iTunes is somebody else's rate
 * limit, and a 5x5 collage asks for twenty-five things at once.
 * The rules that make that safe are the same every time, so they live here:
 *
 *   - a miss is cached too, or a query with no answer is re-asked forever
 *   - Redis being down degrades to a live call, it never fails the command
 *   - a failed lookup is NOT cached, so a blip does not stick for a week
 */

import { redis } from "../core/redis.js";

/**
 * Stored in place of a genuine "no such thing", which is otherwise
 * indistinguishable from a cache miss. Not valid JSON, so it can never
 * collide with an encoded value.
 */
const MISS = "miss";

export interface CacheOptions {
  /** Seconds to keep a successful answer. */
  ttl: number;
  /** Seconds to keep "there is no such thing"; defaults to a shorter ttl. */
  missTtl?: number;
}

/**
 * Returns the cached value for `key`, or calls `load` and caches what it
 * returns. `load` returning null is a real answer and is remembered; `load`
 * throwing is not, and propagates to the caller uncached.
 */
export async function cached<T>(
  key: string,
  { ttl, missTtl = Math.min(ttl, 3600) }: CacheOptions,
  load: () => Promise<T | null>,
): Promise<T | null> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return hit === MISS ? null : (JSON.parse(hit) as T);
  } catch {
    // A cache that cannot be read is not a reason to fail; fall through.
  }

  const value = await load();

  try {
    const encoded = value === null ? MISS : JSON.stringify(value);
    await redis.set(key, encoded, "EX", value === null ? missTtl : ttl);
  } catch {
    // Likewise: failing to record the answer does not invalidate it.
  }

  return value;
}

/** Builds a cache key, lowercased and length-bounded so user input is safe. */
export function cacheKey(namespace: string, ...parts: (string | number)[]): string {
  const tail = parts
    .map((part) => String(part).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80))
    .join(":");
  return `trap:${namespace}:${tail}`;
}
