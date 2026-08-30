/**
 * `,collage` builds a grid of album art as a real image.
 *
 * Every tile is a network fetch and a decode, so the grid size, the number of
 * requests in flight and the bytes accepted per image are all bounded. A cover
 * that is missing, too large or undecodable becomes a captioned placeholder
 * rather than failing the whole grid.
 */

import sharp, { type OverlayOptions } from "sharp";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { getTopAlbums, getTopArtists, getTopTracks, largestImage } from "../api/index.js";
import { albumImage, artistImage, realLastfmArt, trackImage } from "../../../integrations/artwork.js";
import {
  EMBED_COLOR,
  TargetError,
  avatarOf,
  extractPeriod,
  periodLabel,
  plural,
  profile,
  resolveTarget,
  simpleCard,
} from "../shared.js";

/** Last.fm serves 300px covers, so that is the natural tile size. */
const TILE = 300;
const MAX_SIDE = 5;
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 8000;
/** A cover larger than this is skipped rather than decoded. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const BACKGROUND = { r: 24, g: 24, b: 28 };

type Mode = "albums" | "tracks" | "artists";

interface Cell {
  /** The bold line: album, track or artist name. */
  title: string;
  /** The second line, empty for an artist grid. */
  subtitle: string;
  plays: number;
  art: string | null;
  /** Looks the missing art up, whichever service can answer. */
  findArt: () => Promise<string | null>;
}

/**
 * Last.fm's own art, unless it is the shared placeholder it returns for every
 * artist and every top track. Anything null here is filled in from iTunes by
 * `fillArtwork`.
 */
function realArt(images: Parameters<typeof largestImage>[0]): string | null {
  return realLastfmArt(largestImage(images));
}

const MODE_WORDS: Record<string, Mode> = {
  album: "albums",
  albums: "albums",
  track: "tracks",
  tracks: "tracks",
  song: "tracks",
  songs: "tracks",
  artist: "artists",
  artists: "artists",
};

/** Pulls a mode word out of the argument, defaulting to albums. */
function parseMode(argument: string): { mode: Mode; rest: string } {
  const words = argument.split(/\s+/).filter(Boolean);
  const index = words.findIndex((w) => MODE_WORDS[w.toLowerCase()] !== undefined);
  if (index === -1) return { mode: "albums", rest: argument.trim() };
  return {
    mode: MODE_WORDS[(words[index] ?? "").toLowerCase()] ?? "albums",
    rest: words.filter((_, i) => i !== index).join(" "),
  };
}

