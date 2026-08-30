import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  USER_ACCENT,
  artistUrl,
  avatarOf,
  bar,
  buildPages,
  history,
  label,
  plain,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  tally,
  timed,
  url,
} from "../shared.js";

const SESSION_GAP_SECONDS = 30 * 60;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function card(heading: string, body: string, icon: string | null) {
  return simpleCard(heading, body, icon);
}

async function load(ctx: PrefixContext) {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const info = await profile(target.username);
  const { scrobbles, total } = await history(target.username);
  return { target, icon: avatarOf(info), scrobbles, total, stamped: timed(scrobbles) };
}

function noHistory(username: string) {
  return `No scrobbles with timestamps for **${label(username)}** yet.`;
}

async function clock(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username}'s listening clock`;
  if (stamped.length === 0) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const hours = new Array(24).fill(0) as number[];
  for (const s of stamped) hours[new Date(s.at * 1000).getUTCHours()] += 1;
  const peak = Math.max(...hours);
  const busiest = hours.indexOf(peak);

  const rows = hours.map(
    (count, hour) =>
      `\`${String(hour).padStart(2, "0")}\` ${bar(count, peak)} ${count.toLocaleString("en-US")}`,
  );

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      icon,
      noun: "scrobbles",
      total: stamped.length,
      footer: `Busiest hour ${String(busiest).padStart(2, "0")}:00 UTC across the last ${plural(stamped.length, "scrobble")}`,
    }),
    USER_ACCENT,
  );
}

async function weekday(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username}'s week`;
  if (stamped.length === 0) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const days = new Array(7).fill(0) as number[];
  for (const s of stamped) days[new Date(s.at * 1000).getUTCDay()] += 1;
  const peak = Math.max(...days);

  const body = days
    .map((count, i) => `\`${(DAYS[i] ?? "").slice(0, 3)}\` ${bar(count, peak)} ${count.toLocaleString("en-US")}`)
    .join("\n");

  const best = DAYS[days.indexOf(peak)] ?? "";
  await paginate(
    ctx,
    card(heading, `${body}\n\n-# Busiest day: **${best}**, over ${plural(stamped.length, "scrobble")}`, icon),
    USER_ACCENT,
  );
}

async function nightowl(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username}'s hours`;
  if (stamped.length === 0) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const buckets = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const s of stamped) {
    const h = new Date(s.at * 1000).getUTCHours();
    if (h < 6) buckets.night += 1;
    else if (h < 12) buckets.morning += 1;
    else if (h < 18) buckets.afternoon += 1;
    else buckets.evening += 1;
  }

  const n = stamped.length;
  const pct = (v: number) => `${((v / n) * 100).toFixed(1)}%`;
  const peak = Math.max(...Object.values(buckets));
  const rows = [
    ["Night 00-06", buckets.night],
    ["Morning 06-12", buckets.morning],
    ["Afternoon 12-18", buckets.afternoon],
    ["Evening 18-24", buckets.evening],
  ] as const;

  const verdict =
    buckets.night / n > 0.35
      ? "A night owl."
      : buckets.morning / n > 0.35
        ? "An early riser."
        : "Spread across the day.";

  const body =
    rows.map(([name, v]) => `\`${name}\` ${bar(v, peak)} ${pct(v)}`).join("\n") +
    `\n\n-# ${verdict} Based on the last ${plural(n, "scrobble")}, times in UTC.`;

  await paginate(ctx, card(heading, body, icon), USER_ACCENT);
}

interface Session {
  start: number;
  end: number;
  tracks: number;
}

function sessionsOf(stamped: { at: number }[]): Session[] {
  const ordered = [...stamped].sort((a, b) => a.at - b.at);
  const out: Session[] = [];
  for (const s of ordered) {
    const current = out[out.length - 1];
    if (current && s.at - current.end <= SESSION_GAP_SECONDS) {
      current.end = s.at;
      current.tracks += 1;
    } else {
      out.push({ start: s.at, end: s.at, tracks: 1 });
    }
  }
  return out;
}

