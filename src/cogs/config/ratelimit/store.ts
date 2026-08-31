import { sql } from "../../../core/db.js";
import { DEFAULTS, type Limits } from "../../../core/throttle.js";

// Read on the command path, so it is cached. A miss costs one query per server
// per minute; a hit costs nothing.
const CACHE_MS = 60_000;

const cache = new Map<string, { limits: Limits; at: number }>();

// Bounds, not preferences. Below these the bot answers nobody; above them the
// limit stops being one.
export const BOUNDS = {
  perUser: { least: 1, most: 60 },
  perGuild: { least: 5, most: 1000 },
  seconds: { least: 3, most: 120 },
};

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function limits(guildId: string): Promise<Limits> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.limits;

  let held: Limits;
  try {
    const rows = await sql<
      { per_user: number; per_guild: number; window_ms: number; enabled: boolean }[]
    >`
      SELECT per_user, per_guild, window_ms, enabled FROM rate_limits WHERE guild_id = ${guildId}
    `;
    const row = rows[0];
    held = row
      ? {
          perUser: Number(row.per_user),
          perGuild: Number(row.per_guild),
          windowMs: Number(row.window_ms),
          on: row.enabled,
        }
      : { ...DEFAULTS };
  } catch {
    return hit?.limits ?? { ...DEFAULTS };
  }

  cache.set(guildId, { limits: held, at: Date.now() });
  return held;
}

export async function save(guildId: string, patch: Partial<Limits>): Promise<Limits> {
  const next: Limits = { ...(await limits(guildId)), ...patch };

  await sql`
    INSERT INTO rate_limits (guild_id, per_user, per_guild, window_ms, enabled, updated_at)
    VALUES (${guildId}, ${next.perUser}, ${next.perGuild}, ${next.windowMs}, ${next.on}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET per_user = EXCLUDED.per_user, per_guild = EXCLUDED.per_guild,
          window_ms = EXCLUDED.window_ms, enabled = EXCLUDED.enabled, updated_at = now()
  `;
  forget(guildId);
  return next;
}

export async function reset(guildId: string): Promise<Limits> {
  await sql`DELETE FROM rate_limits WHERE guild_id = ${guildId}`;
  forget(guildId);
  return { ...DEFAULTS };
}
