import { sql } from "../../../core/db.js";

export interface ButtonRole {
  id: string;
  channelId: string;
  messageId: string;
  position: number;
  roleId: string;
  style: number;
  emoji: string | null;
  label: string | null;
}

/** Five per row, five rows: Discord's ceiling for one message. */
export const MAX_PER_MESSAGE = 25;

interface Row {
  id: string;
  channel_id: string;
  message_id: string;
  position: number;
  role_id: string;
  style: number;
  emoji: string | null;
  label: string | null;
}

const COLUMNS = sql`id, channel_id, message_id, position, role_id, style, emoji, label`;

function shape(row: Row): ButtonRole {
  return {
    id: String(row.id),
    channelId: row.channel_id,
    messageId: row.message_id,
    position: row.position,
    roleId: row.role_id,
    style: row.style,
    emoji: row.emoji,
    label: row.label,
  };
}

export async function rolesOn(messageId: string): Promise<ButtonRole[]> {
  const rows = await sql<Row[]>`
    SELECT ${COLUMNS} FROM button_roles WHERE message_id = ${messageId} ORDER BY position, id
  `;
  return rows.map(shape);
}

export async function roleButtonById(id: string): Promise<ButtonRole | null> {
  const rows = await sql<Row[]>`SELECT ${COLUMNS} FROM button_roles WHERE id = ${id}`;
  return rows[0] ? shape(rows[0]) : null;
}

export async function rolesIn(guildId: string): Promise<ButtonRole[]> {
  const rows = await sql<Row[]>`
    SELECT ${COLUMNS} FROM button_roles WHERE guild_id = ${guildId}
    ORDER BY message_id, position, id
  `;
  return rows.map(shape);
}

/**
 * The message this channel's button roles were last put on.
 *
 * Derived rather than remembered, so it survives a restart and two people
 * working at once cannot overwrite each other's idea of "the message".
 */
export async function latestIn(guildId: string, channelId: string): Promise<string | null> {
  const rows = await sql<{ message_id: string }[]>`
    SELECT message_id FROM button_roles
    WHERE guild_id = ${guildId} AND channel_id = ${channelId}
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0]?.message_id ?? null;
}

export async function addRoleButton(
  guildId: string,
  channelId: string,
  messageId: string,
  one: { roleId: string; style: number; emoji: string | null; label: string | null },
): Promise<number> {
  const rows = await sql<{ position: number }[]>`
    INSERT INTO button_roles (guild_id, channel_id, message_id, position, role_id, style, emoji, label)
    SELECT ${guildId}, ${channelId}, ${messageId},
           COALESCE(MAX(position), 0) + 1,
           ${one.roleId}, ${one.style}, ${one.emoji}, ${one.label}
    FROM button_roles WHERE message_id = ${messageId}
    RETURNING position
  `;
  return rows[0]?.position ?? 1;
}

export async function removeRoleButton(id: string): Promise<void> {
  await sql`DELETE FROM button_roles WHERE id = ${id}`;
}

export async function clearMessage(messageId: string): Promise<number> {
  const rows = await sql`DELETE FROM button_roles WHERE message_id = ${messageId} RETURNING id`;
  return rows.length;
}

export async function clearGuild(
  guildId: string,
): Promise<{ removed: number; messages: { channelId: string; messageId: string }[] }> {
  // The channel comes back with the delete rather than being looked up after
  // it: once the rows are gone nothing remembers where each message lived, and
  // every re-render would aim at whatever channel the command was typed in.
  const rows = await sql<{ channel_id: string; message_id: string }[]>`
    DELETE FROM button_roles WHERE guild_id = ${guildId} RETURNING channel_id, message_id
  `;
  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.message_id, row.channel_id);

  return {
    removed: rows.length,
    messages: [...seen.entries()].map(([messageId, channelId]) => ({ channelId, messageId })),
  };
}

/** Writes the given order back as positions 1..n, so the indexes stay dense. */
export async function reorder(ids: string[]): Promise<void> {
  for (let at = 0; at < ids.length; at += 1) {
    await sql`UPDATE button_roles SET position = ${at + 1} WHERE id = ${ids[at] as string}`;
  }
}
