/**
 * The iTunes Search API.
 *
 * Needs no key and no account, which makes it the dependable fallback: where
 * Last.fm has nothing (artwork for anything but an album, and audio of any
 * kind), iTunes still answers.
 *
 * It is, in exchange, undocumented about its limits — roughly twenty calls a
 * minute before it starts refusing — so every lookup here is cached and
 * callers are expected to keep concurrency low.
 */

import { cacheKey, cached } from "../../helpers/cache.js";
import { HttpError, TimeoutError, getJson } from "../../helpers/http.js";

const SEARCH_URL = "https://itunes.apple.com/search";
const TIMEOUT_MS = 8000;
const SEARCH_TTL = 24 * 60 * 60;
const ART_TTL = 7 * 24 * 60 * 60;

/** What iTunes calls the kind of thing being searched for. */
export type ITunesEntity = "song" | "album" | "musicArtist";

export interface ITunesResult {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  artistViewUrl?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  kind?: string;
}

export class ITunesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ITunesError";
  }
}

/** Searches the catalogue, cached by term. */
export async function search(
  term: string,
  entity: ITunesEntity,
  limit: number,
): Promise<ITunesResult[]> {
  const query = term.trim();
  if (!query) return [];

  const results = await cached<ITunesResult[]>(
    cacheKey("itunes:search", entity, limit, query),
    { ttl: SEARCH_TTL },
    async () => {
      const params = new URLSearchParams({
        term: query,
        entity,
        limit: String(limit),
        media: "music",
      });
      try {
        const body = await getJson<{ results?: ITunesResult[] }>(`${SEARCH_URL}?${params}`, {
          timeoutMs: TIMEOUT_MS,
        });
        return body.results ?? [];
      } catch (err) {
        if (err instanceof TimeoutError) throw new ITunesError("iTunes timed out.");
        if (err instanceof HttpError) throw new ITunesError(`iTunes returned ${err.status}.`);
        throw err;
      }
    },
  );

  return results ?? [];
}

/**
 * Rewrites an artwork URL to a different size.
 *
 * iTunes returns a 100px thumbnail, but the dimensions are just a path
 * segment, so any size can be asked for and the CDN serves it.
 */
export function artwork(raw: string | undefined, size = 600): string | null {
  if (!raw) return null;
  return raw.replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

/** For comparing names that differ only in case or punctuation. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Cover art for a search term.
 *
 * `expectArtist` guards against a real hazard: searching for "Snoop Dogg"
 * returns an album by somebody else that merely features him, and using it
 * would put the wrong face on his tile. When set, only rows whose artist
 * matches are considered.
 */
export async function lookupArtwork(
  term: string,
  entity: Exclude<ITunesEntity, "musicArtist">,
  expectArtist?: string,
): Promise<string | null> {
  const query = term.trim();
  if (!query) return null;

  return await cached<string>(
    cacheKey("itunes:art", entity, normalise(expectArtist ?? ""), query),
    { ttl: ART_TTL },
    async () => {
      const results = await search(query, entity, expectArtist ? 10 : 1);
      const wanted = expectArtist ? normalise(expectArtist) : "";
      const best = wanted
        ? (results.find((r) => normalise(r.artistName ?? "") === wanted) ??
          results.find((r) => normalise(r.artistName ?? "").startsWith(wanted)))
        : results[0];
      return artwork(best?.artworkUrl100, 600);
    },
  );
}
