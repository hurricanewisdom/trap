/**
 * Browsing Last.fm's tag system: what a tag means, what carries it, and what
 * the crowd has tagged a given record.
 *
 * Read-only. The commands that change your own tags are in tagging.ts, and
 * they need a session key; nothing here does.
 */

import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  getAlbumTopTags,
  getChartTopTags,
  getGlobalTopTags,
  getSimilarTags,
  getTagInfo,
  getTagTop,
  getTagWeeklyChartList,
  getTrackTopTags,
} from "../api/index.js";
import {
  EMBED_COLOR,
  TargetError,
  albumUrl,
  artistUrl,
  bar,
  buildPages,
  currentPair,
  label,
  plain,
  simpleCard,
  splitPair,
  trackUrl,
  url,
} from "../shared.js";

const TAG_LIMIT = 60;

const tagUrl = (tag: string) => `https://www.last.fm/tag/${encodeURIComponent(tag)}`;

/** Strips the wiki markup Last.fm leaves in a summary. */
function cleanSummary(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<a\b[^>]*>.*?<\/a>/gis, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

/** A middot-separated run of tag links. */
function similarLinks(tags: { name: string; url?: string }[]): string {
  return tags
    .slice(0, 10)
    .map((tag) => `[${label(tag.name)}](${url(tag.url, tagUrl(tag.name))})`)
    .join(" · ");
}

/** `,taginfo <tag>` — what a tag means and how widely it is used. */
async function tagInfo(ctx: PrefixContext): Promise<void> {
  const tag = ctx.argument.trim();
  if (!tag) throw new TargetError("Name a tag, e.g. `,taginfo shoegaze`.");

  const info = await getTagInfo(tag);
  if (!info) {
    await paginate(ctx, simpleCard("Tag", `Last.fm has no tag called **${plain(tag)}**.`), EMBED_COLOR);
    return;
  }

  const total = Number(info.total ?? 0);
  const reach = Number(info.reach ?? 0);
  const summary = cleanSummary(info.wiki?.summary);

  // Both of these are best-effort. Last.fm has effectively retired
  // tag.getSimilar (it answers empty for every tag, "rock" included), and a
  // tag with no chart history has no week list, so neither failure is worth
  // taking the whole card down for.
  const [similar, weeks] = await Promise.all([
    getSimilarTags(info.name).catch(() => []),
    getTagWeeklyChartList(info.name).catch(() => []),
  ]);

  const firstWeek = weeks[0]?.from;
  const charted = firstWeek
    ? new Date(Number(firstWeek) * 1000).toISOString().slice(0, 10)
    : null;

  const lines = [
    `**[${label(info.name)}](${tagUrl(info.name)})**`,
    "",
    total ? `**${total.toLocaleString("en-US")}** taggings` : null,
    reach ? `**${reach.toLocaleString("en-US")}** people have used it` : null,
    charted ? `charted weekly since **${charted}**` : null,
    similar.length ? `\n**Similar**\n${similarLinks(similar)}` : null,
    summary ? `\n${plain(summary)}` : null,
  ].filter((line) => line !== null);

  await paginate(ctx, simpleCard(`Tag: ${info.name}`, lines.join("\n")), EMBED_COLOR);
}

/** `,toptags` — the most used tags on Last.fm, all time. */
async function topTags(ctx: PrefixContext): Promise<void> {
  const tags = await getGlobalTopTags();
  if (tags.length === 0) {
    await paginate(ctx, simpleCard("Top tags", "Last.fm returned no tags."), EMBED_COLOR);
    return;
  }

  const rows = tags.map((tag, index) => {
    const count = Number(tag.count ?? 0);
    return (
      `\`${index + 1}\` **[${label(tag.name)}](${url(tag.url, tagUrl(tag.name))})**` +
      (count ? ` · ${count.toLocaleString("en-US")} uses` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, {
      heading: "Most used tags on Last.fm",
      username: "",
      noun: "tags",
      total: tags.length,
    }),
    EMBED_COLOR,
  );
}

/** `,trendingtags` — the tags with the widest reach right now. */
async function trendingTags(ctx: PrefixContext): Promise<void> {
  const tags = await getChartTopTags(TAG_LIMIT);
  if (tags.length === 0) {
    await paginate(ctx, simpleCard("Trending tags", "Last.fm returned no chart."), EMBED_COLOR);
    return;
  }

  const rows = tags.map((tag, index) => {
    const reach = Number(tag.reach ?? 0);
    const taggings = Number(tag.taggings ?? 0);
    const details = [
      reach ? `${reach.toLocaleString("en-US")} listeners` : null,
      taggings ? `${taggings.toLocaleString("en-US")} taggings` : null,
    ].filter(Boolean);
    return (
      `\`${index + 1}\` **[${label(tag.name)}](${url(tag.url, tagUrl(tag.name))})**` +
      (details.length ? `\n-# ${details.join(" · ")}` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, {
      heading: "Tags trending on Last.fm",
      username: "",
      noun: "tags",
      total: tags.length,
    }),
    EMBED_COLOR,
  );
}

/** `,genrealbums <tag>` — the albums most associated with a tag. */
async function genreAlbums(ctx: PrefixContext): Promise<void> {
  const tag = ctx.argument.trim();
  if (!tag) throw new TargetError("Name a tag, e.g. `,genrealbums shoegaze`.");

  const found = await getTagTop("albums", tag, TAG_LIMIT);
  const heading = `Top ${tag} albums`;

  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `Nothing tagged **${plain(tag)}**.`), EMBED_COLOR);
    return;
  }

  const rows = found.map((album, index) => {
    const by = album.artist?.name ?? "";
    const link = url(album.url, albumUrl(by, album.name));
    return `\`${index + 1}\` **[${label(album.name)}](${link})**${by ? `\n-# ${plain(by)}` : ""}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: tag, noun: "albums", total: found.length }),
    EMBED_COLOR,
  );
}

/**
 * Renders a weighted tag list, which Last.fm scores out of 100. The bar makes
 * the difference between a defining tag and a stray one legible at a glance.
 */
function weightedRows(tags: { name: string; count?: string | number; url?: string }[]): string[] {
  const top = Number(tags[0]?.count ?? 100) || 100;
  return tags.map((tag, index) => {
    const count = Number(tag.count ?? 0);
    return (
      `\`${index + 1}\` **[${label(tag.name)}](${url(tag.url, tagUrl(tag.name))})**\n` +
      `-# \`${bar(count, top, 10)}\` ${count}/100`
    );
  });
}

/** `,albumtags [artist - album]` — how the crowd tags an album. */
async function albumTags(ctx: PrefixContext): Promise<void> {
  const pair = splitPair(ctx.argument) ?? (await currentPair(ctx, "album"));
  const [artist, album] = pair;

  const tags = await getAlbumTopTags(artist, album);
  const heading = `Tags on ${album}`;

  if (tags.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, `Nobody has tagged **${plain(album)}** by **${plain(artist)}**.`),
      EMBED_COLOR,
    );
    return;
  }

  await paginate(
    ctx,
    buildPages(weightedRows(tags), {
      heading,
      username: artist,
      noun: "tags",
      total: tags.length,
      footer: `${plain(artist)} · ${tags.length} tags`,
    }),
    EMBED_COLOR,
  );
}

/** `,tracktags [artist - track]` — how the crowd tags a track. */
async function trackTags(ctx: PrefixContext): Promise<void> {
  const pair = splitPair(ctx.argument) ?? (await currentPair(ctx, "track"));
  const [artist, track] = pair;

  const tags = await getTrackTopTags(artist, track);
  const heading = `Tags on ${track}`;

  if (tags.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, `Nobody has tagged **${plain(track)}** by **${plain(artist)}**.`),
      EMBED_COLOR,
    );
    return;
  }

  await paginate(
    ctx,
    buildPages(weightedRows(tags), {
      heading,
      username: artist,
      noun: "tags",
      total: tags.length,
      footer: `${plain(artist)} · ${tags.length} tags`,
    }),
    EMBED_COLOR,
  );
}

export function registerTagBrowser(): void {
  register({
    name: "taginfo",
    aliases: ["abouttag", "genreinfo"],
    description: "What a tag means and how widely it is used",
    handler: guard(tagInfo),
  });
  register({
    name: "toptags",
    aliases: ["alltags", "populartags"],
    description: "The most used tags on Last.fm",
    handler: guard(topTags),
  });
  register({
    name: "trendingtags",
    aliases: ["hottags", "chartags"],
    description: "The tags with the widest reach right now",
    handler: guard(trendingTags),
  });
  register({
    name: "genrealbums",
    aliases: ["tagalbums"],
    description: "Top albums carrying a tag",
    handler: guard(genreAlbums),
  });
  register({
    name: "albumtags",
    aliases: ["albumgenres"],
    description: "How Last.fm tags an album",
    handler: guard(albumTags),
  });
  register({
    name: "tracktags",
    aliases: ["trackgenres", "songtags"],
    description: "How Last.fm tags a track",
    handler: guard(trackTags),
  });
}
