import { provideNowPlaying, type NowPlaying } from "../../core/listening.js";
import { getRecentTracks } from "./api/index.js";
import { getUsername } from "./store.js";

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
    playing: current["@attr"]?.nowplaying === "true",
  };
}

export function registerListeningProvider(): void {
  provideNowPlaying(currentFor);
}
