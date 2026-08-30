import { call } from "./client.js";
import type { RecentTrack } from "./users.js";

import type {
  AlbumStats,
  ArtistStats,
  LovedTrack,
  TopAlbum,
  TopArtist,
  TopTrack,
} from "../types.js";

export type Period = "overall" | "7day" | "1month" | "3month" | "6month" | "12month";

function totals(attr: { total?: string; totalPages?: string } | undefined): {
  total: number;
  pages: number;
} {
  return {
    total: Number(attr?.total ?? 0),
    pages: Number(attr?.totalPages ?? 1),
  };
}

function list<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export async function getTopArtists(
  user: string,
  period: Period,
  limit = 1000,
): Promise<{ items: TopArtist[]; total: number }> {
  const data = await call<{
    topartists?: { artist?: TopArtist | TopArtist[]; "@attr"?: { total?: string } };
  }>("user.getTopArtists", { user, period, limit: String(limit) });
  return {
    items: list(data.topartists?.artist),
    total: totals(data.topartists?.["@attr"]).total,
  };
}

export async function getTopAlbums(
  user: string,
  period: Period,
  limit = 1000,
): Promise<{ items: TopAlbum[]; total: number }> {
  const data = await call<{
    topalbums?: { album?: TopAlbum | TopAlbum[]; "@attr"?: { total?: string } };
  }>("user.getTopAlbums", { user, period, limit: String(limit) });
  return {
    items: list(data.topalbums?.album),
    total: totals(data.topalbums?.["@attr"]).total,
  };
}

export async function getTopTracks(
  user: string,
  period: Period,
  limit = 1000,
): Promise<{ items: TopTrack[]; total: number }> {
  const data = await call<{
    toptracks?: { track?: TopTrack | TopTrack[]; "@attr"?: { total?: string } };
  }>("user.getTopTracks", { user, period, limit: String(limit) });
  return {
    items: list(data.toptracks?.track),
    total: totals(data.toptracks?.["@attr"]).total,
  };
}

export async function getLovedTracks(
  user: string,
  limit = 1000,
): Promise<{ items: LovedTrack[]; total: number }> {
  const data = await call<{
    lovedtracks?: { track?: LovedTrack | LovedTrack[]; "@attr"?: { total?: string } };
  }>("user.getLovedTracks", { user, limit: String(limit) });
  return {
    items: list(data.lovedtracks?.track),
    total: totals(data.lovedtracks?.["@attr"]).total,
  };
}

export async function getRecentPage(
  user: string,
  page: number,
  limit = 200,
): Promise<{ items: RecentTrack[]; total: number; pages: number }> {
  const data = await call<{
    recenttracks?: {
      track?: RecentTrack | RecentTrack[];
      "@attr"?: { total?: string; totalPages?: string };
    };
  }>("user.getRecentTracks", {
    user,
    limit: String(limit),
    page: String(page),
    extended: "1",
  });
  const { total, pages } = totals(data.recenttracks?.["@attr"]);
  return { items: list(data.recenttracks?.track), total, pages };
}

export async function getArtistInfo(
  artist: string,
  username?: string,
): Promise<ArtistStats | null> {
  try {
    const data = await call<{ artist?: ArtistStats }>("artist.getInfo", {
      artist,
      autocorrect: "1",
      ...(username ? { username } : {}),
    });
    return data.artist ?? null;
  } catch {
    return null;
  }
}

export async function getAlbumInfo(
  artist: string,
  album: string,
  username?: string,
): Promise<AlbumStats | null> {
  try {
    const data = await call<{ album?: AlbumStats }>("album.getInfo", {
      artist,
      album,
      autocorrect: "1",
      ...(username ? { username } : {}),
    });
    return data.album ?? null;
  } catch {
    return null;
  }
}
