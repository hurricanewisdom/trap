/**
 * Publishing "what is this person playing" for the rest of the bot.
 *
 * Other cogs need the answer but must not import this one, so the Last.fm cog
 * registers itself as the provider at setup and they ask `core/listening`.
 * See that file for why the dependency points this way.
 */

import { provideNowPlaying, type NowPlaying } from "../../core/listening.js";
import { getRecentTracks } from "./api/index.js";
import { getUsername } from "./store.js";

/** Reads the caller's most recent scrobble, or null if there is nothing to read. */
async function currentFor(discordId: string): Promise<NowPlaying | null> {
  const username = await getUsername(discordId);
  if (!username) return null;

  const { tracks } = await getRecentTracks(username, 1);
  const current = tracks[0];
  if (!current) return null;

  const artist = current.artist?.name ?? current.artist?.["#text"] ?? "";
  if (!artist || !current.name) return null;

  return {
    artist,
    track: current.name,
    album: current.album?.["#text"] || undefined,
    label: `${current.name} by ${artist}`,
    // Last.fm marks a live track with @attr.nowplaying; without it this is
    // simply the last thing they finished.
    playing: current["@attr"]?.nowplaying === "true",
  };
}

export function registerListeningProvider(): void {
  provideNowPlaying(currentFor);
}
