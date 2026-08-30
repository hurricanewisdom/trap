/**
 * Tags: Last.fm's crowd-sourced genre system.
 *
 * Three different things all get called "tags" and they are not the same:
 *
 *   top tags       what everyone has tagged an artist/album/track, with a
 *                  count out of 100 (album.getTopTags and friends)
 *   your tags      what one listener has tagged that item, which only they
 *                  see (artist.getTags with a `user`)
 *   the tag itself what a tag means and how widely it is used (tag.getInfo)
 *
 * `tag.getSimilar` is included for completeness but Last.fm has effectively
 * retired it: it answers with an empty list and `@attr.tag: n/a` for every
 * tag, including ones as common as "rock".
 */

import { call } from "./client.js";

/** A tag with the weight the crowd gave it, out of 100. */
export interface WeightedTag {
  name: string;
  count?: string | number;
  url?: string;
}

/** A tag as a thing in its own right. */
export interface TagInfo {
  name: string;
  /** How many times it has been applied. */
  total?: string | number;
  /** How many people have used it. */
  reach?: string | number;
  wiki?: { summary?: string; content?: string };
}

/** A tag in a global chart, which counts reach rather than a per-item weight. */
export interface ChartTag {
  name: string;
  url?: string;
  reach?: string;
  taggings?: string;
}

function many<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

/** What a tag means, and how widely it is used. */
export async function getTagInfo(tag: string): Promise<TagInfo | null> {
  const data = await call<{ tag?: TagInfo }>("tag.getInfo", { tag });
  return data.tag?.name ? data.tag : null;
}

/**
 * Tags Last.fm considers similar. Reliably empty — kept so the command can
 * say so rather than looking broken.
 */
export async function getSimilarTags(tag: string): Promise<WeightedTag[]> {
  const data = await call<{ similartags?: { tag?: WeightedTag | WeightedTag[] } }>(
    "tag.getSimilar",
    { tag },
  );
  return many(data.similartags?.tag);
}

/** The most used tags on Last.fm overall. */
export async function getGlobalTopTags(): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("tag.getTopTags");
  return many(data.toptags?.tag);
}

/** The tags trending right now, with reach and total taggings. */
export async function getChartTopTags(limit = 50): Promise<ChartTag[]> {
  const data = await call<{ tags?: { tag?: ChartTag | ChartTag[] } }>("chart.getTopTags", {
    limit: String(limit),
  });
  return many(data.tags?.tag);
}

/** How the crowd has tagged one album. */
export async function getAlbumTopTags(artist: string, album: string): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("album.getTopTags", {
    artist,
    album,
    autocorrect: "1",
  });
  return many(data.toptags?.tag);
}

/** How the crowd has tagged one track. */
export async function getTrackTopTags(artist: string, track: string): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("track.getTopTags", {
    artist,
    track,
    autocorrect: "1",
  });
  return many(data.toptags?.tag);
}

/** The tags one listener uses most. */
export async function getUserTopTags(username: string, limit = 50): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("user.getTopTags", {
    user: username,
    limit: String(limit),
  });
  return many(data.toptags?.tag);
}

/** What a listener has personally tagged an item, which only they see. */
export type TaggableKind = "artist" | "album" | "track";

export async function getUserTagsFor(
  kind: TaggableKind,
  username: string,
  params: { artist: string; album?: string; track?: string },
): Promise<WeightedTag[]> {
  const data = await call<{ tags?: { tag?: WeightedTag | WeightedTag[] } }>(`${kind}.getTags`, {
    ...params,
    user: username,
    autocorrect: "1",
  } as Record<string, string>);
  return many(data.tags?.tag);
}

export interface PersonalTagging {
  name: string;
  url?: string;
  artist?: { name?: string };
}

/**
 * Everything one listener has filed under a tag of their own.
 *
 * The results are nested under a key that depends on the type asked for —
 * `taggings.artists.artist`, `taggings.albums.album` — so the shape is
 * resolved from `kind` rather than guessed.
 */
export async function getPersonalTags(
  username: string,
  tag: string,
  kind: TaggableKind,
  limit = 50,
): Promise<{ items: PersonalTagging[]; total: number }> {
  const data = await call<Record<string, Record<string, unknown>>>("user.getPersonalTags", {
    user: username,
    tag,
    taggingtype: kind,
    limit: String(limit),
  });

  const taggings = data.taggings ?? {};
  const group = taggings[`${kind}s`] as Record<string, unknown> | undefined;
  const raw = group?.[kind] as PersonalTagging | PersonalTagging[] | undefined;
  const attr = taggings["@attr"] as { total?: string } | undefined;

  return { items: many(raw), total: Number(attr?.total ?? 0) };
}

/** The weeks a tag has chart data for. */
export async function getTagWeeklyChartList(tag: string): Promise<{ from: string; to: string }[]> {
  const data = await call<{
    weeklychartlist?: { chart?: { from: string; to: string }[] };
  }>("tag.getWeeklyChartList", { tag });
  return many(data.weeklychartlist?.chart);
}