function span(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function sessions(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username}'s recent sessions`;
  const found = sessionsOf(stamped);
  if (found.length === 0) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const rows = found
    .slice()
    .reverse()
    .map(
      (s, i) =>
        `\`${i + 1}\` <t:${s.start}:f> · **${plural(s.tracks, "track")}** over ${span(s.end - s.start)}`,
    );

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      icon,
      noun: "sessions",
      total: found.length,
      footer: `${found.length} sessions in the last ${plural(stamped.length, "scrobble")}. A 30 minute break starts a new one.`,
    }),
    USER_ACCENT,
  );
}

async function binge(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username}'s longest session`;
  const found = sessionsOf(stamped);
  if (found.length === 0) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const longest = found.reduce((a, b) => (b.tracks > a.tracks ? b : a));
  const inside = stamped.filter((s) => s.at >= longest.start && s.at <= longest.end);
  const artists = tally(inside, (s) => s.artist).slice(0, 3);

  const body = [
    `**${plural(longest.tracks, "track")}** over **${span(longest.end - longest.start)}**`,
    `Started <t:${longest.start}:f> · <t:${longest.start}:R>`,
    "",
    "**Mostly**",
    ...artists.map(
      (a, i) =>
        `\`${i + 1}\` **[${label(a.name)}](${artistUrl(a.name)})** · ${plural(a.count, "track")}`,
    ),
  ].join("\n");

  await paginate(ctx, card(heading, body, icon), USER_ACCENT);
}

async function gaps(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username}'s quiet spells`;
  if (stamped.length < 2) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const ordered = [...stamped].sort((a, b) => a.at - b.at);
  const found: { from: number; to: number; length: number }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!.at;
    const to = ordered[i]!.at;
    if (to - from > SESSION_GAP_SECONDS) found.push({ from, to, length: to - from });
  }
  found.sort((a, b) => b.length - a.length);

  if (found.length === 0) {
    await paginate(ctx, card(heading, "No breaks longer than 30 minutes in this stretch.", icon), USER_ACCENT);
    return;
  }

  const rows = found
    .slice(0, 50)
    .map((g, i) => `\`${i + 1}\` **${span(g.length)}** · ended <t:${g.to}:R>`);

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      icon,
      noun: "gaps",
      total: found.length,
      footer: `Longest quiet spell: ${span(found[0]!.length)}`,
    }),
    USER_ACCENT,
  );
}

async function firstScrobble(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const info = await profile(target.username);
  const icon = avatarOf(info);
  const heading = `${target.username}'s first scrobble`;

  const total = Number(info?.playcount ?? 0);
  if (total < 1) {
    await paginate(ctx, card(heading, "Nothing scrobbled yet.", icon), USER_ACCENT);
    return;
  }

  const { getRecentPage } = await import("../api/index.js");
  const probe = await getRecentPage(target.username, 1, 1);
  const last = await getRecentPage(target.username, Math.max(1, probe.pages), 1);
  const track = last.items[last.items.length - 1];
  if (!track) {
    await paginate(ctx, card(heading, "Could not read that far back.", icon), USER_ACCENT);
    return;
  }

  const artist = track.artist?.name ?? track.artist?.["#text"] ?? "Unknown";
  const when = track.date?.uts ? `<t:${track.date.uts}:F> · <t:${track.date.uts}:R>` : "date unknown";
  const body = [
    `**[${label(track.name)}](${url(track.url, artistUrl(artist))})**`,
    `by **[${label(artist)}](${artistUrl(artist)})**`,
    "",
    `-# ${when}`,
  ].join("\n");

  await paginate(ctx, card(heading, body, icon), USER_ACCENT);
}

