import { sql } from "../../../core/db.js";
import { MemberFetchError, displayName, guildMemberIds } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import {
  getAlbumInfo,
  getArtistInfo,
  getRecentTracks,
  getTrackInfo,
  largestImage,
  type RecentTrack,
} from "../api/index.js";
import { guard } from "../guard.js";
import {
  USER_ACCENT,
  TargetError,
  buildPages,
  chartLine,
  label,
  plural,
  resolveTarget,
  simpleCard,
  url,
  artistUrl,
} from "../shared.js";
import type { LfArtistRef } from "../types.js";
import { accented } from "../../../helpers/components.js";

const MAX_CANDIDATES = 100;

const CONCURRENCY = 5;

const SEPARATOR = /\s+[-–—]\s+/;

const LEADING_MENTION = /^<@!?\d{15,25}>(?=\s|$)/;

const INT4_MAX = 2_147_483_647;

const MAX_STORED = 200;

type Kind = "artist" | "album" | "track";

type Audience = { scope: "guild"; guildId: string } | { scope: "global" };

interface Candidate {
  discordId: string;
  username: string;
}

interface Listener extends Candidate {
  plays: number;
}

interface Probe {
  plays: number;
  name: string;
  link: string;
  image: string | null;
}

interface Subject {
  artist: string;
  title?: string;
  probe: (username: string) => Promise<Probe | null>;
}

function artistNameOf(ref: LfArtistRef | undefined): string {
  return ref?.name ?? ref?.["#text"] ?? "";
}

