import { LastfmError, call } from "./client.js";

export interface UserInfo {
  name: string;
  playcount: string;
  url: string;
  image?: { "#text": string; size: string }[];
  registered?: { unixtime: string };
}

export async function getUserInfo(username: string): Promise<UserInfo> {
  const data = await call<{ user?: UserInfo }>("user.getInfo", { user: username });
  if (!data.user) throw new LastfmError("No such Last.fm user");
  return data.user;
}

export interface Image {
  "#text": string;
  size: string;
}

export interface RecentTrack {
  name: string;
  url: string;
  artist: { name?: string; "#text"?: string; url?: string };
  album?: { "#text"?: string };
  image?: Image[];
  loved?: string;
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
}

export function largestImage(images: Image[] | undefined): string | null {
  if (!images?.length) return null;
  const order = ["mega", "extralarge", "large", "medium", "small"];
  for (const size of order) {
    const hit = images.find((i) => i.size === size && i["#text"]);
    if (hit) return hit["#text"];
  }
  return images.find((i) => i["#text"])?.["#text"] ?? null;
}

export interface RecentTracks {
  track: RecentTrack | RecentTrack[];
  "@attr"?: { total?: string; user?: string };
}

export async function getRecentTracks(username: string, limit = 1): Promise<{
  tracks: RecentTrack[];
  total: number;
}> {
  const data = await call<{ recenttracks?: RecentTracks }>("user.getRecentTracks", {
    user: username,
    limit: String(limit),
    extended: "1",
  });
  const raw = data.recenttracks?.track;
  const tracks = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { tracks, total: Number(data.recenttracks?.["@attr"]?.total ?? 0) };
}

export interface TrackInfo {
  userplaycount?: string;
  duration?: string;
  url?: string;
  album?: { title?: string; image?: Image[] };
}

export async function getTrackInfo(
  artist: string,
  track: string,
  username: string,
): Promise<TrackInfo | null> {
  try {
    const data = await call<{ track?: TrackInfo }>(
      "track.getInfo",
      { artist, track, username, autocorrect: "1" },
      { timeoutMs: 6000 },
    );
    return data.track ?? null;
  } catch {
    return null;
  }
}

export interface Friend {
  name: string;
  url?: string;
  realname?: string;
  country?: string;
  playcount?: string;
  image?: Image[];
  registered?: { unixtime?: string };
}

const NO_SUCH_PAGE = 6;

export async function getFriends(
  username: string,
  limit = 50,
  page = 1,
): Promise<{ friends: Friend[]; total: number }> {
  let data: { friends?: { user?: Friend | Friend[]; "@attr"?: { total?: string } } };

  try {
    data = await call<{
      friends?: { user?: Friend | Friend[]; "@attr"?: { total?: string } };
    }>("user.getFriends", { user: username, limit: String(limit), page: String(page) });
  } catch (err) {
    if (err instanceof LastfmError && err.code === NO_SUCH_PAGE) {
      return { friends: [], total: 0 };
    }
    throw err;
  }

  const raw = data.friends?.user;
  return {
    friends: Array.isArray(raw) ? raw : raw ? [raw] : [],
    total: Number(data.friends?.["@attr"]?.total ?? 0),
  };
}

export interface LibraryArtist {
  name: string;
  url?: string;
  playcount?: string;
  tagcount?: string;
  image?: Image[];
}

export async function getLibraryArtists(
  username: string,
  limit = 50,
  page = 1,
): Promise<{ artists: LibraryArtist[]; total: number; pages: number }> {
  const data = await call<{
    artists?: {
      artist?: LibraryArtist | LibraryArtist[];
      "@attr"?: { total?: string; totalPages?: string };
    };
  }>("library.getArtists", { user: username, limit: String(limit), page: String(page) });

  const raw = data.artists?.artist;
  return {
    artists: Array.isArray(raw) ? raw : raw ? [raw] : [],
    total: Number(data.artists?.["@attr"]?.total ?? 0),
    pages: Number(data.artists?.["@attr"]?.totalPages ?? 0),
  };
}
