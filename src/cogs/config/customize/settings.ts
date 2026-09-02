import { sql } from "../../../core/db.js";
import { KINDS, PLAIN, type Kind, type Style } from "../../../core/style.js";

interface Row {
  ping: boolean;
  punctuation: boolean;
  warn_soft: boolean;
  styles: Record<string, { emoji?: string; color?: number }> | null;
}

const CACHE_MS = 30_000;

const cache = new Map<string, { style: Style; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

/**
 * The guild's style, cached.
 *
 * Read on the way to every reply the bot sends in that server, so it must be
 * cheap and must never throw: a failure falls back to the plain style, which
 * means "no decoration" rather than "no answer".
 */
export async function styleOf(guildId: string): Promise<Style> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.style;

  let style: Style;
  try {
    const rows = await sql<Row[]>`
      SELECT ping, punctuation, warn_soft, styles FROM customize WHERE guild_id = ${guildId}
    `;
    const row = rows[0];
    if (!row) {
      style = PLAIN;
    } else {
      const emoji: Partial<Record<Kind, string>> = {};
      const color: Partial<Record<Kind, number>> = {};
      for (const kind of KINDS) {
        const held = row.styles?.[kind];
        if (held?.emoji) emoji[kind] = held.emoji;
        if (typeof held?.color === "number") color[kind] = held.color;
      }
      style = {
        emoji,
        color,
        ping: row.ping,
        punctuation: row.punctuation,
        warnSoft: row.warn_soft,
      };
    }
  } catch {
    return hit?.style ?? PLAIN;
  }

  cache.set(guildId, { style, at: Date.now() });
  return style;
}

type Toggle = "ping" | "punctuation" | "warn_soft";

export async function setToggle(guildId: string, field: Toggle, on: boolean): Promise<void> {
  // The column comes from the union, never from anything typed.
  if (field === "ping") {
    await sql`
      INSERT INTO customize (guild_id, ping, updated_at) VALUES (${guildId}, ${on}, now())
      ON CONFLICT (guild_id) DO UPDATE SET ping = EXCLUDED.ping, updated_at = now()
    `;
  } else if (field === "punctuation") {
    await sql`
      INSERT INTO customize (guild_id, punctuation, updated_at) VALUES (${guildId}, ${on}, now())
      ON CONFLICT (guild_id) DO UPDATE SET punctuation = EXCLUDED.punctuation, updated_at = now()
    `;
  } else {
    await sql`
      INSERT INTO customize (guild_id, warn_soft, updated_at) VALUES (${guildId}, ${on}, now())
      ON CONFLICT (guild_id) DO UPDATE SET warn_soft = EXCLUDED.warn_soft, updated_at = now()
    `;
  }
  forget(guildId);
}

/**
 * Writes one kind's emoji and colour.
 *
 * ⚠️ jsonb_set, not `||`: passing an object as a parameter and casting it sends
 * a JSON *string*, and `jsonb || jsonb_string` concatenates into an array
 * rather than merging. The setting writes, reads back as nothing, and says
 * nothing about it.
 */
export async function setStyle(
  guildId: string,
  kind: Kind,
  emoji: string | null,
  color: number | null,
): Promise<void> {
  const value = {
    ...(emoji ? { emoji } : {}),
    ...(color === null ? {} : { color }),
  };

  // ⚠️ `sql.json(value)`, never `${JSON.stringify(value)}::jsonb`. The driver
  // sends a string parameter as a JSON string literal, so casting it to jsonb
  // stores `"{\"emoji\":\"x\"}"` -- a jsonb *string* -- and every read comes
  // back empty with nothing said about it. Measured against the real database.
  await sql`
    INSERT INTO customize (guild_id, styles, updated_at)
    VALUES (${guildId}, jsonb_build_object(${kind}::text, ${sql.json(value)}), now())
    ON CONFLICT (guild_id) DO UPDATE
      SET styles = jsonb_set(
            COALESCE(customize.styles, '{}'::jsonb),
            ARRAY[${kind}],
            ${sql.json(value)},
            true
          ),
          updated_at = now()
  `;
  forget(guildId);
}

export async function clearStyles(guildId: string): Promise<void> {
  await sql`
    UPDATE customize SET styles = '{}'::jsonb, warn_soft = false, updated_at = now()
    WHERE guild_id = ${guildId}
  `;
  forget(guildId);
}

export async function resetAll(guildId: string): Promise<void> {
  await sql`
    UPDATE customize
    SET styles = '{}'::jsonb, ping = false, punctuation = true, warn_soft = false,
        bio = NULL, updated_at = now()
    WHERE guild_id = ${guildId}
  `;
  forget(guildId);
}
