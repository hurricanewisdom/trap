import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { getWeeklyChart, getWeeklyChartList, type WeekRange } from "../api/index.js";
import {
  USER_ACCENT,
  artistUrl,
  avatarOf,
  buildPages,
  chartLine,
  plain,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";

const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${encodeURIComponent(track)}`;

function weeksBack(argument: string): number {
  const match = argument.trim().match(/(\d+)\s*$/);
  const n = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 500)) : 0;
}

function weeklyCommand(kind: "artist" | "album" | "track") {
  return async (ctx: PrefixContext): Promise<void> => {
    const back = weeksBack(ctx.argument);
    const withoutCount = ctx.argument.replace(/\s*\d+\s*$/, "");
    const { target } = await resolveTarget(ctx, withoutCount);
    const icon = avatarOf(await profile(target.username));

    let range: WeekRange | undefined;
    let when = "this week";
    if (back > 0) {
      const weeks = await getWeeklyChartList(target.username);

      const index = weeks.length - 1 - back;
      if (index < 0) {
        await paginate(
          ctx,
          simpleCard(
            `${target.username}'s weekly ${kind}s`,
            `Only ${plural(weeks.length, "week")} of history exist for this account.`,
            icon,
          ),
          USER_ACCENT,
        );
        return;
      }
      range = weeks[index];
      when = range ? `week of <t:${range.from}:D>` : `${back} weeks ago`;
    }

    const entries = await getWeeklyChart(kind, target.username, range);
    const heading = `${target.username}'s weekly ${kind}s`;

    if (entries.length === 0) {
      await paginate(ctx, simpleCard(heading, `Nothing scrobbled in that week.`, icon), USER_ACCENT);
      return;
    }

    const rows = entries.map((entry, i) => {
      const by = entry.artist?.["#text"] ?? entry.artist?.name ?? "";
      const link = kind === "track" ? trackUrl(by, entry.name) : artistUrl(by || entry.name);
      const line = chartLine(i + 1, entry.name, url(entry.url, link), Number(entry.playcount ?? 0));
      return by && kind !== "artist" ? `${line} · ${plain(by)}` : line;
    });

    const played = entries.reduce((sum, e) => sum + Number(e.playcount ?? 0), 0);

    await paginate(
      ctx,
      buildPages(rows, {
        heading,
        username: target.username,
        icon,
        noun: `${kind}s`,
        total: entries.length,
        footer: `${plural(entries.length, kind)} · ${plural(played, "play")} · ${when}`,
      }),
      USER_ACCENT,
    );
  };
}

async function weeks(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const list = await getWeeklyChartList(target.username);
  const heading = `${target.username}'s chart weeks`;

  if (list.length === 0) {
    await paginate(ctx, simpleCard(heading, "Last.fm has no weekly charts for this account.", icon), USER_ACCENT);
    return;
  }

  const first = list[0];
  const rows = list
    .slice()
    .reverse()
    .slice(0, 200)
    .map((week, i) => `\`${i}\` week of <t:${week.from}:D>`);

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      icon,
      noun: "weeks",
      total: list.length,
      footer: `${plural(list.length, "week")} of history, first on <t:${first?.from ?? 0}:D>. Use the number with ,weeklyartists.`,
    }),
    USER_ACCENT,
  );
}

export function registerWeekly(): void {
  const add = (
    name: string,
    aliases: string[],
    description: string,
    handler: (ctx: PrefixContext) => Promise<void>,
  ) => register({ name, aliases, description, handler: guard(handler) });

  add("weeklyartists", ["wa", "weekartists"], "Your artists for a calendar week", weeklyCommand("artist"));
  add("weeklyalbums", ["wal", "weekalbums"], "Your albums for a calendar week", weeklyCommand("album"));
  add("weeklytracks", ["wt", "weektracks"], "Your tracks for a calendar week", weeklyCommand("track"));
  add("weeks", ["chartweeks", "history"], "How many weeks of charts you have", weeks);
}
