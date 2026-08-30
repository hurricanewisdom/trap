/**
 * Pieces every Last.fm stats command needs: period parsing, target
 * resolution, listening history and the Last.fm-specific formatting.
 *
 * The generic presentation helpers - markdown escaping, card and page
 * building - are not Last.fm's to own; a second cog would otherwise have to
 * import them from inside this one. They live in `src/helpers` and are
 * re-exported here so the twenty command files in this folder keep a single
 * import site.
 */

import {
  getRecentPage,
  getRecentTracks,
  getUserInfo,
  largestImage,
  type Period,
  type RecentTrack,
  type UserInfo,
} from "./api/index.js";
import { getUsername } from "./store.js";
import { TTL, redis } from "../../core/redis.js";
import type { PrefixContext } from "../../core/prefix.js";
import { TargetError } from "./guard.js";

export {
  EMBED_COLOR,
  PAGE_SIZE,
  bar,
  buildPages,
  chartLine,
  header,
  image,
  linkRow,
  paragraph,
  separator,
  simpleCard,
  subtext,
  type CardOptions,
} from "../../helpers/cards.js";

export {
  compact,
  duration,
  label,
  maybeLink,
  plain,
  plural,
  releaseYear,
  url,
} from "../../helpers/markdown.js";

const MENTION = /^<@!?(\d{15,25})>$/;

/* ------------------------------------------------------------------ */
/* Periods                                                            */
/* ------------------------------------------------------------------ */

const PERIODS: Record<string, Period> = {
  overall: "overall",
  all: "overall",
  alltime: "overall",
  a: "overall",
  week: "7day",
  weekly: "7day",
  "7day": "7day",
  "7days": "7day",
  "7d": "7day",
  w: "7day",
  month: "1month",
  monthly: "1month",
  "1month": "1month",
  "30days": "1month",
  "1m": "1month",
  m: "1month",
  "3month": "3month",
  "3months": "3month",
  "3m": "3month",
  quarter: "3month",
  "6month": "6month",
  "6months": "6month",
  "6m": "6month",
  half: "6month",
  year: "12month",
  yearly: "12month",
  "12month": "12month",
  "12months": "12month",
  "1y": "12month",
  y: "12month",
};

/** Human label used in the embed heading, matching Last.fm's own wording. */
const PERIOD_LABEL: Record<Period, string> = {
  overall: "overall",
  "7day": "weekly",
  "1month": "monthly",
  "3month": "quarterly",
  "6month": "half-yearly",
  "12month": "yearly",
};

export function periodLabel(period: Period): string {
  return PERIOD_LABEL[period];
}

/** Pulls a period token out of the argument, returning the rest untouched. */
export function extractPeriod(argument: string): { period: Period; rest: string } {
  const words = argument.split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const hit = PERIODS[(words[i] ?? "").toLowerCase()];
    if (hit) {
      words.splice(i, 1);
      return { period: hit, rest: words.join(" ") };
    }
  }
  return { period: "overall", rest: argument.trim() };
}

/* ------------------------------------------------------------------ */
/* Targets                                                            */
/* ------------------------------------------------------------------ */

export interface Target {
  username: string;
  /** Discord id when the target came from a mention or is the caller. */
  discordId?: string;
}

export { TargetError } from "./guard.js";

/**
 * Works out whose stats to show, consuming a leading mention or username.
 * Returns the remaining argument so callers can parse their own operands.
 */
export async function resolveTarget(
  ctx: PrefixContext,
  argument: string,
): Promise<{ target: Target; rest: string }> {
  const words = argument.split(/\s+/).filter(Boolean);

  /**
   * An explicit token can name any Last.fm account, from anywhere in the
   * argument. A bare word cannot be used for this: ",plays Twxn" names an
   * artist, not a user, so guessing would break every command that takes an
   * operand.
   */
  const tokenAt = words.findIndex((w) => /^(?:user|lfm|fm):.+/i.test(w));
  if (tokenAt !== -1) {
    const username = (words[tokenAt] ?? "").split(":").slice(1).join(":");
    if (!/^[A-Za-z0-9_.-]{2,20}$/.test(username)) {
      throw new TargetError("That does not look like a Last.fm username.");
    }
    const rest = words.filter((_, i) => i !== tokenAt).join(" ");
    return { target: { username }, rest };
  }

  const first = words[0] ?? "";
  const mention = MENTION.exec(first);
  if (mention) {
    const username = await getUsername(mention[1] as string);
    if (!username) throw new TargetError("That user has not linked a Last.fm account.");
    return { target: { username, discordId: mention[1] }, rest: words.slice(1).join(" ") };
  }

  const own = await getUsername(ctx.authorId);
  if (own) return { target: { username: own, discordId: ctx.authorId }, rest: argument.trim() };

  throw new TargetError(
    "You have not linked a Last.fm account. Run `,lf link`, or name one with `user:<name>`.",
  );
}

