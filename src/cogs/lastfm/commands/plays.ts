import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import {
  getAlbumInfo,
  getArtistInfo,
  getRecentTracks,
  getTopAlbums,
  getTopTracks,
  getTrackInfo,
  type Period,
  type RecentTrack,
} from "../api/index.js";
import { guard } from "../guard.js";
import {
  USER_ACCENT,
  TargetError,
  avatarOf,
  buildPages,
  chartLine,
  extractPeriod,
  label,
  periodLabel,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  url,
  type Target,
} from "../shared.js";
import type { LfArtistRef } from "../types.js";

const TOP_N = 10;

const OVERVIEW_N = 3;

const MAX_ALBUM_TRACKS = 50;

const LOOKUP_CONCURRENCY = 4;

const SEPARATOR = /\s+[-–—]\s+/;

interface AlbumTrack {
  name: string;
  url?: string;
  duration?: string | null;
}

function list<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function artistNameOf(ref: LfArtistRef | undefined): string {
  return ref?.name ?? ref?.["#text"] ?? "";
}

function matcher(...names: string[]): (candidate: string) => boolean {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  return (candidate) => wanted.has(candidate.trim().toLowerCase());
}

const segment = (value: string) =>
  encodeURIComponent(value).replaceAll("(", "%28").replaceAll(")", "%29");

const artistLink = (artist: string) => `https://www.last.fm/music/${segment(artist)}`;

const albumUrl = (artist: string, album: string) =>
  `${artistLink(artist)}/${segment(album)}`;

const trackUrl = (artist: string, track: string) =>
  `${artistLink(artist)}/_/${segment(track)}`;

