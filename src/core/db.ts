import postgres from "postgres";
import { optionalInt, required } from "./env.js";

export const sql = postgres(required("DATABASE_URL"), {
  max: optionalInt("PG_POOL_MAX", 8),
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: true,
  onnotice: () => {},
});

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

  await sql`
    CREATE INDEX IF NOT EXISTS lastfm_users_username_idx
      ON lastfm_users (lower(username))
  `;

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

  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_hidden (
      guild_id   TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      hidden_by  TEXT,
      hidden_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, discord_id)
    )
  `;

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

  await sql`ALTER TABLE lastfm_user_settings ADD COLUMN IF NOT EXISTS np_template TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_guild_settings (
      guild_id   TEXT PRIMARY KEY,
      upvote     TEXT,
      downvote   TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

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

  await sql`
    CREATE TABLE IF NOT EXISTS lastfm_prefs (
      discord_id     TEXT PRIMARY KEY,
      default_period TEXT,
      chart_size     INTEGER,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS guild_prefixes (
      guild_id   TEXT NOT NULL,
      prefix     TEXT NOT NULL,
      added_by   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, prefix)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS booster_roles (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      role_id    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS booster_roles_role_idx
      ON booster_roles (guild_id, role_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS booster_config (
      guild_id      TEXT PRIMARY KEY,
      base_role_id  TEXT,
      award_role_id TEXT,
      role_limit    INTEGER,
      share_max     INTEGER,
      share_limit   INTEGER,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS booster_filters (
      guild_id TEXT NOT NULL,
      word     TEXT NOT NULL,
      PRIMARY KEY (guild_id, word)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS booster_shares (
      guild_id  TEXT NOT NULL,
      role_id   TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, role_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS boost_messages (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS command_aliases (
      guild_id   TEXT NOT NULL,
      shortcut   TEXT NOT NULL,
      command    TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, shortcut)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS command_aliases_command_idx
      ON command_aliases (guild_id, command)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sticky_messages (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message    TEXT NOT NULL,
      posted_id  TEXT,
      created_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS channel_messages (
      guild_id   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, kind, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS booster_state (
      guild_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      premium_since TIMESTAMPTZ,
      seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS gallery_channels (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      added_by   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS filter_settings (
      guild_id   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT false,
      threshold  INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, kind)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS filter_exempt_roles (
      guild_id TEXT NOT NULL,
      kind     TEXT NOT NULL,
      role_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, kind, role_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS filter_exempt_channels (
      guild_id   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, kind, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS autoresponders (
      guild_id   TEXT NOT NULL,
      trigger    TEXT NOT NULL,
      reply      TEXT NOT NULL,
      strict     BOOLEAN NOT NULL DEFAULT false,
      ticket     BOOLEAN NOT NULL DEFAULT false,
      wipe       BOOLEAN NOT NULL DEFAULT false,
      quote      BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, trigger)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS autoresponder_roles (
      guild_id TEXT NOT NULL,
      trigger  TEXT NOT NULL,
      role_id  TEXT NOT NULL,
      action   TEXT NOT NULL,
      PRIMARY KEY (guild_id, trigger, role_id, action)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS autoresponder_exclusive (
      guild_id  TEXT NOT NULL,
      trigger   TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind      TEXT NOT NULL,
      PRIMARY KEY (guild_id, trigger, target_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS paginations (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      current    INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pagination_pages (
      message_id TEXT NOT NULL,
      page_id    INTEGER NOT NULL,
      body       TEXT NOT NULL,
      PRIMARY KEY (message_id, page_id)
    )
  `;

  console.log("db: schema ready");
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
