import { redis } from "../core/redis.js";

const MISS = "miss";

export interface CacheOptions {
  ttl: number;
  missTtl?: number;
}

export async function cached<T>(
  key: string,
  { ttl, missTtl = Math.min(ttl, 3600) }: CacheOptions,
  load: () => Promise<T | null>,
): Promise<T | null> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return hit === MISS ? null : (JSON.parse(hit) as T);
  } catch {}

  const value = await load();

  try {
    const encoded = value === null ? MISS : JSON.stringify(value);
    await redis.set(key, encoded, "EX", value === null ? missTtl : ttl);
  } catch {}

  return value;
}

export function cacheKey(namespace: string, ...parts: (string | number)[]): string {
  const tail = parts
    .map((part) => String(part).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80))
    .join(":");
  return `trap:${namespace}:${tail}`;
}
