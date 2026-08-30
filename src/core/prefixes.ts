import { sql } from "./db.js";

export const DEFAULT_PREFIX = process.env.PREFIX ?? ",";

export const MAX_PREFIXES = 25;

export const MAX_PREFIX_LENGTH = 8;

const CACHE_MS = 300_000;

interface Cached {
  prefixes: string[];
  primary: string;
  at: number;
}

const cache = new Map<string, Cached>();

export type PrefixCheck = { ok: true; prefix: string } | { ok: false; reason: string };

export function checkPrefix(raw: string): PrefixCheck {
  const prefix = raw.trim();

  if (!prefix) return { ok: false, reason: "Give me the prefix you want." };
  if (/\s/.test(prefix)) return { ok: false, reason: "A prefix cannot contain spaces." };
  if (prefix.length > MAX_PREFIX_LENGTH) {
    return { ok: false, reason: `A prefix can be at most ${MAX_PREFIX_LENGTH} characters.` };
  }
  if (prefix.startsWith("<@") || prefix.startsWith("<#") || prefix.startsWith("<:")) {
    return { ok: false, reason: "A prefix cannot be a mention or an emoji tag." };
  }
  if (prefix.includes("`")) return { ok: false, reason: "A prefix cannot contain a backtick." };
  if (prefix.startsWith("/")) {
    return { ok: false, reason: "A prefix cannot start with `/`, that belongs to slash commands." };
  }

  return { ok: true, prefix };
}

function sorted(prefixes: string[]): string[] {
  return [...prefixes].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function prefixesFor(guildId?: string): Promise<string[]> {
  if (!guildId) return [DEFAULT_PREFIX];

  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.prefixes;

  let stored: string[] = [];
  try {
    const rows = await sql<{ prefix: string }[]>`
      SELECT prefix FROM guild_prefixes WHERE guild_id = ${guildId} ORDER BY created_at, prefix
    `;
    stored = rows.map((row) => row.prefix);
  } catch {
    return hit?.prefixes ?? [DEFAULT_PREFIX];
  }

  const prefixes = sorted(stored.length ? stored : [DEFAULT_PREFIX]);
  const primary = !stored.length || stored.includes(DEFAULT_PREFIX)
    ? DEFAULT_PREFIX
    : (stored[0] ?? DEFAULT_PREFIX);

  cache.set(guildId, { prefixes, primary, at: Date.now() });
  return prefixes;
}

export async function customPrefixes(guildId: string): Promise<string[]> {
  const rows = await sql<{ prefix: string }[]>`
    SELECT prefix FROM guild_prefixes WHERE guild_id = ${guildId}
  `;
  return sorted(rows.map((row) => row.prefix));
}

export async function isDefaulted(guildId: string): Promise<boolean> {
  return (await customPrefixes(guildId)).length === 0;
}

export async function addPrefix(
  guildId: string,
  prefix: string,
  actorId: string,
): Promise<"added" | "exists" | "full"> {
  const existing = await customPrefixes(guildId);
  if (existing.includes(prefix)) return "exists";
  if (existing.length >= MAX_PREFIXES) return "full";

  if (existing.length === 0 && prefix !== DEFAULT_PREFIX) {
    await sql`
      INSERT INTO guild_prefixes (guild_id, prefix, added_by)
      VALUES (${guildId}, ${DEFAULT_PREFIX}, ${actorId})
      ON CONFLICT (guild_id, prefix) DO NOTHING
    `;
  }

  await sql`
    INSERT INTO guild_prefixes (guild_id, prefix, added_by)
    VALUES (${guildId}, ${prefix}, ${actorId})
    ON CONFLICT (guild_id, prefix) DO NOTHING
  `;
  forget(guildId);
  return "added";
}

export async function removePrefix(guildId: string, prefix: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM guild_prefixes WHERE guild_id = ${guildId} AND prefix = ${prefix}
    RETURNING prefix
  `;
  forget(guildId);
  return rows.length > 0;
}

export async function setPrefixes(
  guildId: string,
  prefixes: string[],
  actorId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM guild_prefixes WHERE guild_id = ${guildId}`;
    for (const prefix of prefixes) {
      await tx`
        INSERT INTO guild_prefixes (guild_id, prefix, added_by)
        VALUES (${guildId}, ${prefix}, ${actorId})
        ON CONFLICT (guild_id, prefix) DO NOTHING
      `;
    }
  });
  forget(guildId);
}

export async function resetPrefixes(guildId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM guild_prefixes WHERE guild_id = ${guildId} RETURNING prefix
  `;
  forget(guildId);
  return rows.length;
}

export async function primaryPrefix(guildId?: string): Promise<string> {
  if (!guildId) return DEFAULT_PREFIX;
  await prefixesFor(guildId);
  return cache.get(guildId)?.primary ?? DEFAULT_PREFIX;
}

export async function matchPrefix(content: string, guildId?: string): Promise<string | null> {
  for (const prefix of await prefixesFor(guildId)) {
    if (content.startsWith(prefix)) return prefix;
  }
  return null;
}
