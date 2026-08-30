/**
 * Numbers about your own listening, and the preferences that shape how the
 * other commands behave for you.
 */

import { sql } from "../../../core/db.js";
import { redis } from "../../../core/redis.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { getArtistInfo, getTopAlbums, getTopArtists, getTopTracks, getUserInfo } from "../api/index.js";
import {
  EMBED_COLOR,
  TargetError,
  artistUrl,
  avatarOf,
  bar,
  buildPages,
  history,
  label,
  periodLabel,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  tally,
  timed,
  url,
} from "../shared.js";
import { getUsername } from "../store.js";

/** Preferences live next to the other per-user settings. */
const PREF_TTL = 60;
const prefKey = (discordId: string) => `trap:lf:pref:${discordId}`;

export interface Prefs {
  period: string | null;
  chartSize: number | null;
}

export async function getPrefs(discordId: string): Promise<Prefs> {
  try {
    const hit = await redis.get(prefKey(discordId));
    if (hit) return JSON.parse(hit) as Prefs;
  } catch {
    /* fall through */
  }
  const rows = await sql<{ default_period: string | null; chart_size: number | null }[]>`
    SELECT default_period, chart_size FROM lastfm_prefs WHERE discord_id = ${discordId}
  `;
  const prefs: Prefs = {
    period: rows[0]?.default_period ?? null,
    chartSize: rows[0]?.chart_size ?? null,
  };
  redis.set(prefKey(discordId), JSON.stringify(prefs), "EX", PREF_TTL).catch(() => {});
  return prefs;
}

