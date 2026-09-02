import { sql } from "../../../core/db.js";

/** Every on/off setting the spec's `toggle` takes, and what it does by default. */
export const FLAGS = {
  math: false,
  repeat: false,
  deleteinvalid: false,
  deleteothers: false,
  editprotection: false,
  resetonfail: true,
  announceresets: true,
  announcerecords: true,
  pinmilestones: false,
} as const;

export type Flag = keyof typeof FLAGS;

export const FLAG_NAMES = Object.keys(FLAGS) as Flag[];

export interface Counting {
  channelId: string;
  current: number;
  step: number;
  lastUserId: string | null;
  lives: number;
  livesLeft: number;
  cooldownSecs: number;
  requiredRoleId: string | null;
  successEmoji: string;
  failEmoji: string;
  goalNumber: number | null;
  goalRoleId: string | null;
  goalMessage: string | null;
  milestoneInterval: number | null;
  milestoneTemplate: string | null;
  record: number;
  flags: Record<Flag, boolean>;
}

interface Row {
  channel_id: string;
  current: number;
  step: number;
  last_user_id: string | null;
  lives: number;
  lives_left: number;
  cooldown_secs: number;
  required_role_id: string | null;
  success_emoji: string;
  fail_emoji: string;
  goal_number: number | null;
  goal_role_id: string | null;
  goal_message: string | null;
  milestone_interval: number | null;
  milestone_template: string | null;
  record: number;
  flags: Record<string, boolean> | null;
}

function shape(row: Row): Counting {
  const flags = { ...FLAGS } as Record<Flag, boolean>;
  for (const name of FLAG_NAMES) {
    const held = row.flags?.[name];
    if (typeof held === "boolean") flags[name] = held;
  }

  return {
    channelId: row.channel_id,
    current: row.current,
    step: row.step,
    lastUserId: row.last_user_id,
    lives: row.lives,
    livesLeft: row.lives_left,
    cooldownSecs: row.cooldown_secs,
    requiredRoleId: row.required_role_id,
    successEmoji: row.success_emoji,
    failEmoji: row.fail_emoji,
    goalNumber: row.goal_number,
    goalRoleId: row.goal_role_id,
    goalMessage: row.goal_message,
    milestoneInterval: row.milestone_interval,
    milestoneTemplate: row.milestone_template,
    record: row.record,
    flags,
  };
}

const CACHE_MS = 15_000;

const cache = new Map<string, { held: Counting | null; at: number }>();

export function forget(channelId: string): void {
  cache.delete(channelId);
}

/**
 * The settings for one channel, cached briefly.
 *
 * This is read on every message in a counting channel, which is the busiest
 * thing about the feature, so a short cache keeps a fast conversation from
 * becoming a query per line. Fifteen seconds is short enough that a change
 * shows up while somebody is still looking at the card that made it.
 */
export async function countingIn(channelId: string): Promise<Counting | null> {
  const hit = cache.get(channelId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.held;

  let held: Counting | null;
  try {
    const rows = await sql<Row[]>`SELECT * FROM counting_channels WHERE channel_id = ${channelId}`;
    held = rows[0] ? shape(rows[0]) : null;
  } catch {
    return hit?.held ?? null;
  }

  cache.set(channelId, { held, at: Date.now() });
  return held;
}

export async function countingChannels(guildId: string): Promise<Counting[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM counting_channels WHERE guild_id = ${guildId} ORDER BY created_at
  `;
  return rows.map(shape);
}

export async function setup(
  guildId: string,
  channelId: string,
  start: number,
  step: number,
): Promise<void> {
  await sql`
    INSERT INTO counting_channels (guild_id, channel_id, current, step)
    VALUES (${guildId}, ${channelId}, ${start}, ${step})
    ON CONFLICT (channel_id) DO UPDATE SET current = EXCLUDED.current, step = EXCLUDED.step
  `;
  forget(channelId);
}

export type Field =
  | "current"
  | "step"
  | "lives"
  | "lives_left"
  | "cooldown_secs"
  | "required_role_id"
  | "success_emoji"
  | "fail_emoji"
  | "goal_number"
  | "goal_role_id"
  | "goal_message"
  | "milestone_interval"
  | "milestone_template"
  | "record"
  | "last_user_id";

export async function set(
  channelId: string,
  field: Field,
  value: string | number | null,
): Promise<void> {
  // The column comes from the union above, never from anything typed.
  await sql`
    UPDATE counting_channels SET ${sql(field)} = ${value as never} WHERE channel_id = ${channelId}
  `;
  forget(channelId);
}

export async function setFlag(channelId: string, flag: Flag, on: boolean): Promise<void> {
  // jsonb_set, not `||`. Passing the object as a parameter and casting it
  // sends a JSON *string*, and `jsonb_object || jsonb_string` concatenates into
  // an ARRAY rather than merging -- the flag is written, reads back as nothing,
  // and every toggle silently does not work.
  await sql`
    UPDATE counting_channels
    SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), ARRAY[${flag}], to_jsonb(${on}::boolean), true)
    WHERE channel_id = ${channelId}
  `;
  forget(channelId);
}

/** Sets the count and who counted last in one statement, on the message path. */
export async function advance(
  channelId: string,
  current: number,
  userId: string,
  record: number,
): Promise<void> {
  await sql`
    UPDATE counting_channels
    SET current = ${current}, last_user_id = ${userId}, record = GREATEST(record, ${record})
    WHERE channel_id = ${channelId}
  `;
  forget(channelId);
}

export async function reset(channelId: string, to: number, lives: number): Promise<void> {
  await sql`
    UPDATE counting_channels
    SET current = ${to}, last_user_id = NULL, lives_left = ${lives}
    WHERE channel_id = ${channelId}
  `;
  forget(channelId);
}

export async function stop(channelId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM counting_channels WHERE channel_id = ${channelId} RETURNING channel_id`;
  await sql`DELETE FROM counting_scores WHERE channel_id = ${channelId}`;
  forget(channelId);
  return rows.length > 0;
}

/** One count by one member, and when, for the score board and the cooldown. */
export async function score(channelId: string, userId: string): Promise<void> {
  await sql`
    INSERT INTO counting_scores (channel_id, user_id, counts, last_at)
    VALUES (${channelId}, ${userId}, 1, now())
    ON CONFLICT (channel_id, user_id)
      DO UPDATE SET counts = counting_scores.counts + 1, last_at = now()
  `;
}

export async function lastCountAt(channelId: string, userId: string): Promise<Date | null> {
  const rows = await sql<{ last_at: Date }[]>`
    SELECT last_at FROM counting_scores WHERE channel_id = ${channelId} AND user_id = ${userId}
  `;
  return rows[0]?.last_at ?? null;
}

export async function leaderboard(
  channelId: string,
  cap = 15,
): Promise<{ userId: string; counts: number }[]> {
  const rows = await sql<{ user_id: string; counts: number }[]>`
    SELECT user_id, counts FROM counting_scores
    WHERE channel_id = ${channelId} ORDER BY counts DESC LIMIT ${cap}
  `;
  return rows.map((row) => ({ userId: row.user_id, counts: row.counts }));
}
