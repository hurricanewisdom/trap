import { sql } from "../../../core/db.js";
import type { Embed } from "./embedcode.js";

export interface Page {
  pageId: number;
  embed: Embed;
}

export interface Pagination {
  guildId: string;
  channelId: string;
  messageId: string;
  current: number;
  pages: Page[];
}

export const MAX_PAGES = 25;

export const MAX_PAGINATIONS = 50;

let known: Set<string> | null = null;

async function ids(): Promise<Set<string>> {
  if (known) return known;
  try {
    const rows = await sql<{ message_id: string }[]>`SELECT message_id FROM paginations`;
    known = new Set(rows.map((row) => row.message_id));
  } catch {
    known = new Set();
  }
  return known;
}

export async function tracked(messageId: string): Promise<boolean> {
  return (await ids()).has(messageId);
}

function note(messageId: string): void {
  known?.add(messageId);
}

function drop(messageId: string): void {
  known?.delete(messageId);
}

function parse(body: string): Embed {
  try {
    return JSON.parse(body) as Embed;
  } catch {
    return {};
  }
}

export async function load(messageId: string): Promise<Pagination | null> {
  const rows = await sql<
    { guild_id: string; channel_id: string; message_id: string; current: number }[]
  >`SELECT guild_id, channel_id, message_id, current FROM paginations WHERE message_id = ${messageId}`;

  const held = rows[0];
  if (!held) return null;

  const pages = await sql<{ page_id: number; body: string }[]>`
    SELECT page_id, body FROM pagination_pages WHERE message_id = ${messageId} ORDER BY page_id
  `;

  return {
    guildId: held.guild_id,
    channelId: held.channel_id,
    messageId: held.message_id,
    current: held.current,
    pages: pages.map((row) => ({ pageId: row.page_id, embed: parse(row.body) })),
  };
}

export async function inGuild(guildId: string): Promise<Pagination[]> {
  const rows = await sql<
    { guild_id: string; channel_id: string; message_id: string; current: number }[]
  >`SELECT guild_id, channel_id, message_id, current FROM paginations WHERE guild_id = ${guildId} ORDER BY updated_at DESC`;

  const out: Pagination[] = [];
  for (const row of rows) {
    const pages = await sql<{ page_id: number; body: string }[]>`
      SELECT page_id, body FROM pagination_pages WHERE message_id = ${row.message_id} ORDER BY page_id
    `;
    out.push({
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      current: row.current,
      pages: pages.map((page) => ({ pageId: page.page_id, embed: parse(page.body) })),
    });
  }
  return out;
}

export async function create(
  guildId: string,
  channelId: string,
  messageId: string,
  first: Embed,
  authorId: string,
): Promise<void> {
  await sql`
    INSERT INTO paginations (guild_id, channel_id, message_id, current, created_by, updated_at)
    VALUES (${guildId}, ${channelId}, ${messageId}, 1, ${authorId}, now())
    ON CONFLICT (message_id) DO UPDATE SET updated_at = now()
  `;
  await sql`
    INSERT INTO pagination_pages (message_id, page_id, body)
    VALUES (${messageId}, 1, ${JSON.stringify(first)})
    ON CONFLICT (message_id, page_id) DO UPDATE SET body = EXCLUDED.body
  `;
  note(messageId);
}

export async function addPage(messageId: string, embed: Embed): Promise<number> {
  const rows = await sql<{ next: number }[]>`
    SELECT COALESCE(MAX(page_id), 0) + 1 AS next FROM pagination_pages WHERE message_id = ${messageId}
  `;
  const pageId = Number(rows[0]?.next ?? 1);

  await sql`
    INSERT INTO pagination_pages (message_id, page_id, body)
    VALUES (${messageId}, ${pageId}, ${JSON.stringify(embed)})
  `;
  await sql`UPDATE paginations SET updated_at = now() WHERE message_id = ${messageId}`;
  return pageId;
}

export async function updatePage(
  messageId: string,
  pageId: number,
  embed: Embed,
): Promise<boolean> {
  const done = await sql`
    UPDATE pagination_pages SET body = ${JSON.stringify(embed)}
    WHERE message_id = ${messageId} AND page_id = ${pageId}
    RETURNING page_id
  `;
  return done.length > 0;
}

export async function removePage(messageId: string, pageId: number): Promise<boolean> {
  const gone = await sql`
    DELETE FROM pagination_pages WHERE message_id = ${messageId} AND page_id = ${pageId}
    RETURNING page_id
  `;
  return gone.length > 0;
}

export async function setCurrent(messageId: string, current: number): Promise<void> {
  await sql`UPDATE paginations SET current = ${current} WHERE message_id = ${messageId}`;
}

export async function destroy(messageId: string): Promise<boolean> {
  const gone = await sql`
    DELETE FROM paginations WHERE message_id = ${messageId} RETURNING message_id
  `;
  await sql`DELETE FROM pagination_pages WHERE message_id = ${messageId}`;
  drop(messageId);
  return gone.length > 0;
}

export async function reset(guildId: string): Promise<number> {
  const gone = await sql<{ message_id: string }[]>`
    DELETE FROM paginations WHERE guild_id = ${guildId} RETURNING message_id
  `;
  for (const row of gone) {
    await sql`DELETE FROM pagination_pages WHERE message_id = ${row.message_id}`;
    drop(row.message_id);
  }
  return gone.length;
}

export async function count(guildId: string): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM paginations WHERE guild_id = ${guildId}
  `;
  return Number(rows[0]?.n ?? 0);
}
