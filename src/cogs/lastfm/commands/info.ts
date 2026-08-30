/**
 * Lookups: what Last.fm knows about an artist, album or track, and the
 * artwork that goes with them.
 */

import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  getAlbumInfo,
  getArtistInfo,
  getArtistTags,
  getArtistTop,
  getRecentTracks,
  getTrackInfo,
  largestImage,
} from "../api/index.js";
import {
  EMBED_COLOR,
  TargetError,
  artistUrl,
  buildPages,
  label,
  plain,
  plural,
  resolveTarget,
  simpleCard,
  url,
  splitPair,
  currentArtist,
  currentPair,
} from "../shared.js";

const IS_COMPONENTS_V2 = 1 << 15;

const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${encodeURIComponent(track)}`;

/** Strips the "Read more on Last.fm" tail and the markup Last.fm embeds. */
function cleanBio(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<a href="[^"]*">[^<]*<\/a>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s*Read more on Last\.fm.*$/is, "")
    .trim();
}

/* ------------------------------------------------------------------ */

async function artistInfo(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim() || (await currentArtist(ctx));
  const { target } = await resolveTarget(ctx, "");
  const info = await getArtistInfo(name, target.username);
  if (!info) throw new TargetError(`Last.fm has no artist called **${label(name)}**.`);

  const tagList = (info.tags?.tag ?? []).slice(0, 6).map((t) => plain(t.name)).join(", ");
  const bio = cleanBio(info.bio?.summary);

  const rows = [
    `**[${label(info.name)}](${url(info.url, artistUrl(info.name))})**`,
    "",
    `**Your plays** ${Number(info.stats?.userplaycount ?? 0).toLocaleString("en-US")}`,
    `**Listeners** ${Number(info.stats?.listeners ?? 0).toLocaleString("en-US")}`,
    `**Global plays** ${Number(info.stats?.playcount ?? 0).toLocaleString("en-US")}`,
    ...(tagList ? ["", `**Tags** ${tagList}`] : []),
    ...(bio ? ["", bio.slice(0, 600)] : []),
  ].join("\n");

  await paginate(ctx, simpleCard(`${info.name}`, rows, largestImage(info.image)), EMBED_COLOR);
}

async function bio(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim() || (await currentArtist(ctx));
  const info = await getArtistInfo(name);
  if (!info) throw new TargetError(`Last.fm has no artist called **${label(name)}**.`);

  const text = cleanBio(info.bio?.summary);
  await paginate(
    ctx,
    simpleCard(
      `About ${info.name}`,
      text ? text.slice(0, 1500) : "Last.fm has no biography for this artist.",
      largestImage(info.image),
    ),
    EMBED_COLOR,
  );
}

async function albumInfo(ctx: PrefixContext): Promise<void> {
  const pair = splitPair(ctx.argument) ?? (await currentPair(ctx, "album"));
  const [artist, album] = pair;
  const { target } = await resolveTarget(ctx, "");
  const info = await getAlbumInfo(artist, album, target.username);
  if (!info) throw new TargetError(`No album **${label(album)}** by **${label(artist)}**.`);

  const tracks = info.tracks?.track ?? [];
  const rows = [
    `**[${label(info.name)}](${url(info.url, artistUrl(artist))})**`,
    `by **[${label(info.artist)}](${artistUrl(info.artist)})**`,
    "",
    `**Your plays** ${Number(info.userplaycount ?? 0).toLocaleString("en-US")}`,
    `**Listeners** ${Number(info.listeners ?? 0).toLocaleString("en-US")}`,
    `**Global plays** ${Number(info.playcount ?? 0).toLocaleString("en-US")}`,
    ...(tracks.length ? ["", `**Tracks** ${tracks.length}`] : []),
  ].join("\n");

  await paginate(ctx, simpleCard(info.name, rows, largestImage(info.image)), EMBED_COLOR);
}

async function trackInfo(ctx: PrefixContext): Promise<void> {
  const pair = splitPair(ctx.argument) ?? (await currentPair(ctx, "track"));
  const [artist, track] = pair;
  const { target } = await resolveTarget(ctx, "");
  const info = await getTrackInfo(artist, track, target.username);
  if (!info) throw new TargetError(`No track **${label(track)}** by **${label(artist)}**.`);

  const seconds = Number(info.duration ?? 0) / 1000;
  const length = seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : null;

  const rows = [
    `**[${label(track)}](${url(info.url, trackUrl(artist, track))})**`,
    `by **[${label(artist)}](${artistUrl(artist)})**`,
    "",
    `**Your plays** ${Number(info.userplaycount ?? 0).toLocaleString("en-US")}`,
    ...(info.album?.title ? [`**Album** ${label(info.album.title)}`] : []),
    ...(length ? [`**Length** ${length}`] : []),
  ].join("\n");

  await paginate(ctx, simpleCard(track, rows, largestImage(info.album?.image)), EMBED_COLOR);
}

/** The album art on its own, as large as Last.fm serves it. */
async function cover(ctx: PrefixContext): Promise<void> {
  const pair = splitPair(ctx.argument) ?? (await currentPair(ctx, "album"));
  const [artist, album] = pair;
  const info = await getAlbumInfo(artist, album);
  const art = largestImage(info?.image);

  if (!art) {
    await paginate(
      ctx,
      simpleCard("No artwork", `Last.fm has no cover for **${label(album)}** by **${label(artist)}**.`),
      EMBED_COLOR,
    );
    return;
  }

  // A media gallery renders the art far larger than a thumbnail would.
  await ctx.reply({
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17,
        accent_color: EMBED_COLOR,
        components: [
          { type: 10, content: `### ${label(album)}\nby ${label(artist)}` },
          { type: 12, items: [{ media: { url: art }, description: `${album} by ${artist}` }] },
        ],
      },
    ],
  });
}