function playCount(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const segment = (value: string) =>
  encodeURIComponent(value).replaceAll("(", "%28").replaceAll(")", "%29");

const artistLink = (artist: string) => `https://www.last.fm/music/${segment(artist)}`;

const albumLink = (artist: string, album: string) =>
  `${artistLink(artist)}/${segment(album)}`;

const trackLink = (artist: string, track: string) =>
  `${artistLink(artist)}/_/${segment(track)}`;

const userLink = (username: string) => `https://www.last.fm/user/${segment(username)}`;

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

function splitMention(argument: string): { mention: string; rest: string } {
  const trimmed = argument.trim();
  const found = LEADING_MENTION.exec(trimmed);
  if (!found) return { mention: "", rest: trimmed };
  const token = found[0] ?? "";
  return { mention: token, rest: trimmed.slice(token.length).trim() };
}

async function currentScrobble(ctx: PrefixContext, mention: string): Promise<RecentTrack> {
  const { target } = await resolveTarget(ctx, mention);
  const { tracks } = await getRecentTracks(target.username, 1);
  const track = tracks[0];
  if (!track?.name) {
    throw new TargetError(`**${label(target.username)}** has not scrobbled anything yet.`);
  }
  return track;
}

function artistOf(track: RecentTrack): string {
  const name = artistNameOf(track.artist);
  if (!name) throw new TargetError("Last.fm did not name the artist of that scrobble.");
  return name;
}

function splitPair(
  typed: string,
  kind: "album" | "track",
  command: string,
): { artist: string; title: string } {
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
  return { artist, title };
}

async function probeArtist(artist: string, username: string): Promise<Probe | null> {
  const info = await getArtistInfo(artist, username);
  if (!info) return null;
  const name = info.name || artist;
  return {
    plays: playCount(info.stats?.userplaycount),
    name,
    link: url(info.url, artistLink(name)),
    image: largestImage(info.image),
  };
}

async function probeAlbum(
  artist: string,
  title: string,
  username: string,
): Promise<Probe | null> {
  const info = await getAlbumInfo(artist, title, username);
  if (!info) return null;
  const name = info.name || title;
  const by = info.artist || artist;
  return {
    plays: playCount(info.userplaycount),
    name,
    link: url(info.url, albumLink(by, name)),
    image: largestImage(info.image),
  };
}

async function probeTrack(
  artist: string,
  title: string,
  username: string,
): Promise<Probe | null> {
  const info = await getTrackInfo(artist, title, username);
  if (!info) return null;
  return {
    plays: playCount(info.userplaycount),
    name: title,
    link: url(info.url, trackLink(artist, title)),
    image: largestImage(info.album?.image),
  };
}

async function subjectOf(ctx: PrefixContext, kind: Kind, command: string): Promise<Subject> {
  const { mention, rest } = splitMention(ctx.argument);

  if (kind === "artist") {
    const artist = rest || artistOf(await currentScrobble(ctx, mention));
    return { artist, probe: (username) => probeArtist(artist, username) };
  }

  let artist: string;
  let title: string;

  if (rest) {
    ({ artist, title } = splitPair(rest, kind, command));
  } else {
    const current = await currentScrobble(ctx, mention);
    artist = artistOf(current);
    if (kind === "track") {
      title = current.name;
    } else {
      const album = current.album?.["#text"]?.trim() ?? "";
      if (!album) {
        throw new TargetError(
          `That scrobble has no album attached, so name one: \`,${command} artist - album\`.`,
        );
      }
      title = album;
    }
  }

  const probe =
    kind === "album"
      ? (username: string) => probeAlbum(artist, title, username)
      : (username: string) => probeTrack(artist, title, username);

  return { artist, title, probe };
}

interface LinkRow {
  discord_id: string;
  username: string;
}

async function candidates(audience: Audience): Promise<{ list: Candidate[]; total: number }> {
  if (audience.scope === "global") {
    const rows = await sql<LinkRow[]>`
      SELECT discord_id, username FROM lastfm_users ORDER BY linked_at ASC
    `;
    const all = rows.map((row) => ({ discordId: row.discord_id, username: row.username }));
    return { list: all.slice(0, MAX_CANDIDATES), total: all.length };
  }

  let members: Set<string>;
  let rows: LinkRow[];
  try {
    [rows, members] = await Promise.all([
      sql<LinkRow[]>`
        SELECT u.discord_id, u.username
        FROM lastfm_users u
        WHERE NOT EXISTS (
          SELECT 1 FROM lastfm_hidden h
          WHERE h.guild_id = ${audience.guildId} AND h.discord_id = u.discord_id
        )
        ORDER BY u.linked_at ASC
      `,
      guildMemberIds(audience.guildId),
    ]);
  } catch (err) {
    if (err instanceof MemberFetchError) {
      throw new TargetError(
        "Discord would not give me this server's member list just now, so I cannot tell " +
          "who is here. Try again in a moment, or use `,globalwhoknows`.",
      );
    }
    throw err;
  }

  const all = rows
    .filter((row) => members.has(row.discord_id))
    .map((row) => ({ discordId: row.discord_id, username: row.username }));
  return { list: all.slice(0, MAX_CANDIDATES), total: all.length };
}

export const CROWN = "\u{1F451}";

interface CrownOutcome {
  holder: string | null;
  takenFrom: string | null;
  changed: boolean;
}

async function claimCrown(
  guildId: string,
  artistName: string,
  top: Listener | undefined,
): Promise<CrownOutcome> {
  const none: CrownOutcome = { holder: null, takenFrom: null, changed: false };

  const name = artistName.trim().slice(0, MAX_STORED);
  const key = name.toLowerCase();
  if (!key) return none;

  const before = await sql<{ discord_id: string }[]>`
    SELECT discord_id FROM lastfm_crowns
    WHERE guild_id = ${guildId} AND artist_key = ${key}
  `;
  const previous = before[0]?.discord_id ?? null;

  if (!top || top.plays < 1) return { holder: previous, takenFrom: null, changed: false };

  const plays = Math.min(Math.max(Math.trunc(top.plays), 0), INT4_MAX);

  await sql`
    INSERT INTO lastfm_crowns (guild_id, artist_key, artist_name, discord_id, plays, claimed_at)
    VALUES (${guildId}, ${key}, ${name}, ${top.discordId}, ${plays}, now())
    ON CONFLICT (guild_id, artist_key) DO UPDATE
      SET artist_name = EXCLUDED.artist_name,
          discord_id  = EXCLUDED.discord_id,
          plays       = EXCLUDED.plays,
          claimed_at  = now()
  `;

  return {
    holder: top.discordId,
    takenFrom: previous !== null && previous !== top.discordId ? previous : null,
    changed: previous !== top.discordId,
  };
}

async function crownCandidate(
  listeners: Listener[],
  audience: Audience,
  guildId: string,
): Promise<Listener | undefined> {
  if (audience.scope === "guild") return listeners[0];

  let members: Set<string>;
  let hidden: { discord_id: string }[];
  try {
    [members, hidden] = await Promise.all([
      guildMemberIds(guildId),
      sql<{ discord_id: string }[]>`
        SELECT discord_id FROM lastfm_hidden WHERE guild_id = ${guildId}
      `,
    ]);
  } catch (err) {
    if (err instanceof MemberFetchError) return undefined;
    throw err;
  }

  const excluded = new Set(hidden.map((row) => row.discord_id));
  return listeners.find(
    (listener) => members.has(listener.discordId) && !excluded.has(listener.discordId),
  );
}

async function announceCrown(
  guildId: string,
  outcome: CrownOutcome,
  artistName: string,
  top: Listener,
): Promise<Record<string, unknown> | null> {
  if (!outcome.changed || outcome.holder === null) return null;

  const winner = label(await displayName(guildId, outcome.holder));
  const artist = `**[${label(artistName)}](${artistUrl(artistName)})**`;
  const plays = `**${plural(top.plays, "play")}**`;

  const body = outcome.takenFrom
    ? `${CROWN} **${winner}** took the crown for ${artist} from ` +
      `**${label(await displayName(guildId, outcome.takenFrom))}** with ${plays}.`
    : `${CROWN} **${winner}** claimed the crown for ${artist} with ${plays}.`;

  return {
    flags: 1 << 15,
    components: [
      accented({ type: 17, components: [{ type: 10, content: body }] }),
    ],
  };
}

function headingFor(subject: Subject, canonical: Probe | null, audience: Audience): string {
  const name = canonical?.name ?? subject.title ?? subject.artist;
  const where = audience.scope === "global" ? " globally" : "";
  if (subject.title === undefined) return `Who knows ${label(name)}${where}`;
  return `Who knows ${label(name)} by ${label(subject.artist)}${where}`;
}

async function whoKnows(
  ctx: PrefixContext,
  kind: Kind,
  audience: Audience,
  command: string,
): Promise<void> {
  const subject = await subjectOf(ctx, kind, command);
  const { list, total } = await candidates(audience);

  const guildId = audience.scope === "guild" ? audience.guildId : null;

  if (list.length === 0) {
    const body =
      guildId === null
        ? "Nobody has linked a Last.fm account yet."
        : "Nobody in this server has linked a Last.fm account yet.";
    await paginate(ctx, simpleCard(headingFor(subject, null, audience), body), USER_ACCENT);
    return;
  }

  const probed = await mapLimit(list, CONCURRENCY, async (candidate) => ({
    candidate,
    probe: await subject.probe(candidate.username),
  }));

  let canonical: Probe | null = null;
  const listeners: Listener[] = [];
  for (const result of probed) {
    if (!result?.probe) continue;
    if (canonical === null) canonical = result.probe;
    if (result.probe.plays <= 0) continue;
    listeners.push({ ...result.candidate, plays: result.probe.plays });
  }
  listeners.sort((a, b) => b.plays - a.plays || a.username.localeCompare(b.username));

  const heading = headingFor(subject, canonical, audience);
  const icon = canonical?.image ?? null;

  const complete = total <= list.length;
  const crownArtist = canonical?.name ?? subject.artist;

  const crownGuild = audience.scope === "guild" ? audience.guildId : (ctx.guildId ?? null);
  const contender =
    kind === "artist" && crownGuild !== null && complete
      ? await crownCandidate(listeners, audience, crownGuild)
      : undefined;
  const crowned =
    kind === "artist" && crownGuild !== null && complete
      ? await claimCrown(crownGuild, crownArtist, contender)
      : null;

  const summary = [plural(listeners.length, "listener")];
  if (crowned?.changed) summary.push("crown claimed");
  if (total > list.length) {
    const noun = guildId === null ? "linked accounts" : "linked members";
    summary.push(`scanned the first ${list.length} of ${total} ${noun}`);
  }
  const footer = summary.join(" • ");

  if (listeners.length === 0) {
    const item = canonical
      ? `**[${label(canonical.name)}](${canonical.link})**`
      : `**${label(subject.title ?? subject.artist)}**`;
    const who = guildId === null ? "Nobody linked" : "Nobody here";
    await paginate(
      ctx,
      simpleCard(heading, `${who} has scrobbled ${item}.\n-# ${footer}`, icon),
      USER_ACCENT,
    );
    return;
  }

  let names: string[];
  if (guildId === null) {
    names = listeners.map((listener) => listener.username);
  } else {
    const scope = guildId;
    names = await mapLimit(listeners, CONCURRENCY, (listener) =>
      displayName(scope, listener.discordId),
    );
  }

  const lines = listeners.map((listener, i) =>
    chartLine(
      i + 1,
      names[i] ?? listener.username,
      userLink(listener.username),
      listener.plays,
      "play",
      crowned?.holder === listener.discordId ? CROWN : undefined,
    ),
  );

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: crownArtist,
      icon,
      noun: "listeners",
      total: listeners.length,
      footer,
    }),
    USER_ACCENT,
  );

  if (crownGuild !== null && crowned && contender) {
    const card = await announceCrown(crownGuild, crowned, crownArtist, contender);
    if (card) await ctx.reply(card);
  }
}

