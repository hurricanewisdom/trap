/**
 * `,whoknows` — who else listens to an artist, an album or a track, either in
 * this server or across everyone who has linked an account, plus the per-guild
 * artist crowns.
 *
 * These commands fan out over *people* rather than over one library: a lookup
 * per linked member, not a single chart call. An unbounded Promise.all over a
 * large server would open hundreds of connections at once and trip Last.fm's
 * rate limit, returning a card full of zeroes, so the candidate list is capped
 * and the requests run through a small fixed pool. Whenever the scan is
 * truncated the footer says so rather than quietly showing a partial ranking.
 *
 * Argument shapes match the `,plays` family: `<artist>` verbatim,
 * `<artist - album>` split on a space-dash-space, and an omitted operand falls
 * back to whatever is playing right now.
 */

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
  EMBED_COLOR,
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

/**
 * Members scanned per command. One Last.fm request each, so this is the whole
 * cost of the command; the footer reports the true size when it bites.
 */
const MAX_CANDIDATES = 100;

/** In-flight lookups. Last.fm starts throttling a key well above this. */
const CONCURRENCY = 5;

/** Space, dash, space. The en/em dashes are accepted because phones insert them. */
const SEPARATOR = /\s+[-–—]\s+/;

/** A whole-word leading mention, matching what resolveTarget will accept. */
const LEADING_MENTION = /^<@!?\d{15,25}>(?=\s|$)/;

/** `lastfm_crowns.plays` is INTEGER; a bogus count must not abort the insert. */
const INT4_MAX = 2_147_483_647;

/** Artist names are stored, so they are bounded before they reach the table. */
const MAX_STORED = 200;

type Kind = "artist" | "album" | "track";

/** Guild scope carries its id so the compiler keeps the two paths apart. */
type Audience = { scope: "guild"; guildId: string } | { scope: "global" };

interface Candidate {
  discordId: string;
  username: string;
}

interface Listener extends Candidate {
  plays: number;
}

/** What one lookup learned about the item for one user. */
interface Probe {
  plays: number;
  /** Canonical name, as Last.fm autocorrected it. */
  name: string;
  /** Ready-to-embed link to the item. */
  link: string;
  image: string | null;
}

