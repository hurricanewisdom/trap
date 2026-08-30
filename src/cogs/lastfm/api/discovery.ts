/**
 * Everything that looks outward from one listener: weekly chart ranges,
 * similarity, tags, and what Last.fm as a whole is playing.
 */

import { call } from "./client.js";
import type { Image } from "./users.js";

export interface WeekRange {
  from: string;
  to: string;
}

/** Every week Last.fm has data for, oldest first. */
export async function getWeeklyChartList(user: string): Promise<WeekRange[]> {
  const data = await call<{ weeklychartlist?: { chart?: WeekRange | WeekRange[] } }>(
    "user.getWeeklyChartList",
    { user },
  );
  const raw = data.weeklychartlist?.chart;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export interface WeeklyEntry {
  name: string;
  playcount: string;
  url?: string;
  artist?: { "#text"?: string; name?: string };
}

/** One week's chart. Omit the range for the most recent week. */
export async function getWeeklyChart(
  kind: "artist" | "album" | "track",
  user: string,
  range?: WeekRange,
): Promise<WeeklyEntry[]> {
  const method = `user.getWeekly${kind[0]!.toUpperCase()}${kind.slice(1)}Chart`;
  const data = await call<Record<string, { [k: string]: WeeklyEntry | WeeklyEntry[] }>>(
    method,
    range ? { user, from: range.from, to: range.to } : { user },
  );
  const block = data[`weekly${kind}chart`];
  const raw = block?.[kind];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export interface SimilarArtist {
  name: string;
  url?: string;
  match?: string;
  image?: Image[];
}

export async function getSimilarArtists(artist: string, limit = 30): Promise<SimilarArtist[]> {
  const data = await call<{ similarartists?: { artist?: SimilarArtist | SimilarArtist[] } }>(
    "artist.getSimilar",
    { artist, autocorrect: "1", limit: String(limit) },
  );
  const raw = data.similarartists?.artist;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export interface SimilarTrack {
  name: string;
  url?: string;
  match?: number | string;
  artist?: { name?: string };
}

export async function getSimilarTracks(
  artist: string,
  track: string,
  limit = 30,
): Promise<SimilarTrack[]> {
  const data = await call<{ similartracks?: { track?: SimilarTrack | SimilarTrack[] } }>(
    "track.getSimilar",
    { artist, track, autocorrect: "1", limit: String(limit) },
  );
  const raw = data.similartracks?.track;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

export interface Tag {
  name: string;
  count?: number | string;
  url?: string;
  reach?: string;
  taggings?: string;
}

export async function getArtistTags(artist: string, username?: string): Promise<Tag[]> {
  const data = await call<{ toptags?: { tag?: Tag | Tag[] } }>("artist.getTopTags", {
    artist,
    autocorrect: "1",
    ...(username ? { user: username } : {}),
  });
  const raw = data.toptags?.tag;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/** An artist's globally most played tracks or albums. */
export async function getArtistTop(
  kind: "tracks" | "albums",
  artist: string,
  limit = 20,
): Promise<{ name: string; url?: string; playcount?: string | number }[]> {
  const method = kind === "tracks" ? "artist.getTopTracks" : "artist.getTopAlbums";
  const key = kind === "tracks" ? "toptracks" : "topalbums";
  const inner = kind === "tracks" ? "track" : "album";
  const data = await call<Record<string, Record<string, unknown>>>(method, {
    artist,
    autocorrect: "1",
    limit: String(limit),
  });
  const raw = data[key]?.[inner] as
    | { name: string; url?: string; playcount?: string | number }
    | { name: string; url?: string; playcount?: string | number }[]
    | undefined;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/**
 * Digs the list out of a Last.fm chart response.
 *
 * The wrapper key is not predictable from the method name — `tag.getTopAlbums`
 * answers under `albums` while `artist.getTopAlbums` answers under `topalbums`,
 * and `chart.getTopArtists` uses `artists` where `geo.getTopArtists` uses
 * `topartists`. Deriving it as `top${kind}` looked right and silently returned
 * an empty list for half of these methods, so the container is located instead
 * of guessed: take the one object that is not `@attr`, then the one array
 * inside it.
 */
function chartItems<T>(data: Record<string, unknown>): T[] {
  for (const [key, value] of Object.entries(data)) {
    if (key === "@attr" || typeof value !== "object" || value === null) continue;
    for (const [inner, list] of Object.entries(value as Record<string, unknown>)) {
      if (inner === "@attr") continue;
      if (Array.isArray(list)) return list as T[];
      // A single result comes back as an object rather than a one-item array.
      if (list && typeof list === "object") return [list as T];
    }
  }
  return [];
}

export async function getTagTop(
  kind: "artists" | "tracks" | "albums",
  tag: string,
  limit = 30,
): Promise<{ name: string; url?: string; artist?: { name?: string } }[]> {
  const method = `tag.getTop${kind[0]!.toUpperCase()}${kind.slice(1)}`;
  const data = await call<Record<string, unknown>>(method, { tag, limit: String(limit) });
  return chartItems(data);
}

export async function getGlobalChart(
  kind: "artists" | "tracks",
  country?: string,
  limit = 30,
): Promise<
  { name: string; url?: string; playcount?: string; listeners?: string; artist?: { name?: string } }[]
> {
  const method = country
    ? `geo.getTop${kind[0]!.toUpperCase()}${kind.slice(1)}`
    : `chart.getTop${kind[0]!.toUpperCase()}${kind.slice(1)}`;
  const data = await call<Record<string, unknown>>(method, {
    limit: String(limit),
    ...(country ? { country } : {}),
  });
  return chartItems(data);
}
