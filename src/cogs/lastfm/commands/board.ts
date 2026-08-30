import process from "node:process";
import { sql } from "../../../core/db.js";
import { displayName } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  USER_ACCENT,
  buildPages,
  label,
  plural,
  simpleCard,
  url,
} from "../shared.js";

const MAX_ROWS = 100;

const NAME_CONCURRENCY = 5;

const UP = "up";
const DOWN = "down";

type Id = string | bigint;

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

interface Tally {
  up: number;
  down: number;
  net: number;
}

const asId = (value: Id): string => String(value);

export async function recordNpPost(
  messageId: Id,
  guildId: Id | null | undefined,
  discordId: Id,
): Promise<void> {
  try {
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

export async function recordVote(messageId: Id, reactorId: Id, vote: number): Promise<void> {
  try {
    const message = asId(messageId);
    const reactor = asId(reactorId);
    if (!message || !reactor) return;

    if (reactor === selfId()) return;

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

      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

function boardLine(rank: number, name: string, row: Tally): string {
  const sign = row.net > 0 ? "+" : "";
  const net = `${sign}${row.net.toLocaleString("en-US")}`;
  return (
    `\`${rank}\` **${name}**: **${net}**` +
    ` • ${UP} ${row.up.toLocaleString("en-US")}` +
    ` • ${DOWN} ${row.down.toLocaleString("en-US")}`
  );
}

const num = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function footerFor(shown: number, capped: boolean, noun: string): string {
  const base = `${plural(shown, noun)} ranked`;
  return capped ? `${base} • capped at the top ${MAX_ROWS}` : base;
}

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

interface GuildRow extends Tally {
  discord_id: string;
}

async function scoreboard(ctx: PrefixContext): Promise<void> {
  const heading = "Now-playing scoreboard";

  if (!ctx.guildId) {
    await paginate(
      ctx,
      simpleCard(heading, "This board is per-server. Run it in a server, not in a DM."),
      USER_ACCENT,
    );
    return;
  }
  const guildId = ctx.guildId;

  const self = selfId();

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
    await paginate(ctx, emptyCard(heading, "in this server"), USER_ACCENT);
    return;
  }

  const capped = rows.length > MAX_ROWS;

  const shown: GuildRow[] = rows.slice(0, MAX_ROWS);

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
      username: "",
      icon: null,
      noun: "members",
      total: shown.length,
      footer: footerFor(shown.length, capped, "member"),
    }),
    USER_ACCENT,
  );
}

interface GlobalRow extends Tally {
  username: string;
}

const lastfmUser = (name: string) =>
  url(`https://www.last.fm/user/${encodeURIComponent(name)}`, "https://www.last.fm");

async function globalboard(ctx: PrefixContext): Promise<void> {
  const heading = "Global scoreboard";
  const self = selfId();

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
    await paginate(ctx, emptyCard(heading, "anywhere"), USER_ACCENT);
    return;
  }

  const capped = rows.length > MAX_ROWS;
  const shown: GlobalRow[] = rows.slice(0, MAX_ROWS);

  const lines = shown.map((row, i) => {
    const name = row.username ?? "";

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
    USER_ACCENT,
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
