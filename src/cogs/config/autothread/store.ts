import { sql } from "../../../core/db.js";

export interface Autothread {
  channelId: string;
  name: string;
  archiveMinutes: number;
  slowmodeSeconds: number;
  script: string | null;
  reactions: string[];
}

/** The only four Discord accepts, in minutes: an hour, a day, three days, a week. */
export const ARCHIVE_CHOICES = [60, 1440, 4320, 10080] as const;

export const DEFAULT_NAME = "{user.display}";

export const DEFAULT_ARCHIVE = 1440;

/** Discord's own ceiling for rate_limit_per_user, six hours. */
export const MAX_SLOWMODE = 21600;

/** Discord allows twenty reactions on a message; five is plenty and keeps the
 * per-message cost down, since each one is its own request. */
export const MAX_REACTIONS = 5;

export const MAX_CHANNELS = 25;

const CACHE_MS = 30_000;

const cache = new Map<string, { held: Map<string, Autothread>; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

/**
 * Every configured channel in a guild, keyed by channel id.
 *
 * The whole guild is loaded at once rather than one channel at a time, because
 * the read happens on the message path: a per-message query against a busy
 * channel is a query per message.
 */
export async function allThreads(guildId: string): Promise<Map<string, Autothread>> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.held;

  const held = new Map<string, Autothread>();
  try {
    const rows = await sql<
      {
        channel_id: string;
        name: string;
        archive_minutes: number;
        slowmode_seconds: number;
        script: string | null;
      }[]
    >`
      SELECT channel_id, name, archive_minutes, slowmode_seconds, script
      FROM autothread_channels WHERE guild_id = ${guildId}
    `;
    const reactions = await sql<{ channel_id: string; emoji: string }[]>`
      SELECT channel_id, emoji FROM autothread_reactions WHERE guild_id = ${guildId}
    `;

    for (const row of rows) {
      held.set(row.channel_id, {
        channelId: row.channel_id,
        name: row.name,
        archiveMinutes: row.archive_minutes,
        slowmodeSeconds: row.slowmode_seconds,
        script: row.script,
        reactions: reactions.filter((r) => r.channel_id === row.channel_id).map((r) => r.emoji),
      });
    }
  } catch {
    return hit?.held ?? new Map();
  }

  cache.set(guildId, { held, at: Date.now() });
  return held;
}

export async function threadFor(guildId: string, channelId: string): Promise<Autothread | null> {
  return (await allThreads(guildId)).get(channelId) ?? null;
}

export async function addChannel(
  guildId: string,
  channelId: string,
  name: string,
  archiveMinutes: number,
): Promise<void> {
  await sql`
    INSERT INTO autothread_channels (guild_id, channel_id, name, archive_minutes)
    VALUES (${guildId}, ${channelId}, ${name}, ${archiveMinutes})
    ON CONFLICT (guild_id, channel_id)
      DO UPDATE SET name = EXCLUDED.name, archive_minutes = EXCLUDED.archive_minutes
  `;
  forget(guildId);
}

type Field = "name" | "archive_minutes" | "slowmode_seconds" | "script";

/**
 * One setter for the four single-column edits.
 *
 * The column name is not interpolated from user input -- it comes from the
 * union above, so every call site names one of four literals and there is no
 * path from a typed argument to the SQL.
 */
export async function setField(
  guildId: string,
  channelId: string,
  field: Field,
  value: string | number | null,
): Promise<boolean> {
  const rows = await (field === "name"
    ? sql`UPDATE autothread_channels SET name = ${value as string} WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING channel_id`
    : field === "archive_minutes"
      ? sql`UPDATE autothread_channels SET archive_minutes = ${value as number} WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING channel_id`
      : field === "slowmode_seconds"
        ? sql`UPDATE autothread_channels SET slowmode_seconds = ${value as number} WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING channel_id`
        : sql`UPDATE autothread_channels SET script = ${value as string | null} WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING channel_id`);

  forget(guildId);
  return rows.length > 0;
}

export async function removeChannel(guildId: string, channelId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM autothread_channels
    WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING channel_id
  `;
  await sql`
    DELETE FROM autothread_reactions WHERE guild_id = ${guildId} AND channel_id = ${channelId}
  `;
  forget(guildId);
  return rows.length > 0;
}

export async function clearChannels(guildId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM autothread_channels WHERE guild_id = ${guildId} RETURNING channel_id
  `;
  await sql`DELETE FROM autothread_reactions WHERE guild_id = ${guildId}`;
  forget(guildId);
  return rows.length;
}

export async function addReactionTo(
  guildId: string,
  channelId: string,
  emoji: string,
): Promise<void> {
  await sql`
    INSERT INTO autothread_reactions (guild_id, channel_id, emoji)
    VALUES (${guildId}, ${channelId}, ${emoji})
    ON CONFLICT (guild_id, channel_id, emoji) DO NOTHING
  `;
  forget(guildId);
}

export async function removeReactionFrom(
  guildId: string,
  channelId: string,
  emoji: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM autothread_reactions
    WHERE guild_id = ${guildId} AND channel_id = ${channelId} AND emoji = ${emoji}
    RETURNING emoji
  `;
  forget(guildId);
  return rows.length > 0;
}

export async function clearReactionsFor(guildId: string, channelId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM autothread_reactions
    WHERE guild_id = ${guildId} AND channel_id = ${channelId} RETURNING emoji
  `;
  forget(guildId);
  return rows.length;
}
