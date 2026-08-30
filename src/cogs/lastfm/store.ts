import { randomBytes } from "node:crypto";
import { sql } from "../../core/db.js";
import { TTL, keys, redis } from "../../core/redis.js";

const NOT_LINKED = "";

export interface Link {
  discordId: string;
  username: string;
  linkedAt: Date;
}

export async function getUsername(discordId: string): Promise<string | null> {
  try {
    const cached = await redis.get(keys.user(discordId));
    if (cached !== null) return cached === NOT_LINKED ? null : cached;
  } catch {}

  const rows = await sql<{ username: string }[]>`
    SELECT username FROM lastfm_users WHERE discord_id = ${discordId}
  `;
  const username = rows[0]?.username ?? null;

  redis
    .set(keys.user(discordId), username ?? NOT_LINKED, "EX", TTL.user)
    .catch(() => {});

  return username;
}

export async function saveLink(
  discordId: string,
  username: string,
  sessionKey: string,
): Promise<{ replaced: boolean; previous: string | null }> {
  const before = await sql<{ username: string }[]>`
    SELECT username FROM lastfm_users WHERE discord_id = ${discordId}
  `;
  const previous = before[0]?.username ?? null;

  await sql`
    INSERT INTO lastfm_users (discord_id, username, session_key)
    VALUES (${discordId}, ${username}, ${sessionKey})
    ON CONFLICT (discord_id) DO UPDATE
      SET username = EXCLUDED.username,
          session_key = EXCLUDED.session_key,
          updated_at = now()
  `;

  await redis.set(keys.user(discordId), username, "EX", TTL.user).catch(() => {});
  return { replaced: previous !== null && previous !== username, previous };
}

export async function removeLink(discordId: string): Promise<string | null> {
  const rows = await sql<{ username: string }[]>`
    DELETE FROM lastfm_users WHERE discord_id = ${discordId} RETURNING username
  `;
  const removed = rows[0]?.username ?? null;

  await redis.set(keys.user(discordId), NOT_LINKED, "EX", TTL.user).catch(() => {});
  return removed;
}

export async function createLinkState(discordId: string): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await redis.set(keys.linkState(state), discordId, "EX", TTL.linkState);
  return state;
}

export async function consumeLinkState(state: string): Promise<string | null> {
  const discordId = await redis.getdel(keys.linkState(state));
  return discordId ?? null;
}

export async function getSessionKey(
  discordId: string,
): Promise<{ username: string; sessionKey: string } | null> {
  const rows = await sql<{ username: string; session_key: string }[]>`
    SELECT username, session_key FROM lastfm_users WHERE discord_id = ${discordId}
  `;
  const row = rows[0];
  return row ? { username: row.username, sessionKey: row.session_key } : null;
}