/** The thing being counted, plus how to count it for one username. */
interface Subject {
  artist: string;
  title?: string;
  probe: (username: string) => Promise<Probe | null>;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

/** The artist reference is `name` on some endpoints and `#text` on others. */
function artistNameOf(ref: LfArtistRef | undefined): string {
  return ref?.name ?? ref?.["#text"] ?? "";
}

/**
 * Last.fm sends counts as strings and occasionally omits or mangles one.
 * Number("1,024") is NaN, which would sort to the bottom and render as
 * "NaN plays" instead of simply being skipped.
 */
function playCount(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * encodeURIComponent leaves `(` and `)` alone, and url() hands back its
 * *fallback* verbatim rather than running it through the paren-encoder it
 * applies to real URLs. A name like "Everlong (Live)" would therefore close its
 * own `[label](url)`, so every path segment is escaped here instead.
 */
const segment = (value: string) =>
  encodeURIComponent(value).replaceAll("(", "%28").replaceAll(")", "%29");

const artistLink = (artist: string) => `https://www.last.fm/music/${segment(artist)}`;

const albumLink = (artist: string, album: string) =>
  `${artistLink(artist)}/${segment(album)}`;

const trackLink = (artist: string, track: string) =>
  `${artistLink(artist)}/_/${segment(track)}`;

/** Each row links to that listener's profile, which is the useful destination. */
const userLink = (username: string) => `https://www.last.fm/user/${segment(username)}`;

/**
 * Runs `worker` over `items` a few at a time, preserving order.
 *
 * A fixed pool of runners pulling from a shared cursor bounds the fan-out
 * without needing a dependency; Promise.all over the whole list would not.
 */
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
      // A hole skips its own slot — `return` here would retire the runner and
      // silently leave every later member unqueried.
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ */
/* Argument parsing                                                   */
/* ------------------------------------------------------------------ */

/** Peels a leading mention off, leaving the operand behind. */
function splitMention(argument: string): { mention: string; rest: string } {
  const trimmed = argument.trim();
  const found = LEADING_MENTION.exec(trimmed);
  if (!found) return { mention: "", rest: trimmed };
  const token = found[0] ?? "";
  return { mention: token, rest: trimmed.slice(token.length).trim() };
}

/**
 * The scrobble an omitted operand refers to. Only the mention is handed to
 * resolveTarget: the rest of the argument is free text, and a bare artist name
 * must not be mistaken for a username.
 */
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

/**
 * Splits `<artist - album>`.
 *
 * Splitting on the *first* separator lets a title keep its own " - "
 * ("Artist - Album - Deluxe Edition" keeps the suffix on the album).
 */
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

/* ------------------------------------------------------------------ */
/* Lookups                                                            */
/* ------------------------------------------------------------------ */

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
  // track.getInfo echoes no canonical name, so the typed title stands.
  const info = await getTrackInfo(artist, title, username);
  if (!info) return null;
  return {
    plays: playCount(info.userplaycount),
    name: title,
    link: url(info.url, trackLink(artist, title)),
    image: largestImage(info.album?.image),
  };
}

/** Works out what is being counted and how to count it. */
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

/* ------------------------------------------------------------------ */
/* Candidates                                                         */
/* ------------------------------------------------------------------ */

interface LinkRow {
  discord_id: string;
  username: string;
}

/**
 * Everyone eligible to appear, oldest link first so the cap is deterministic
 * rather than shuffling on every run. `total` is the size before the cap.
 */
async function candidates(audience: Audience): Promise<{ list: Candidate[]; total: number }> {
  if (audience.scope === "global") {
    const rows = await sql<LinkRow[]>`
      SELECT discord_id, username FROM lastfm_users ORDER BY linked_at ASC
    `;
    const all = rows.map((row) => ({ discordId: row.discord_id, username: row.username }));
    return { list: all.slice(0, MAX_CANDIDATES), total: all.length };
  }

  // Hidden members are filtered in the database; guild membership cannot be,
  // since the member list comes from Discord rather than from Postgres.
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

  // A genuinely empty set means a server of bots, which is not an error.
  // A failed fetch throws instead, and is reported by the caller.

  const all = rows
    .filter((row) => members.has(row.discord_id))
    .map((row) => ({ discordId: row.discord_id, username: row.username }));
  return { list: all.slice(0, MAX_CANDIDATES), total: all.length };
}

/* ------------------------------------------------------------------ */
/* Crowns                                                             */
/* ------------------------------------------------------------------ */

/** Shown in place of the rank number on the row that holds the crown. */
export const CROWN = "\u{1F451}";

interface CrownOutcome {
  /** Who holds the crown now, whether or not this scan changed it. */
  holder: string | null;
  /** Who held it before, when this scan took it from them. */
  takenFrom: string | null;
  /** True when the crown changed hands just now. */
  changed: boolean;
}

/**
 * Awards the artist crown to the top listener.
 *
 * Being the only listener still wins it: a server can have a dozen linked
 * members and one person who has actually played the artist, and requiring a
 * runner-up meant nothing niche could ever be crowned. What is required is a
 * real play, so an artist nobody here has listened to stays uncrowned.
 */
async function claimCrown(
  guildId: string,
  artistName: string,
  top: Listener | undefined,
): Promise<CrownOutcome> {
  const none: CrownOutcome = { holder: null, takenFrom: null, changed: false };

  const name = artistName.trim().slice(0, MAX_STORED);
  const key = name.toLowerCase();
  if (!key) return none;

  // Read the holder first: a subquery inside RETURNING would see this
  // statement's own snapshot, not reliably the pre-update value.
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

/**
 * The listener eligible to hold `guildId`'s crown.
 *
 * A guild listing is already filtered to members, so its top row is the
 * answer. A *global* listing is not: it ranks every linked account, so the
 * winner may be in another server entirely. Awarding this guild's crown to
 * them would put a stranger's name on it, so the list is filtered to members
 * of this guild — minus anyone hidden here — and the best of those wins.
 *
 * Doing it this way makes `,globalwhoknows` award crowns as accurately as
 * `,whoknows`, and more accurately when the guild scan hit its candidate cap.
 */
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
    // Without a member list there is no way to tell who is in this server, and
    // guessing would hand the crown to whoever happens to rank first globally.
    if (err instanceof MemberFetchError) return undefined;
    throw err;
  }

