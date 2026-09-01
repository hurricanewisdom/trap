import { sql } from "../../core/db.js";

// Read before every action command, so it is cached. A miss costs one query per
// server per minute; a hit costs nothing.
const CACHE_MS = 60_000;

const cache = new Map<string, { on: boolean; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

// Off unless a row says otherwise. A server that has never heard of these
// commands should not suddenly have sixty-two of them.
export async function enabled(guildId: string): Promise<boolean> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.on;

  let on = false;
  try {
    const rows = await sql<{ enabled: boolean }[]>`
      SELECT enabled FROM roleplay WHERE guild_id = ${guildId}
    `;
    on = rows[0]?.enabled ?? false;
  } catch {
    // A database that will not answer must not accidentally turn these on.
    return hit?.on ?? false;
  }

  cache.set(guildId, { on, at: Date.now() });
  return on;
}

export async function setEnabled(guildId: string, on: boolean): Promise<void> {
  await sql`
    INSERT INTO roleplay (guild_id, enabled) VALUES (${guildId}, ${on})
    ON CONFLICT (guild_id) DO UPDATE SET enabled = ${on}
  `;
  cache.set(guildId, { on, at: Date.now() });
}
