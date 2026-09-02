import { sql } from "../../../core/db.js";

/** `server` reads this guild; the rest read one account on one platform. */
export type Kind =
  | "server"
  | "youtube"
  | "soundcloud"
  | "soundcloudtrack"
  | "tiktok"
  | "twitch"
  | "spotify"
  | "instagram"
  | "twitter";

export interface Counter {
  channelId: string;
  kind: Kind;
  handle: string | null;
  template: string;
  lastName: string | null;
  updatedAt: Date | null;
}

/**
 * Discord allows **two channel renames per ten minutes**, measured rather than
 * read: the third PATCH comes back 429 with `retry-after: 600`. The documented
 * headers do not say so -- they report nine remaining on a ten second window --
 * so a counter that trusts them gets throttled and stops updating entirely.
 *
 * One pass every ten minutes leaves a rename in hand for `counter refresh`.
 */
export const CYCLE_MS = 10 * 60 * 1000;

export const MAX_PER_GUILD = 10;

interface Row {
  channel_id: string;
  kind: string;
  handle: string | null;
  template: string;
  last_name: string | null;
  updated_at: Date | null;
}

function shape(row: Row): Counter {
  return {
    channelId: row.channel_id,
    kind: row.kind as Kind,
    handle: row.handle,
    template: row.template,
    lastName: row.last_name,
    updatedAt: row.updated_at,
  };
}

export async function countersIn(guildId: string): Promise<Counter[]> {
  const rows = await sql<Row[]>`
    SELECT channel_id, kind, handle, template, last_name, updated_at
    FROM counters WHERE guild_id = ${guildId} ORDER BY created_at
  `;
  return rows.map(shape);
}

export async function counterFor(channelId: string): Promise<Counter | null> {
  const rows = await sql<Row[]>`
    SELECT channel_id, kind, handle, template, last_name, updated_at
    FROM counters WHERE channel_id = ${channelId}
  `;
  return rows[0] ? shape(rows[0]) : null;
}

/** Every counter in the bot, for the update cycle. */
export async function allCounters(): Promise<{ guildId: string; counter: Counter }[]> {
  const rows = await sql<(Row & { guild_id: string })[]>`
    SELECT guild_id, channel_id, kind, handle, template, last_name, updated_at
    FROM counters ORDER BY updated_at NULLS FIRST
  `;
  return rows.map((row) => ({ guildId: row.guild_id, counter: shape(row) }));
}

export async function setCounter(
  guildId: string,
  channelId: string,
  kind: Kind,
  handle: string | null,
  template: string,
): Promise<void> {
  await sql`
    INSERT INTO counters (guild_id, channel_id, kind, handle, template)
    VALUES (${guildId}, ${channelId}, ${kind}, ${handle}, ${template})
    ON CONFLICT (channel_id) DO UPDATE
      SET kind = EXCLUDED.kind, handle = EXCLUDED.handle, template = EXCLUDED.template
  `;
}

export async function markUpdated(channelId: string, name: string): Promise<void> {
  await sql`
    UPDATE counters SET last_name = ${name}, updated_at = now() WHERE channel_id = ${channelId}
  `;
}

export async function removeCounter(channelId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM counters WHERE channel_id = ${channelId} RETURNING channel_id`;
  return rows.length > 0;
}

export async function clearCounters(guildId: string): Promise<number> {
  const rows = await sql`DELETE FROM counters WHERE guild_id = ${guildId} RETURNING channel_id`;
  return rows.length;
}

/**
 * Joins today, kept as a per-day tally rather than a list of members.
 *
 * `{joins_today}` only ever needs the number, and a tally cannot grow without
 * bound the way a row per join would in a busy server.
 */
export async function noteJoin(guildId: string): Promise<void> {
  await sql`
    INSERT INTO counter_joins (guild_id, day, joins)
    VALUES (${guildId}, CURRENT_DATE, 1)
    ON CONFLICT (guild_id, day) DO UPDATE SET joins = counter_joins.joins + 1
  `;
}

export async function joinsToday(guildId: string): Promise<number> {
  const rows = await sql<{ joins: number }[]>`
    SELECT joins FROM counter_joins WHERE guild_id = ${guildId} AND day = CURRENT_DATE
  `;
  return rows[0]?.joins ?? 0;
}
