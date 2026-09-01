import { sql } from "../../../core/db.js";

export const MODULES = [
  "massjoin",
  "newaccount",
  "avatar",
  "automation",
  "spam",
  "mentionspam",
  "raidspam",
] as const;

export type Module = (typeof MODULES)[number];

export const PUNISHMENTS = ["kick", "ban", "timeout"] as const;

export type Punishment = (typeof PUNISHMENTS)[number];

export interface Watch {
  on: boolean;
  /** How many it takes, or for `newaccount` how old an account must be. */
  threshold: number;
  windowMs: number;
  punishment: Punishment;
}

export interface Settings {
  modules: Record<Module, Watch>;
  alertChannel: string | null;
  /** How long invites stay paused once a raid trips it. */
  pauseMs: number;
  /** Set while somebody has switched the whole thing off for a while. */
  disabledUntil: number | null;
  /** Set while invites are paused, whether by a raid or by hand. */
  pausedUntil: number | null;
  whitelisted: Set<string>;
}

// The defaults are the numbers a server would pick anyway. `newaccount` counts
// days rather than events, which is why its threshold reads oddly next to the
// others.
const DEFAULTS: Record<Module, Watch> = {
  massjoin: { on: false, threshold: 10, windowMs: 60_000, punishment: "kick" },
  newaccount: { on: false, threshold: 3, windowMs: 0, punishment: "kick" },
  avatar: { on: false, threshold: 0, windowMs: 0, punishment: "kick" },
  automation: { on: false, threshold: 0, windowMs: 0, punishment: "kick" },
  spam: { on: false, threshold: 8, windowMs: 10_000, punishment: "timeout" },
  mentionspam: { on: false, threshold: 6, windowMs: 15_000, punishment: "timeout" },
  raidspam: { on: false, threshold: 12, windowMs: 10_000, punishment: "timeout" },
};

export const BOUNDS = {
  threshold: { least: 1, most: 200 },
  seconds: { least: 3, most: 3_600 },
  days: { least: 1, most: 365 },
  pause: { least: 60_000, most: 24 * 3_600_000 },
};

export const DEFAULT_PAUSE_MS = 10 * 60_000;

// Read on the join path and the message path both, so it is cached. Short,
// because a server under attack is changing these while it happens.
const CACHE_MS = 20_000;

const cache = new Map<string, { settings: Settings; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

function fresh(): Settings {
  return {
    modules: Object.fromEntries(MODULES.map((one) => [one, { ...DEFAULTS[one] }])) as Record<
      Module,
      Watch
    >,
    alertChannel: null,
    pauseMs: DEFAULT_PAUSE_MS,
    disabledUntil: null,
    pausedUntil: null,
    whitelisted: new Set(),
  };
}

export async function settingsFor(guildId: string): Promise<Settings> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;

  const settings = fresh();
  try {
    const [modules, config, whitelisted] = await Promise.all([
      sql<
        { module: string; enabled: boolean; threshold: number; window_ms: number; punishment: string }[]
      >`
        SELECT module, enabled, threshold, window_ms, punishment
        FROM antiraid WHERE guild_id = ${guildId}
      `,
      sql<
        { alert_channel: string | null; pause_ms: number; disabled_until: Date | null; paused_until: Date | null }[]
      >`
        SELECT alert_channel, pause_ms, disabled_until, paused_until
        FROM antiraid_config WHERE guild_id = ${guildId}
      `,
      sql<{ user_id: string }[]>`SELECT user_id FROM antiraid_whitelist WHERE guild_id = ${guildId}`,
    ]);

    for (const row of modules) {
      if (!(MODULES as readonly string[]).includes(row.module)) continue;
      settings.modules[row.module as Module] = {
        on: row.enabled,
        threshold: Number(row.threshold),
        windowMs: Number(row.window_ms),
        punishment: (PUNISHMENTS as readonly string[]).includes(row.punishment)
          ? (row.punishment as Punishment)
          : "kick",
      };
    }

    const one = config[0];
    if (one) {
      settings.alertChannel = one.alert_channel;
      settings.pauseMs = Number(one.pause_ms) || DEFAULT_PAUSE_MS;
      settings.disabledUntil = one.disabled_until ? one.disabled_until.getTime() : null;
      settings.pausedUntil = one.paused_until ? one.paused_until.getTime() : null;
    }
    settings.whitelisted = new Set(whitelisted.map((row) => row.user_id));
  } catch {
    // A database that will not answer must not switch protection on for a
    // server that never asked for it, nor off for one relying on it.
    return hit?.settings ?? fresh();
  }

  cache.set(guildId, { settings, at: Date.now() });
  return settings;
}

/** Whether the whole thing is switched off right now. */
export function sleeping(settings: Settings): boolean {
  return settings.disabledUntil !== null && settings.disabledUntil > Date.now();
}

export async function setModule(
  guildId: string,
  module: Module,
  patch: Partial<Watch>,
): Promise<Watch> {
  const held = (await settingsFor(guildId)).modules[module];
  const next: Watch = { ...held, ...patch };

  await sql`
    INSERT INTO antiraid (guild_id, module, enabled, threshold, window_ms, punishment)
    VALUES (${guildId}, ${module}, ${next.on}, ${next.threshold}, ${next.windowMs}, ${next.punishment})
    ON CONFLICT (guild_id, module) DO UPDATE SET
      enabled = ${next.on}, threshold = ${next.threshold},
      window_ms = ${next.windowMs}, punishment = ${next.punishment}
  `;
  forget(guildId);
  return next;
}

type Config = {
  alertChannel?: string | null;
  pauseMs?: number;
  disabledUntil?: Date | null;
  pausedUntil?: Date | null;
};

export async function setConfig(guildId: string, patch: Config): Promise<void> {
  const held = await settingsFor(guildId);
  const channel = patch.alertChannel !== undefined ? patch.alertChannel : held.alertChannel;
  const pause = patch.pauseMs ?? held.pauseMs;
  const disabled =
    patch.disabledUntil !== undefined
      ? patch.disabledUntil
      : held.disabledUntil
        ? new Date(held.disabledUntil)
        : null;
  const paused =
    patch.pausedUntil !== undefined
      ? patch.pausedUntil
      : held.pausedUntil
        ? new Date(held.pausedUntil)
        : null;

  await sql`
    INSERT INTO antiraid_config (guild_id, alert_channel, pause_ms, disabled_until, paused_until)
    VALUES (${guildId}, ${channel}, ${pause}, ${disabled}, ${paused})
    ON CONFLICT (guild_id) DO UPDATE SET
      alert_channel = ${channel}, pause_ms = ${pause},
      disabled_until = ${disabled}, paused_until = ${paused}
  `;
  forget(guildId);
}

export async function toggleWhitelist(guildId: string, userId: string): Promise<boolean> {
  const gone = await sql<{ user_id: string }[]>`
    DELETE FROM antiraid_whitelist WHERE guild_id = ${guildId} AND user_id = ${userId}
    RETURNING user_id
  `;
  if (gone.length > 0) {
    forget(guildId);
    return false;
  }
  await sql`INSERT INTO antiraid_whitelist (guild_id, user_id) VALUES (${guildId}, ${userId})`;
  forget(guildId);
  return true;
}

export async function whitelistOf(guildId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM antiraid_whitelist WHERE guild_id = ${guildId} ORDER BY user_id
  `;
  return rows.map((row) => row.user_id);
}
