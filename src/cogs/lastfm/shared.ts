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
  USER_ACCENT,
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

const USERNAME = /^[A-Za-z0-9_.-]{2,20}$/;

const TARGET_TOKEN = /^(?:user|lfm|fm):.+/i;

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

export interface Target {
  username: string;
  discordId?: string;
}

export interface TargetOptions {
  allowBare?: boolean;
}

export function possessive(ctx: PrefixContext, target: Target): string | null {
  if (!target.discordId) return `**${target.username.replaceAll("[", "［").replaceAll("]", "］")}**`;
  return target.discordId === ctx.authorId ? null : `<@${target.discordId}>`;
}

export { TargetError } from "./guard.js";

export async function resolveTarget(
  ctx: PrefixContext,
  argument: string,
  options: TargetOptions = {},
): Promise<{ target: Target; rest: string }> {
  const words = argument.split(/\s+/).filter(Boolean);

  const tokenAt = words.findIndex((word) => TARGET_TOKEN.test(word));
  if (tokenAt !== -1) {
    const username = (words[tokenAt] ?? "").split(":").slice(1).join(":");
    if (!USERNAME.test(username)) throw badUsername();
    return { target: { username }, rest: words.filter((_, i) => i !== tokenAt).join(" ") };
  }

  const first = words[0] ?? "";
  const mention = MENTION.exec(first);
  if (mention) {
    const username = await getUsername(mention[1] as string);
    if (!username) throw new TargetError("That user has not linked a Last.fm account.", "Not linked");
    return { target: { username, discordId: mention[1] }, rest: words.slice(1).join(" ") };
  }

  if (options.allowBare && first) {
    if (!USERNAME.test(first)) throw badUsername();
    return { target: { username: first }, rest: words.slice(1).join(" ") };
  }

  const own = await getUsername(ctx.authorId);
  if (own) return { target: { username: own, discordId: ctx.authorId }, rest: argument.trim() };

  throw new TargetError(
    "You have not linked a Last.fm account. Run `,lf link`, or name one with `user:<name>`.",
    "Not linked",
  );
}

function badUsername(): TargetError {
  return new TargetError("That does not look like a Last.fm username.", "Bad username");
}

export async function profile(username: string): Promise<UserInfo | null> {
  const cacheKey = `trap:lf:profile:${username.toLowerCase()}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as UserInfo;
  } catch {}
  try {
    const info = await getUserInfo(username);
    redis.set(cacheKey, JSON.stringify(info), "EX", TTL.user).catch(() => {});
    return info;
  } catch {
    return null;
  }
}

export async function currentArtist(ctx: PrefixContext): Promise<string> {
  const { target } = await resolveTarget(ctx, "");
  const { tracks } = await getRecentTracks(target.username, 1);
  const artist = tracks[0]?.artist?.name ?? tracks[0]?.artist?.["#text"];
  if (!artist) throw new TargetError("Name one, or play something first.");
  return artist;
}

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

export const artistUrl = (name: string) =>
  `https://www.last.fm/music/${encodeURIComponent(name)}`;

export const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${encodeURIComponent(track)}`;

export const albumUrl = (artist: string, album: string) =>
  `${artistUrl(artist)}/${encodeURIComponent(album)}`;

export const PAIR_SEPARATOR = /\s+[-–—]\s+/;

export function splitPair(argument: string): [string, string] | null {
  const parts = argument.trim().split(PAIR_SEPARATOR);
  if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) return null;
  return [parts[0].trim(), parts.slice(1).join(" - ").trim()];
}

export function avatarOf(info: UserInfo | null): string | null {
  return largestImage(info?.image);
}

export interface Scrobble {
  artist: string;
  album: string;
  track: string;
  at: number | null;
}

export const HISTORY_PAGES = 5;

export async function history(
  username: string,
  pages = HISTORY_PAGES,
): Promise<{ scrobbles: Scrobble[]; total: number }> {
  const key = `trap:lf:hist:${username.toLowerCase()}:${pages}`;
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as { scrobbles: Scrobble[]; total: number };
  } catch {}

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

export function timed(scrobbles: Scrobble[]): (Scrobble & { at: number })[] {
  return scrobbles.filter((s): s is Scrobble & { at: number } => s.at !== null);
}

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
