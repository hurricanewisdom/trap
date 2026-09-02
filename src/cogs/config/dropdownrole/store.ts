import { sql } from "../../../core/db.js";

export interface DropdownRole {
  id: string;
  channelId: string;
  messageId: string;
  position: number;
  roleId: string;
  emoji: string | null;
  label: string | null;
  description: string | null;
}

/** Discord's ceiling for a string select. */
export const MAX_OPTIONS = 25;

export const MAX_PLACEHOLDER = 150;

interface Row {
  id: string;
  channel_id: string;
  message_id: string;
  position: number;
  role_id: string;
  emoji: string | null;
  label: string | null;
  description: string | null;
}

const COLUMNS = sql`id, channel_id, message_id, position, role_id, emoji, label, description`;

function shape(row: Row): DropdownRole {
  return {
    id: String(row.id),
    channelId: row.channel_id,
    messageId: row.message_id,
    position: row.position,
    roleId: row.role_id,
    emoji: row.emoji,
    label: row.label,
    description: row.description,
  };
}

export async function optionsOn(messageId: string): Promise<DropdownRole[]> {
  const rows = await sql<Row[]>`
    SELECT ${COLUMNS} FROM dropdown_roles WHERE message_id = ${messageId} ORDER BY position, id
  `;
  return rows.map(shape);
}

export async function optionsIn(guildId: string): Promise<DropdownRole[]> {
  const rows = await sql<Row[]>`
    SELECT ${COLUMNS} FROM dropdown_roles WHERE guild_id = ${guildId}
    ORDER BY message_id, position, id
  `;
  return rows.map(shape);
}

export async function latestIn(guildId: string, channelId: string): Promise<string | null> {
  const rows = await sql<{ message_id: string }[]>`
    SELECT message_id FROM dropdown_roles
    WHERE guild_id = ${guildId} AND channel_id = ${channelId}
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0]?.message_id ?? null;
}

export async function addOption(
  guildId: string,
  channelId: string,
  messageId: string,
  one: { roleId: string; emoji: string | null; label: string | null },
): Promise<number> {
  const rows = await sql<{ position: number }[]>`
    INSERT INTO dropdown_roles (guild_id, channel_id, message_id, position, role_id, emoji, label)
    SELECT ${guildId}, ${channelId}, ${messageId},
           COALESCE(MAX(position), 0) + 1,
           ${one.roleId}, ${one.emoji}, ${one.label}
    FROM dropdown_roles WHERE message_id = ${messageId}
    RETURNING position
  `;
  return rows[0]?.position ?? 1;
}

export async function setDescription(id: string, text: string | null): Promise<void> {
  await sql`UPDATE dropdown_roles SET description = ${text} WHERE id = ${id}`;
}

export async function removeOption(id: string): Promise<void> {
  await sql`DELETE FROM dropdown_roles WHERE id = ${id}`;
}

export async function clearMessage(messageId: string): Promise<number> {
  const rows = await sql`DELETE FROM dropdown_roles WHERE message_id = ${messageId} RETURNING id`;
  await sql`DELETE FROM dropdown_placeholders WHERE message_id = ${messageId}`;
  return rows.length;
}

export async function clearGuild(
  guildId: string,
): Promise<{ removed: number; messages: { channelId: string; messageId: string }[] }> {
  // The channel comes back with the delete: once the rows are gone nothing
  // remembers where each message lived, and every re-render would aim at
  // whatever channel the command was typed in.
  const rows = await sql<{ channel_id: string; message_id: string }[]>`
    DELETE FROM dropdown_roles WHERE guild_id = ${guildId} RETURNING channel_id, message_id
  `;
  await sql`DELETE FROM dropdown_placeholders WHERE guild_id = ${guildId}`;

  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.message_id, row.channel_id);

  return {
    removed: rows.length,
    messages: [...seen.entries()].map(([messageId, channelId]) => ({ channelId, messageId })),
  };
}

export async function reorder(ids: string[]): Promise<void> {
  for (let at = 0; at < ids.length; at += 1) {
    await sql`UPDATE dropdown_roles SET position = ${at + 1} WHERE id = ${ids[at] as string}`;
  }
}

export async function placeholderFor(messageId: string): Promise<string | null> {
  const rows = await sql<{ text: string }[]>`
    SELECT text FROM dropdown_placeholders WHERE message_id = ${messageId}
  `;
  return rows[0]?.text ?? null;
}

export async function setPlaceholder(
  guildId: string,
  messageId: string,
  text: string | null,
): Promise<void> {
  if (text === null) {
    await sql`DELETE FROM dropdown_placeholders WHERE message_id = ${messageId}`;
    return;
  }
  await sql`
    INSERT INTO dropdown_placeholders (guild_id, message_id, text)
    VALUES (${guildId}, ${messageId}, ${text})
    ON CONFLICT (message_id) DO UPDATE SET text = EXCLUDED.text
  `;
}
