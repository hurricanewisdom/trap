import { sql } from "../../../core/db.js";

export interface Setup {
  enabled: boolean;
  channelId: string | null;
  unpin: boolean;
}

export const OFF: Setup = { enabled: false, channelId: null, unpin: true };

const CACHE_MS = 60_000;

const cache = new Map<string, { setup: Setup; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function setup(guildId: string): Promise<Setup> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.setup;

  let held: Setup;
  try {
    const rows = await sql<{ enabled: boolean; channel_id: string | null; unpin: boolean }[]>`
      SELECT enabled, channel_id, unpin FROM pin_archive WHERE guild_id = ${guildId}
    `;
    const row = rows[0];
    held = row ? { enabled: row.enabled, channelId: row.channel_id, unpin: row.unpin } : { ...OFF };
  } catch {
    return hit?.setup ?? { ...OFF };
  }

  cache.set(guildId, { setup: held, at: Date.now() });
  return held;
}

export async function save(guildId: string, patch: Partial<Setup>): Promise<Setup> {
  const held = await setup(guildId);
  const next: Setup = { ...held, ...patch };

  await sql`
    INSERT INTO pin_archive (guild_id, enabled, channel_id, unpin, updated_at)
    VALUES (${guildId}, ${next.enabled}, ${next.channelId}, ${next.unpin}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET enabled = EXCLUDED.enabled, channel_id = EXCLUDED.channel_id,
          unpin = EXCLUDED.unpin, updated_at = now()
  `;
  forget(guildId);
  return next;
}

export async function reset(guildId: string): Promise<boolean> {
  const gone = await sql`
    DELETE FROM pin_archive WHERE guild_id = ${guildId} RETURNING guild_id
  `;
  forget(guildId);
  return gone.length > 0;
}
