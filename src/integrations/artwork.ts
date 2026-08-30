import * as itunes from "./itunes/index.js";

const LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

export function isPlaceholder(url: string | null | undefined): boolean {
  return !url || url.includes(LASTFM_PLACEHOLDER);
}

export function realLastfmArt(url: string | null | undefined): string | null {
  return isPlaceholder(url) ? null : (url ?? null);
}

async function attempt(load: () => Promise<string | null>): Promise<string | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export async function artistImage(name: string): Promise<string | null> {
  if (!name.trim()) return null;
  return await attempt(() => itunes.lookupArtwork(name, "album", name));
}

export async function albumImage(artist: string, album: string): Promise<string | null> {
  if (!album.trim()) return null;
  return await attempt(() => itunes.lookupArtwork(`${artist} ${album}`.trim(), "album"));
}

export async function trackImage(artist: string, track: string): Promise<string | null> {
  if (!track.trim()) return null;
  return await attempt(() => itunes.lookupArtwork(`${artist} ${track}`.trim(), "song"));
}