async function inGuild(
  ctx: PrefixContext,
  kind: Kind,
  command: string,
  global: string,
): Promise<void> {
  if (!ctx.guildId) {
    await paginate(
      ctx,
      simpleCard(
        "Who knows",
        `\`,${command}\` only works inside a server. Try \`,${global}\` here instead.`,
      ),
      USER_ACCENT,
    );
    return;
  }
  await whoKnows(ctx, kind, { scope: "guild", guildId: ctx.guildId }, command);
}

export function registerWhoKnows(): void {
  register({
    name: "whoknows",
    aliases: ["wk"],
    description: "Top listeners for an artist in this server",
    handler: guard((ctx) => inGuild(ctx, "artist", "whoknows", "globalwhoknows")),
  });
  register({
    name: "wkalbum",
    aliases: ["wka"],
    description: "Top listeners for an album in this server",
    handler: guard((ctx) => inGuild(ctx, "album", "wkalbum", "globalwkalbum")),
  });
  register({
    name: "wktrack",
    aliases: ["wkt"],
    description: "Top listeners for a track in this server",
    handler: guard((ctx) => inGuild(ctx, "track", "wktrack", "globalwktrack")),
  });
  register({
    name: "globalwhoknows",
    aliases: ["gwk"],
    description: "Top listeners anywhere, by artist",
    handler: guard((ctx) => whoKnows(ctx, "artist", { scope: "global" }, "globalwhoknows")),
  });
  register({
    name: "globalwkalbum",
    aliases: ["gwka"],
    description: "Top listeners anywhere, by album",
    handler: guard((ctx) => whoKnows(ctx, "album", { scope: "global" }, "globalwkalbum")),
  });
  register({
    name: "globalwktrack",
    aliases: ["gwkt"],
    description: "Top listeners anywhere, by track",
    handler: guard((ctx) => whoKnows(ctx, "track", { scope: "global" }, "globalwktrack")),
  });
}
