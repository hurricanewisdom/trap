import { Redis } from "ioredis";
import { optional, optionalInt, required } from "./env.js";

export const redis = new Redis({
  host: optional("REDIS_HOST", "127.0.0.1"),
  port: optionalInt("REDIS_PORT", 6379),
  password: required("REDIS_PASSWORD"),
  db: optionalInt("REDIS_DB", 1),
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  connectTimeout: 5000,
  lazyConnect: false,
});

redis.on("error", (err: Error) => {
  console.error("redis:", err.message);
});

export const keys = {
  linkState: (state: string) => `trap:lf:state:${state}`,
  user: (discordId: string) => `trap:lf:user:${discordId}`,
} as const;

export const TTL = {
  linkState: 600,
  user: 3600,
} as const;

export async function closeRedis(): Promise<void> {
  await redis.quit().catch(() => redis.disconnect());
}
