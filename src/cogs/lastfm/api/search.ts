import { call } from "./client.js";
import type { LfImage } from "../types.js";

export interface ArtistMatch {
  name: string;
  url?: string;
  listeners?: string;
  mbid?: string;
  image?: LfImage[];
}

export interface AlbumMatch {
  name: string;
  artist: string;
  url?: string;
  mbid?: string;
  image?: LfImage[];
}

export interface TrackMatch {
  name: string;
  artist: string;
  url?: string;
  listeners?: string;
  mbid?: string;
  image?: LfImage[];
}

function many<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export async function searchArtists(query: string, limit = 30): Promise<ArtistMatch[]> {
  const data = await call<{
    results?: { artistmatches?: { artist?: ArtistMatch | ArtistMatch[] } };
  }>("artist.search", { artist: query, limit: String(limit) });
  return many(data.results?.artistmatches?.artist);
}

export async function searchAlbums(query: string, limit = 30): Promise<AlbumMatch[]> {
  const data = await call<{
    results?: { albummatches?: { album?: AlbumMatch | AlbumMatch[] } };
  }>("album.search", { album: query, limit: String(limit) });
  return many(data.results?.albummatches?.album);
}

export async function searchTracks(query: string, limit = 30): Promise<TrackMatch[]> {
  const data = await call<{
    results?: { trackmatches?: { track?: TrackMatch | TrackMatch[] } };
  }>("track.search", { track: query, limit: String(limit) });
  return many(data.results?.trackmatches?.track);
}

export interface Correction {
  name: string;
  url?: string;
  artist?: string;
}

export async function getArtistCorrection(artist: string): Promise<Correction | null> {
  const data = await call<{
    corrections?: { correction?: { artist?: { name?: string; url?: string } } };
  }>("artist.getCorrection", { artist });

  const found = data.corrections?.correction?.artist;
  if (!found?.name) return null;
  return { name: found.name, url: found.url ?? undefined };
}

export async function getTrackCorrection(
  artist: string,
  track: string,
): Promise<Correction | null> {
  const data = await call<{
    corrections?: {
      correction?: {
        track?: { name?: string; url?: string; artist?: { name?: string } };
      };
    };
  }>("track.getCorrection", { artist, track });

  const found = data.corrections?.correction?.track;
  if (!found?.name) return null;
  return {
    name: found.name,
    url: found.url ?? undefined,
    artist: found.artist?.name ?? undefined,
  };
}