/** Cached profile lookup, for avatars and totals. */
export async function profile(username: string): Promise<UserInfo | null> {
  const cacheKey = `trap:lf:profile:${username.toLowerCase()}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as UserInfo;
  } catch {
    /* fall through to the API */
  }
  try {
    const info = await getUserInfo(username);
    redis.set(cacheKey, JSON.stringify(info), "EX", TTL.user).catch(() => {});
    return info;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* What the caller is playing                                          */
/* ------------------------------------------------------------------ */

/**
 * The artist of the most recent scrobble, for commands that take an artist
 * but should default to what you are listening to.
 */
export async function currentArtist(ctx: PrefixContext): Promise<string> {
  const { target } = await resolveTarget(ctx, "");
  const { tracks } = await getRecentTracks(target.username, 1);
  const artist = tracks[0]?.artist?.name ?? tracks[0]?.artist?.["#text"];
  if (!artist) throw new TargetError("Name one, or play something first.");
  return artist;
}

/** The same, as an `[artist, album]` or `[artist, track]` pair. */
export async function currentPair(
  ctx: PrefixContext,
  kind: "album" | "track",
): Promise<[string, string]> {
  const { target } = await resolveTarget(ctx, "");
  const { tracks } = await getRecentTracks(target.username, 1);
  const current = tracks[0];
  const artist = current?.artist?.name ?? current?.artist?.["#text"];
  const second = kind === "album" ? current?.album?.["#text"] : current?.name;
  if (!artist || !second) {
    throw new TargetError(`Give it as \`artist - ${kind}\`, or play something first.`);
  }
  return [artist, second];
}

/* ------------------------------------------------------------------ */
/* Last.fm rendering                                                  */
/* ------------------------------------------------------------------ */

export const artistUrl = (name: string) =>
  `https://www.last.fm/music/${encodeURIComponent(name)}`;

export const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${encodeURIComponent(track)}`;

export const albumUrl = (artist: string, album: string) =>
  `${artistUrl(artist)}/${encodeURIComponent(album)}`;

/**
 * The separator in "artist - album". En and em dashes are accepted because
 * phones substitute them for a typed hyphen without asking.
 */
export const PAIR_SEPARATOR = /\s+[-–—]\s+/;

/**
 * Splits "artist - album" into its two halves, or null if there is no
 * separator. Everything after the first separator stays with the second half,
 * so "Radiohead - Everything In Its Right Place - Live" keeps its own dash.
 */
export function splitPair(argument: string): [string, string] | null {
  const parts = argument.trim().split(PAIR_SEPARATOR);
  if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) return null;
  return [parts[0].trim(), parts.slice(1).join(" - ").trim()];
}

export function avatarOf(info: UserInfo | null): string | null {
  return largestImage(info?.image);
}

/* ------------------------------------------------------------------ */
/* Listening history                                                   */
/* ------------------------------------------------------------------ */

/** A scrobble reduced to what the time analyses need. */
export interface Scrobble {
  artist: string;
  album: string;
  track: string;
  /** Unix seconds. Absent for a track that is playing right now. */
  at: number | null;
}

/** How many 200-track pages the history commands may pull. */
export const HISTORY_PAGES = 5;

/**
 * Recent scrobbles, flattened and cached.
 *
 * Each page is one API call, so this is the expensive part of every time
 * analysis; the cache is what makes running several of them in a row cheap.
 */
export async function history(
  username: string,
  pages = HISTORY_PAGES,
): Promise<{ scrobbles: Scrobble[]; total: number }> {
  const key = `trap:lf:hist:${username.toLowerCase()}:${pages}`;
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as { scrobbles: Scrobble[]; total: number };
  } catch {
    /* fall through to the API */
  }

  const scrobbles: Scrobble[] = [];
  let total = 0;
  for (let page = 1; page <= pages; page++) {
    const { items, total: reported, pages: available } = await getRecentPage(username, page, 200);
    total = reported;
    for (const item of items) push(scrobbles, item);
    if (page >= available) break;
  }

  const result = { scrobbles, total };
  redis.set(key, JSON.stringify(result), "EX", 600).catch(() => {});
  return result;
}

function push(into: Scrobble[], track: RecentTrack): void {
  into.push({
    artist: track.artist?.name ?? track.artist?.["#text"] ?? "Unknown",
    album: track.album?.["#text"] ?? "",
    track: track.name,
    at: track.date?.uts ? Number(track.date.uts) : null,
  });
}

/** Scrobbles that carry a timestamp, newest first. */
export function timed(scrobbles: Scrobble[]): (Scrobble & { at: number })[] {
  return scrobbles.filter((s): s is Scrobble & { at: number } => s.at !== null);
}

/** Counts values and returns them sorted, most common first. */
export function tally<T>(items: T[], key: (item: T) => string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
