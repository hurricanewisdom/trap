/**
 * Guild-wide Last.fm commands: crowns, the crown leaderboard, who is playing
 * something right now, and the hide list that keeps a member out of listings.
 *
 * Everything here fans out over guild members, so every loop is bounded: at
 * most CONCURRENCY requests in flight and at most SCAN_CAP members touched.
 * An unbounded promise per member would take a 4,000-person guild and turn one
 * message into 4,000 simultaneous Last.fm calls.
 */

import { sql } from "../../../core/db.js";
import { canManageGuild, displayName, guildMemberIds } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { getRecentTracks, type RecentTrack } from "../api/index.js";
import { guard } from "../guard.js";
import {
  EMBED_COLOR,
  artistUrl,
  avatarOf,
  buildPages,
  chartLine,
  label,
  plural,
  profile,
  simpleCard,
  url,
} from "../shared.js";
import { getUsername } from "../store.js";

/** Requests in flight at once, for every fan-out in this file. */
const CONCURRENCY = 5;
/** Members whose Last.fm account is actually contacted by `,playing`. */
const SCAN_CAP = 100;
/** Rows read for a paginated list; the footer reports the true total. */
const CROWN_LIMIT = 250;
const LEADER_LIMIT = 100;
const HIDDEN_LIMIT = 100;

/** A member argument: a mention, a nickname mention, or a bare id. */
const MEMBER = /^(?:<@!?(\d{15,25})>|(\d{15,25}))(?=\s|$)/;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Maps over items with at most `limit` workers running at once. Workers pull
 * from a shared cursor rather than being handed a slice, so one slow member
 * does not stall a whole chunk.
 */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // Fixing the length up front keeps result[i] aligned with items[i] even when
  // the final slot is skipped, so callers can index by position safely.
  results.length = items.length;
  let cursor = 0;

  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        // A hole skips its own slot — `return` here would retire the runner and
        // silently leave every later member unqueried, which on a full pool
        // means the listing quietly drops most of the server.
        if (item === undefined) continue;
        results[index] = await worker(item);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

/**
 * url() only sanitises its first argument — a fallback is handed back
 * untouched. artistUrl() builds its path with encodeURIComponent, which leaves
 * "(" and ")" alone, so "Sunday (Live)" would close its own markdown link.
 * Passing the fallback through url() as well closes that hole.
 */
function link(value: string | undefined, fallback: string): string {
  return url(value, url(fallback, fallback));
}

const artistLink = (name: string) => link(undefined, artistUrl(name));

/**
 * Display names are attacker-chosen text. label() swaps the square brackets
 * for fullwidth lookalikes, so a nickname of "[click me](https://evil)" cannot
 * render as a real link in a heading or a list row.
 */
const memberName = (name: string) => label(name);

/** A relative Discord timestamp, tolerating a driver that hands back a string. */
function when(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor(date.getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:R>` : null;
}

/** Reads a leading member argument, defaulting to the caller. */
function targetOf(ctx: PrefixContext): { id: string; explicit: boolean } {
  const match = MEMBER.exec(ctx.argument.trim());
  const id = match?.[1] ?? match?.[2];
  return id ? { id, explicit: true } : { id: ctx.authorId, explicit: false };
}

/** Guild-only guard: DMs have no member list, no crowns and no hide list. */
async function requireGuild(ctx: PrefixContext, heading: string): Promise<string | null> {
  if (ctx.guildId) return ctx.guildId;
  await paginate(
    ctx,
    simpleCard(heading, "This only works inside a server, not in DMs."),
    EMBED_COLOR,
  );
  return null;
}

/** Best-effort avatar: an unlinked member simply gets no thumbnail. */
async function iconFor(discordId: string): Promise<string | null> {
  const username = await getUsername(discordId);
  if (!username) return null;
  return avatarOf(await profile(username));
}

/* ------------------------------------------------------------------ */
/* ,crowns                                                            */
/* ------------------------------------------------------------------ */

interface CrownRow {
  artist_name: string;
  plays: number;
  /** COUNT(*) OVER () — bigint, so the driver hands it back as a string. */
  total: string;
}

async function crowns(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "Crowns");
  if (!guildId) return;

  const target = targetOf(ctx);
  const name = memberName(await displayName(guildId, target.id));
  const heading = `${name}'s crowns`;
  const icon = await iconFor(target.id);

  const rows = await sql<CrownRow[]>`
    SELECT artist_name, plays, COUNT(*) OVER () AS total
    FROM lastfm_crowns
    WHERE guild_id = ${guildId} AND discord_id = ${target.id}
    ORDER BY plays DESC, artist_name ASC
    LIMIT ${CROWN_LIMIT}
  `;

  if (rows.length === 0) {
    await paginate(
      ctx,
      simpleCard(
        heading,
        target.explicit
          ? "No crowns here yet. A crown goes to the top listener for an artist in this server."
          : "You have no crowns yet. Run `,whoknows <artist>` and take one.",
        icon,
      ),
      EMBED_COLOR,
    );
    return;
  }

  const total = Number(rows[0]?.total ?? rows.length) || rows.length;
  const lines = rows.map((row, i) =>
    chartLine(i + 1, row.artist_name, artistLink(row.artist_name), Number(row.plays) || 0),
  );

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: name,
      icon,
      noun: "crowns",
      total,
      ...(total > rows.length
        ? {
            footer: `showing the top ${rows.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} crowns`,
          }
        : {}),
    }),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* ,mostcrowns                                                        */
