import { call } from "./client.js";
import type { TaggableKind } from "./tags.js";

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
  reason?: string;
  artist?: string;
  track?: string;
}

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

export const MAX_TAGS_PER_CALL = 10;

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
