/**
 * Postgres access.
 *
 * One pooled connection set for the process, with prepared statements enabled
 * (the default in this driver) so repeated lookups skip parse and plan.
 */

import postgres from "postgres";
import { optionalInt, required } from "./env.js";

export const sql = postgres(required("DATABASE_URL"), {
  max: optionalInt("PG_POOL_MAX", 8),
  idle_timeout: 30,
  connect_timeout: 10,
  // Bot workloads are bursty and tiny; keeping prepares on is the win here.
  prepare: true,
  onnotice: () => {},
});

/**
 * Schema, applied on boot. Written to be safe to run repeatedly rather than
 * tracked with migration files — the schema is small and additive so far.
 */
export async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_users (
      discord_id   TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      session_key  TEXT NOT NULL,
      linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Looking a Discord user up by their Last.fm name (for future commands such
  // as "whose account is this") should not scan the table.
  await sql`
    CREATE INDEX IF NOT EXISTS lastfm_users_username_idx
      ON lastfm_users (lower(username))
  `;

  // A crown is "top listener for this artist in this guild".
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_crowns (
      guild_id    TEXT NOT NULL,
      artist_key  TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      discord_id  TEXT NOT NULL,
      plays       INTEGER NOT NULL,
      claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, artist_key)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS lastfm_crowns_holder_idx
      ON lastfm_crowns (guild_id, discord_id)
  `;

  // Members a moderator has removed from whoknows listings.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_hidden (
      guild_id   TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      hidden_by  TEXT,
      hidden_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, discord_id)
    )
  `;

  // Now-playing posts, so their reactions can be tallied into a scoreboard.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_np_posts (
      message_id TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS lastfm_np_posts_guild_idx
      ON lastfm_np_posts (guild_id, discord_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_np_votes (
      message_id TEXT NOT NULL REFERENCES lastfm_np_posts(message_id) ON DELETE CASCADE,
      reactor_id TEXT NOT NULL,
      vote       SMALLINT NOT NULL,
      PRIMARY KEY (message_id, reactor_id)
    )
  `;

  // Per-user Last.fm preferences: now-playing style, embed colour, reactions.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_user_settings (
      discord_id TEXT PRIMARY KEY,
      np_mode    TEXT,
      color      INTEGER,
      upvote     TEXT,
      downvote   TEXT,
      np_template TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Added after the table shipped, so it is a separate statement.
  await sql`ALTER TABLE lastfm_user_settings ADD COLUMN IF NOT EXISTS np_template TEXT`;

  // Server-wide defaults, set by moderators.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_guild_settings (
      guild_id   TEXT PRIMARY KEY,
      upvote     TEXT,
      downvote   TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // A member's own word for "show my now playing", scoped to one guild.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_custom_commands (
      guild_id   TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      command    TEXT NOT NULL,
      is_public  BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, discord_id)
    )
  `;
  // One word cannot belong to two members in the same guild.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS lastfm_custom_commands_word_idx
      ON lastfm_custom_commands (guild_id, lower(command))
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_cc_blacklist (
      guild_id    TEXT NOT NULL,
      discord_id  TEXT NOT NULL,
      blocked_by  TEXT,
      blocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, discord_id)
    )
  `;

  // Community-submitted album covers, used when Last.fm's artwork is poor.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_album_art (
      id           BIGSERIAL PRIMARY KEY,
      artist_key   TEXT NOT NULL,
      album_key    TEXT NOT NULL,
      url          TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS lastfm_album_art_unique_idx
      ON lastfm_album_art (artist_key, album_key, url)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS lastfm_album_art_lookup_idx
      ON lastfm_album_art (artist_key, album_key)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_album_art_votes (
      art_id   BIGINT NOT NULL REFERENCES lastfm_album_art(id) ON DELETE CASCADE,
      voter_id TEXT NOT NULL,
      PRIMARY KEY (art_id, voter_id)
    )
  `;

  // Per-user command preferences, kept apart from the Last.fm card settings.
  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_prefs (
      discord_id     TEXT PRIMARY KEY,
      default_period TEXT,
      chart_size     INTEGER,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  console.log("db: schema ready");
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