/* ------------------------------------------------------------------ */

interface LeaderRow {
  discord_id: string;
  crowns: number;
  /** Number of holders, counted after the grouping. */
  holders: string;
}

async function mostCrowns(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "Crown leaderboard");
  if (!guildId) return;

  const heading = "Crown leaderboard";

  // `,hide` promises "hidden from whoknows and server listings", and whoknows
  // already refuses to hand a hidden member a crown. A leaderboard that still
  // names them would break that promise with data they can no longer add to.
  const rows = await sql<LeaderRow[]>`
    SELECT c.discord_id, COUNT(*)::int AS crowns, COUNT(*) OVER () AS holders
    FROM lastfm_crowns c
    WHERE c.guild_id = ${guildId}
      AND NOT EXISTS (
        SELECT 1 FROM lastfm_hidden h
        WHERE h.guild_id = c.guild_id AND h.discord_id = c.discord_id
      )
    GROUP BY c.discord_id
    ORDER BY crowns DESC, c.discord_id ASC
    LIMIT ${LEADER_LIMIT}
  `;

  if (rows.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, "Nobody holds a crown in this server yet."),
      EMBED_COLOR,
    );
    return;
  }

  // displayName() is cached but still a REST call on a miss, so the leaderboard
  // resolves its names through the same bounded fan-out as everything else.
  const names = await mapLimited(rows, CONCURRENCY, (row) =>
    displayName(guildId, row.discord_id),
  );

  const lines = rows.map((row, i) => {
    const name = memberName(names[i] ?? "unknown");
    return `\`${i + 1}\` **${name}** · **${plural(Number(row.crowns) || 0, "crown")}**`;
  });

  const holders = Number(rows[0]?.holders ?? rows.length) || rows.length;

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: heading,
      noun: holders === 1 ? "crown holder" : "crown holders",
      total: holders,
      ...(holders > rows.length
        ? {
            footer: `top ${rows.length.toLocaleString("en-US")} of ${holders.toLocaleString("en-US")} crown holders`,
          }
        : {}),
    }),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* ,playing                                                           */
/* ------------------------------------------------------------------ */

interface LinkedRow {
  discord_id: string;
  username: string;
}

interface Listening {
  discordId: string;
  username: string;
  track: RecentTrack;
}

async function playing(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "Playing now");
  if (!guildId) return;

  const heading = "Playing right now";
  const memberIds = [...(await guildMemberIds(guildId))];

  if (memberIds.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, "I could not read this server's member list."),
      EMBED_COLOR,
    );
    return;
  }

  // Hiding is a request not to be listed; honouring it here as well as in
  // whoknows costs nothing and is what a hidden member expects.
  const linked = await sql<LinkedRow[]>`
    SELECT u.discord_id, u.username
    FROM lastfm_users u
    WHERE u.discord_id = ANY(${memberIds}::text[])
      AND NOT EXISTS (
        SELECT 1 FROM lastfm_hidden h
        WHERE h.guild_id = ${guildId} AND h.discord_id = u.discord_id
      )
    ORDER BY u.discord_id ASC
  `;

  if (linked.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, "Nobody here has linked a Last.fm account yet. Run `,lf link`."),
      EMBED_COLOR,
    );
    return;
  }

  const scanned = linked.slice(0, SCAN_CAP);

  const results = await mapLimited(scanned, CONCURRENCY, async (row): Promise<Listening | null> => {
    try {
      const { tracks } = await getRecentTracks(row.username, 1);
      const track = tracks[0];
      // Only a live scrobble counts; the endpoint returns the last played
      // track either way, and "@attr" is what separates the two.
      if (!track || track["@attr"]?.nowplaying !== "true") return null;
      return { discordId: row.discord_id, username: row.username, track };
    } catch {
      // One member's dead account must not sink the whole listing.
      return null;
    }
  });

  const live = results.filter((entry): entry is Listening => entry !== null);

  if (live.length === 0) {
    await paginate(
      ctx,
      simpleCard(
        heading,
        `Nobody is listening to anything right now. Checked ${plural(scanned.length, "member")}.`,
      ),
      EMBED_COLOR,
    );
    return;
  }

  const names = await mapLimited(live, CONCURRENCY, (entry) =>
    displayName(guildId, entry.discordId),
  );

  const rendered = live.map((entry, i) => {
    const name = memberName(names[i] ?? entry.username);
    const artist = entry.track.artist?.name ?? entry.track.artist?.["#text"] ?? "Unknown artist";
    const artistHref = link(entry.track.artist?.url, artistUrl(artist));
    const trackHref = link(
      entry.track.url,
      `${artistUrl(artist)}/_/${encodeURIComponent(entry.track.name)}`,
    );
    return {
      name,
      line: `**${name}** · **[${label(entry.track.name)}](${trackHref})** by [${label(artist)}](${artistHref})`,
    };
  });

  rendered.sort((a, b) => a.name.localeCompare(b.name));
  const lines = rendered.map((entry, i) => `\`${i + 1}\` ${entry.line}`);

  const capped =
    linked.length > scanned.length
      ? ` • scanned ${scanned.length} of ${linked.length.toLocaleString("en-US")} linked members`
      : "";

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: heading,
      noun: "listeners",
      total: live.length,
      footer: `${plural(live.length, "member")} listening now${capped}`,
    }),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* ,hide                                                              */
