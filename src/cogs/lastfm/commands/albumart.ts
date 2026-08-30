/**
 * Community album artwork.
 *
 * Last.fm's own cover for an album is often missing, tiny, or the wrong
 * pressing, so members submit replacements with `,lfurl` and the server picks
 * the winner with `,vote`. The most-voted submission is what `,np` renders.
 *
 * Two things drive every decision in this file:
 *
 * 1. A submitted URL is rendered inside *other people's* cards, so it is
 *    validated hard on the way in (see checkImageUrl): anything that is not
 *    plainly an image on a public host is refused with a reason. Nothing is
 *    trusted on the way out either — every stored URL is re-checked before it
 *    is rendered here (url()) or handed to nowplaying (renderableUrl), because
 *    a single unrenderable row would otherwise 400 the command for everyone.
 * 2. getCoverOverride runs on every `,np`, so it is one Redis GET on the happy
 *    path — negatives cached too, because "no submission" is the common case.
 */

import { createHash } from "node:crypto";
import { sql } from "../../../core/db.js";
import { displayName } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { redis } from "../../../core/redis.js";
import { getRecentTracks } from "../api/index.js";
import { guard } from "../guard.js";
import {
  MAX_URL,
  checkImageUrl,
  hostOf,
  renderableUrl,
} from "../../../helpers/imageurl.js";
import {
  EMBED_COLOR,
  TargetError,
  buildPages,
  label,
  plural,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";

/** How long a resolved (or absent) cover is cached for. */
const COVER_TTL = 300;
/** Redis stores "no submission" as an empty string so negatives cache too. */
const NO_COVER = "";

/** Artist and album names are stored verbatim, so they are bounded. */
const MAX_NAME = 200;
/** Submissions kept per album — enough choice without turning the list into spam. */
const MAX_PER_ALBUM = 25;
/**
 * Rows read for the listing. Deliberately above MAX_PER_ALBUM so the list is
 * always complete, which is what makes the "in use" marker below trustworthy:
 * it is computed from these rows rather than from a second query.
 */
const LIST_LIMIT = 30;
/** Name lookups in flight at once, for the bounded fan-out over submitters. */
const CONCURRENCY = 5;

/** Space, dash, space. The en/em dashes are accepted because phones insert them. */
const SEPARATOR = /\s+[-–—]\s+/;

/**
 * A leading pick, as in ",vote 2". Capped at three digits so an album whose
 * name opens with a year ("1975 - ...") is still read as an album name.
 * A "#" prefix is accepted because that is what people type anyway.
 */
const PICK = /^#?(\d{1,3})(?:\s+|$)/;

/* ------------------------------------------------------------------ */
/* Keys and cache                                                     */
/* ------------------------------------------------------------------ */

/**
 * The lookup key for an artist or album name. Whitespace is collapsed as well
 * as trimmed so "Boards  of Canada" and "Boards of Canada" are one album; the
 * write path and the read path both go through here, which is the only thing
 * that keeps them agreeing.
 */
function keyOf(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Hashed so the key is a fixed length whatever the album is called, and so the
 * two halves cannot run together — "a:b" + "c" must not collide with "a" + "b:c".
 */
function cacheKey(artistKey: string, albumKey: string): string {
  const digest = createHash("sha1")
    .update(`${artistKey}\u0000${albumKey}`, "utf8")
    .digest("base64url");
  return `trap:lf:cover:${digest}`;
}

/** Drops the cached cover after a submission or a vote changes the winner. */
async function invalidate(artistKey: string, albumKey: string): Promise<void> {
  await redis.del(cacheKey(artistKey, albumKey)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* The read path                                                      */
/* ------------------------------------------------------------------ */

/**
 * The community cover for an album, or null when there is none.
 *
 * Called on every now-playing, so it must stay cheap: one Redis GET normally,
 * one indexed query on a miss, and never a thrown error — artwork is
 * decoration and must not be able to sink the command that asked for it.
 */
export async function getCoverOverride(artist: string, album: string): Promise<string | null> {
  const artistKey = keyOf(artist);
  const albumKey = keyOf(album);
  if (!artistKey || !albumKey) return null;

  const key = cacheKey(artistKey, albumKey);
  try {
    const hit = await redis.get(key);
    // An empty string is a cached "nothing submitted", not a cache miss.
    if (hit !== null) return hit === NO_COVER ? null : renderableUrl(hit);
  } catch {
    /* cache down — fall through to Postgres */
  }

  let href: string | null = null;
  try {
    // Most votes wins; the oldest submission holds the tie, so a newcomer
    // cannot take the cover simply by matching the incumbent's score.
    const rows = await sql<{ url: string }[]>`
      SELECT a.url
      FROM lastfm_album_art a
      LEFT JOIN lastfm_album_art_votes v ON v.art_id = a.id
      WHERE a.artist_key = ${artistKey} AND a.album_key = ${albumKey}
      GROUP BY a.id
      ORDER BY COUNT(v.voter_id) DESC, a.created_at ASC, a.id ASC
      LIMIT 1
    `;
    // Validated again on the way out: this is the one value that leaves the
    // module, and a row Discord refuses would break `,np` rather than this file.
    href = renderableUrl(rows[0]?.url);
  } catch (err) {
    // Do not cache a failure — the next call should try again.
    console.error("album art lookup failed:", err);
    return null;
  }

  redis.set(key, href ?? NO_COVER, "EX", COVER_TTL).catch(() => {});
  return href;
}

/* ------------------------------------------------------------------ */
/* URL validation                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Maps with at most `limit` workers running at once, pulling from a shared
 * cursor so one slow lookup does not stall a chunk. A hole skips its own slot
 * rather than retiring the worker, which would silently drop every later item.
 */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let cursor = 0;

  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) continue;
        results[index] = await worker(item);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

/** Text going inside a `code span`: a backtick would close it early. */
const code = (value: string) => label(value).replaceAll("`", "'");

/** A single-page reply, used for every refusal and confirmation here. */
async function card(
  ctx: PrefixContext,
  heading: string,
  body: string,
  icon?: string | null,
): Promise<void> {
  await paginate(ctx, simpleCard(heading, body, icon), EMBED_COLOR);
}

interface Album {
  artist: string;
  album: string;
}

/**
 * Resolves `<artist - album>`, falling back to what the caller is playing.
 *
 * Splitting on the *first* separator keeps a suffix on the album, so
 * "Artist - Album - Deluxe Edition" resolves the way it reads.
 */
async function albumOperand(
  ctx: PrefixContext,
  spec: string,
  command: string,
): Promise<Album> {
  const typed = spec.trim();

  if (typed) {
    const found = SEPARATOR.exec(typed);
    if (!found) {
      throw new TargetError(
        "Separate the artist and the album with a space, a dash and a space. " +
          `\`,${command} artist - album\`.`,
      );
    }
    const token = found[0] ?? " - ";
    const artist = typed.slice(0, found.index).trim();
    const album = typed.slice(found.index + token.length).trim();
    if (!artist || !album) {
      throw new TargetError(`Both halves are needed. Use \`,${command} artist - album\`.`);
    }
    if (artist.length > MAX_NAME || album.length > MAX_NAME) {
      throw new TargetError(`Keep the artist and album under ${MAX_NAME} characters each.`);
    }
    return { artist, album };
  }

  // No album named, so use the caller's own current scrobble. resolveTarget
  // is given an empty argument on purpose: this command is about the caller,
  // and a mention would otherwise be eaten as a target.
  const { target } = await resolveTarget(ctx, "");
  const { tracks } = await getRecentTracks(target.username, 1);
  const track = tracks[0];
  if (!track) {
    throw new TargetError(
      `You have not scrobbled anything yet, so name an album: \`,${command} artist - album\`.`,
    );
  }

  const artist = (track.artist?.name ?? track.artist?.["#text"] ?? "").trim();
  const album = track.album?.["#text"]?.trim() ?? "";
  if (!artist) {
    throw new TargetError("Last.fm did not name the artist of that scrobble.");
  }
  if (!album) {
    throw new TargetError(
      `That scrobble has no album attached, so name one: \`,${command} artist - album\`.`,
    );
  }
  // A scrobble carries whatever text the client sent, so the same bound the
  // typed form gets applies here — these two strings become table keys.
  if (artist.length > MAX_NAME || album.length > MAX_NAME) {
    throw new TargetError(
      `That scrobble's artist or album is over ${MAX_NAME} characters, so name the album yourself: ` +
        `\`,${command} artist - album\`.`,
    );
  }
  return { artist, album };
}

interface ArtRow {
  /** BIGINT, selected as text so the driver does not hand back a string surprise. */
  id: string;
  url: string;
  submitted_by: string;
  votes: number;
  /** 1 when the caller has already voted for this submission. */
  mine: number;
}

/** Every submission for an album, oldest first, with vote counts. */
async function submissions(
  artistKey: string,
  albumKey: string,
  voterId: string,
): Promise<ArtRow[]> {
  return await sql<ArtRow[]>`
    SELECT a.id::text AS id,
           a.url,
           a.submitted_by,
           COUNT(v.voter_id)::int AS votes,
           (COUNT(*) FILTER (WHERE v.voter_id = ${voterId}))::int AS mine
    FROM lastfm_album_art a
    LEFT JOIN lastfm_album_art_votes v ON v.art_id = a.id
    WHERE a.artist_key = ${artistKey} AND a.album_key = ${albumKey}
    GROUP BY a.id
    ORDER BY a.created_at ASC, a.id ASC
    LIMIT ${LIST_LIMIT}
  `;
}

/**
 * The submission currently in use. Rows arrive oldest-first, so a strict `>`
 * leaves the oldest holding a tie — the same rule getCoverOverride applies.
 */
function winnerOf(rows: readonly ArtRow[]): ArtRow | undefined {
  let best: ArtRow | undefined;
  for (const row of rows) {
    if (!best || row.votes > best.votes) best = row;
  }
  return best;
}

/**
 * Names for the submitters. Display names are attacker-chosen text, so they go
 * through label(); outside a guild there is no member list to read, and a
 * mention renders as a name on its own.
 */
async function submitterNames(ctx: PrefixContext, ids: readonly string[]): Promise<string[]> {
  const guildId = ctx.guildId;
  if (!guildId) return ids.map((id) => `<@${id}>`);
  const names = await mapLimited(ids, CONCURRENCY, (id) => displayName(guildId, id));
  return names.map((name) => label(name ?? "unknown"));
}

/* ------------------------------------------------------------------ */
/* ,lfurl                                                             */
/* ------------------------------------------------------------------ */

const USAGE = [
  "Submit artwork for an album, image URL first:",
  "`,lfurl <image url> artist - album`",
  "",
  "Leave the album off to use whatever you are playing right now.",
].join("\n");

async function submit(ctx: PrefixContext): Promise<void> {
  const argument = ctx.argument.trim();
  if (!argument) {
    await card(ctx, "Album artwork", USAGE);
    return;
  }

  // The URL is the first word; everything after it is the album.
  const parts = /^(\S+)\s*([\s\S]*)$/.exec(argument);
  const check = checkImageUrl(parts?.[1] ?? "");
  if (!check.ok) {
    await card(ctx, "That URL will not do", `${check.reason}\n\n${USAGE}`);
    return;
  }

  const { artist, album } = await albumOperand(ctx, parts?.[2] ?? "", "lfurl");
  const artistKey = keyOf(artist);
  const albumKey = keyOf(album);
  const named = `**${label(artist)}** · **${label(album)}**`;
  const listHint = `\`,vote ${code(artist)} - ${code(album)}\``;

  const counted = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM lastfm_album_art
    WHERE artist_key = ${artistKey} AND album_key = ${albumKey}
  `;
  const existing = counted[0]?.count ?? 0;

  if (existing >= MAX_PER_ALBUM) {
    await card(
      ctx,
      "That album has enough artwork",
      `${named} already has ${plural(existing, "submission")}, which is the limit.\n` +
        `Vote for the one you want instead: ${listHint}`,
    );
    return;
  }

  // DO NOTHING turns the unique index into an answer rather than an error:
  // no row back means this exact image is already on the album.
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO lastfm_album_art (artist_key, album_key, url, submitted_by)
    VALUES (${artistKey}, ${albumKey}, ${check.href}, ${ctx.authorId})
    ON CONFLICT (artist_key, album_key, url) DO NOTHING
    RETURNING id::text AS id
  `;

  if (inserted.length === 0) {
    await card(
      ctx,
      "Already submitted",
      `That image is already on ${named}.\nSee every submission and vote: ${listHint}`,
      check.href,
    );
    return;
  }

  await invalidate(artistKey, albumKey);

  await card(
    ctx,
    "Artwork submitted",
    `Added artwork for ${named}.\n` +
      `It is submission **${existing + 1}** for this album and has no votes yet.\n` +
      `-# Vote on it with ${listHint}`,
    check.href,
  );
}

/* ------------------------------------------------------------------ */
/* ,vote                                                              */
/* ------------------------------------------------------------------ */

/** Renders an album's submissions, or the invitation to be first. */
async function renderArt(
  ctx: PrefixContext,
  artist: string,
  album: string,
  rows: readonly ArtRow[],
): Promise<void> {
  const heading = `Artwork for ${label(album)}`;

  if (rows.length === 0) {
    await card(
      ctx,
      heading,
      `Nobody has submitted artwork for **${label(artist)}** · **${label(album)}** yet.\n` +
        `Be first: \`,lfurl <image url> ${code(artist)} - ${code(album)}\``,
    );
    return;
  }

  const best = winnerOf(rows);
  const names = await submitterNames(
    ctx,
    rows.map((row) => row.submitted_by),
  );

  const lines = rows.map((row, i) => {
    // url() only sanitises its first argument, so the fallback is empty
    // rather than the raw value: a stored URL that no longer parses is shown
    // as plain text instead of being pasted into a markdown link.
    const href = url(row.url, "");
    const shown = label(hostOf(row.url));
    const linked = href ? `**[${shown}](${href})**` : `**${shown}**`;
    const marks =
      (best && best.id === row.id ? " · **in use**" : "") + (row.mine > 0 ? " · you voted" : "");
    return `\`${i + 1}\` ${linked} · **${plural(row.votes, "vote")}** · ${names[i] ?? "unknown"}${marks}`;
  });

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: label(artist),
      // Stored URLs are validated on the way in, but the thumbnail is built
      // from one at render time — url() keeps a bad row from breaking the card.
      icon: best ? url(best.url, "") : null,
      noun: "submissions",
      total: rows.length,
      footer:
        `${plural(rows.length, "submission")} • \`,vote <n> ${code(artist)} - ${code(album)}\` to vote` +
        " • numbered in submission order",
    }),
    EMBED_COLOR,
  );
}

