import { sql } from "../../../core/db.js";

export type Kind = "member" | "channel";

export interface Ignored {
  targetId: string;
  kind: Kind;
}

export const MAX_IGNORES = 200;

const CACHE_MS = 60_000;

const cache = new Map<string, { held: Ignored[]; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function all(guildId: string): Promise<Ignored[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.held;

  let held: Ignored[];
  try {
    const rows = await sql<{ target_id: string; kind: Kind }[]>`
      SELECT target_id, kind FROM ignores WHERE guild_id = ${guildId} ORDER BY kind, target_id
    `;
    held = rows.map((row) => ({ targetId: row.target_id, kind: row.kind }));
  } catch {
    return hit?.held ?? [];
  }

  cache.set(guildId, { held, at: Date.now() });
  return held;
}

export async function ignores(guildId: string, targetId: string): Promise<boolean> {
  return (await all(guildId)).some((held) => held.targetId === targetId);
}

export async function add(guildId: string, targetId: string, kind: Kind): Promise<boolean> {
  const done = await sql`
    INSERT INTO ignores (guild_id, target_id, kind)
    VALUES (${guildId}, ${targetId}, ${kind})
    ON CONFLICT DO NOTHING
    RETURNING target_id
  `;
  forget(guildId);
  return done.length > 0;
}

export async function remove(guildId: string, targetId: string): Promise<boolean> {
  const gone = await sql`
    DELETE FROM ignores WHERE guild_id = ${guildId} AND target_id = ${targetId}
    RETURNING target_id
  `;
  forget(guildId);
  return gone.length > 0;
}
