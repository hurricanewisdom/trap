import { sql } from "../../../core/db.js";

export interface Config {
  enabled: boolean;
  channelId: string | null;
  message: string | null;
}

export const OFF: Config = { enabled: false, channelId: null, message: null };

export const DEFAULT_MESSAGE = "{user} put the server tag on. Thank you!";

const CACHE_MS = 60_000;

const cache = new Map<string, { config: Config; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function config(guildId: string): Promise<Config> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.config;

  let held: Config;
  try {
    const rows = await sql<{ enabled: boolean; channel_id: string | null; message: string | null }[]>`
      SELECT enabled, channel_id, message FROM badge_config WHERE guild_id = ${guildId}
    `;
    const row = rows[0];
    held = row
      ? { enabled: row.enabled, channelId: row.channel_id, message: row.message }
      : { ...OFF };
  } catch {
    return hit?.config ?? { ...OFF };
  }

  cache.set(guildId, { config: held, at: Date.now() });
  return held;
}

export async function save(guildId: string, patch: Partial<Config>): Promise<Config> {
  const next: Config = { ...(await config(guildId)), ...patch };

  await sql`
    INSERT INTO badge_config (guild_id, enabled, channel_id, message, updated_at)
    VALUES (${guildId}, ${next.enabled}, ${next.channelId}, ${next.message}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET enabled = EXCLUDED.enabled, channel_id = EXCLUDED.channel_id,
          message = EXCLUDED.message, updated_at = now()
  `;
  forget(guildId);
  return next;
}

export async function roles(guildId: string): Promise<string[]> {
  const rows = await sql<{ role_id: string }[]>`
    SELECT role_id FROM badge_roles WHERE guild_id = ${guildId} ORDER BY role_id
  `;
  return rows.map((row) => row.role_id);
}

export async function addRole(guildId: string, roleId: string): Promise<boolean> {
  const rows = await sql<{ role_id: string }[]>`
    INSERT INTO badge_roles (guild_id, role_id) VALUES (${guildId}, ${roleId})
    ON CONFLICT (guild_id, role_id) DO NOTHING
    RETURNING role_id
  `;
  return rows.length > 0;
}

export async function dropRole(guildId: string, roleId: string): Promise<boolean> {
  const rows = await sql<{ role_id: string }[]>`
    DELETE FROM badge_roles WHERE guild_id = ${guildId} AND role_id = ${roleId}
    RETURNING role_id
  `;
  return rows.length > 0;
}

// Who has already been thanked. Without this a sync would announce the same
// people every time it ran.
export async function awarded(guildId: string): Promise<Set<string>> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM badge_awarded WHERE guild_id = ${guildId}
  `;
  return new Set(rows.map((row) => row.user_id));
}

export async function markAwarded(guildId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await sql`
    INSERT INTO badge_awarded ${sql(userIds.map((user_id) => ({ guild_id: guildId, user_id })))}
    ON CONFLICT (guild_id, user_id) DO NOTHING
  `;
}

export async function forgetAwarded(guildId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await sql`
    DELETE FROM badge_awarded WHERE guild_id = ${guildId} AND user_id = ANY(${userIds})
  `;
}
