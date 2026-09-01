import { sql } from "../../../core/db.js";

export const MODULES = [
  "ban",
  "kick",
  "channel",
  "role",
  "emoji",
  "webhook",
  "bot",
  "permissions",
  "webhookspam",
] as const;

export type Module = (typeof MODULES)[number];

export const PUNISHMENTS = ["ban", "kick", "stripstaff", "jail"] as const;

export type Punishment = (typeof PUNISHMENTS)[number];

export interface Watch {
  on: boolean;
  threshold: number;
  windowMs: number;
}

export interface Settings {
  modules: Record<Module, Watch>;
  punishment: Punishment;
  trusted: Set<string>;
  whitelisted: Set<string>;
  // Channels where webhook mass-mentions are somebody's announcement rather
  // than an attack. Only webhookspam reads this; the other modules act on the
  // server, not in a channel.
  spamExempt: Set<string>;
}

// A threshold of one means the first one is punished, which is what `bot` and
// `permissions` want: adding a bot or granting administrator is not something
// that needs to happen three times before it counts.
const DEFAULTS: Record<Module, Watch> = {
  ban: { on: false, threshold: 3, windowMs: 60_000 },
  kick: { on: false, threshold: 3, windowMs: 60_000 },
  channel: { on: false, threshold: 3, windowMs: 60_000 },
  role: { on: false, threshold: 3, windowMs: 60_000 },
  emoji: { on: false, threshold: 5, windowMs: 60_000 },
  webhook: { on: false, threshold: 3, windowMs: 60_000 },
  bot: { on: false, threshold: 1, windowMs: 60_000 },
  permissions: { on: false, threshold: 1, windowMs: 60_000 },
  webhookspam: { on: false, threshold: 5, windowMs: 30_000 },
};

export const BOUNDS = {
  threshold: { least: 1, most: 50 },
  seconds: { least: 5, most: 600 },
};

// Read on the path of every channel deletion and every role change, so it is
// cached. The cache is short because a server that has just been told it is
// under attack will be changing these settings while it happens.
const CACHE_MS = 30_000;

const cache = new Map<string, { settings: Settings; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

function fresh(): Settings {
  return {
    modules: Object.fromEntries(
      MODULES.map((one) => [one, { ...DEFAULTS[one] }]),
    ) as Record<Module, Watch>,
    punishment: "ban",
    trusted: new Set(),
    whitelisted: new Set(),
    spamExempt: new Set(),
  };
}

export async function settingsFor(guildId: string): Promise<Settings> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;

  const settings = fresh();
  try {
    const [modules, config, trusted, whitelisted, exempt] = await Promise.all([
      sql<{ module: string; enabled: boolean; threshold: number; window_ms: number }[]>`
        SELECT module, enabled, threshold, window_ms FROM antinuke WHERE guild_id = ${guildId}
      `,
      sql<{ punishment: string }[]>`
        SELECT punishment FROM antinuke_config WHERE guild_id = ${guildId}
      `,
      sql<{ user_id: string }[]>`SELECT user_id FROM antinuke_trust WHERE guild_id = ${guildId}`,
      sql<{ user_id: string }[]>`SELECT user_id FROM antinuke_whitelist WHERE guild_id = ${guildId}`,
      sql<{ channel_id: string }[]>`
        SELECT channel_id FROM antinuke_spam_exempt WHERE guild_id = ${guildId}
      `,
    ]);

    for (const row of modules) {
      if (!(MODULES as readonly string[]).includes(row.module)) continue;
      settings.modules[row.module as Module] = {
        on: row.enabled,
        threshold: Number(row.threshold),
        windowMs: Number(row.window_ms),
      };
    }
    const chosen = config[0]?.punishment;
    if (chosen && (PUNISHMENTS as readonly string[]).includes(chosen)) {
      settings.punishment = chosen as Punishment;
    }
    settings.trusted = new Set(trusted.map((row) => row.user_id));
    settings.whitelisted = new Set(whitelisted.map((row) => row.user_id));
    settings.spamExempt = new Set(exempt.map((row) => row.channel_id));
  } catch {
    // A database that will not answer must not switch protection on for a
    // server that never asked for it, nor off for one relying on it. The last
    // known answer is the least wrong of the three.
    return hit?.settings ?? fresh();
  }

  cache.set(guildId, { settings, at: Date.now() });
  return settings;
}

export async function setModule(
  guildId: string,
  module: Module,
  patch: Partial<Watch>,
): Promise<Watch> {
  const held = (await settingsFor(guildId)).modules[module];
  const next: Watch = { ...held, ...patch };

  await sql`
    INSERT INTO antinuke (guild_id, module, enabled, threshold, window_ms)
    VALUES (${guildId}, ${module}, ${next.on}, ${next.threshold}, ${next.windowMs})
    ON CONFLICT (guild_id, module)
    DO UPDATE SET enabled = ${next.on}, threshold = ${next.threshold}, window_ms = ${next.windowMs}
  `;
  forget(guildId);
  return next;
}

export async function setPunishment(guildId: string, punishment: Punishment): Promise<void> {
  await sql`
    INSERT INTO antinuke_config (guild_id, punishment) VALUES (${guildId}, ${punishment})
    ON CONFLICT (guild_id) DO UPDATE SET punishment = ${punishment}
  `;
  forget(guildId);
}

type Roll = "antinuke_trust" | "antinuke_whitelist";

/** Adding somebody already on a list takes them off it: these are toggles. */
export async function toggleOn(roll: Roll, guildId: string, userId: string): Promise<boolean> {
  const gone = await sql.unsafe(
    `DELETE FROM ${roll} WHERE guild_id = $1 AND user_id = $2 RETURNING user_id`,
    [guildId, userId],
  );
  if (gone.length > 0) {
    forget(guildId);
    return false;
  }
  await sql.unsafe(`INSERT INTO ${roll} (guild_id, user_id) VALUES ($1, $2)`, [guildId, userId]);
  forget(guildId);
  return true;
}

export async function clearList(roll: Roll, guildId: string): Promise<number> {
  const gone = await sql.unsafe(
    `DELETE FROM ${roll} WHERE guild_id = $1 RETURNING user_id`,
    [guildId],
  );
  forget(guildId);
  return gone.length;
}

export async function listOf(roll: Roll, guildId: string): Promise<string[]> {
  const rows = await sql.unsafe(
    `SELECT user_id FROM ${roll} WHERE guild_id = $1 ORDER BY user_id`,
    [guildId],
  );
  return (rows as unknown as { user_id: string }[]).map((row) => row.user_id);
}

/** A channel where webhook mass-mentions are allowed. Adding twice removes it. */
export async function toggleSpamExempt(guildId: string, channelId: string): Promise<boolean> {
  const gone = await sql<{ channel_id: string }[]>`
    DELETE FROM antinuke_spam_exempt WHERE guild_id = ${guildId} AND channel_id = ${channelId}
    RETURNING channel_id
  `;
  if (gone.length > 0) {
    forget(guildId);
    return false;
  }
  await sql`
    INSERT INTO antinuke_spam_exempt (guild_id, channel_id) VALUES (${guildId}, ${channelId})
  `;
  forget(guildId);
  return true;
}

export async function clearSpamExempt(guildId: string): Promise<number> {
  const gone = await sql<{ channel_id: string }[]>`
    DELETE FROM antinuke_spam_exempt WHERE guild_id = ${guildId} RETURNING channel_id
  `;
  forget(guildId);
  return gone.length;
}
