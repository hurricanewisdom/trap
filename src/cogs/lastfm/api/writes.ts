/**
 * The methods that change something on Last.fm.
 *
 * All of these need the user's session key and must be POSTed. The session
 * key is part of the signature, so `call` signs it with everything else.
 */

import { LastfmError, call } from "./client.js";
import type { TaggableKind } from "./tags.js";

/**
 * Write methods need the user's session key and must be POSTed. The session
 * key is part of the signature, so `call` signs it along with everything else.
 *
 * Last.fm reports a dead or revoked session as error 9, which callers turn
 * into "link again" rather than a generic failure.
 */
export const INVALID_SESSION = 9;

export async function loveTrack(
  artist: string,
  track: string,
  sessionKey: string,
  loved = true,
): Promise<void> {
  await call<unknown>(
    loved ? "track.love" : "track.unlove",
    { artist, track, sk: sessionKey },
    { signed: true, method: "POST" },
  );
}

export interface ScrobbleResult {
  accepted: number;
  ignored: number;
  /** Last.fm's reason when it declines a scrobble, e.g. a timestamp too old. */
  reason?: string;
  artist?: string;
  track?: string;
}

/** Records a play. The timestamp is when listening *started*, in seconds. */
export async function scrobbleTrack(
  entry: { artist: string; track: string; album?: string; timestamp: number },
  sessionKey: string,
): Promise<ScrobbleResult> {
  const data = await call<{
    scrobbles?: {
      "@attr"?: { accepted?: number | string; ignored?: number | string };
      scrobble?: {
        artist?: { "#text"?: string };
        track?: { "#text"?: string };
        ignoredMessage?: { code?: string; "#text"?: string };
      };
    };
  }>(
    "track.scrobble",
    {
      artist: entry.artist,
      track: entry.track,
      timestamp: String(entry.timestamp),
      sk: sessionKey,
      ...(entry.album ? { album: entry.album } : {}),
    },
    { signed: true, method: "POST" },
  );

  const attr = data.scrobbles?.["@attr"];
  const one = data.scrobbles?.scrobble;
  const ignoredText = one?.ignoredMessage?.["#text"];
  return {
    accepted: Number(attr?.accepted ?? 0),
    ignored: Number(attr?.ignored ?? 0),
    reason: ignoredText && ignoredText.trim() ? ignoredText : undefined,
    artist: one?.artist?.["#text"],
    track: one?.track?.["#text"],
  };
}

/** Marks a track as playing right now, without recording a play. */
export async function updateNowPlaying(
  entry: { artist: string; track: string; album?: string },
  sessionKey: string,
): Promise<void> {
  await call<unknown>(
    "track.updateNowPlaying",
    {
      artist: entry.artist,
      track: entry.track,
      sk: sessionKey,
      ...(entry.album ? { album: entry.album } : {}),
    },
    { signed: true, method: "POST" },
  );
}

/* ------------------------------------------------------------------ */
/* Tagging                                                             */
/* ------------------------------------------------------------------ */

/** Last.fm accepts at most ten tags in one call. */
export const MAX_TAGS_PER_CALL = 10;

/**
 * Attaches tags to an artist, album or track for one listener.
 *
 * The tags are sent as a single comma-separated value, and that whole string
 * is what gets signed — splitting it into repeated parameters produces a
 * signature Last.fm rejects with the same opaque message as a wrong secret.
 */
export async function addTags(
  kind: TaggableKind,
  params: { artist: string; album?: string; track?: string },
  tags: string[],
  sessionKey: string,
): Promise<void> {
  await call(
    `${kind}.addTags`,
    { ...params, tags: tags.slice(0, MAX_TAGS_PER_CALL).join(","), sk: sessionKey } as Record<
      string,
      string
    >,
    { signed: true, method: "POST" },
  );
}

/** Removes one tag. Last.fm takes exactly one per call, not a list. */
export async function removeTag(
  kind: TaggableKind,
  params: { artist: string; album?: string; track?: string },
  tag: string,
  sessionKey: string,
): Promise<void> {
  await call(
    `${kind}.removeTag`,
    { ...params, tag, sk: sessionKey } as Record<string, string>,
    { signed: true, method: "POST" },
  );
}
