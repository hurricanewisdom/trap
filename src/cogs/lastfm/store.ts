/**
 * Link storage: Postgres is the record, Redis is the read path.
 *
 * Reads hit the cache first and cache misses AND negatives — an unlinked user
 * running a command is the common case, and caching that keeps it off the
 * database entirely. Writes update Postgres then refresh the cache, so a
 * link or unlink is visible immediately rather than after a TTL.
 */

import { randomBytes } from "node:crypto";
import { sql } from "../../core/db.js";
import { TTL, keys, redis } from "../../core/redis.js";

/** Sentinel for "this user is definitely not linked", to make negatives cacheable. */
const NOT_LINKED = "";

export interface Link {
  discordId: string;
  username: string;
  linkedAt: Date;
}

/** Returns the linked Last.fm username, or null. Cached both ways. */
export async function getUsername(discordId: string): Promise<string | null> {
  try {
    const cached = await redis.get(keys.user(discordId));
    if (cached !== null) return cached === NOT_LINKED ? null : cached;
  } catch {
    // Cache unavailable — fall through to the database.
  }

  const rows = await sql<{ username: string }[]>`
    SELECT username FROM lastfm_users WHERE discord_id = ${discordId}
  `;
  const username = rows[0]?.username ?? null;

  redis
    .set(keys.user(discordId), username ?? NOT_LINKED, "EX", TTL.user)
    .catch(() => {});

  return username;
}

/** Creates or replaces a link, returning whether it replaced an existing one. */
export async function saveLink(
  discordId: string,
  username: string,
  sessionKey: string,
): Promise<{ replaced: boolean; previous: string | null }> {
  // Read the old name first: a subquery inside RETURNING would read this
  // statement's own snapshot, which is not reliably the pre-update value.
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

/** Removes a link. Returns the username that was removed, or null. */
export async function removeLink(discordId: string): Promise<string | null> {
  const rows = await sql<{ username: string }[]>`
    DELETE FROM lastfm_users WHERE discord_id = ${discordId} RETURNING username
  `;
  const removed = rows[0]?.username ?? null;

  // Cache the negative straight away so the next read stays off the database.
  await redis.set(keys.user(discordId), NOT_LINKED, "EX", TTL.user).catch(() => {});
  return removed;
}

/**
 * Starts an authorisation attempt.
 *
 * The state is the only thing binding the browser that comes back to the
 * Discord user who asked, so it is random, single-use and short-lived.
 */
export async function createLinkState(discordId: string): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await redis.set(keys.linkState(state), discordId, "EX", TTL.linkState);
  return state;
}

/** Consumes a state, returning the Discord id that opened it. Single use. */
export async function consumeLinkState(state: string): Promise<string | null> {
  // GETDEL makes claiming the state atomic, so a replayed callback finds nothing.
  const discordId = await redis.getdel(keys.linkState(state));
  return discordId ?? null;
}

/**
 * The stored Last.fm session key for a user.
 *
 * This is a write credential: it can love, unlove and scrobble on their
 * account. It is only ever handed to a command acting on behalf of the same
 * Discord user who authorised it, never to a command targeting someone else.
 */
export async function getSessionKey(
  discordId: string,
): Promise<{ username: string; sessionKey: string } | null> {
  const rows = await sql<{ username: string; session_key: string }[]>`
    SELECT username, session_key FROM lastfm_users WHERE discord_id = ${discordId}
  `;
  const row = rows[0];
  return row ? { username: row.username, sessionKey: row.session_key } : null;
}
