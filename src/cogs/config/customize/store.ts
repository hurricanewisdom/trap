import { sql } from "../../../core/db.js";

// Discord accepts a bio for the bot's guild member and echoes it back, but returns
// it from no endpoint a bot is allowed to read: the member object carries only
// nick, avatar and banner, and the profile endpoint answers "Bots cannot use this
// endpoint". So the only way to show a server its own bio is to remember it here.
const cache = new Map<string, string | null>();

export async function bio(guildId: string): Promise<string | null> {
  const hit = cache.get(guildId);
  if (hit !== undefined) return hit;

  try {
    const rows = await sql<{ bio: string | null }[]>`
      SELECT bio FROM customize WHERE guild_id = ${guildId}
    `;
    const held = rows[0]?.bio ?? null;
    cache.set(guildId, held);
    return held;
  } catch {
    return null;
  }
}

export async function saveBio(guildId: string, text: string | null): Promise<void> {
  await sql`
    INSERT INTO customize (guild_id, bio, updated_at) VALUES (${guildId}, ${text}, now())
    ON CONFLICT (guild_id) DO UPDATE SET bio = EXCLUDED.bio, updated_at = now()
  `;
  cache.set(guildId, text);
}
