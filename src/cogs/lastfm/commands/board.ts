/**
 * Reaction scoreboards.
 *
 * Every `,np` card is posted with up and down reactions, so the gateway can
 * turn those into votes: `recordNpPost` remembers which post belongs to whom,
 * and `recordVote` / `removeVote` keep one row per (post, reactor). The two
 * commands here are just tallies over that pair of tables: `,scoreboard` for
 * the current guild and `,globalboard` across every guild, keyed by Last.fm
 * name so one person's score follows them between servers.
 */

import process from "node:process";
import { sql } from "../../../core/db.js";
import { displayName } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  EMBED_COLOR,
  buildPages,
  label,
  plural,
  simpleCard,
  url,
} from "../shared.js";

/**
 * Rows past this are dropped rather than rendered. The guild board resolves a
 * display name per row over the Discord API, so an unbounded board would mean
 * an unbounded fan-out; the footer says when the list was cut.
 */
const MAX_ROWS = 100;

/** In-flight display-name lookups. Small: these are REST calls, not queries. */
const NAME_CONCURRENCY = 5;

const UP = "up";
const DOWN = "down";

/** Ids arrive as strings from the prefix layer and as bigints from the gateway. */
type Id = string | bigint;

/**
 * The bot's own user id.
 *
 * `,np` seeds every card with both reactions, and Discord dispatches the bot's
 * own reactions as ordinary MESSAGE_REACTION_ADD events. Without this the bot
 * votes on every post it makes: two inserts under the same (message, reactor)
 * key, so the downvote overwrites the upvote and every card carries a phantom
 * -1. The author is not voting on themselves, but nobody cast that vote either.
 *
 * The id is the first token segment base64-decoded, which is how the gateway
 * library derives it too. Resolved lazily and only cached once it parses, so
 * import order relative to the environment cannot pin it to an empty string.
 */
let cachedSelfId = "";
function selfId(): string {
  if (cachedSelfId) return cachedSelfId;
  const first = (process.env.DISCORD_TOKEN ?? "").split(".")[0] ?? "";
  let decoded = "";
  try {
    decoded = Buffer.from(first, "base64").toString("utf8");
  } catch {
    decoded = "";
  }
  cachedSelfId = /^\d{15,25}$/.test(decoded) ? decoded : "";
  return cachedSelfId;
}

/** One tallied row, before it is turned into a line. */
interface Tally {
  up: number;
  down: number;
  net: number;
}

/* ------------------------------------------------------------------ */
/* Event-side helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * These three run from gateway events, where there is no command context to
 * report into and a rejection would surface as an unhandled promise. They
 * swallow everything and never throw.
 */

const asId = (value: Id): string => String(value);

/** Remembers a now-playing post so its reactions can be counted. */
export async function recordNpPost(
  messageId: Id,
  guildId: Id | null | undefined,
  discordId: Id,
): Promise<void> {
  try {
    // DM posts have nobody to compete with, so they are not tracked.
    if (guildId === null || guildId === undefined) return;
    const message = asId(messageId);
    const guild = asId(guildId);
    const author = asId(discordId);
    if (!message || !guild || !author) return;

    await sql`
      INSERT INTO lastfm_np_posts (message_id, guild_id, discord_id)
      VALUES (${message}, ${guild}, ${author})
      ON CONFLICT (message_id) DO NOTHING
    `;
  } catch (err) {
    console.error("board: recordNpPost failed:", err);
  }
}

/**
 * Casts one vote, replacing that reactor's previous one.
 *
 * The insert selects from lastfm_np_posts rather than checking first: an
 * untracked message (anything the bot did not post as `,np`) matches no row, so
 * nothing is inserted and the foreign key is never violated, and the same WHERE
 * drops a self-vote in the one round trip.
 *
 * The select-list values are cast explicitly because a parameter in an
 * `INSERT ... SELECT` target list has no column to take its type from.
 * Postgres would reject the statement with "could not determine data type".
 */
