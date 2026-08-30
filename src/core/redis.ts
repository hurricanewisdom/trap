/**
 * Redis: short-lived link states and a read cache in front of Postgres.
 *
 * A dedicated logical database keeps these keys away from the other app on
 * this host, and every key written here carries a TTL — the server runs
 * `maxmemory-policy noeviction`, so nothing may accumulate without expiry.
 */

import { Redis } from "ioredis";
import { optional, optionalInt, required } from "./env.js";

export const redis = new Redis({
  host: optional("REDIS_HOST", "127.0.0.1"),
  port: optionalInt("REDIS_PORT", 6379),
  password: required("REDIS_PASSWORD"),
  db: optionalInt("REDIS_DB", 1),
  /**
   * Commands issued during the initial connect or a reconnect are queued
   * briefly rather than rejected outright; `maxRetriesPerRequest` still bounds
   * how long a command can be in flight, so a dead Redis fails fast instead of
   * hanging. Reads fall back to Postgres on error either way.
   */
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  connectTimeout: 5000,
  lazyConnect: false,
});

redis.on("error", (err: Error) => {
  // Cache problems must never be fatal; the DB path still works.
  console.error("redis:", err.message);
});

export const keys = {
  /** Pending Last.fm authorisation, holding the Discord id that started it. */
  linkState: (state: string) => `trap:lf:state:${state}`,
  /** Cached Last.fm username for a Discord user; "" means known-not-linked. */
  user: (discordId: string) => `trap:lf:user:${discordId}`,
} as const;

export const TTL = {
  /** Long enough to authorise in a browser, short enough to limit replay. */
  linkState: 600,
  user: 3600,
} as const;

export async function closeRedis(): Promise<void> {
  await redis.quit().catch(() => redis.disconnect());
}
