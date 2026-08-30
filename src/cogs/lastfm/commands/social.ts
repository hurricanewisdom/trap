import { guildMemberIds, displayName } from "../../../core/discord.js";
import { sql } from "../../../core/db.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { getTopArtists, getUserInfo } from "../api/index.js";
import {
  USER_ACCENT,
  TargetError,
  artistUrl,
  buildPages,
  label,
  plural,
  simpleCard,
  url,
} from "../shared.js";
import { getUsername } from "../store.js";

const SCAN_CAP = 100;
const CONCURRENCY = 5;

const MENTION = /^<@!?(\d{15,25})>$/;

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      out[index] = await job(item);
    }
  });
  await Promise.all(workers);
  return out;
}

async function linkedMembers(
  guildId: string,
): Promise<{ rows: { discord_id: string; username: string }[]; capped: boolean }> {
  const memberIds = [...(await guildMemberIds(guildId))];
  if (memberIds.length === 0) return { rows: [], capped: false };

  const rows = await sql<{ discord_id: string; username: string }[]>`
    SELECT u.discord_id, u.username
    FROM lastfm_users u
    WHERE u.discord_id = ANY(${memberIds})
      AND NOT EXISTS (
        SELECT 1 FROM lastfm_hidden h
        WHERE h.guild_id = ${guildId} AND h.discord_id = u.discord_id
      )
  `;
  return { rows: rows.slice(0, SCAN_CAP), capped: rows.length > SCAN_CAP };
}

function requireGuild(ctx: PrefixContext): string {
  if (!ctx.guildId) throw new TargetError("This only works inside a server, not in DMs.");
  return ctx.guildId;
}

async function bothSides(ctx: PrefixContext): Promise<{ mine: string; theirs: string; label: string }> {
  const first = ctx.argument.trim().split(/\s+/)[0] ?? "";
  const mention = MENTION.exec(first);
  if (!mention) throw new TargetError("Mention someone to compare against.");

  const mine = await getUsername(ctx.authorId);
  if (!mine) throw new TargetError("You have not linked a Last.fm account. Run `,lf link`.");

  const theirs = await getUsername(mention[1] as string);
  if (!theirs) throw new TargetError("That user has not linked a Last.fm account.");
  if (theirs.toLowerCase() === mine.toLowerCase()) {
    throw new TargetError("That is your own account.");
  }

  return { mine, theirs, label: `<@${mention[1]}>` };
}

async function common(ctx: PrefixContext): Promise<void> {
  const { mine, theirs } = await bothSides(ctx);
  const [a, b] = await Promise.all([
    getTopArtists(mine, "overall", 300),
    getTopArtists(theirs, "overall", 300),
  ]);

  const theirsBy = new Map(b.items.map((x) => [x.name.toLowerCase(), Number(x.playcount ?? 0)]));
  const shared = a.items
    .map((x) => ({ name: x.name, mine: Number(x.playcount ?? 0), theirs: theirsBy.get(x.name.toLowerCase()) ?? 0 }))
    .filter((x) => x.theirs > 0)
    .sort((x, y) => y.mine + y.theirs - (x.mine + x.theirs));

  const heading = `${mine} and ${theirs}`;
  if (shared.length === 0) {
    await paginate(ctx, simpleCard(heading, "Nothing in common across your top 300 artists each."), USER_ACCENT);
    return;
  }

  const rows = shared.map(
    (x, i) =>
      `\`${i + 1}\` **[${label(x.name)}](${artistUrl(x.name)})** · ${x.mine.toLocaleString("en-US")} vs ${x.theirs.toLocaleString("en-US")}`,
  );

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: mine,
      noun: "artists",
      total: shared.length,
      footer: `${plural(shared.length, "artist")} in common, out of the top 300 each`,
    }),
    USER_ACCENT,
  );
}

async function unique(ctx: PrefixContext): Promise<void> {
  const { mine, theirs } = await bothSides(ctx);
  const [a, b] = await Promise.all([
    getTopArtists(mine, "overall", 300),
    getTopArtists(theirs, "overall", 300),
  ]);

  const known = new Set(b.items.map((x) => x.name.toLowerCase()));
  const only = a.items.filter((x) => !known.has(x.name.toLowerCase()));

  const heading = `Only ${mine} listens to these`;
  if (only.length === 0) {
    await paginate(ctx, simpleCard(heading, "You have nothing they do not."), USER_ACCENT);
    return;
  }

  const rows = only.map(
    (x, i) =>
      `\`${i + 1}\` **[${label(x.name)}](${url(x.url, artistUrl(x.name))})** · ${plural(Number(x.playcount ?? 0), "play")}`,
  );

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: mine,
      noun: "artists",
      total: only.length,
      footer: `${plural(only.length, "artist")} of yours missing from ${theirs}'s top 300`,
    }),
    USER_ACCENT,
  );
}

