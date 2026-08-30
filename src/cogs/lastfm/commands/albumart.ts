import { createHash } from "node:crypto";
import { sql } from "../../../core/db.js";
import { displayName } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { redis } from "../../../core/redis.js";
import { getRecentTracks } from "../api/index.js";
import { guard } from "../guard.js";
import { checkImageUrl, hostOf, renderableUrl } from "../../../helpers/imageurl.js";
import {
  USER_ACCENT,
  TargetError,
  buildPages,
  label,
  plural,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";

const COVER_TTL = 300;

const NO_COVER = "";

const MAX_NAME = 200;

const MAX_PER_ALBUM = 25;

const LIST_LIMIT = 30;

const CONCURRENCY = 5;

const SEPARATOR = /\s+[-–—]\s+/;

const PICK = /^#?(\d{1,3})(?:\s+|$)/;

function keyOf(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(artistKey: string, albumKey: string): string {
  const digest = createHash("sha1")
    .update(`${artistKey}\u0000${albumKey}`, "utf8")
    .digest("base64url");
  return `trap:lf:cover:${digest}`;
}

async function invalidate(artistKey: string, albumKey: string): Promise<void> {
  await redis.del(cacheKey(artistKey, albumKey)).catch(() => {});
}

export async function getCoverOverride(artist: string, album: string): Promise<string | null> {
  const artistKey = keyOf(artist);
  const albumKey = keyOf(album);
  if (!artistKey || !albumKey) return null;

  const key = cacheKey(artistKey, albumKey);
  try {
    const hit = await redis.get(key);

    if (hit !== null) return hit === NO_COVER ? null : renderableUrl(hit);
  } catch {}

  let href: string | null = null;
  try {
    const rows = await sql<{ url: string }[]>`
      SELECT a.url
      FROM lastfm_album_art a
      LEFT JOIN lastfm_album_art_votes v ON v.art_id = a.id
      WHERE a.artist_key = ${artistKey} AND a.album_key = ${albumKey}
      GROUP BY a.id
      ORDER BY COUNT(v.voter_id) DESC, a.created_at ASC, a.id ASC
      LIMIT 1
    `;

    href = renderableUrl(rows[0]?.url);
  } catch (err) {
    console.error("album art lookup failed:", err);
    return null;
  }

  redis.set(key, href ?? NO_COVER, "EX", COVER_TTL).catch(() => {});
  return href;
}

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

const code = (value: string) => label(value).replaceAll("`", "'");

async function card(
  ctx: PrefixContext,
  heading: string,
  body: string,
  icon?: string | null,
): Promise<void> {
  await paginate(ctx, simpleCard(heading, body, icon), USER_ACCENT);
}

interface Album {
  artist: string;
  album: string;
}

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

  if (artist.length > MAX_NAME || album.length > MAX_NAME) {
    throw new TargetError(
      `That scrobble's artist or album is over ${MAX_NAME} characters, so name the album yourself: ` +
        `\`,${command} artist - album\`.`,
    );
  }
  return { artist, album };
}

interface ArtRow {
  id: string;
  url: string;
  submitted_by: string;
  votes: number;
  mine: number;
}

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

function winnerOf(rows: readonly ArtRow[]): ArtRow | undefined {
  let best: ArtRow | undefined;
  for (const row of rows) {
    if (!best || row.votes > best.votes) best = row;
  }
  return best;
}

async function submitterNames(ctx: PrefixContext, ids: readonly string[]): Promise<string[]> {
  const guildId = ctx.guildId;
  if (!guildId) return ids.map((id) => `<@${id}>`);
  const names = await mapLimited(ids, CONCURRENCY, (id) => displayName(guildId, id));
  return names.map((name) => label(name ?? "unknown"));
}

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
      icon: best ? url(best.url, "") : null,
      noun: "submissions",
      total: rows.length,
      footer:
        `${plural(rows.length, "submission")} • \`,vote <n> ${code(artist)} - ${code(album)}\` to vote` +
        " • numbered in submission order",
    }),
    USER_ACCENT,
  );
}

async function listArt(ctx: PrefixContext, spec: string): Promise<void> {
  const { artist, album } = await albumOperand(ctx, spec, "vote");
  const rows = await submissions(keyOf(artist), keyOf(album), ctx.authorId);
  await renderArt(ctx, artist, album, rows);
}

async function retryAsAlbum(ctx: PrefixContext, argument: string): Promise<boolean> {
  if (!SEPARATOR.test(argument)) return false;
  try {
    const { artist, album } = await albumOperand(ctx, argument, "vote");
    const rows = await submissions(keyOf(artist), keyOf(album), ctx.authorId);
    if (rows.length === 0) return false;
    await renderArt(ctx, artist, album, rows);
    return true;
  } catch (err) {
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

  const chosen: ArtRow | undefined =
    index >= 1 && index <= rows.length ? rows[index - 1] : undefined;

  if (!chosen) {
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