async function onThisDay(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped } = await load(ctx);
  const heading = `${target.username} on this day`;

  const now = new Date();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const matches = stamped.filter((s) => {
    const d = new Date(s.at * 1000);
    return d.getUTCMonth() === month && d.getUTCDate() === day && d.getUTCFullYear() !== now.getUTCFullYear();
  });

  if (matches.length === 0) {
    await paginate(
      ctx,
      card(
        heading,
        "Nothing from this date in earlier years, at least within the scrobbles I can reach.",
        icon,
      ),
      USER_ACCENT,
    );
    return;
  }

  const rows = matches.map(
    (s) => `\`${new Date(s.at * 1000).getUTCFullYear()}\` **${plain(s.track)}** by ${plain(s.artist)}`,
  );

  await paginate(
    ctx,
    buildPages(rows, { heading, username: target.username, icon, noun: "scrobbles", total: matches.length }),
    USER_ACCENT,
  );
}

async function pace(ctx: PrefixContext): Promise<void> {
  const { target, icon, stamped, total } = await load(ctx);
  const heading = `${target.username}'s pace`;
  if (stamped.length < 2) {
    await paginate(ctx, card(heading, noHistory(target.username), icon), USER_ACCENT);
    return;
  }

  const newest = Math.max(...stamped.map((s) => s.at));
  const oldest = Math.min(...stamped.map((s) => s.at));
  const days = Math.max((newest - oldest) / 86400, 1 / 24);
  const perDay = stamped.length / days;

  const body = [
    `**${perDay.toFixed(1)}** scrobbles per day`,
    `**${(perDay * 7).toFixed(0)}** per week · **${(perDay * 30).toFixed(0)}** per month`,
    "",
    `**Total** ${total.toLocaleString("en-US")} scrobbles`,
    `-# Measured over the last ${plural(stamped.length, "scrobble")}, spanning ${days.toFixed(1)} days.`,
  ].join("\n");

  await paginate(ctx, card(heading, body, icon), USER_ACCENT);
}

async function listeningTime(ctx: PrefixContext): Promise<void> {
  const { target, icon, scrobbles, total } = await load(ctx);
  const heading = `${target.username}'s listening time`;

  const AVERAGE_TRACK_SECONDS = 210;
  const seconds = total * AVERAGE_TRACK_SECONDS;
  const hours = seconds / 3600;

  const body = [
    `About **${Math.round(hours).toLocaleString("en-US")} hours** of music`,
    `That is roughly **${(hours / 24).toFixed(1)} days** or **${(hours / 24 / 365).toFixed(2)} years**`,
    "",
    `**Scrobbles** ${total.toLocaleString("en-US")}`,
    `-# Estimated at ${AVERAGE_TRACK_SECONDS / 60} minutes a track, since Last.fm does not store a length per scrobble.`,
  ].join("\n");

  await paginate(ctx, card(heading, body, icon), USER_ACCENT);
  void scrobbles;
}

export function registerInsights(): void {
  const add = (
    name: string,
    aliases: string[],
    description: string,
    handler: (ctx: PrefixContext) => Promise<void>,
  ) => register({ name, aliases, description, handler: guard(handler) });

  add("clock", ["hourly", "hours"], "When you listen, hour by hour", clock);
  add("weekday", ["days", "week"], "Which days you listen most", weekday);
  add("nightowl", ["earlybird", "timeofday"], "How your listening splits across the day", nightowl);
  add("sessions", ["listens"], "Your recent listening sessions", sessions);
  add("binge", ["longest", "marathon"], "Your longest listening session", binge);
  add("gaps", ["quiet", "breaks"], "Your longest breaks from listening", gaps);
  add("firstscrobble", ["first", "oldest"], "The very first track you scrobbled", firstScrobble);
  add("onthisday", ["otd", "today"], "What you played on this date in past years", onThisDay);
  add("pace", ["rate", "perday"], "How fast you are scrobbling", pace);
  add("listeningtime", ["timespent", "hourslistened"], "Roughly how long you have spent listening", listeningTime);
}