  const excluded = new Set(hidden.map((row) => row.discord_id));
  return listeners.find(
    (listener) => members.has(listener.discordId) && !excluded.has(listener.discordId),
  );
}

/**
 * The card announcing a crown, sent after the ranking.
 *
 * Separate from the listing because it is news: the ranking looks the same
 * every time, and a handover is the part worth noticing. One line, no
 * heading — the sentence already says what it is.
 */
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
      {
        type: 17,
        accent_color: EMBED_COLOR,
        components: [{ type: 10, content: body }],
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Command                                                            */
/* ------------------------------------------------------------------ */

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

  // Narrowed once, into a const, so the closures below keep the narrowing.
  const guildId = audience.scope === "guild" ? audience.guildId : null;

  if (list.length === 0) {
    const body =
      guildId === null
        ? "Nobody has linked a Last.fm account yet."
        : "Nobody in this server has linked a Last.fm account yet.";
    await paginate(ctx, simpleCard(headingFor(subject, null, audience), body), EMBED_COLOR);
    return;
  }

  const probed = await mapLimit(list, CONCURRENCY, async (candidate) => ({
    candidate,
    probe: await subject.probe(candidate.username),
  }));

  // Every lookup describes the same item, so the first one that answered
  // supplies the canonical name, link and artwork for free.
  let canonical: Probe | null = null;
  const listeners: Listener[] = [];
  for (const result of probed) {
    // mapLimit leaves a hole in any slot it skipped, so a slot is not yet
    // known to hold a result however the element type reads.
    if (!result?.probe) continue;
    if (canonical === null) canonical = result.probe;
    if (result.probe.plays <= 0) continue;
    listeners.push({ ...result.candidate, plays: result.probe.plays });
  }
  listeners.sort((a, b) => b.plays - a.plays || a.username.localeCompare(b.username));

  const heading = headingFor(subject, canonical, audience);
  const icon = canonical?.image ?? null;

  // A truncated scan only saw the first MAX_CANDIDATES linked members, so its
  // "top listener" is the top of a sample rather than of the server. Writing
  // that to `lastfm_crowns` would overwrite a legitimately held crown with a
  // guess and leave the wrong holder in place for every later `,crowns` and
  // `,mostcrowns` read, so the ranking is still shown but the table is left
  // alone until a scan can see everyone.
  const complete = total <= list.length;
  const crownArtist = canonical?.name ?? subject.artist;

  // Crowns are an artist thing and belong to one server, but the command does
  // not have to be the guild-scoped one: ",gwk" run inside a server still
  // settles that server's crown, via crownCandidate(). A DM has no guild and
  // so awards nothing, and album/track listings never touch the table.
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
      EMBED_COLOR,
    );
    return;
  }

  // Display names come from the Discord API one member at a time, so this is a
  // second fan-out and gets the same bounded pool. Global listings need none:
  // there is no one guild to read a nickname from, so the Last.fm name stands.
  let names: string[];
  if (guildId === null) {
    names = listeners.map((listener) => listener.username);
  } else {
    // Re-bound as a plain string so the worker closure needs no narrowing.
    const scope = guildId;
    names = await mapLimit(listeners, CONCURRENCY, (listener) =>
      displayName(scope, listener.discordId),
    );
  }

  // The crown holder is marked instead of numbered. Read from the outcome
  // rather than assumed to be row one: an incomplete scan leaves the table
  // alone, so the holder can be someone further down this page.
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
    EMBED_COLOR,
  );

  // Sent after the ranking so the listing stays the reply to the command and
  // the handover reads as the news it is.
  if (crownGuild !== null && crowned && contender) {
    const card = await announceCrown(crownGuild, crowned, crownArtist, contender);
    if (card) await ctx.reply(card);
  }
}

/** Guild commands need a guild; a DM gets a card rather than an exception. */
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
      EMBED_COLOR,
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
