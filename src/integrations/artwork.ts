/**
 * One place to answer "what does this look like?".
 *
 * Last.fm returns real covers for albums, but for artists and top tracks it
 * returns the same placeholder star for every single row — which is worse
 * than returning nothing, because it looks like an answer. iTunes fills that
 * gap and needs no key.
 *
 * iTunes has no artist photographs at all, so an artist is represented by the
 * cover of a record actually credited to them.
 *
 * Callers get a URL or null and never have to know which service answered.
 */

import * as itunes from "./itunes/index.js";

/**
 * The one image Last.fm serves for every artist and every top track. Present
 * in the response, but it means "no art" rather than art.
 */
const LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

/** True when a Last.fm image URL is the shared placeholder rather than a cover. */
export function isPlaceholder(url: string | null | undefined): boolean {
  return !url || url.includes(LASTFM_PLACEHOLDER);
}

/** A Last.fm image URL, or null when it is the placeholder. */
export function realLastfmArt(url: string | null | undefined): string | null {
  return isPlaceholder(url) ? null : (url ?? null);
}

/** Runs a lookup, treating an unavailable service as "no answer". */
async function attempt(load: () => Promise<string | null>): Promise<string | null> {
  try {
    return await load();
  } catch {
    // A throttled or failing service must not fail the caller: the tile that
    // wanted this art falls back to a placeholder instead.
    return null;
  }
}

/**
 * Cover art standing in for an artist.
 *
 * The artist name is passed as the expected credit as well as the query,
 * because searching for "Snoop Dogg" otherwise returns an album by somebody
 * else that merely features him.
 */
export async function artistImage(name: string): Promise<string | null> {
  if (!name.trim()) return null;
  return await attempt(() => itunes.lookupArtwork(name, "album", name));
}

/** Cover art for one album. */
export async function albumImage(artist: string, album: string): Promise<string | null> {
  if (!album.trim()) return null;
  return await attempt(() => itunes.lookupArtwork(`${artist} ${album}`.trim(), "album"));
}

/** Cover art for one track, which is its album's cover. */
export async function trackImage(artist: string, track: string): Promise<string | null> {
  if (!track.trim()) return null;
  return await attempt(() => itunes.lookupArtwork(`${artist} ${track}`.trim(), "song"));
}
