/**
 * The Last.fm API client.
 *
 *   client.ts     signing, the request itself, and the auth handshake
 *   users.ts      a listener: profile, recent scrobbles, loved, track stats
 *   charts.ts     top artists/albums/tracks over a period, artist and album stats
 *   discovery.ts  weekly ranges, similarity, global and country charts
 *   search.ts     catalogue search and spelling corrections
 *   tags.ts       the tag system: the crowd's, one listener's, and the tag itself
 *   writes.ts     love, unlove, scrobble, now playing — everything signed and POSTed
 *
 * Split by what a call is *for* rather than by size: the read paths are used
 * by every stats command, while the writes are the only ones that need a
 * user's session key and can fail with "link again".
 *
 * Everything is re-exported here, so callers import from `../api.js` and do
 * not have to know which file a method lives in.
 */

export * from "./client.js";
export * from "./users.js";
export * from "./charts.js";
export * from "./discovery.js";
export * from "./search.js";
export * from "./tags.js";
export * from "./writes.js";