/** An artist's globally biggest tracks or albums, not yours. */
function artistTop(kind: "tracks" | "albums") {
  return async (ctx: PrefixContext): Promise<void> => {
    const name = ctx.argument.trim() || (await currentArtist(ctx));
    const found = await getArtistTop(kind, name, 50);
    const heading = `${name}'s biggest ${kind}`;

    if (found.length === 0) {
      await paginate(ctx, simpleCard(heading, `Last.fm has no ${kind} for **${label(name)}**.`), EMBED_COLOR);
      return;
    }

    const rows = found.map((row, i) => {
      const link = kind === "tracks" ? trackUrl(name, row.name) : artistUrl(name);
      const plays = Number(row.playcount ?? 0);
      return plays > 0
        ? `\`${i + 1}\` **[${label(row.name)}](${url(row.url, link)})** · ${plural(plays, "play")} worldwide`
        : `\`${i + 1}\` **[${label(row.name)}](${url(row.url, link)})**`;
    });

    await paginate(
      ctx,
      buildPages(rows, { heading, username: name, noun: kind, total: found.length }),
      EMBED_COLOR,
    );
  };
}

async function artistTags(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim() || (await currentArtist(ctx));
  const found = await getArtistTags(name);
  const heading = `${name} by tag`;

  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `No tags on **${label(name)}**.`), EMBED_COLOR);
    return;
  }

  const top = Math.max(...found.map((t) => Number(t.count ?? 0)), 1);
  const rows = found.map((t, i) => {
    const count = Number(t.count ?? 0);
    return `\`${i + 1}\` **${label(t.name)}**${count ? ` · ${Math.round((count / top) * 100)}%` : ""}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: name, noun: "tags", total: found.length }),
    EMBED_COLOR,
  );
}

export function registerInfo(): void {
  const add = (
    name: string,
    aliases: string[],
    description: string,
    handler: (ctx: PrefixContext) => Promise<void>,
  ) => register({ name, aliases, description, handler: guard(handler) });

  add("artistinfo", ["ai", "artist"], "Stats and summary for an artist", artistInfo);
  add("bio", ["about", "artistbio"], "An artist's biography", bio);
  add("albuminfo", ["abi", "album"], "Stats for an album", albumInfo);
  add("trackinfo", ["ti", "track", "song"], "Stats for a track", trackInfo);
  add("cover", ["art", "albumcover"], "The album artwork, full size", cover);
  add("artisttracks", ["topsongs", "biggesttracks"], "An artist's biggest tracks", artistTop("tracks"));
  add("artistalbums", ["biggestalbums"], "An artist's biggest albums", artistTop("albums"));
  add("artisttagged", ["tagged", "artistgenres"], "How well each tag fits", artistTags);
}
