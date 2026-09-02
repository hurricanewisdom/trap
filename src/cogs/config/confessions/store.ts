import { sql } from "../../../core/db.js";

export const DEFAULT_TEMPLATE = "**Confession #{number}**\n{content}";

export const DEFAULT_REPLY = "**Reply to #{number}**\n{content}";

export const DEFAULT_BUTTON = { style: 1, label: "Submit a confession" };

export const DEFAULT_REPLY_BUTTON = { style: 2, label: "Reply" };

export interface Settings {
  channelId: string | null;
  reviewChannelId: string | null;
  logChannelId: string | null;
  anonymous: boolean;
  minAccountAgeMs: number | null;
  cooldownMs: number | null;
  allowImages: boolean;
  allowLinks: boolean;
  filterOn: boolean;
  template: string;
  replyTemplate: string;
  buttonStyle: number;
  buttonLabel: string | null;
  replyButtonStyle: number;
  replyButtonLabel: string | null;
}

interface Row {
  channel_id: string | null;
  review_channel_id: string | null;
  log_channel_id: string | null;
  anonymous: boolean;
  min_account_age_ms: string | null;
  cooldown_ms: string | null;
  allow_images: boolean;
  allow_links: boolean;
  filter_on: boolean;
  template: string | null;
  reply_template: string | null;
  button_style: number;
  button_label: string | null;
  reply_button_style: number;
  reply_button_label: string | null;
}

const EMPTY: Settings = {
  channelId: null,
  reviewChannelId: null,
  logChannelId: null,
  anonymous: true,
  minAccountAgeMs: null,
  cooldownMs: null,
  allowImages: false,
  allowLinks: false,
  filterOn: true,
  template: DEFAULT_TEMPLATE,
  replyTemplate: DEFAULT_REPLY,
  buttonStyle: DEFAULT_BUTTON.style,
  buttonLabel: DEFAULT_BUTTON.label,
  replyButtonStyle: DEFAULT_REPLY_BUTTON.style,
  replyButtonLabel: DEFAULT_REPLY_BUTTON.label,
};

export async function settings(guildId: string): Promise<Settings> {
  const rows = await sql<Row[]>`SELECT * FROM confession_settings WHERE guild_id = ${guildId}`;
  const row = rows[0];
  if (!row) return EMPTY;

  return {
    channelId: row.channel_id,
    reviewChannelId: row.review_channel_id,
    logChannelId: row.log_channel_id,
    anonymous: row.anonymous,
    minAccountAgeMs: row.min_account_age_ms === null ? null : Number(row.min_account_age_ms),
    cooldownMs: row.cooldown_ms === null ? null : Number(row.cooldown_ms),
    allowImages: row.allow_images,
    allowLinks: row.allow_links,
    filterOn: row.filter_on,
    template: row.template ?? DEFAULT_TEMPLATE,
    replyTemplate: row.reply_template ?? DEFAULT_REPLY,
    buttonStyle: row.button_style,
    buttonLabel: row.button_label,
    replyButtonStyle: row.reply_button_style,
    replyButtonLabel: row.reply_button_label,
  };
}

/**
 * Every settable column, named once.
 *
 * The setter takes the column from this union, so nothing typed by a user ever
 * reaches the SQL as an identifier.
 */
export type Field =
  | "channel_id"
  | "review_channel_id"
  | "log_channel_id"
  | "anonymous"
  | "min_account_age_ms"
  | "cooldown_ms"
  | "allow_images"
  | "allow_links"
  | "filter_on"
  | "template"
  | "reply_template"
  | "button_style"
  | "button_label"
  | "reply_button_style"
  | "reply_button_label";

export async function set(
  guildId: string,
  field: Field,
  value: string | number | boolean | null,
): Promise<void> {
  await sql`
    INSERT INTO confession_settings (guild_id, ${sql(field)}, updated_at)
    VALUES (${guildId}, ${value as never}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET ${sql(field)} = EXCLUDED.${sql(field)}, updated_at = now()
  `;
}

/** blacklist, ping, review_ping and word all live in one list table. */
export type ListKind = "blacklist" | "ping" | "review_ping" | "word";

export async function listOf(guildId: string, kind: ListKind): Promise<string[]> {
  const rows = await sql<{ value: string }[]>`
    SELECT value FROM confession_lists
    WHERE guild_id = ${guildId} AND kind = ${kind} ORDER BY added_at
  `;
  return rows.map((row) => row.value);
}

export async function addTo(guildId: string, kind: ListKind, value: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO confession_lists (guild_id, kind, value) VALUES (${guildId}, ${kind}, ${value})
    ON CONFLICT (guild_id, kind, value) DO NOTHING RETURNING value
  `;
  return rows.length > 0;
}

export async function removeFrom(guildId: string, kind: ListKind, value: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM confession_lists
    WHERE guild_id = ${guildId} AND kind = ${kind} AND value = ${value} RETURNING value
  `;
  return rows.length > 0;
}

export async function clearList(guildId: string, kind: ListKind): Promise<number> {
  const rows = await sql`
    DELETE FROM confession_lists WHERE guild_id = ${guildId} AND kind = ${kind} RETURNING value
  `;
  return rows.length;
}

export interface Confession {
  id: string;
  number: number;
  userId: string;
  content: string;
  messageId: string | null;
  createdAt: Date;
}

/**
 * Numbers are handed out per guild by the insert itself.
 *
 * Counting the rows and adding one would give two confessions submitted at the
 * same moment the same number; taking the max inside the statement does not.
 */
export async function record(
  guildId: string,
  userId: string,
  content: string,
): Promise<Confession> {
  const rows = await sql<
    { id: string; number: number; user_id: string; content: string; message_id: string | null; created_at: Date }[]
  >`
    INSERT INTO confessions (guild_id, number, user_id, content)
    SELECT ${guildId},
           COALESCE(MAX(number), 0) + 1,
           ${userId}, ${content}
    FROM confessions WHERE guild_id = ${guildId}
    RETURNING id, number, user_id, content, message_id, created_at
  `;
  const row = rows[0] as NonNullable<(typeof rows)[0]>;
  return {
    id: String(row.id),
    number: row.number,
    userId: row.user_id,
    content: row.content,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

export async function confessionById(id: string): Promise<Confession | null> {
  const rows = await sql<
    { id: string; number: number; user_id: string; content: string; message_id: string | null; created_at: Date }[]
  >`SELECT id, number, user_id, content, message_id, created_at FROM confessions WHERE id = ${id}`;
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        number: row.number,
        userId: row.user_id,
        content: row.content,
        messageId: row.message_id,
        createdAt: row.created_at,
      }
    : null;
}

export async function attachMessage(id: string, messageId: string): Promise<void> {
  await sql`UPDATE confessions SET message_id = ${messageId} WHERE id = ${id}`;
}

export async function drop(id: string): Promise<void> {
  await sql`DELETE FROM confessions WHERE id = ${id}`;
}

/** When this member last submitted, for the cooldown. */
export async function lastSubmission(guildId: string, userId: string): Promise<Date | null> {
  const rows = await sql<{ created_at: Date }[]>`
    SELECT created_at FROM confessions
    WHERE guild_id = ${guildId} AND user_id = ${userId}
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0]?.created_at ?? null;
}
