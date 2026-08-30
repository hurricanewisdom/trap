import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { getTopAlbums, getTopArtists, getTopTracks } from "../api/index.js";

const CHART_LIMIT = 250;
import {
  USER_ACCENT,
  artistUrl,
  avatarOf,
  buildPages,
  chartLine,
  extractPeriod,
  periodLabel,
  plain,
  profile,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";

async function chart(
  ctx: PrefixContext,
  kind: "artists" | "albums" | "tracks",
): Promise<void> {
  const { period, rest } = extractPeriod(ctx.argument);
  const { target } = await resolveTarget(ctx, rest);
  const info = await profile(target.username);
  const icon = avatarOf(info);

  const heading = `${target.username}'s ${periodLabel(period)} top ${kind}`;

  if (kind === "artists") {
    const { items, total } = await getTopArtists(target.username, period, CHART_LIMIT);
    const lines = items.map((a, i) =>
      chartLine(i + 1, a.name, url(a.url, artistUrl(a.name)), Number(a.playcount)),
    );
    await render(ctx, lines, heading, target.username, icon, "artists", total);
    return;
  }

  if (kind === "albums") {
    const { items, total } = await getTopAlbums(target.username, period, CHART_LIMIT);
    const lines = items.map((a, i) => {
      const artist = a.artist?.name ?? a.artist?.["#text"] ?? "";
      const link = url(a.url, artistUrl(a.name));
      return `${chartLine(i + 1, a.name, link, Number(a.playcount))} · ${plain(artist)}`;
    });
    await render(ctx, lines, heading, target.username, icon, "albums", total);
    return;
  }

  const { items, total } = await getTopTracks(target.username, period, CHART_LIMIT);
  const lines = items.map((t, i) => {
    const artist = t.artist?.name ?? t.artist?.["#text"] ?? "";
    const link = url(t.url, artistUrl(t.name));
    return `${chartLine(i + 1, t.name, link, Number(t.playcount))} · ${plain(artist)}`;
  });
  await render(ctx, lines, heading, target.username, icon, "tracks", total);
}

async function render(
  ctx: PrefixContext,
  lines: string[],
  heading: string,
  username: string,
  icon: string | null,
  noun: string,
  total: number,
): Promise<void> {
  if (lines.length === 0) {
    await paginate(ctx, simpleCard(heading, `No ${noun} for that period.`, icon), USER_ACCENT);
    return;
  }
  await paginate(ctx, buildPages(lines, { heading, username, icon, noun, total }), USER_ACCENT);
}

export function registerCharts(): void {
  register({
    name: "topartists",
    aliases: ["ta", "tar", "artists"],
    description: "Your most listened to artists",
    handler: guard((ctx) => chart(ctx, "artists")),
  });
  register({
    name: "topalbums",
    aliases: ["tal", "albums"],
    description: "Your most listened to albums",
    handler: guard((ctx) => chart(ctx, "albums")),
  });
  register({
    name: "toptracks",
    aliases: ["tt", "tracks"],
    description: "Your most listened to tracks",
    handler: guard((ctx) => chart(ctx, "tracks")),
  });
}
