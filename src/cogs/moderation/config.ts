import { sql } from "../../core/db.js";

export interface ModConfig {
  jailRole: string | null;
  jailChannel: string | null;
  muteRole: string | null;
  imuteRole: string | null;
  rmuteRole: string | null;
  lockRole: string | null;
  logChannel: string | null;
  banPurge: number;
}

export const BLANK: ModConfig = {
  jailRole: null,
  jailChannel: null,
  muteRole: null,
  imuteRole: null,
  rmuteRole: null,
  lockRole: null,
  logChannel: null,
  banPurge: 0,
};

const CACHE_MS = 60_000;

const cache = new Map<string, { held: ModConfig; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

interface Row {
  jail_role: string | null;
  jail_channel: string | null;
  mute_role: string | null;
  imute_role: string | null;
  rmute_role: string | null;
  lock_role: string | null;
  log_channel: string | null;
  ban_purge: number;
}

export async function config(guildId: string): Promise<ModConfig> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.held;

  let held: ModConfig;
  try {
    const rows = await sql<Row[]>`
      SELECT jail_role, jail_channel, mute_role, imute_role, rmute_role,
             lock_role, log_channel, ban_purge
      FROM mod_config WHERE guild_id = ${guildId}
    `;
    const row = rows[0];
    held = row
      ? {
          jailRole: row.jail_role,
          jailChannel: row.jail_channel,
          muteRole: row.mute_role,
          imuteRole: row.imute_role,
          rmuteRole: row.rmute_role,
          lockRole: row.lock_role,
          logChannel: row.log_channel,
          banPurge: Number(row.ban_purge),
        }
      : { ...BLANK };
  } catch {
    return hit?.held ?? { ...BLANK };
  }

  cache.set(guildId, { held, at: Date.now() });
  return held;
}

// Deliberately does not touch next_case: the case counter lives in the same row,
// and writing the whole row back from a cached copy would hand out a number twice.
export async function saveConfig(guildId: string, patch: Partial<ModConfig>): Promise<ModConfig> {
  const next: ModConfig = { ...(await config(guildId)), ...patch };

  await sql`
    INSERT INTO mod_config (guild_id, jail_role, jail_channel, mute_role, imute_role,
                            rmute_role, lock_role, log_channel, ban_purge, updated_at)
    VALUES (${guildId}, ${next.jailRole}, ${next.jailChannel}, ${next.muteRole},
            ${next.imuteRole}, ${next.rmuteRole}, ${next.lockRole}, ${next.logChannel},
            ${next.banPurge}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET jail_role = EXCLUDED.jail_role, jail_channel = EXCLUDED.jail_channel,
          mute_role = EXCLUDED.mute_role, imute_role = EXCLUDED.imute_role,
          rmute_role = EXCLUDED.rmute_role, lock_role = EXCLUDED.lock_role,
          log_channel = EXCLUDED.log_channel, ban_purge = EXCLUDED.ban_purge,
          updated_at = now()
  `;
  forget(guildId);
  return next;
}
