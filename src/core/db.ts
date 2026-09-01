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

  await sql`
    CREATE TABLE IF NOT EXISTS availability (
      guild_id TEXT NOT NULL,
      kind     TEXT NOT NULL,
      name     TEXT NOT NULL,
      target   TEXT NOT NULL,
      PRIMARY KEY (guild_id, kind, name, target)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ignores (
      guild_id  TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind      TEXT NOT NULL,
      PRIMARY KEY (guild_id, target_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pin_archive (
      guild_id   TEXT NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT false,
      channel_id TEXT,
      unpin      BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS webhooks (
      guild_id   TEXT NOT NULL,
      identifier TEXT NOT NULL,
      webhook_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      locked_by  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, identifier)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS fake_permissions (
      guild_id   TEXT NOT NULL,
      role_id    TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id, permission)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS highlights (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      word     TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, word)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS highlight_ignores (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, target_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS last_seen (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS birthdays (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      month    INTEGER NOT NULL,
      day      INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS birthday_config (
      guild_id   TEXT NOT NULL,
      role_id    TEXT,
      channel_id TEXT,
      locked     BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS birthday_roles (
      guild_id TEXT NOT NULL,
      role_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS timezones (
      user_id TEXT NOT NULL,
      zone    TEXT NOT NULL,
      PRIMARY KEY (user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS emote_uses (
      guild_id TEXT NOT NULL,
      emote    TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS emote_uses_guild ON emote_uses (guild_id, emote)`;

  await sql`
    CREATE TABLE IF NOT EXISTS antinuke (
      guild_id  TEXT NOT NULL,
      module    TEXT NOT NULL,
      enabled   BOOLEAN NOT NULL DEFAULT false,
      threshold INTEGER NOT NULL DEFAULT 3,
      window_ms INTEGER NOT NULL DEFAULT 60000,
      PRIMARY KEY (guild_id, module)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS antinuke_config (
      guild_id   TEXT PRIMARY KEY,
      punishment TEXT NOT NULL DEFAULT 'ban'
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS antinuke_trust (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS antinuke_whitelist (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS antinuke_spam_exempt (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS antinuke_events (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      module   TEXT NOT NULL,
      detail   TEXT NOT NULL,
      outcome  TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS antinuke_events_guild ON antinuke_events (guild_id, at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS embeds (
      guild_id  TEXT NOT NULL,
      name      TEXT NOT NULL,
      code      TEXT NOT NULL,
      author_id TEXT NOT NULL,
      at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, name)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS afk (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      status   TEXT NOT NULL,
      since    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS afk_mentions (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      from_id    TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS afk_mentions_who ON afk_mentions (guild_id, user_id, at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS name_history (
      user_id  TEXT NOT NULL,
      guild_id TEXT,
      kind     TEXT NOT NULL,
      name     TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS name_history_who ON name_history (user_id, kind, at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS guild_name_history (
      guild_id TEXT NOT NULL,
      name     TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS guild_name_history_who ON guild_name_history (guild_id, at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS command_uses (
      guild_id TEXT NOT NULL,
      command  TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS command_uses_guild ON command_uses (guild_id, command)`;

  await sql`
    CREATE TABLE IF NOT EXISTS roleplay (
      guild_id TEXT PRIMARY KEY,
      enabled  BOOLEAN NOT NULL DEFAULT false
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_config (
      guild_id     TEXT NOT NULL,
      jail_role    TEXT,
      jail_channel TEXT,
      mute_role    TEXT,
      imute_role   TEXT,
      rmute_role   TEXT,
      lock_role    TEXT,
      log_channel  TEXT,
      ban_purge    INTEGER NOT NULL DEFAULT 0,
      next_case    INTEGER NOT NULL DEFAULT 1,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_cases (
      guild_id     TEXT NOT NULL,
      case_id      INTEGER NOT NULL,
      action       TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason       TEXT,
      duration_ms  BIGINT,
      proof        TEXT,
      at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, case_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS mod_cases_target ON mod_cases (guild_id, target_id)`;
  await sql`CREATE INDEX IF NOT EXISTS mod_cases_mod ON mod_cases (guild_id, moderator_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_case_proof (
      guild_id TEXT NOT NULL,
      case_id  INTEGER NOT NULL,
      idx      INTEGER NOT NULL,
      url      TEXT NOT NULL,
      PRIMARY KEY (guild_id, case_id, idx)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_notes (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      note_id   INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      body      TEXT NOT NULL,
      at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id, note_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_pending (
      id        BIGSERIAL PRIMARY KEY,
      guild_id  TEXT NOT NULL,
      kind      TEXT NOT NULL,
      target_id TEXT NOT NULL,
      extra     TEXT,
      due       TIMESTAMPTZ NOT NULL
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS mod_pending_due ON mod_pending (due)`;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_nukes (
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      interval_ms BIGINT NOT NULL,
      message     TEXT,
      next_at     TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_watched_threads (
      guild_id  TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, thread_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_forced_nicks (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      nickname TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_sticky_roles (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      role_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, role_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_restricted (
      guild_id TEXT NOT NULL,
      command  TEXT NOT NULL,
      role_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, command, role_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_lock_ignores (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_hardbans (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      by_id    TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mod_jailed (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      roles    TEXT NOT NULL DEFAULT '',
      at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS badge_config (
      guild_id   TEXT NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT false,
      channel_id TEXT,
      message    TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS badge_roles (
      guild_id TEXT NOT NULL,
      role_id  TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS badge_awarded (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      guild_id   TEXT NOT NULL,
      per_user   INTEGER NOT NULL DEFAULT 5,
      per_guild  INTEGER NOT NULL DEFAULT 30,
      window_ms  INTEGER NOT NULL DEFAULT 10000,
      enabled    BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS customize (
      guild_id   TEXT NOT NULL,
      bio        TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS suggest_config (
      guild_id   TEXT NOT NULL,
      channel_id TEXT,
      review_id  TEXT,
      locked     BOOLEAN NOT NULL DEFAULT false,
      threads    BOOLEAN NOT NULL DEFAULT false,
      review     BOOLEAN NOT NULL DEFAULT false,
      upvote     TEXT NOT NULL DEFAULT '👍',
      downvote   TEXT NOT NULL DEFAULT '👎',
      next_id    INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS suggestions (
      guild_id   TEXT NOT NULL,
      id         INTEGER NOT NULL,
      author_id  TEXT NOT NULL,
      body       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      channel_id TEXT,
      message_id TEXT,
      thread_id  TEXT,
      reply      TEXT,
      replied_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS suggest_ignores (
      guild_id  TEXT NOT NULL,
      target_id TEXT NOT NULL,
      is_role   BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (guild_id, target_id)
    )
  `;

  console.log("db: schema ready");
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
