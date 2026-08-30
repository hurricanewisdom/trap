import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  getArtistCorrection,
  getTrackCorrection,
  searchAlbums,
  searchArtists,
  searchTracks,
} from "../api/index.js";
import {
  USER_ACCENT,
  TargetError,
  albumUrl,
  artistUrl,
  buildPages,
  label,
  plain,
  simpleCard,
  splitPair,
  trackUrl,
  url,
} from "../shared.js";

const RESULT_LIMIT = 50;

async function searchArtist(ctx: PrefixContext): Promise<void> {
  const query = ctx.argument.trim();
  if (!query) throw new TargetError("Name an artist to search for.");

  const results = await searchArtists(query, RESULT_LIMIT);
  const heading = `Artists matching "${query.slice(0, 40)}"`;

  if (results.length === 0) {
    await paginate(ctx, simpleCard(heading, `Last.fm knows no artist like **${plain(query)}**.`), USER_ACCENT);
    return;
  }

  const rows = results.map((match, index) => {
    const listeners = Number(match.listeners ?? 0);
    const link = url(match.url, artistUrl(match.name));
    return (
      `\`${index + 1}\` **[${label(match.name)}](${link})**` +
      (listeners ? `\n-# ${listeners.toLocaleString("en-US")} listeners` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: query, noun: "results", total: results.length }),
    USER_ACCENT,
  );
}

async function searchAlbum(ctx: PrefixContext): Promise<void> {
  const query = ctx.argument.trim();
  if (!query) throw new TargetError("Name an album to search for.");

  const results = await searchAlbums(query, RESULT_LIMIT);
  const heading = `Albums matching "${query.slice(0, 40)}"`;

  if (results.length === 0) {
    await paginate(ctx, simpleCard(heading, `Last.fm knows no album like **${plain(query)}**.`), USER_ACCENT);
    return;
  }

  const rows = results.map((match, index) => {
    const link = url(match.url, albumUrl(match.artist, match.name));
    return `\`${index + 1}\` **[${label(match.name)}](${link})**\n-# ${plain(match.artist)}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: query, noun: "results", total: results.length }),
    USER_ACCENT,
  );
}

async function searchTrack(ctx: PrefixContext): Promise<void> {
  const query = ctx.argument.trim();
  if (!query) throw new TargetError("Name a track to search for.");

  const results = await searchTracks(query, RESULT_LIMIT);
  const heading = `Tracks matching "${query.slice(0, 40)}"`;

  if (results.length === 0) {
    await paginate(ctx, simpleCard(heading, `Last.fm knows no track like **${plain(query)}**.`), USER_ACCENT);
    return;
  }

  const rows = results.map((match, index) => {
    const listeners = Number(match.listeners ?? 0);
    const link = url(match.url, trackUrl(match.artist, match.name));
    return (
      `\`${index + 1}\` **[${label(match.name)}](${link})**\n-# ${plain(match.artist)}` +
      (listeners ? ` · ${listeners.toLocaleString("en-US")} listeners` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: query, noun: "results", total: results.length }),
    USER_ACCENT,
  );
}

async function correct(ctx: PrefixContext): Promise<void> {
  const argument = ctx.argument.trim();
  if (!argument) throw new TargetError("Give an artist, or `artist - track`.");

  const pair = splitPair(argument);

  if (pair) {
    const [artist, track] = pair;
    const fix = await getTrackCorrection(artist, track);
    if (!fix) {
      await paginate(
        ctx,
        simpleCard("Correction", `Last.fm has no correction for **${plain(track)}** by **${plain(artist)}**.`),
        USER_ACCENT,
      );
      return;
    }

    const canonicalArtist = fix.artist ?? artist;
    const link = url(fix.url, trackUrl(canonicalArtist, fix.name));
    const changed =
      fix.name.toLowerCase() !== track.toLowerCase() ||
      canonicalArtist.toLowerCase() !== artist.toLowerCase();

    await paginate(
      ctx,
      simpleCard(
        "Correction",
        changed
          ? `**${plain(track)}** by **${plain(artist)}**\nis filed as **[${label(fix.name)}](${link})** by **${plain(canonicalArtist)}**.`
          : `**[${label(fix.name)}](${link})** by **${plain(canonicalArtist)}** is already the canonical spelling.`,
      ),
      USER_ACCENT,
    );
    return;
  }

  const fix = await getArtistCorrection(argument);
  if (!fix) {
    await paginate(
      ctx,
      simpleCard("Correction", `Last.fm has no correction for **${plain(argument)}**.`),
      USER_ACCENT,
    );
    return;
  }

  const link = url(fix.url, artistUrl(fix.name));
  const changed = fix.name.toLowerCase() !== argument.toLowerCase();

  await paginate(
    ctx,
    simpleCard(
      "Correction",
      changed
        ? `**${plain(argument)}** is filed as **[${label(fix.name)}](${link})**.`
        : `**[${label(fix.name)}](${link})** is already the canonical spelling.`,
    ),
    USER_ACCENT,
  );
}

export function registerSearch(): void {
  register({
    name: "searchartist",
    aliases: ["sartist", "findartist"],
    description: "Search Last.fm for an artist",
    handler: guard(searchArtist),
  });
  register({
    name: "searchalbum",
    aliases: ["salbum", "findalbum"],
    description: "Search Last.fm for an album",
    handler: guard(searchAlbum),
  });
  register({
    name: "searchtrack",
    aliases: ["strack", "findtrack", "search"],
    description: "Search Last.fm for a track",
    handler: guard(searchTrack),
  });
  register({
    name: "correct",
    aliases: ["correction", "spelling"],
    description: "How Last.fm spells an artist or track",
    handler: guard(correct),
  });
}
