import { sql } from "../../../core/db.js";

export const STATUSES = ["pending", "considering", "progress", "approved", "denied"] as const;

export type Status = (typeof STATUSES)[number];

export interface Config {
  channelId: string | null;
  reviewId: string | null;
  locked: boolean;
  threads: boolean;
  review: boolean;
  upvote: string;
  downvote: string;
}

export const DEFAULTS: Config = {
  channelId: null,
  reviewId: null,
  locked: false,
  threads: false,
  review: false,
  upvote: "\u{1F44D}",
  downvote: "\u{1F44E}",
};

const CACHE_MS = 60_000;

const cache = new Map<string, { config: Config; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

interface Row {
  channel_id: string | null;
  review_id: string | null;
  locked: boolean;
  threads: boolean;
  review: boolean;
  upvote: string;
  downvote: string;
}

function shaped(row: Row): Config {
  return {
    channelId: row.channel_id,
    reviewId: row.review_id,
    locked: row.locked,
    threads: row.threads,
    review: row.review,
    upvote: row.upvote,
    downvote: row.downvote,
  };
}

export async function config(guildId: string): Promise<Config> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.config;

  let held: Config;
  try {
    const rows = await sql<Row[]>`
      SELECT channel_id, review_id, locked, threads, review, upvote, downvote
      FROM suggest_config WHERE guild_id = ${guildId}
    `;
    held = rows[0] ? shaped(rows[0]) : { ...DEFAULTS };
  } catch {
    return hit?.config ?? { ...DEFAULTS };
  }

  cache.set(guildId, { config: held, at: Date.now() });
  return held;
}

export async function saveConfig(guildId: string, patch: Partial<Config>): Promise<Config> {
  const next: Config = { ...(await config(guildId)), ...patch };

  await sql`
    INSERT INTO suggest_config (guild_id, channel_id, review_id, locked, threads, review,
                                upvote, downvote, updated_at)
    VALUES (${guildId}, ${next.channelId}, ${next.reviewId}, ${next.locked}, ${next.threads},
            ${next.review}, ${next.upvote}, ${next.downvote}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET channel_id = EXCLUDED.channel_id, review_id = EXCLUDED.review_id,
          locked = EXCLUDED.locked, threads = EXCLUDED.threads, review = EXCLUDED.review,
          upvote = EXCLUDED.upvote, downvote = EXCLUDED.downvote, updated_at = now()
  `;
  forget(guildId);
  return next;
}

// Numbers are per server and handed out by the database, not by counting rows:
// two people suggesting at the same moment would otherwise be given the same
// number, and the number is how every other command finds a suggestion.
export async function nextId(guildId: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO suggest_config (guild_id, next_id) VALUES (${guildId}, 2)
    ON CONFLICT (guild_id) DO UPDATE SET next_id = suggest_config.next_id + 1
    RETURNING next_id - 1 AS id
  `;
  forget(guildId);
  return Number(rows[0]?.id ?? 1);
}

export interface Suggestion {
  id: number;
  authorId: string;
  body: string;
  status: Status;
  channelId: string | null;
  messageId: string | null;
  threadId: string | null;
  reply: string | null;
  repliedBy: string | null;
}

interface SuggestionRow {
  id: number;
  author_id: string;
  body: string;
  status: string;
  channel_id: string | null;
  message_id: string | null;
  thread_id: string | null;
  reply: string | null;
  replied_by: string | null;
}

function asSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: Number(row.id),
    authorId: row.author_id,
    body: row.body,
    status: (STATUSES as readonly string[]).includes(row.status)
      ? (row.status as Status)
      : "pending",
    channelId: row.channel_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    reply: row.reply,
    repliedBy: row.replied_by,
  };
}

const COLUMNS = sql`id, author_id, body, status, channel_id, message_id, thread_id, reply, replied_by`;

export async function create(
  guildId: string,
  id: number,
  authorId: string,
  body: string,
): Promise<Suggestion> {
  await sql`
    INSERT INTO suggestions (guild_id, id, author_id, body)
    VALUES (${guildId}, ${id}, ${authorId}, ${body})
  `;
  return {
    id,
    authorId,
    body,
    status: "pending",
    channelId: null,
    messageId: null,
    threadId: null,
    reply: null,
    repliedBy: null,
  };
}

export async function find(guildId: string, id: number): Promise<Suggestion | null> {
  const rows = await sql<SuggestionRow[]>`
    SELECT ${COLUMNS} FROM suggestions WHERE guild_id = ${guildId} AND id = ${id}
  `;
  return rows[0] ? asSuggestion(rows[0]) : null;
}

export async function setStatus(
  guildId: string,
  id: number,
  status: Status,
): Promise<Suggestion | null> {
  const rows = await sql<SuggestionRow[]>`
    UPDATE suggestions SET status = ${status}
    WHERE guild_id = ${guildId} AND id = ${id}
    RETURNING ${COLUMNS}
  `;
  return rows[0] ? asSuggestion(rows[0]) : null;
}

export async function setReply(
  guildId: string,
  id: number,
  reply: string,
  by: string,
): Promise<Suggestion | null> {
  const rows = await sql<SuggestionRow[]>`
    UPDATE suggestions SET reply = ${reply}, replied_by = ${by}
    WHERE guild_id = ${guildId} AND id = ${id}
    RETURNING ${COLUMNS}
  `;
  return rows[0] ? asSuggestion(rows[0]) : null;
}

export async function setPosted(
  guildId: string,
  id: number,
  channelId: string,
  messageId: string,
  threadId: string | null,
): Promise<void> {
  await sql`
    UPDATE suggestions
    SET channel_id = ${channelId}, message_id = ${messageId}, thread_id = ${threadId}
    WHERE guild_id = ${guildId} AND id = ${id}
  `;
}

export interface Ignored {
  targetId: string;
  isRole: boolean;
}

// There is no unignore command, so this is a toggle: naming something already
// ignored takes it off the list again.
export async function toggleIgnore(
  guildId: string,
  targetId: string,
  isRole: boolean,
): Promise<boolean> {
  const gone = await sql<{ target_id: string }[]>`
    DELETE FROM suggest_ignores
    WHERE guild_id = ${guildId} AND target_id = ${targetId}
    RETURNING target_id
  `;
  if (gone.length > 0) return false;

  await sql`
    INSERT INTO suggest_ignores (guild_id, target_id, is_role)
    VALUES (${guildId}, ${targetId}, ${isRole})
    ON CONFLICT (guild_id, target_id) DO NOTHING
  `;
  return true;
}

export async function ignoredIn(guildId: string): Promise<Ignored[]> {
  const rows = await sql<{ target_id: string; is_role: boolean }[]>`
    SELECT target_id, is_role FROM suggest_ignores WHERE guild_id = ${guildId}
  `;
  return rows.map((row) => ({ targetId: row.target_id, isRole: row.is_role }));
}

export async function isIgnored(
  guildId: string,
  userId: string,
  roleIds: string[],
): Promise<boolean> {
  const held = await ignoredIn(guildId);
  if (held.length === 0) return false;

  const roles = new Set(roleIds);
  return held.some((one) => (one.isRole ? roles.has(one.targetId) : one.targetId === userId));
}
