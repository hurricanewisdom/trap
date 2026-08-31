import { sql } from "../../../core/db.js";

export interface Settings {
  enabled: boolean;
  embed: boolean;
  strict: boolean;
  suppress: boolean;
  wipe: boolean;
  prefixed: boolean;
}

export const OFF: Settings = {
  enabled: false,
  embed: true,
  strict: false,
  suppress: true,
  wipe: false,
  prefixed: false,
};

const CACHE_MS = 60_000;

const cache = new Map<string, { settings: Settings; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function settings(guildId: string): Promise<Settings> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;

  let held: Settings;
  try {
    const rows = await sql<
      {
        enabled: boolean;
        embed: boolean;
        strict: boolean;
        suppress: boolean;
        wipe: boolean;
        prefixed: boolean;
      }[]
    >`
      SELECT enabled, embed, strict, suppress, wipe, prefixed
      FROM reposter WHERE guild_id = ${guildId}
    `;
    held = rows[0] ? { ...rows[0] } : { ...OFF };
  } catch {
    return hit?.settings ?? { ...OFF };
  }

  cache.set(guildId, { settings: held, at: Date.now() });
  return held;
}

export async function save(guildId: string, patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await settings(guildId)), ...patch };

  await sql`
    INSERT INTO reposter (guild_id, enabled, embed, strict, suppress, wipe, prefixed, updated_at)
    VALUES (${guildId}, ${next.enabled}, ${next.embed}, ${next.strict},
            ${next.suppress}, ${next.wipe}, ${next.prefixed}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET enabled = EXCLUDED.enabled, embed = EXCLUDED.embed, strict = EXCLUDED.strict,
          suppress = EXCLUDED.suppress, wipe = EXCLUDED.wipe, prefixed = EXCLUDED.prefixed,
          updated_at = now()
  `;
  forget(guildId);
  return next;
}
