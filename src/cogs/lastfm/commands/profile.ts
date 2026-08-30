/**
 * Profile-shaped commands: who someone is, what they have played lately, and a
 * few numbers derived from it.
 *
 * Same shape as charts.ts throughout — resolve a target, fetch, render into the
 * shared card skin, hand the pages to the pager. Nothing here builds a
 * container by hand; simpleCard and buildPages cover every layout used.
 */

import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import {
  call,
  getLovedTracks,
  getRecentPage,
  getTopArtists,
  type RecentTrack,
  type UserInfo,
} from "../api/index.js";
import { guard } from "../guard.js";
import {
  EMBED_COLOR,
  TargetError,
  artistUrl,
  avatarOf,
  buildPages,
  label,
  plain,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";
import type { LfArtistRef } from "../types.js";

/** One page of scrobbles is ten lines, so these are whole numbers of pages. */
const RECENT_LIMIT = 100;
const LOVED_LIMIT = 200;

/** `recentfor` walks the history itself, so the walk is hard-capped. */
const SCAN_LIMIT = 200;
const SCAN_PAGES = 5;
const SCAN_TARGET = 100;

const STREAK_WALK = 200;
const MILESTONE_PAGE = 200;

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                */
/* ------------------------------------------------------------------ */

/** Last.fm sends every number as a string, and sometimes not at all. */
function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * api.ts turns the `@attr` paging block into numbers with a bare `Number()`, so
 * a malformed total arrives here as NaN. NaN loses every comparison silently —
 * it slips through range checks and then poisons any average built on it — so
 * totals are floored before they are used in arithmetic.
 */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

const artistName = (artist: LfArtistRef | undefined): string =>
  (artist?.name ?? artist?.["#text"] ?? "").trim();

const profileUrl = (username: string) =>
  `https://www.last.fm/user/${encodeURIComponent(username)}`;

const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${encodeURIComponent(track)}`;

/** A Discord timestamp, or null when Last.fm gave us no usable date. */
function stamp(uts: string | undefined, style: "R" | "D" | "F"): string | null {
  const seconds = Math.trunc(Number(uts));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return `<t:${seconds}:${style}>`;
}

/** `1` Name — detail, matching chartLine's layout for lists that have no count. */
function entry(index: number, name: string, link: string, detail: string): string {
  const head = `\`${index}\` **[${label(name)}](${link})**`;
  return detail ? `${head} · ${detail}` : head;
}

function ordinal(value: number): string {
  const teens = value % 100;
  const suffix =
    teens >= 11 && teens <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th");
  return `${value.toLocaleString("en-US")}${suffix}`;
}

interface Listing {
  heading: string;
  username: string;
  icon: string | null;
  noun: string;
  total: number;
}

/** Empty lists still deserve a card rather than silence. */
async function show(ctx: PrefixContext, lines: string[], options: Listing): Promise<void> {
  if (lines.length === 0) {
    await paginate(
      ctx,
      simpleCard(options.heading, `No ${options.noun} found.`, options.icon),
      EMBED_COLOR,
    );
    return;
  }
  await paginate(ctx, buildPages(lines, options), EMBED_COLOR);
}

/**
 * user.getInfo returns more than api.ts models. Rather than widen the shared
 * client (other modules are being written against it right now), the extra
 * fields are declared and fetched here.
 */
interface FullUserInfo extends UserInfo {
  realname?: string;
  country?: string;
  artist_count?: string;
  album_count?: string;
  track_count?: string;
}

async function fullProfile(username: string): Promise<FullUserInfo> {
  const data = await call<{ user?: FullUserInfo }>("user.getInfo", { user: username });
  const user = data.user;
  if (!user) throw new TargetError(`Last.fm has no profile for **${label(username)}**.`);
  return user;
}

/* ------------------------------------------------------------------ */
/* count / whois                                                      */
/* ------------------------------------------------------------------ */

async function count(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const info = await profile(target.username);
  if (!info) throw new TargetError(`Could not load ${target.username}'s Last.fm profile.`);

  const link = url(info.url, profileUrl(target.username));
  const body = [
    `**${plural(num(info.playcount), "scrobble")}**`,
    "",
    `-# [${label(target.username)}](${link}) on Last.fm`,
  ].join("\n");

  await paginate(
    ctx,
    simpleCard(`${target.username}'s scrobbles`, body, avatarOf(info)),
    EMBED_COLOR,
  );
}