/** "4x4", "4", or nothing. Returns the side length. */
function parseSize(argument: string): { side: number; rest: string } {
  const words = argument.split(/\s+/).filter(Boolean);
  const index = words.findIndex((w) => /^\d(?:\s*[x×]\s*\d)?$/i.test(w) || /^\dx\d$/i.test(w));
  if (index === -1) return { side: 3, rest: argument.trim() };

  const token = words[index] ?? "";
  const side = Number.parseInt(token[0] ?? "3", 10);
  const rest = words.filter((_, i) => i !== index).join(" ");
  if (!Number.isInteger(side) || side < 2 || side > MAX_SIDE) {
    throw new TargetError(`Pick a grid between 2x2 and ${MAX_SIDE}x${MAX_SIDE}.`);
  }
  return { side, rest };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Text usable width inside a tile, once the left and right margins are taken. */
const TEXT_WIDTH = TILE - 24;

/**
 * Average glyph advance as a fraction of the font size, for DejaVu Sans.
 * Counting characters is not enough: "Echoes - The Best Of Pink Floyd" and
 * "IIIIIIIIIIIIIIIIIIIIIIIIIIIIII" are the same length and nothing like the
 * same width, and the wide one used to run off the edge of the tile.
 */
const BOLD_ADVANCE = 0.62;
const REGULAR_ADVANCE = 0.54;

function widthOf(text: string, size: number, advance: number): number {
  return text.length * size * advance;
}

/**
 * Shrinks the font until the line fits, then truncates if it still does not.
 * Returns the text to draw and the size to draw it at.
 */
function fit(
  text: string,
  base: number,
  min: number,
  advance: number,
): { text: string; size: number } {
  for (let size = base; size >= min; size -= 1) {
    if (widthOf(text, size, advance) <= TEXT_WIDTH) return { text, size };
  }
  const budget = Math.max(1, Math.floor(TEXT_WIDTH / (min * advance)) - 1);
  return { text: text.length > budget ? `${text.slice(0, budget)}…` : text, size: min };
}

/** The caption bar drawn along the bottom of a tile. */
function captionSvg(album: string, artist: string): Buffer {
  const title = fit(album, 20, 13, BOLD_ADVANCE);
  const by = fit(artist, 16, 11, REGULAR_ADVANCE);
  const line1 = xmlEscape(title.text);
  const line2 = xmlEscape(by.text);
  return Buffer.from(
    `<svg width="${TILE}" height="${TILE}">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgb(0,0,0)" stop-opacity="0"/>
          <stop offset="100%" stop-color="rgb(0,0,0)" stop-opacity="0.85"/>
        </linearGradient>
        <clipPath id="bounds">
          <rect x="0" y="0" width="${TILE}" height="${TILE}"/>
        </clipPath>
      </defs>
      <g clip-path="url(#bounds)">
        <rect x="0" y="${TILE - 88}" width="${TILE}" height="88" fill="url(#fade)"/>
        <text x="12" y="${TILE - 46}" font-family="DejaVu Sans, sans-serif"
              font-size="${title.size}" font-weight="bold" fill="#ffffff">${line1}</text>
        <text x="12" y="${TILE - 22}" font-family="DejaVu Sans, sans-serif"
              font-size="${by.size}" fill="#c9c9d1">${line2}</text>
      </g>
    </svg>`,
  );
}

/** A tile for a cover that could not be used. */
async function placeholder(cell: Cell, captions: boolean): Promise<Buffer> {
  const base = sharp({
    create: { width: TILE, height: TILE, channels: 3, background: BACKGROUND },
  });
  const overlay = Buffer.from(
    `<svg width="${TILE}" height="${TILE}">
      <text x="${TILE / 2}" y="${TILE / 2}" text-anchor="middle"
            font-family="DejaVu Sans, sans-serif" font-size="18" fill="#5a5a66">no cover</text>
    </svg>`,
  );
  const layers: OverlayOptions[] = [{ input: overlay, left: 0, top: 0 }];
  if (captions) layers.push({ input: captionSvg(cell.title, cell.subtitle), left: 0, top: 0 });
  return await base.composite(layers).png().toBuffer();
}

/** Fetches and normalises one cover into a TILE-sized image. */
async function tileFor(cell: Cell, captions: boolean): Promise<Buffer> {
  if (!cell.art) return await placeholder(cell, captions);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(cell.art, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return await placeholder(cell, captions);

    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_IMAGE_BYTES) return await placeholder(cell, captions);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return await placeholder(cell, captions);

    // animated: false takes the first frame; some covers are animated gifs.
    const cover = sharp(buffer, { animated: false }).resize(TILE, TILE, { fit: "cover" });
    if (!captions) return await cover.png().toBuffer();

    const flat = await cover.png().toBuffer();
    return await sharp(flat)
      .composite([{ input: captionSvg(cell.title, cell.subtitle), left: 0, top: 0 }])
      .png()
      .toBuffer();
  } catch {
    return await placeholder(cell, captions);
  }
}

/** Runs a job over items with a bounded number in flight. */
async function mapLimited<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) continue;
        out[index] = await job(item);
      }
    }),
  );
  return out;
}