export async function recordVote(messageId: Id, reactorId: Id, vote: number): Promise<void> {
  try {
    const message = asId(messageId);
    const reactor = asId(reactorId);
    if (!message || !reactor) return;

    // The bot's own seeded reactions are not votes. removeVote deliberately
    // has no such guard, so a bot reaction that predates this check can still
    // be cleared by taking the reaction off.
    if (reactor === selfId()) return;

    // Anything that is not a clear up or down is not a vote.
    const value = vote > 0 ? 1 : vote < 0 ? -1 : 0;
    if (value === 0) return;

    await sql`
      INSERT INTO lastfm_np_votes (message_id, reactor_id, vote)
      SELECT ${message}::text, ${reactor}::text, ${value}::smallint
      FROM lastfm_np_posts
      WHERE message_id = ${message}
        AND discord_id <> ${reactor}
      ON CONFLICT (message_id, reactor_id) DO UPDATE
        SET vote = EXCLUDED.vote
    `;
  } catch (err) {
    console.error("board: recordVote failed:", err);
  }
}

/** Withdraws a vote, for when the reaction is removed again. */
export async function removeVote(messageId: Id, reactorId: Id): Promise<void> {
  try {
    const message = asId(messageId);
    const reactor = asId(reactorId);
    if (!message || !reactor) return;

    await sql`
      DELETE FROM lastfm_np_votes
      WHERE message_id = ${message} AND reactor_id = ${reactor}
    `;
  } catch (err) {
    console.error("board: removeVote failed:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Runs `worker` over `items` a few at a time, preserving order. A board of a
 * hundred members would otherwise open a hundred simultaneous REST calls.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      // A hole skips its own slot; returning here would retire the runner and
      // leave every later row unresolved.
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** `1` Name: **+12** • up 14 • down 2 */
function boardLine(rank: number, name: string, row: Tally): string {
  const sign = row.net > 0 ? "+" : "";
  const net = `${sign}${row.net.toLocaleString("en-US")}`;
  return (
    `\`${rank}\` **${name}**: **${net}**` +
    ` • ${UP} ${row.up.toLocaleString("en-US")}` +
    ` • ${DOWN} ${row.down.toLocaleString("en-US")}`
  );
}

/** Counts are cast to int in SQL, but a driver surprise should not render NaN. */
const num = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `noun` is the singular; plural() handles the rest. */
function footerFor(shown: number, capped: boolean, noun: string): string {
  const base = `${plural(shown, noun)} ranked`;
  return capped ? `${base} • capped at the top ${MAX_ROWS}` : base;
}

/** Shown when a board has no votes on it yet. */
function emptyCard(heading: string, scope: string): unknown[][] {
  return simpleCard(
    heading,
    [
      `No votes ${scope} yet.`,
      "",
      "The bot adds a thumbs up and a thumbs down to every `,np` card.",
      "React with either one on someone else's card to vote on what",
      "they are playing, and the tally shows up here.",
      "",
      "-# One vote per person per post, and you cannot vote on your own.",
    ].join("\n"),
  );
}

/* ------------------------------------------------------------------ */
/* ,scoreboard                                                         */
/* ------------------------------------------------------------------ */

interface GuildRow extends Tally {
  discord_id: string;
}

async function scoreboard(ctx: PrefixContext): Promise<void> {
  const heading = "Now-playing scoreboard";

  if (!ctx.guildId) {
    await paginate(
      ctx,
      simpleCard(heading, "This board is per-server. Run it in a server, not in a DM."),
      EMBED_COLOR,
    );
    return;
  }
  const guildId = ctx.guildId;
  // Rows the bot cast before recordVote learned to refuse itself are still in
  // the table; excluding it here keeps old data from skewing the tally.
  const self = selfId();

  // One extra row is fetched purely to detect that the board was cut.
  const rows = await sql<GuildRow[]>`
    SELECT
      p.discord_id AS discord_id,
      COUNT(*) FILTER (WHERE v.vote > 0)::int AS up,
      COUNT(*) FILTER (WHERE v.vote < 0)::int AS down,
      (COUNT(*) FILTER (WHERE v.vote > 0)
        - COUNT(*) FILTER (WHERE v.vote < 0))::int AS net
    FROM lastfm_np_posts p
    JOIN lastfm_np_votes v
      ON v.message_id = p.message_id
     AND v.reactor_id <> ${self}
    WHERE p.guild_id = ${guildId}
    GROUP BY p.discord_id
    ORDER BY
      (COUNT(*) FILTER (WHERE v.vote > 0)
        - COUNT(*) FILTER (WHERE v.vote < 0)) DESC,
      COUNT(*) FILTER (WHERE v.vote > 0) DESC,
      p.discord_id
    LIMIT ${MAX_ROWS + 1}
  `;

  if (rows.length === 0) {
    await paginate(ctx, emptyCard(heading, "in this server"), EMBED_COLOR);
    return;
  }

  const capped = rows.length > MAX_ROWS;
  // Sliced unconditionally so this is a plain array rather than the driver's
  // own row list, which only some of the time behaves like one.
  const shown: GuildRow[] = rows.slice(0, MAX_ROWS);

  // Bounded fan-out: display names come from the REST API, a few at a time.
  const names = await mapLimit(shown, NAME_CONCURRENCY, (row) =>
    displayName(guildId, row.discord_id),
  );

  const lines = shown.map((row, i) =>
    boardLine(i + 1, label(names[i] ?? row.discord_id), {
      up: num(row.up),
      down: num(row.down),
      net: num(row.net),
    }),
  );

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      // buildPages does not render this; the board is not one person's card.
      username: "",
      icon: null,
      noun: "members",
      total: shown.length,
      footer: footerFor(shown.length, capped, "member"),
    }),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* ,globalboard                                                        */
/* ------------------------------------------------------------------ */

interface GlobalRow extends Tally {
  username: string;
}

const lastfmUser = (name: string) =>
  url(`https://www.last.fm/user/${encodeURIComponent(name)}`, "https://www.last.fm");

async function globalboard(ctx: PrefixContext): Promise<void> {
  const heading = "Global scoreboard";
  const self = selfId();

  // Grouped on the lowercased name so a re-link with different casing does not
  // split one listener into two rows; MIN() picks a stable spelling to show.
  const rows = await sql<GlobalRow[]>`
    SELECT
      MIN(u.username) AS username,
      COUNT(*) FILTER (WHERE v.vote > 0)::int AS up,
      COUNT(*) FILTER (WHERE v.vote < 0)::int AS down,
      (COUNT(*) FILTER (WHERE v.vote > 0)
        - COUNT(*) FILTER (WHERE v.vote < 0))::int AS net
    FROM lastfm_np_posts p
    JOIN lastfm_np_votes v
      ON v.message_id = p.message_id
     AND v.reactor_id <> ${self}
    JOIN lastfm_users u ON u.discord_id = p.discord_id
    GROUP BY lower(u.username)
    ORDER BY
      (COUNT(*) FILTER (WHERE v.vote > 0)
        - COUNT(*) FILTER (WHERE v.vote < 0)) DESC,
      COUNT(*) FILTER (WHERE v.vote > 0) DESC,
      lower(u.username)
    LIMIT ${MAX_ROWS + 1}
  `;

  if (rows.length === 0) {
    await paginate(ctx, emptyCard(heading, "anywhere"), EMBED_COLOR);
    return;
  }

  const capped = rows.length > MAX_ROWS;
  const shown: GlobalRow[] = rows.slice(0, MAX_ROWS);

  const lines = shown.map((row, i) => {
    const name = row.username ?? "";
    // An empty name would render as a literal "[](…)" rather than a link.
    const link = name ? `[${label(name)}](${lastfmUser(name)})` : "unknown";
    return boardLine(i + 1, link, {
      up: num(row.up),
      down: num(row.down),
      net: num(row.net),
    });
  });

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: "",
      icon: null,
      noun: "listeners",
      total: shown.length,
      footer: footerFor(shown.length, capped, "listener"),
    }),
    EMBED_COLOR,
  );
}

export function registerBoard(): void {
  register({
    name: "scoreboard",
    aliases: ["sb"],
    description: "This server's now-playing vote tally",
    handler: guard(scoreboard),
  });
  register({
    name: "globalboard",
    aliases: ["gb"],
    description: "The now-playing vote tally across every server",
    handler: guard(globalboard),
  });
}