/** `,vote` with no leading number: show what has been submitted. */
async function listArt(ctx: PrefixContext, spec: string): Promise<void> {
  const { artist, album } = await albumOperand(ctx, spec, "vote");
  const rows = await submissions(keyOf(artist), keyOf(album), ctx.authorId);
  await renderArt(ctx, artist, album, rows);
}

/**
 * The recovery for ",vote 100 gecs - 1000 gecs": a leading number is a pick,
 * so that reads as picking #100 of "gecs - 1000 gecs". Only when the pick
 * cannot exist AND the whole argument names an album that actually has
 * submissions is it re-read as a listing — a mistyped number on a real album
 * still gets the "pick 1-N" answer rather than a puzzling one about an artist
 * whose name starts with a digit.
 */
async function retryAsAlbum(ctx: PrefixContext, argument: string): Promise<boolean> {
  if (!SEPARATOR.test(argument)) return false;
  try {
    const { artist, album } = await albumOperand(ctx, argument, "vote");
    const rows = await submissions(keyOf(artist), keyOf(album), ctx.authorId);
    if (rows.length === 0) return false;
    await renderArt(ctx, artist, album, rows);
    return true;
  } catch (err) {
    // A second bad parse is not worth reporting; the caller has a better message.
    if (err instanceof TargetError) return false;
    throw err;
  }
}