async function whois(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const info = await fullProfile(target.username);
  const link = url(info.url, profileUrl(target.username));

  const rows: string[] = [];
  const real = (info.realname ?? "").trim();
  if (real) rows.push(`**Real name** · ${plain(real)}`);

  const country = (info.country ?? "").trim();
  if (country && country.toLowerCase() !== "none") rows.push(`**Country** · ${plain(country)}`);

  rows.push(`**Scrobbles** · ${num(info.playcount).toLocaleString("en-US")}`);

  // The counts are absent on some accounts; a zero row is worse than no row.
  const artists = num(info.artist_count);
  if (artists) rows.push(`**Artists** · ${artists.toLocaleString("en-US")}`);
  const albums = num(info.album_count);
  if (albums) rows.push(`**Albums** · ${albums.toLocaleString("en-US")}`);
  const tracks = num(info.track_count);
  if (tracks) rows.push(`**Tracks** · ${tracks.toLocaleString("en-US")}`);

  const registered = stamp(info.registered?.unixtime, "D");
  if (registered) rows.push(`**Registered** · ${registered}`);

  rows.push("", `-# [View profile on Last.fm](${link})`);

  await paginate(
    ctx,
    simpleCard(info.name || target.username, rows.join("\n"), avatarOf(info)),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* recent / recentfor / favorites                                     */
/* ------------------------------------------------------------------ */

/** Renders one scrobble: track link, artist, and when it happened. */
function scrobbleLine(index: number, track: RecentTrack): string {
  const artist = artistName(track.artist) || "Unknown artist";
  const live = track["@attr"]?.nowplaying === "true";
  const when = live ? "**now playing**" : (stamp(track.date?.uts, "R") ?? "unknown");
  return entry(
    index,
    track.name,
    url(track.url, trackUrl(artist, track.name)),
    `${label(artist)} • ${when}`,
  );
}

async function recent(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const [info, page] = await Promise.all([
    profile(target.username),
    getRecentPage(target.username, 1, RECENT_LIMIT),
  ]);

  await show(ctx, page.items.map((track, i) => scrobbleLine(i + 1, track)), {
    heading: `${target.username}'s recent tracks`,
    username: target.username,
    icon: avatarOf(info),
    noun: "scrobbles",
    total: finite(page.total),
  });
}

async function recentFor(ctx: PrefixContext): Promise<void> {
  const { target, rest } = await resolveTarget(ctx, ctx.argument);
  const query = rest.trim();
  if (!query) throw new TargetError("Name an artist, e.g. `,recentfor radiohead`.");

  const info = await profile(target.username);
  const needle = query.toLowerCase();
  const matches: RecentTrack[] = [];
  let pages = 1;

  // Last.fm has no "recent tracks by artist" endpoint, so this filters the
  // history itself and stops at the cap rather than walking a whole account.
  for (let page = 1; page <= SCAN_PAGES && page <= pages; page++) {
    const result = await getRecentPage(target.username, page, SCAN_LIMIT);
    pages = Math.max(1, finite(result.pages));
    if (result.items.length === 0) break;

    for (const track of result.items) {
      const artist = artistName(track.artist).toLowerCase();
      if (artist && artist.includes(needle)) matches.push(track);
    }
    if (matches.length >= SCAN_TARGET) break;
  }

  await show(ctx, matches.map((track, i) => scrobbleLine(i + 1, track)), {
    heading: `${target.username}'s recent ${label(query)} scrobbles`,
    username: target.username,
    icon: avatarOf(info),
    noun: "matches",
    total: matches.length,
  });
}

async function favorites(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const [info, loved] = await Promise.all([
    profile(target.username),
    getLovedTracks(target.username, LOVED_LIMIT),
  ]);

  const lines = loved.items.map((track, i) => {
    const artist = artistName(track.artist) || "Unknown artist";
    const when = stamp(track.date?.uts, "R");
    return entry(
      i + 1,
      track.name,
      url(track.url, trackUrl(artist, track.name)),
      when ? `${label(artist)} • ${when}` : label(artist),
    );
  });

  await show(ctx, lines, {
    heading: `${target.username}'s loved tracks`,
    username: target.username,
    icon: avatarOf(info),
    noun: "loved tracks",
    total: finite(loved.total),
  });
}

/* ------------------------------------------------------------------ */
/* milestone                                                          */
/* ------------------------------------------------------------------ */

/** Pulls the trailing count out of "1000" or "@someone 1,000". */
function milestoneNumber(rest: string): number | null {
  const words = rest.split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = (words[i] ?? "").replaceAll(",", "");
    if (/^\d+$/.test(word)) return Number(word);
  }
  return null;
}

async function milestone(ctx: PrefixContext): Promise<void> {
  const { target, rest } = await resolveTarget(ctx, ctx.argument);
  const wanted = milestoneNumber(rest);
  if (wanted === null) throw new TargetError("Which scrobble? e.g. `,milestone 1000`.");

  // One cheap row carries the lifetime total in its paging block.
  const probe = await getRecentPage(target.username, 1, 1);
  const lifetime = finite(probe.total);
  if (lifetime === 0) throw new TargetError(`${target.username} has not scrobbled anything yet.`);
  if (wanted < 1 || wanted > lifetime) {
    throw new TargetError(`Pick a number between 1 and ${lifetime.toLocaleString("en-US")}.`);
  }

  // The feed is newest-first, so the Nth oldest scrobble sits (total - N + 1)
  // rows down. Paging is expressed in those same scrobble terms — @attr.total
  // counts only real scrobbles — so the page and offset are derived before any
  // now-playing adjustment, never after it.
  const position = lifetime - wanted + 1;
  const page = Math.ceil(position / MILESTONE_PAGE);
  const offset = (position - 1) % MILESTONE_PAGE;

  const [info, result] = await Promise.all([
    profile(target.username),
    getRecentPage(target.username, page, MILESTONE_PAGE),
  ]);

  // A now-playing track is prepended to page one *in addition to* the requested
  // limit, and it is not part of the total. Dropping it leaves a pure scrobble
  // list that the offset above indexes directly.
  const scrobbles = result.items.filter((row) => row["@attr"]?.nowplaying !== "true");
  const track = scrobbles[offset];
  if (!track) throw new TargetError("Last.fm did not return that scrobble. Try again in a moment.");

  const artist = artistName(track.artist) || "Unknown artist";
  const album = (track.album?.["#text"] ?? "").trim();
  const when = stamp(track.date?.uts, "F");
  const ago = stamp(track.date?.uts, "R");

  const body = [
    `**[${label(track.name)}](${url(track.url, trackUrl(artist, track.name))})**`,
    `by **[${label(artist)}](${url(track.artist?.url, artistUrl(artist))})**`,
    ...(album ? [`from **${label(album)}**`] : []),
    "",
    when ? `-# ${when}${ago ? ` • ${ago}` : ""}` : "-# Date unknown",
  ].join("\n");

  await paginate(
    ctx,
    simpleCard(
      `${target.username}'s ${ordinal(wanted)} scrobble`,
      body,
      avatarOf(info),
    ),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */
/* streak                                                             */
/* ------------------------------------------------------------------ */

/** Length of the run of identical keys at the head of the list. */
function runLength(tracks: RecentTrack[], keyOf: (track: RecentTrack) => string): number {
  const head = tracks[0];
  if (!head) return 0;
  const wanted = keyOf(head);
  if (!wanted) return 0;

  let run = 0;
  for (const track of tracks) {
    if (keyOf(track) !== wanted) break;
    run++;
  }
  return run;
}

/**
 * A run that fills a *full* window may well be longer than we saw, so it is
 * reported open-ended. A short window means we simply reached the account's
 * first scrobble, and that number is exact.
 */
const runText = (run: number, walked: number, capped: boolean) =>
  capped && run > 0 && run >= walked ? `${run}+` : String(run);

async function streak(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const [info, result] = await Promise.all([
    profile(target.username),
    getRecentPage(target.username, 1, STREAK_WALK),
  ]);

  const tracks = result.items;
  const head = tracks[0];
  const heading = `${target.username}'s streak`;
  if (!head) {
    await paginate(
      ctx,
      simpleCard(heading, "Nothing scrobbled yet, so no streak going.", avatarOf(info)),
      EMBED_COLOR,
    );
    return;
  }

  const artistKey = (track: RecentTrack) => artistName(track.artist).toLowerCase();
  const albumKey = (track: RecentTrack) => {
    const album = (track.album?.["#text"] ?? "").trim().toLowerCase();
    return album ? `${artistKey(track)}\u0000${album}` : "";
  };
  const trackKey = (track: RecentTrack) => {
    const name = track.name.trim().toLowerCase();
    return name ? `${artistKey(track)}\u0000${name}` : "";
  };

  const walked = tracks.length;
  const capped = walked >= STREAK_WALK;
  const artist = artistName(head.artist) || "Unknown artist";
  const album = (head.album?.["#text"] ?? "").trim();

  const rows = [
    `**Artist** · [${label(artist)}](${url(head.artist?.url, artistUrl(artist))}) × **${runText(runLength(tracks, artistKey), walked, capped)}**`,
    album
      ? `**Album** · ${plain(album)} × **${runText(runLength(tracks, albumKey), walked, capped)}**`
      : "**Album** · unknown",
    `**Track** · [${label(head.name)}](${url(head.url, trackUrl(artist, head.name))}) × **${runText(runLength(tracks, trackKey), walked, capped)}**`,
    "",
    `-# Counted back through the last ${walked.toLocaleString("en-US")} scrobbles.`,
  ];

  await paginate(ctx, simpleCard(heading, rows.join("\n"), avatarOf(info)), EMBED_COLOR);
}

/* ------------------------------------------------------------------ */
/* score                                                              */
/* ------------------------------------------------------------------ */

const BAR_CELLS = 20;

/** Ratings run high-to-low, so the first band a score clears is the answer. */
const RATINGS: { at: number; name: string }[] = [
  { at: 90, name: "Terminal" },
  { at: 75, name: "Obsessive" },
  { at: 60, name: "Devoted" },
  { at: 45, name: "Regular" },
  { at: 30, name: "Casual" },
  { at: 15, name: "Dabbler" },
  { at: 0, name: "Newcomer" },
];

function bar(score: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((score / 100) * BAR_CELLS)));
  return `\`${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}\``;
}

async function score(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const info = await fullProfile(target.username);
  // A limit of one still carries the real artist count in the paging block.
  const artists = Math.max(0, finite((await getTopArtists(target.username, "overall", 1)).total));

  const scrobbles = Math.max(0, num(info.playcount));
  const registered = num(info.registered?.unixtime);
  const days = registered > 0 ? Math.max(1, (Date.now() / 1000 - registered) / 86_400) : 0;
  const perDay = days > 0 ? scrobbles / days : 0;

  // Three axes, each capped: how much, how steadily, how widely. The divisors
  // are the point at which an axis is considered maxed out. Every input is
  // floored above, because Math.min(cap, NaN) is NaN and would render "NaN/100".
  const volume = Math.min(40, (Math.log10(scrobbles + 1) / 5) * 40);
  const habit = Math.min(35, (perDay / 30) * 35);
  const variety = Math.min(25, (artists / 2500) * 25);
  const total = Math.max(0, Math.min(100, Math.round(volume + habit + variety)));
  const rating = RATINGS.find((band) => total >= band.at)?.name ?? "Newcomer";

  const since = stamp(info.registered?.unixtime, "D");
  const rows = [
    `${bar(total)} **${total}**/100 · **${rating}**`,
    "",
    `**Scrobbles** · ${scrobbles.toLocaleString("en-US")}`,
    days > 0
      ? `**Per day** · ${perDay.toFixed(1)} over ${Math.round(days).toLocaleString("en-US")} days`
      : "**Per day** · unknown",
    `**Artists** · ${artists.toLocaleString("en-US")}`,
    ...(since ? ["", `-# Scrobbling since ${since}`] : []),
  ];

  await paginate(
    ctx,
    simpleCard(`${target.username}'s listening score`, rows.join("\n"), avatarOf(info)),
    EMBED_COLOR,
  );
}

/* ------------------------------------------------------------------ */

export function registerProfile(): void {
  register({
    name: "count",
    aliases: ["scrobbles"],
    description: "Total scrobbles for you or someone else",
    handler: guard(count),
  });
  register({
    name: "whois",
    aliases: ["lfprofile"],
    description: "Last.fm profile details",
    handler: guard(whois),
  });
  register({
    name: "recent",
    aliases: ["recents", "rt"],
    description: "Recently scrobbled tracks",
    handler: guard(recent),
  });
  register({
    name: "recentfor",
    aliases: ["rf", "recentartist"],
    description: "Recent scrobbles filtered to one artist",
    handler: guard(recentFor),
  });
  register({
    name: "favorites",
    aliases: ["favourites", "loved", "likes"],
    description: "Tracks you have loved on Last.fm",
    handler: guard(favorites),
  });
  register({
    name: "milestone",
    aliases: ["ms"],
    description: "Look up the Nth scrobble of an account",
    handler: guard(milestone),
  });
  register({
    name: "streak",
    aliases: ["streaks"],
    description: "Your current repeat streak",
    handler: guard(streak),
  });
  register({
    name: "score",
    aliases: ["rating"],
    description: "A listening score derived from your history",
    handler: guard(score),
  });
}
