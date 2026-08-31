import { sql } from "../../../core/db.js";

export const EVERYWHERE = "*";

export type Kind = "command" | "module" | "event";

export interface Rule {
  kind: Kind;
  name: string;
  target: string;
}

const CACHE_MS = 60_000;

const cache = new Map<string, { rules: Rule[]; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

async function load(guildId: string): Promise<Rule[]> {
  const rows = await sql<{ kind: Kind; name: string; target: string }[]>`
    SELECT kind, name, target FROM availability WHERE guild_id = ${guildId}
  `;
  return rows;
}

export async function rules(guildId: string): Promise<Rule[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;

  let held: Rule[];
  try {
    held = await load(guildId);
  } catch {
    return hit?.rules ?? [];
  }

  cache.set(guildId, { rules: held, at: Date.now() });
  return held;
}

export function blocks(held: Rule[], kind: Kind, name: string, targets: string[]): boolean {
  return held.some(
    (rule) => rule.kind === kind && rule.name === name && targets.includes(rule.target),
  );
}

export async function disable(
  guildId: string,
  kind: Kind,
  name: string,
  target: string,
): Promise<boolean> {
  const done = await sql`
    INSERT INTO availability (guild_id, kind, name, target)
    VALUES (${guildId}, ${kind}, ${name}, ${target})
    ON CONFLICT DO NOTHING
    RETURNING name
  `;
  forget(guildId);
  return done.length > 0;
}

export async function enable(
  guildId: string,
  kind: Kind,
  name: string,
  target: string,
): Promise<number> {
  const gone =
    target === EVERYWHERE
      ? await sql`
          DELETE FROM availability
          WHERE guild_id = ${guildId} AND kind = ${kind} AND name = ${name}
          RETURNING target
        `
      : await sql`
          DELETE FROM availability
          WHERE guild_id = ${guildId} AND kind = ${kind} AND name = ${name} AND target = ${target}
          RETURNING target
        `;
  forget(guildId);
  return gone.length;
}

export async function listing(guildId: string, kind: Kind): Promise<Rule[]> {
  return (await rules(guildId)).filter((rule) => rule.kind === kind);
}

export async function copy(
  guildId: string,
  from: string,
  to: string,
): Promise<{ found: number; made: number }> {
  const held = (await rules(guildId)).filter((rule) => rule.target === from);
  let made = 0;

  for (const rule of held) {
    const done = await sql`
      INSERT INTO availability (guild_id, kind, name, target)
      VALUES (${guildId}, ${rule.kind}, ${rule.name}, ${to})
      ON CONFLICT DO NOTHING
      RETURNING name
    `;
    made += done.length;
  }

  forget(guildId);
  return { found: held.length, made };
}