async function castVote(ctx: PrefixContext, index: number, spec: string): Promise<void> {
  const { artist, album } = await albumOperand(ctx, spec, "vote");
  const artistKey = keyOf(artist);
  const albumKey = keyOf(album);
  const heading = `Artwork for ${label(album)}`;
  const rows = await submissions(artistKey, albumKey, ctx.authorId);

  // Typed as possibly-absent on purpose: index came from the user.
  const chosen: ArtRow | undefined =
    index >= 1 && index <= rows.length ? rows[index - 1] : undefined;

  if (!chosen) {
    // The pick cannot exist, so the number may have been part of the album.
    if (rows.length === 0 && (await retryAsAlbum(ctx, ctx.argument.trim()))) return;
    await card(
      ctx,
      heading,
      rows.length === 0
        ? `Nobody has submitted artwork for **${label(artist)}** · **${label(album)}** yet.\n` +
            `Be first: \`,lfurl <image url> ${code(artist)} - ${code(album)}\``
        : `There ${rows.length === 1 ? "is" : "are"} only ${plural(rows.length, "submission")} for ` +
            `**${label(album)}**, so pick 1–${rows.length}.\n` +
            `-# \`,vote ${code(artist)} - ${code(album)}\` lists them.`,
    );
    return;
  }

  // Delete-then-insert makes the toggle one decision — whether a row was
  // actually removed — instead of a read and a write that can race.
  const removed = await sql<{ voter_id: string }[]>`
    DELETE FROM lastfm_album_art_votes
    WHERE art_id = ${chosen.id}::bigint AND voter_id = ${ctx.authorId}
    RETURNING voter_id
  `;
  const added = removed.length === 0;

  if (added) {
    await sql`
      INSERT INTO lastfm_album_art_votes (art_id, voter_id)
      VALUES (${chosen.id}::bigint, ${ctx.authorId})
      ON CONFLICT (art_id, voter_id) DO NOTHING
    `;
  }

  const tally = await sql<{ votes: number }[]>`
    SELECT COUNT(*)::int AS votes
    FROM lastfm_album_art_votes
    WHERE art_id = ${chosen.id}::bigint
  `;
  const votes = tally[0]?.votes ?? 0;

  // Drop the cached cover first, then re-read it: the read warms the cache
  // with the new winner, so the next `,np` is already correct.
  await invalidate(artistKey, albumKey);
  const current = await getCoverOverride(artist, album);
  const winning = current !== null && current === chosen.url;

  await card(
    ctx,
    added ? "Vote recorded" : "Vote removed",
    `${added ? "Voted for" : "Took your vote off"} submission **${index}** for ` +
      `**${label(artist)}** · **${label(album)}**, now on **${plural(votes, "vote")}**.\n` +
      (winning
        ? "It is the artwork shown for this album."
        : "It is not the artwork shown for this album yet.") +
      `\n-# \`,vote ${code(artist)} - ${code(album)}\` lists every submission.`,
    url(chosen.url, ""),
  );
}

async function vote(ctx: PrefixContext): Promise<void> {
  const argument = ctx.argument.trim();
  const pick = PICK.exec(argument);

  if (!pick) {
    await listArt(ctx, argument);
    return;
  }

  const matched = pick[0] ?? "";
  await castVote(ctx, Number(pick[1] ?? "0"), argument.slice(matched.length).trim());
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

export function registerAlbumArt(): void {
  register({
    name: "lfurl",
    aliases: ["albumart", "setcover"],
    description: "Submit community album artwork",
    handler: guard(submit),
  });
  register({
    name: "vote",
    aliases: ["votecover"],
    description: "Show submitted album artwork and vote for one",
    handler: guard(vote),
  });
}