const playCount = (value: string | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function withGlobals(line: string, listeners?: string, playcount?: string): string {
  const parts = [
    Number(listeners) ? `${Number(listeners).toLocaleString("en-US")} listeners` : null,
    Number(playcount) ? `${Number(playcount).toLocaleString("en-US")} plays worldwide` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${line}\n-# ${parts.join(" • ")}` : line;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];

      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

function trailingPeriod(argument: string): { period: Period; rest: string } {
  const trimmed = argument.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { period: "overall", rest: "" };

  const last = words[words.length - 1] ?? "";
  const tail = extractPeriod(last);

  if (tail.rest === "") return { period: tail.period, rest: words.slice(0, -1).join(" ") };
  return { period: "overall", rest: trimmed };
}

async function currentTrack(username: string): Promise<RecentTrack> {
  const { tracks } = await getRecentTracks(username, 1);
  const track = tracks[0];
  if (!track?.name) {
    throw new TargetError(`**${label(username)}** has not scrobbled anything yet.`);
  }
  return track;
}

function artistOf(track: RecentTrack): string {
  const name = artistNameOf(track.artist);
  if (!name) throw new TargetError("Last.fm did not name the artist of that scrobble.");
  return name;
}

async function artistOperand(ctx: PrefixContext): Promise<{ target: Target; artist: string }> {
  const { target, rest } = await resolveTarget(ctx, ctx.argument);
  const typed = rest.trim();
  if (typed) return { target, artist: typed };
  return { target, artist: artistOf(await currentTrack(target.username)) };
}

async function pairOperand(
  ctx: PrefixContext,
  kind: "album" | "track",
  command: string,
): Promise<{ target: Target; artist: string; title: string }> {
  const { target, rest } = await resolveTarget(ctx, ctx.argument);
  const typed = rest.trim();

  if (!typed) {
    const current = await currentTrack(target.username);
    const artist = artistOf(current);
    if (kind === "track") return { target, artist, title: current.name };

    const album = current.album?.["#text"]?.trim() ?? "";
    if (!album) {
      throw new TargetError(
        `That scrobble has no album attached, so name one: \`,${command} artist - album\`.`,
      );
    }
    return { target, artist, title: album };
  }

  const found = SEPARATOR.exec(typed);
  if (!found) {
    throw new TargetError(
      `Separate the artist and the ${kind} with a space, a dash and a space. ` +
        `\`,${command} artist - ${kind}\`.`,
    );
  }

  const token = found[0] ?? " - ";
  const artist = typed.slice(0, found.index).trim();
  const title = typed.slice(found.index + token.length).trim();
  if (!artist || !title) {
    throw new TargetError(`Both halves are needed. Use \`,${command} artist - ${kind}\`.`);
  }
  return { target, artist, title };
}

async function playsArtist(ctx: PrefixContext): Promise<void> {
  const { target, artist } = await artistOperand(ctx);

  const info = await getArtistInfo(artist, target.username);
  if (!info) throw new TargetError(`I could not find an artist called **${label(artist)}**.`);

  const name = info.name || artist;
  const count = playCount(info.stats?.userplaycount);
  const line = `**[${label(name)}](${url(info.url, artistLink(name))})** · **${plural(count, "play")}**`;
  const icon = avatarOf(await profile(target.username));

  await paginate(
    ctx,
    simpleCard(
      `${target.username}'s plays for ${label(name)}`,
      withGlobals(line, info.stats?.listeners, info.stats?.playcount),
      icon,
    ),
    USER_ACCENT,
  );
}

async function playsAlbum(ctx: PrefixContext): Promise<void> {
  const { target, artist, title } = await pairOperand(ctx, "album", "playsalbum");

  const album = await getAlbumInfo(artist, title, target.username);
  if (!album) {
    throw new TargetError(`I could not find **${label(title)}** by **${label(artist)}**.`);
  }

  const name = album.name || title;
  const by = album.artist || artist;
  const count = playCount(album.userplaycount);
  const link = url(album.url, albumUrl(by, name));
  const line = `**[${label(name)}](${link})** by **${label(by)}** · **${plural(count, "play")}**`;
  const icon = avatarOf(await profile(target.username));

  await paginate(
    ctx,
    simpleCard(
      `${target.username}'s plays for ${label(name)}`,
      withGlobals(line, album.listeners, album.playcount),
      icon,
    ),
    USER_ACCENT,
  );
}

async function playsTrack(ctx: PrefixContext): Promise<void> {
  const { target, artist, title } = await pairOperand(ctx, "track", "playstrack");

  const info = await getTrackInfo(artist, title, target.username);
  if (!info) {
    throw new TargetError(`I could not find **${label(title)}** by **${label(artist)}**.`);
  }

  const count = playCount(info.userplaycount);
  const link = url(info.url, trackUrl(artist, title));
  const line = `**[${label(title)}](${link})** by **${label(artist)}** · **${plural(count, "play")}**`;
  const album = info.album?.title;
  const icon = avatarOf(await profile(target.username));

  await paginate(
    ctx,
    simpleCard(
      `${target.username}'s plays for ${label(title)}`,
      album ? `${line}\n-# From ${label(album)}` : line,
      icon,
    ),
    USER_ACCENT,
  );
}

async function playsAll(ctx: PrefixContext): Promise<void> {
  const { target, artist, title } = await pairOperand(ctx, "album", "playsall");

  const album = await getAlbumInfo(artist, title, target.username);
  if (!album) {
    throw new TargetError(`I could not find **${label(title)}** by **${label(artist)}**.`);
  }

  const name = album.name || title;
  const by = album.artist || artist;

  const every = list<AlbumTrack>(album.tracks?.track).filter((t) => Boolean(t.name));
  if (every.length === 0) {
    throw new TargetError(`Last.fm has no track list for **${label(name)}**.`);
  }
  const tracks = every.slice(0, MAX_ALBUM_TRACKS);

  const counts = await mapLimit(tracks, LOOKUP_CONCURRENCY, async (track) => {
    const info = await getTrackInfo(by, track.name, target.username);
    return playCount(info?.userplaycount);
  });

  const lines = tracks.map((track, i) =>
    chartLine(i + 1, track.name, url(track.url, trackUrl(by, track.name)), counts[i] ?? 0),
  );
  const total = counts.reduce((sum, n) => sum + n, 0);
  const capped = every.length > tracks.length ? ` (first ${tracks.length} tracks)` : "";
  const icon = avatarOf(await profile(target.username));

  await paginate(
    ctx,
    buildPages(lines, {
      heading: `${target.username}'s plays on ${label(name)}${capped}`,
      username: target.username,
      icon,
      noun: "plays",
      total,
    }),
    USER_ACCENT,
  );
}

async function topTen(ctx: PrefixContext, kind: "albums" | "tracks"): Promise<void> {
  const { target, rest } = await resolveTarget(ctx, ctx.argument);
  const { period, rest: typed } = trailingPeriod(rest);
  const artist = typed || artistOf(await currentTrack(target.username));

  const info = await getArtistInfo(artist, target.username);
  const name = info?.name || artist;
  const belongs = matcher(name, artist);
  const icon = avatarOf(await profile(target.username));
  const heading = `${target.username}'s ${periodLabel(period)} top ${kind} for ${label(name)}`;

  if (kind === "albums") {
    const { items } = await getTopAlbums(target.username, period);
    const mine = items.filter((a) => belongs(artistNameOf(a.artist)));
    const lines = mine
      .slice(0, TOP_N)
      .map((a, i) =>
        chartLine(i + 1, a.name, url(a.url, albumUrl(name, a.name)), playCount(a.playcount)),
      );
    await render(ctx, lines, heading, target.username, icon, "albums", mine.length, name);
    return;
  }

  const { items } = await getTopTracks(target.username, period);
  const mine = items.filter((t) => belongs(artistNameOf(t.artist)));
  const lines = mine
    .slice(0, TOP_N)
    .map((t, i) =>
      chartLine(i + 1, t.name, url(t.url, trackUrl(name, t.name)), playCount(t.playcount)),
    );
  await render(ctx, lines, heading, target.username, icon, "tracks", mine.length, name);
}

async function render(
  ctx: PrefixContext,
  lines: string[],
  heading: string,
  username: string,
  icon: string | null,
  noun: string,
  total: number,
  artist: string,
): Promise<void> {
  if (lines.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, `No scrobbled ${noun} by **${label(artist)}**.`, icon),
      USER_ACCENT,
    );
    return;
  }
  await paginate(ctx, buildPages(lines, { heading, username, icon, noun, total }), USER_ACCENT);
}

async function overview(ctx: PrefixContext): Promise<void> {
  const { target, artist } = await artistOperand(ctx);

  const info = await getArtistInfo(artist, target.username);
  if (!info) throw new TargetError(`I could not find an artist called **${label(artist)}**.`);

  const name = info.name || artist;
  const belongs = matcher(name, artist);

  const [albums, tracks, user] = await Promise.all([
    getTopAlbums(target.username, "overall"),
    getTopTracks(target.username, "overall"),
    profile(target.username),
  ]);

  const topAlbums = albums.items
    .filter((a) => belongs(artistNameOf(a.artist)))
    .slice(0, OVERVIEW_N)
    .map((a, i) =>
      chartLine(i + 1, a.name, url(a.url, albumUrl(name, a.name)), playCount(a.playcount)),
    );

  const topTracks = tracks.items
    .filter((t) => belongs(artistNameOf(t.artist)))
    .slice(0, OVERVIEW_N)
    .map((t, i) =>
      chartLine(i + 1, t.name, url(t.url, trackUrl(name, t.name)), playCount(t.playcount)),
    );

  const nothing = "-# Nothing scrobbled yet.";
  const body = [
    `**[${label(name)}](${url(info.url, artistLink(name))})**`,
    "",
    `**Plays** · ${plural(playCount(info.stats?.userplaycount), "play")}`,
    `**Listeners** · ${playCount(info.stats?.listeners).toLocaleString("en-US")}`,
    `**Global plays** · ${playCount(info.stats?.playcount).toLocaleString("en-US")}`,
    "",
    "**Top albums**",
    ...(topAlbums.length > 0 ? topAlbums : [nothing]),
    "",
    "**Top tracks**",
    ...(topTracks.length > 0 ? topTracks : [nothing]),
  ].join("\n");

  await paginate(
    ctx,
    simpleCard(`${target.username}'s ${label(name)} overview`, body, avatarOf(user)),
    USER_ACCENT,
  );
}

export function registerPlays(): void {
  register({
    name: "plays",
    aliases: ["artistplays", "ap"],
    description: "Your play count for an artist",
    handler: guard(playsArtist),
  });
  register({
    name: "playsalbum",
    aliases: ["albumplays", "pa"],
    description: "Your play count for an album",
    handler: guard(playsAlbum),
  });
  register({
    name: "playstrack",
    aliases: ["trackplays", "pt"],
    description: "Your play count for a track",
    handler: guard(playsTrack),
  });
  register({
    name: "playsall",
    aliases: ["albumtracks", "pall"],
    description: "Your plays for every track on an album",
    handler: guard(playsAll),
  });
  register({
    name: "toptenalbums",
    aliases: ["tta", "t10a"],
    description: "Your top 10 albums for one artist",
    handler: guard((ctx) => topTen(ctx, "albums")),
  });
  register({
    name: "toptentracks",
    aliases: ["ttt", "t10t"],
    description: "Your top 10 tracks for one artist",
    handler: guard((ctx) => topTen(ctx, "tracks")),
  });
  register({
    name: "overview",
    aliases: ["artistoverview", "ov"],
    description: "Combined stats for one artist",
    handler: guard(overview),
  });
}