async function savePrefs(discordId: string, patch: Partial<Prefs>): Promise<void> {
  await sql`
    INSERT INTO lastfm_prefs (discord_id, default_period, chart_size)
    VALUES (${discordId}, ${patch.period ?? null}, ${patch.chartSize ?? null})
    ON CONFLICT (discord_id) DO UPDATE SET
      default_period = COALESCE(${patch.period ?? null}, lastfm_prefs.default_period),
      chart_size     = COALESCE(${patch.chartSize ?? null}, lastfm_prefs.chart_size),
      updated_at     = now()
  `;
  await redis.del(prefKey(discordId)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/** One card with the headline figures. */
async function stats(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const info = await profile(target.username);
  const icon = avatarOf(info);

  const [artists, albums, tracks] = await Promise.all([
    getTopArtists(target.username, "overall", 1),
    getTopAlbums(target.username, "overall", 1),
    getTopTracks(target.username, "overall", 1),
  ]);

  const scrobbles = Number(info?.playcount ?? 0);
  const registered = Number(info?.registered?.unixtime ?? 0);
  const days = registered ? Math.max((Date.now() / 1000 - registered) / 86400, 1) : 0;

  const body = [
    `**Scrobbles** ${scrobbles.toLocaleString("en-US")}`,
    `**Artists** ${artists.total.toLocaleString("en-US")}`,
    `**Albums** ${albums.total.toLocaleString("en-US")}`,
    `**Tracks** ${tracks.total.toLocaleString("en-US")}`,
    "",
    ...(days
      ? [
          `**Per day** ${(scrobbles / days).toFixed(1)} over ${Math.round(days).toLocaleString("en-US")} days`,
          `**Since** <t:${registered}:D>`,
        ]
      : []),
    ...(artists.total
      ? [`**Repeat rate** ${(scrobbles / Math.max(tracks.total, 1)).toFixed(1)} plays per track`]
      : []),
  ].join("\n");

  await paginate(ctx, simpleCard(`${target.username}'s numbers`, body, icon), EMBED_COLOR);
}

/** How far your top artists sit from the mainstream. */
async function obscurity(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const { items } = await getTopArtists(target.username, "overall", 20);
  const heading = `${target.username}'s obscurity`;

  if (items.length === 0) {
    await paginate(ctx, simpleCard(heading, "Play something first.", icon), EMBED_COLOR);
    return;
  }

  const sample = items.slice(0, 12);
  const listeners: number[] = [];
  for (const artist of sample) {
    const info = await getArtistInfo(artist.name);
    const count = Number(info?.stats?.listeners ?? 0);
    if (count > 0) listeners.push(count);
  }

  if (listeners.length === 0) {
    await paginate(ctx, simpleCard(heading, "Last.fm had no listener counts for your top artists.", icon), EMBED_COLOR);
    return;
  }

  const median = listeners.slice().sort((a, b) => a - b)[Math.floor(listeners.length / 2)] ?? 0;
  // A million listeners is thoroughly mainstream; a thousand is deep cuts.
  const score = Math.max(0, Math.min(100, Math.round(100 - (Math.log10(Math.max(median, 1)) / 6) * 100)));
  const verdict =
    score > 70 ? "Deep cuts." : score > 45 ? "Off the beaten track." : score > 25 ? "Fairly popular." : "Chart music.";

  const body = [
    `\`${bar(score, 100, 20)}\` **${score}**/100`,
    verdict,
    "",
    `**Median listeners** ${median.toLocaleString("en-US")} across your top ${listeners.length} artists`,
    `-# Higher means fewer people listen to what you do.`,
  ].join("\n");

  await paginate(ctx, simpleCard(heading, body, icon), EMBED_COLOR);
}

/** How wide your listening spreads, rather than how deep. */
async function variety(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const info = await profile(target.username);
  const heading = `${target.username}'s variety`;

  const [artists, tracks] = await Promise.all([
    getTopArtists(target.username, "overall", 1),
    getTopTracks(target.username, "overall", 1),
  ]);
  const scrobbles = Number(info?.playcount ?? 0);
  if (scrobbles === 0 || artists.total === 0) {
    await paginate(ctx, simpleCard(heading, "Not enough history yet.", icon), EMBED_COLOR);
    return;
  }

  const perArtist = scrobbles / artists.total;
  const perTrack = scrobbles / Math.max(tracks.total, 1);
  const score = Math.max(0, Math.min(100, Math.round(100 - (perArtist / 60) * 100)));

  const body = [
    `\`${bar(score, 100, 20)}\` **${score}**/100`,
    score > 65 ? "You spread wide." : score > 35 ? "A balanced mix." : "You go deep on favourites.",
    "",
    `**Artists** ${artists.total.toLocaleString("en-US")} · ${perArtist.toFixed(1)} plays each`,
    `**Tracks** ${tracks.total.toLocaleString("en-US")} · ${perTrack.toFixed(1)} plays each`,
    `-# Higher means more artists for the same number of scrobbles.`,
  ].join("\n");

  await paginate(ctx, simpleCard(heading, body, icon), EMBED_COLOR);
}

/** The artists dominating your recent listening, as a share. */
async function share(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const { scrobbles } = await history(target.username);
  const heading = `${target.username}'s recent share`;

  const stamped = timed(scrobbles);
  if (stamped.length === 0) {
    await paginate(ctx, simpleCard(heading, "No recent scrobbles to measure.", icon), EMBED_COLOR);
    return;
  }

  const counts = tally(stamped, (s) => s.artist).slice(0, 25);
  const top = counts[0]?.count ?? 1;
  const rows = counts.map(
    (a, i) =>
      `\`${i + 1}\` ${bar(a.count, top, 10)} **[${label(a.name)}](${artistUrl(a.name)})** · ${((a.count / stamped.length) * 100).toFixed(1)}%`,
  );

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      icon,
      noun: "artists",
      total: counts.length,
      footer: `Share of your last ${plural(stamped.length, "scrobble")}`,
    }),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

const PERIODS = ["overall", "7day", "1month", "3month", "6month", "12month"];

async function defaultPeriod(ctx: PrefixContext): Promise<void> {
  const wanted = ctx.argument.trim().toLowerCase();
  const heading = "Default period";

  if (!wanted) {
    const prefs = await getPrefs(ctx.authorId);
    const current = prefs.period ?? "overall";
    await paginate(
      ctx,
      simpleCard(
        heading,
        [
          `Your charts default to **${periodLabel(current as never)}**.`,
          "",
          "`,defaultperiod overall` · `weekly` · `monthly` · `3month` · `6month` · `yearly`",
        ].join("\n"),
      ),
      EMBED_COLOR,
    );
    return;
  }

  const map: Record<string, string> = {
    overall: "overall", all: "overall", alltime: "overall",
    week: "7day", weekly: "7day", "7day": "7day",
    month: "1month", monthly: "1month", "1month": "1month",
    "3month": "3month", quarter: "3month",
    "6month": "6month", half: "6month",
    year: "12month", yearly: "12month", "12month": "12month",
  };
  const period = map[wanted];
  if (!period || !PERIODS.includes(period)) {
    throw new TargetError("Pick one of: overall, weekly, monthly, 3month, 6month, yearly.");
  }

  await savePrefs(ctx.authorId, { period });
  await paginate(
    ctx,
    simpleCard(heading, `Your charts now default to **${periodLabel(period as never)}**.`),
    EMBED_COLOR,
  );
}

async function chartSize(ctx: PrefixContext): Promise<void> {
  const raw = ctx.argument.trim();
  const heading = "Chart size";

  if (!raw) {
    const prefs = await getPrefs(ctx.authorId);
    await paginate(
      ctx,
      simpleCard(
        heading,
        `Your charts show **${prefs.chartSize ?? 10}** rows a page.\n\n\`,chartsize 5\` to 25.`,
      ),
      EMBED_COLOR,
    );
    return;
  }

  const size = Number.parseInt(raw, 10);
  if (!Number.isInteger(size) || size < 5 || size > 25) {
    throw new TargetError("Pick a number between 5 and 25.");
  }

  await savePrefs(ctx.authorId, { chartSize: size });
  await paginate(ctx, simpleCard(heading, `Charts will show **${size}** rows a page.`), EMBED_COLOR);
}

/** Which Last.fm account is attached to you, and how to change it. */
async function whoami(ctx: PrefixContext): Promise<void> {
  const username = await getUsername(ctx.authorId);
  const heading = "Your account";

  if (!username) {
    await paginate(
      ctx,
      simpleCard(heading, "You have not linked a Last.fm account. Run `,lf link`."),
      EMBED_COLOR,
    );
    return;
  }

  const info = await profile(username);
  const prefs = await getPrefs(ctx.authorId);
  const body = [
    `**[${label(username)}](https://www.last.fm/user/${encodeURIComponent(username)})**`,
    `**Scrobbles** ${Number(info?.playcount ?? 0).toLocaleString("en-US")}`,
    "",
    `**Default period** ${periodLabel((prefs.period ?? "overall") as never)}`,
    `**Chart size** ${prefs.chartSize ?? 10}`,
    "",
    "-# `,lf unlink` to disconnect.",
  ].join("\n");

  await paginate(ctx, simpleCard(heading, body, avatarOf(info)), EMBED_COLOR);
}

export function registerPersonal(): void {
  const add = (
    name: string,
    aliases: string[],
    description: string,
    handler: (ctx: PrefixContext) => Promise<void>,
  ) => register({ name, aliases, description, handler: guard(handler) });

  add("stats", ["summary", "numbers"], "Your headline listening figures", stats);
  add("obscurity", ["hipster", "underground"], "How far from the mainstream you listen", obscurity);
  add("variety", ["diversity", "spread"], "How wide your listening spreads", variety);
  add("share", ["dominance", "topshare"], "Which artists dominate your recent plays", share);
  add("defaultperiod", ["setperiod"], "The period your charts use by default", defaultPeriod);
  add("chartsize", ["setsize", "rows"], "How many rows a chart page shows", chartSize);
  add("whoami", ["me", "myaccount"], "Which Last.fm account is linked to you", whoami);
}
