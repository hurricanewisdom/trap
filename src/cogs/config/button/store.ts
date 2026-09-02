import { sql } from "../../../core/db.js";

export interface ResponseButton {
  id: string;
  channelId: string;
  messageId: string;
  position: number;
  style: number;
  emoji: string | null;
  label: string | null;
  script: string;
}

/** Five per row, five rows. Discord's ceiling, not ours. */
export const MAX_PER_MESSAGE = 25;

export const STYLES: Record<string, number> = {
  primary: 1,
  blurple: 1,
  secondary: 2,
  grey: 2,
  gray: 2,
  success: 3,
  green: 3,
  danger: 4,
  red: 4,
};

export function styleName(value: number): string {
  if (value === 1) return "primary";
  if (value === 3) return "success";
  if (value === 4) return "danger";
  return "secondary";
}

interface Row {
  id: string;
  channel_id: string;
  message_id: string;
  position: number;
  style: number;
  emoji: string | null;
  label: string | null;
  script: string;
}

function shape(row: Row): ResponseButton {
  return {
    id: String(row.id),
    channelId: row.channel_id,
    messageId: row.message_id,
    position: row.position,
    style: row.style,
    emoji: row.emoji,
    label: row.label,
    script: row.script,
  };
}

/** Every button on one message, in the order they are shown. */
export async function buttonsOn(messageId: string): Promise<ResponseButton[]> {
  const rows = await sql<Row[]>`
    SELECT id, channel_id, message_id, position, style, emoji, label, script
    FROM response_buttons WHERE message_id = ${messageId} ORDER BY position, id
  `;
  return rows.map(shape);
}

export async function buttonById(id: string): Promise<ResponseButton | null> {
  const rows = await sql<Row[]>`
    SELECT id, channel_id, message_id, position, style, emoji, label, script
    FROM response_buttons WHERE id = ${id}
  `;
  return rows[0] ? shape(rows[0]) : null;
}

export async function buttonsIn(guildId: string): Promise<ResponseButton[]> {
  const rows = await sql<Row[]>`
    SELECT id, channel_id, message_id, position, style, emoji, label, script
    FROM response_buttons WHERE guild_id = ${guildId} ORDER BY message_id, position, id
  `;
  return rows.map(shape);
}

/**
 * The message this guild's buttons were last put on in a channel.
 *
 * Every command takes the message as an optional argument, and this is what
 * fills it in: the most recently configured message in the channel you are
 * standing in. It is derived rather than remembered, so it survives a restart
 * and two people working at once do not overwrite each other's idea of "the
 * message".
 */
export async function latestIn(guildId: string, channelId: string): Promise<string | null> {
  const rows = await sql<{ message_id: string }[]>`
    SELECT message_id FROM response_buttons
    WHERE guild_id = ${guildId} AND channel_id = ${channelId}
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0]?.message_id ?? null;
}

export async function addButton(
  guildId: string,
  channelId: string,
  messageId: string,
  button: { style: number; emoji: string | null; label: string | null; script: string },
): Promise<number> {
  const rows = await sql<{ position: number }[]>`
    INSERT INTO response_buttons (guild_id, channel_id, message_id, position, style, emoji, label, script)
    SELECT ${guildId}, ${channelId}, ${messageId},
           COALESCE(MAX(position), 0) + 1,
           ${button.style}, ${button.emoji}, ${button.label}, ${button.script}
    FROM response_buttons WHERE message_id = ${messageId}
    RETURNING position
  `;
  return rows[0]?.position ?? 1;
}

type Field = "style" | "emoji" | "label" | "script";

export async function setField(
  id: string,
  field: Field,
  value: string | number | null,
): Promise<void> {
  // The column is chosen from the union above, never interpolated from input.
  if (field === "style") await sql`UPDATE response_buttons SET style = ${value as number} WHERE id = ${id}`;
  else if (field === "emoji") await sql`UPDATE response_buttons SET emoji = ${value as string | null} WHERE id = ${id}`;
  else if (field === "label") await sql`UPDATE response_buttons SET label = ${value as string | null} WHERE id = ${id}`;
  else await sql`UPDATE response_buttons SET script = ${value as string} WHERE id = ${id}`;
}

export async function removeButton(id: string): Promise<void> {
  await sql`DELETE FROM response_buttons WHERE id = ${id}`;
}

export async function clearMessage(messageId: string): Promise<number> {
  const rows = await sql`DELETE FROM response_buttons WHERE message_id = ${messageId} RETURNING id`;
  return rows.length;
}

export async function clearGuild(
  guildId: string,
): Promise<{ removed: number; messages: { channelId: string; messageId: string }[] }> {
  // The channel comes back with the delete rather than being looked up after
  // it: once the rows are gone there is nothing left that knows where each
  // message lived, and re-rendering would aim at the wrong channel.
  const rows = await sql<{ id: string; channel_id: string; message_id: string }[]>`
    DELETE FROM response_buttons WHERE guild_id = ${guildId} RETURNING id, channel_id, message_id
  `;

  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.message_id, row.channel_id);

  return {
    removed: rows.length,
    messages: [...seen.entries()].map(([messageId, channelId]) => ({ channelId, messageId })),
  };
}

/**
 * Writes the given order back as positions 1..n.
 *
 * Renumbering the whole message rather than nudging one row keeps the positions
 * dense: after a remove, the indexes a person reads off `button list` are the
 * indexes the other commands take.
 */
export async function reorder(ids: string[]): Promise<void> {
  for (let at = 0; at < ids.length; at += 1) {
    await sql`UPDATE response_buttons SET position = ${at + 1} WHERE id = ${ids[at] as string}`;
  }
}