/* ------------------------------------------------------------------ */

interface HiddenRow {
  discord_id: string;
  hidden_at: Date | string | null;
}

async function hideList(ctx: PrefixContext, guildId: string): Promise<void> {
  const heading = "Hidden members";

  const rows = await sql<HiddenRow[]>`
    SELECT discord_id, hidden_at
    FROM lastfm_hidden
    WHERE guild_id = ${guildId}
    ORDER BY hidden_at DESC
    LIMIT ${HIDDEN_LIMIT}
  `;

  if (rows.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, "Nobody is hidden in this server."),
      EMBED_COLOR,
    );
    return;
  }

  const names = await mapLimited(rows, CONCURRENCY, (row) => displayName(guildId, row.discord_id));

  const lines = rows.map((row, i) => {
    const name = memberName(names[i] ?? "unknown");
    const stamp = when(row.hidden_at);
    return `\`${i + 1}\` **${name}**${stamp ? ` · hidden ${stamp}` : ""}`;
  });

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: heading,
      noun: "hidden members",
      total: rows.length,
      footer:
        rows.length === HIDDEN_LIMIT
          ? `first ${HIDDEN_LIMIT} hidden members • \`,hide @user\` to unhide`
          : `${plural(rows.length, "hidden member")} • \`,hide @user\` to unhide`,
    }),
    EMBED_COLOR,
  );
}

async function hide(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "Hide");
  if (!guildId) return;

  // `list` is a subcommand of hide rather than a command of its own.
  const first = (ctx.argument.trim().split(/\s+/)[0] ?? "").toLowerCase();
  if (first.startsWith("list")) {
    await hideList(ctx, guildId);
    return;
  }

  const target = targetOf(ctx);
  const heading = "Hide";

  // Hiding yourself is always allowed; hiding anyone else is moderation.
  if (target.id !== ctx.authorId && !(await canManageGuild(guildId, ctx.authorId))) {
    await paginate(
      ctx,
      simpleCard(
        heading,
        "Hiding someone else needs the **Manage Server** permission. You can always hide yourself with `,hide`.",
      ),
      EMBED_COLOR,
    );
    return;
  }

  const name = memberName(await displayName(guildId, target.id));

  // Delete-then-insert makes the toggle a single decision: whether a row was
  // actually removed. A read followed by a write could race two moderators
  // into both believing they hid the same member.
  const removed = await sql<{ discord_id: string }[]>`
    DELETE FROM lastfm_hidden
    WHERE guild_id = ${guildId} AND discord_id = ${target.id}
    RETURNING discord_id
  `;

  if (removed.length > 0) {
    await paginate(
      ctx,
      simpleCard(heading, `**${name}** is no longer hidden and will appear in listings again.`),
      EMBED_COLOR,
    );
    return;
  }

  await sql`
    INSERT INTO lastfm_hidden (guild_id, discord_id, hidden_by)
    VALUES (${guildId}, ${target.id}, ${ctx.authorId})
    ON CONFLICT (guild_id, discord_id) DO NOTHING
  `;

  await paginate(
    ctx,
    simpleCard(
      heading,
      `**${name}** is now hidden from whoknows and server listings.\n-# Run \`,hide\` on them again to undo it.`,
    ),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

export function registerCrowns(): void {
  register({
    name: "crowns",
    description: "Artists you top this server for",
    handler: guard(crowns),
  });
  register({
    name: "mostcrowns",
    aliases: ["crownleaderboard", "cl"],
    description: "Who holds the most crowns in this server",
    handler: guard(mostCrowns),
  });
  register({
    name: "playing",
    description: "What the server is listening to right now",
    handler: guard(playing),
  });
  register({
    name: "hide",
    description: "Hide a member (Manage Server)",
    handler: guard(hide),
  });
}