/** Turns one period of a user's top X into cells, whatever X is. */
async function cellsFor(
  username: string,
  mode: Mode,
  period: Parameters<typeof getTopAlbums>[1],
  wanted: number,
): Promise<{ cells: Cell[]; total: number; noun: string }> {
  if (mode === "tracks") {
    const { items, total } = await getTopTracks(username, period, wanted);
    const cells = items.slice(0, wanted).map<Cell>((track) => {
      const artist = track.artist?.name ?? track.artist?.["#text"] ?? "";
      return {
        title: track.name,
        subtitle: artist,
        plays: Number(track.playcount ?? 0),
        art: realArt(track.image),
        findArt: () => trackImage(artist, track.name),
      };
    });
    return { cells, total, noun: "track" };
  }

  if (mode === "artists") {
    const { items, total } = await getTopArtists(username, period, wanted);
    const cells = items.slice(0, wanted).map<Cell>((artist) => ({
      title: artist.name,
      // An artist grid has nothing useful for a second line, so it carries the
      // play count instead of an empty gap.
      subtitle: `${Number(artist.playcount ?? 0).toLocaleString("en-US")} plays`,
      plays: Number(artist.playcount ?? 0),
      art: realArt(artist.image),
      findArt: () => artistImage(artist.name),
    }));
    return { cells, total, noun: "artist" };
  }

  const { items, total } = await getTopAlbums(username, period, wanted);
  const cells = items.slice(0, wanted).map<Cell>((album) => {
    const artist = album.artist?.name ?? album.artist?.["#text"] ?? "";
    return {
      title: album.name,
      subtitle: artist,
      plays: Number(album.playcount ?? 0),
      art: realArt(album.image),
      findArt: () => albumImage(artist, album.name),
    };
  });
  return { cells, total, noun: "album" };
}

/**
 * Fills in art Last.fm does not have.
 *
 * Kept to a low concurrency because iTunes throttles at around twenty calls a
 * minute and a 5x5 artist grid needs twenty-five lookups. Every answer is
 * cached, so the same grid costs nothing the second time.
 */
const LOOKUP_CONCURRENCY = 3;

async function fillArtwork(cells: Cell[]): Promise<void> {
  const missing = cells.filter((cell) => !cell.art);
  if (missing.length === 0) return;
  await mapLimited(missing, LOOKUP_CONCURRENCY, async (cell) => {
    cell.art = await cell.findArt();
  });
}

async function collage(ctx: PrefixContext): Promise<void> {
  const { mode, rest: afterMode } = parseMode(ctx.argument);
  const { side, rest: afterSize } = parseSize(afterMode);

  const captions = !/\b(nocaption|noname|clean|plain)\b/i.test(afterSize);
  const withoutFlags = afterSize.replace(/\b(nocaption|noname|clean|plain)\b/gi, "").trim();

  const { period, rest } = extractPeriod(withoutFlags);
  const { target } = await resolveTarget(ctx, rest);
  const icon = avatarOf(await profile(target.username));

  const wanted = side * side;
  const { cells, total, noun } = await cellsFor(target.username, mode, period, wanted);
  const heading = `${target.username}'s ${periodLabel(period)} ${noun}s`;

  if (cells.length === 0) {
    await paginate(ctx, simpleCard(heading, `No ${noun}s for that period.`, icon), EMBED_COLOR);
    return;
  }

  await fillArtwork(cells);

  const tiles = await mapLimited(cells, CONCURRENCY, (cell) => tileFor(cell, captions));

  const canvas = sharp({
    create: { width: TILE * side, height: TILE * side, channels: 3, background: BACKGROUND },
  });
  const layers = tiles.map((input, index) => ({
    input,
    left: (index % side) * TILE,
    top: Math.floor(index / side) * TILE,
  }));

  const image = await canvas.composite(layers).jpeg({ quality: 86 }).toBuffer();
  const covers = cells.filter((c) => c.art).length;

  await ctx.reply({
    content:
      `**${heading}** · ${side}x${side}\n` +
      `-# ${plural(total, noun)} total · ${covers}/${cells.length} covers found` +
      (cells.length < wanted ? ` · only ${cells.length} available` : ""),
    files: [
      {
        name: `collage-${target.username}-${mode}-${side}x${side}.jpg`,
        blob: new Blob([image], { type: "image/jpeg" }),
      },
    ],
  });
}

export function registerCollage(): void {
  register({
    name: "collage",
    aliases: ["grid", "cg"],
    description: "A grid of your most played art",
    handler: guard(collage),
  });
}