async function serverArtists(ctx: PrefixContext): Promise<void> {
  const guildId = requireGuild(ctx);
  const { rows, capped } = await linkedMembers(guildId);
  const heading = "Server top artists";

  if (rows.length === 0) {
    await paginate(ctx, simpleCard(heading, "Nobody here has linked a Last.fm account yet."), USER_ACCENT);
    return;
  }

  const charts = await mapLimited(rows, CONCURRENCY, async (row) => {
    try {
      return await getTopArtists(row.username, "overall", 100);
    } catch {
      return { items: [], total: 0 };
    }
  });

  const totals = new Map<string, { plays: number; fans: number }>();
  for (const chart of charts) {
    for (const artist of chart.items) {
      const key = artist.name;
      const entry = totals.get(key) ?? { plays: 0, fans: 0 };
      entry.plays += Number(artist.playcount ?? 0);
      entry.fans += 1;
      totals.set(key, entry);
    }
  }

  const ranked = [...totals.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.plays - a.plays);

  const listRows = ranked.map(
    (a, i) =>
      `\`${i + 1}\` **[${label(a.name)}](${artistUrl(a.name)})** · ${plural(a.plays, "play")} · ${plural(a.fans, "listener")}`,
  );

  await paginate(
    ctx,
    buildPages(listRows, {
      heading,
      username: "server",
      noun: "artists",
      total: ranked.length,
      footer: `Across ${plural(rows.length, "member")}${capped ? `, capped at ${SCAN_CAP}` : ""}`,
    }),
    USER_ACCENT,
  );
}

async function leaderboard(ctx: PrefixContext): Promise<void> {
  const guildId = requireGuild(ctx);
  const { rows, capped } = await linkedMembers(guildId);
  const heading = "Server scrobble leaderboard";

  if (rows.length === 0) {
    await paginate(ctx, simpleCard(heading, "Nobody here has linked a Last.fm account yet."), USER_ACCENT);
    return;
  }

  const counts = await mapLimited(rows, CONCURRENCY, async (row) => {
    try {
      const info = await getUserInfo(row.username);
      return { row, plays: Number(info.playcount ?? 0) };
    } catch {
      return { row, plays: 0 };
    }
  });

  const ranked = counts.filter((c) => c.plays > 0).sort((a, b) => b.plays - a.plays);
  if (ranked.length === 0) {
    await paginate(ctx, simpleCard(heading, "No scrobbles among the linked members here."), USER_ACCENT);
    return;
  }

  const names = await mapLimited(ranked, CONCURRENCY, (entry) =>
    displayName(guildId, entry.row.discord_id),
  );

  const listRows = ranked.map(
    (entry, i) => `\`${i + 1}\` **${label(names[i] ?? entry.row.username)}** · ${plural(entry.plays, "scrobble")}`,
  );

  const total = ranked.reduce((sum, r) => sum + r.plays, 0);
  await paginate(
    ctx,
    buildPages(listRows, {
      heading,
      username: "server",
      noun: "members",
      total: ranked.length,
      footer: `${plural(total, "scrobble")} between them${capped ? `, capped at ${SCAN_CAP} members` : ""}`,
    }),
    USER_ACCENT,
  );
}

async function serverTaste(ctx: PrefixContext): Promise<void> {
  const guildId = requireGuild(ctx);
  const { rows, capped } = await linkedMembers(guildId);
  const heading = "Server obscurity";

  if (rows.length === 0) {
    await paginate(ctx, simpleCard(heading, "Nobody here has linked a Last.fm account yet."), USER_ACCENT);
    return;
  }

  const scored = await mapLimited(rows, CONCURRENCY, async (row) => {
    try {
      const { items } = await getTopArtists(row.username, "overall", 30);
      if (items.length === 0) return { row, score: -1 };

      const plays = items.map((a) => Number(a.playcount ?? 0));
      const top = plays[0] ?? 1;
      const spread = plays.reduce((sum, p) => sum + p / top, 0) / plays.length;
      return { row, score: Math.round((1 - spread) * 100) };
    } catch {
      return { row, score: -1 };
    }
  });

  const ranked = scored.filter((s) => s.score >= 0).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    await paginate(ctx, simpleCard(heading, "Not enough listening history here yet."), USER_ACCENT);
    return;
  }

  const names = await mapLimited(ranked, CONCURRENCY, (entry) =>
    displayName(guildId, entry.row.discord_id),
  );

  const listRows = ranked.map(
    (entry, i) => `\`${i + 1}\` **${label(names[i] ?? entry.row.username)}** · ${entry.score}/100`,
  );

  await paginate(
    ctx,
    buildPages(listRows, {
      heading,
      username: "server",
      noun: "members",
      total: ranked.length,
      footer: `Higher means a flatter, more varied chart${capped ? `, capped at ${SCAN_CAP} members` : ""}`,
    }),
    USER_ACCENT,
  );
}

export function registerSocial(): void {
  const add = (
    name: string,
    aliases: string[],
    description: string,
    handler: (ctx: PrefixContext) => Promise<void>,
  ) => register({ name, aliases, description, handler: guard(handler) });

  add("common", ["shared", "overlap"], "Artists you and someone else both play", common);
  add("unique", ["onlyme", "mine"], "Artists you play that they do not", unique);
  add("serverartists", ["sa", "guildartists"], "Top artists across this server", serverArtists);
  add("leaderboard", ["lb", "topscrobblers"], "Who has scrobbled the most here", leaderboard);
  add("serverobscurity", ["obscurityboard"], "Whose chart is the most varied here", serverTaste);
}
