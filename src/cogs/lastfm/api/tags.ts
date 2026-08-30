import { call } from "./client.js";

export interface WeightedTag {
  name: string;
  count?: string | number;
  url?: string;
}

export interface TagInfo {
  name: string;
  total?: string | number;
  reach?: string | number;
  wiki?: { summary?: string; content?: string };
}

export interface ChartTag {
  name: string;
  url?: string;
  reach?: string;
  taggings?: string;
}

function many<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export async function getTagInfo(tag: string): Promise<TagInfo | null> {
  const data = await call<{ tag?: TagInfo }>("tag.getInfo", { tag });
  return data.tag?.name ? data.tag : null;
}

export async function getSimilarTags(tag: string): Promise<WeightedTag[]> {
  const data = await call<{ similartags?: { tag?: WeightedTag | WeightedTag[] } }>(
    "tag.getSimilar",
    { tag },
  );
  return many(data.similartags?.tag);
}

export async function getGlobalTopTags(): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("tag.getTopTags");
  return many(data.toptags?.tag);
}

export async function getChartTopTags(limit = 50): Promise<ChartTag[]> {
  const data = await call<{ tags?: { tag?: ChartTag | ChartTag[] } }>("chart.getTopTags", {
    limit: String(limit),
  });
  return many(data.tags?.tag);
}

export async function getAlbumTopTags(artist: string, album: string): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("album.getTopTags", {
    artist,
    album,
    autocorrect: "1",
  });
  return many(data.toptags?.tag);
}

export async function getTrackTopTags(artist: string, track: string): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("track.getTopTags", {
    artist,
    track,
    autocorrect: "1",
  });
  return many(data.toptags?.tag);
}

export async function getUserTopTags(username: string, limit = 50): Promise<WeightedTag[]> {
  const data = await call<{ toptags?: { tag?: WeightedTag | WeightedTag[] } }>("user.getTopTags", {
    user: username,
    limit: String(limit),
  });
  return many(data.toptags?.tag);
}

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

export async function getTagWeeklyChartList(tag: string): Promise<{ from: string; to: string }[]> {
  const data = await call<{
    weeklychartlist?: { chart?: { from: string; to: string }[] };
  }>("tag.getWeeklyChartList", { tag });
  return many(data.weeklychartlist?.chart);
}
