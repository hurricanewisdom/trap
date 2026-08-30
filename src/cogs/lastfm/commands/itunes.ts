/**
 * iTunes search, and the audio Last.fm does not have.
 *
 * `,preview` attaches the 30 second clip to the message so it plays inside
 * Discord; nothing else the bot talks to still serves one.
 *
 * The HTTP client lives in `integrations/itunes`; this file only decides what
 * to ask for and how to show it.
 */

import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { artwork, search } from "../../../integrations/itunes/index.js";
import { guard } from "../guard.js";
import { getRecentTracks } from "../api/index.js";
import {
  EMBED_COLOR,
  TargetError,
  buildPages,
  duration,
  label,
  paragraph,
  plain,
  releaseYear,
  resolveTarget,
  simpleCard,
  url as safeUrl,
} from "../shared.js";

/** Results per search; the pager splits them ten to a page. */
const RESULT_LIMIT = 25;

/** Discord rejects large uploads, and a 30 second clip is far below this. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 8000;

async function itunes(ctx: PrefixContext): Promise<void> {
  const term = ctx.argument.trim();
  if (!term) throw new TargetError("Give it something to look for, e.g. `,itunes bohemian rhapsody`.");

  const results = await search(term, "song", RESULT_LIMIT);
  const heading = `iTunes: ${term.slice(0, 40)}`;

  if (results.length === 0) {
    await paginate(ctx, simpleCard(heading, `Nothing found for **${plain(term)}**.`), EMBED_COLOR);
    return;
  }

  const rows = results.map((result, index) => {
    const name = result.trackName ?? "Unknown";
    const link = safeUrl(result.trackViewUrl, "");
    const title = link ? `**[${label(name)}](${link})**` : `**${plain(name)}**`;
    const details = [
      plain(result.artistName ?? ""),
      result.collectionName ? plain(result.collectionName) : null,
      duration(result.trackTimeMillis),
    ].filter(Boolean);
    return `\`${index + 1}\` ${title}\n-# ${details.join(" · ")}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: term, noun: "results", total: results.length }),
    EMBED_COLOR,
  );
}

async function itunesAlbum(ctx: PrefixContext): Promise<void> {
  const term = ctx.argument.trim();
  if (!term) throw new TargetError("Name an album, e.g. `,itunesalbum in rainbows`.");

  const results = await search(term, "album", RESULT_LIMIT);
  const heading = `iTunes albums: ${term.slice(0, 40)}`;

  if (results.length === 0) {
    await paginate(ctx, simpleCard(heading, `Nothing found for **${plain(term)}**.`), EMBED_COLOR);
    return;
  }

  const rows = results.map((result, index) => {
    const name = result.collectionName ?? "Unknown";
    const link = safeUrl(result.collectionViewUrl, "");
    const title = link ? `**[${label(name)}](${link})**` : `**${plain(name)}**`;
    const details = [plain(result.artistName ?? ""), releaseYear(result.releaseDate)].filter(Boolean);
    return `\`${index + 1}\` ${title}\n-# ${details.join(" · ")}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: term, noun: "albums", total: results.length }),
    EMBED_COLOR,
  );
}

/** Downloads the clip, or returns nothing if it cannot be had. */
async function clipFor(
  previewUrl: string,
  name: string,
): Promise<{ name: string; blob: Blob } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUDIO_TIMEOUT_MS);
    const res = await fetch(previewUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) return null;

    const safeName = name.replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 60) || "preview";
    return { name: `${safeName}.m4a`, blob: new Blob([audio], { type: "audio/mp4" }) };
  } catch {
    // The card is still worth sending without the audio.
    return null;
  }
}

/** The 30 second preview for whatever you are playing, or a named track. */
async function preview(ctx: PrefixContext): Promise<void> {
  let term = ctx.argument.trim();
  let source = "";

  if (!term) {
    const { target } = await resolveTarget(ctx, "");
    const { tracks } = await getRecentTracks(target.username, 1);
    const current = tracks[0];
    const artist = current?.artist?.name ?? current?.artist?.["#text"];
    if (!current || !artist) throw new TargetError("Name a track, or play something first.");
    term = `${artist} ${current.name}`;
    source = `${current.name} by ${artist}`;
  }

  const [best] = await search(term, "song", 1);
  if (!best) {
    await paginate(
      ctx,
      simpleCard("No preview", `iTunes has nothing for **${plain(source || term)}**.`),
      EMBED_COLOR,
    );
    return;
  }

  const name = best.trackName ?? "Unknown";
  const art = artwork(best.artworkUrl100);
  const link = safeUrl(best.trackViewUrl, "");

  const components: unknown[] = [
    paragraph(
      `### ${plain(name)}\nby **${plain(best.artistName ?? "")}**` +
        (best.collectionName ? ` · ${plain(best.collectionName)}` : ""),
    ),
  ];
  if (art) components.push({ type: 12, items: [{ media: { url: art } }] });
  if (link) {
    components.push({
      type: 1,
      components: [{ type: 2, style: 5, label: "Open in iTunes", url: link }],
    });
  }

  const clip = best.previewUrl ? await clipFor(best.previewUrl, name) : null;
  if (!clip) components.push(paragraph("-# iTunes has no preview clip for this one."));

  await ctx.reply({
    flags: 1 << 15,
    components: [{ type: 17, accent_color: EMBED_COLOR, components }],
    ...(clip ? { files: [clip] } : {}),
  });
}

export function registerItunes(): void {
  register({
    name: "itunes",
    aliases: ["applemusic", "isearch"],
    description: "Search iTunes for a track",
    handler: guard(itunes),
  });
  register({
    name: "itunesalbum",
    aliases: ["ialbum"],
    description: "Search iTunes for an album",
    handler: guard(itunesAlbum),
  });
  register({
    name: "preview",
    aliases: ["clip", "listen"],
    description: "A 30 second preview of what you are playing",
    handler: guard(preview),
  });
}
