import { sql } from "../../../core/db.js";

export const MAX_ALIASES = 100;

const CACHE_MS = 60_000;

export interface Alias {
  shortcut: string;
  command: string;
}

interface Cached {
  map: Map<string, string>;
  at: number;
}

const cache = new Map<string, Cached>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function aliasesFor(guildId: string): Promise<Map<string, string>> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.map;

  let rows: Alias[] = [];
  try {
    rows = await sql<Alias[]>`
      SELECT shortcut, command FROM command_aliases WHERE guild_id = ${guildId}
    `;
  } catch {
    return hit?.map ?? new Map();
  }

  const map = new Map(rows.map((row) => [row.shortcut, row.command]));
  cache.set(guildId, { map, at: Date.now() });
  return map;
}

export async function targetOf(guildId: string, shortcut: string): Promise<string | null> {
  return (await aliasesFor(guildId)).get(shortcut) ?? null;
}

export async function listAliases(guildId: string): Promise<Alias[]> {
  return sql<Alias[]>`
    SELECT shortcut, command FROM command_aliases
    WHERE guild_id = ${guildId} ORDER BY shortcut
  `;
}

export async function countAliases(guildId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM command_aliases WHERE guild_id = ${guildId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function addAlias(
  guildId: string,
  shortcut: string,
  command: string,
  actorId: string,
): Promise<void> {
  await sql`
    INSERT INTO command_aliases (guild_id, shortcut, command, created_by)
    VALUES (${guildId}, ${shortcut}, ${command}, ${actorId})
    ON CONFLICT (guild_id, shortcut) DO UPDATE
      SET command = EXCLUDED.command, created_by = EXCLUDED.created_by
  `;
  forget(guildId);
}

export async function dropAlias(guildId: string, shortcut: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM command_aliases WHERE guild_id = ${guildId} AND shortcut = ${shortcut}
    RETURNING shortcut
  `;
  forget(guildId);
  return rows.length > 0;
}

export async function dropForCommand(guildId: string, command: string): Promise<string[]> {
  const rows = await sql<{ shortcut: string }[]>`
    DELETE FROM command_aliases
    WHERE guild_id = ${guildId}
      AND (command = ${command} OR command LIKE ${command + " %"})
    RETURNING shortcut
  `;
  forget(guildId);
  return rows.map((row) => row.shortcut);
}

export async function resetAliases(guildId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM command_aliases WHERE guild_id = ${guildId} RETURNING shortcut
  `;
  forget(guildId);
  return rows.length;
}
