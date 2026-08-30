/**
 * Writing back to Last.fm: loving tracks and scrobbling from Discord.
 *
 * These are the only commands that use the stored session key, and they act
 * solely on the account of whoever ran them. A mention or a `user:` token is
 * deliberately not honoured here: naming someone else must never write to
 * their account.
 */

import { redis } from "../../../core/redis.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  getRecentTracks,
  loveTrack,
  scrobbleTrack,
  updateNowPlaying,
} from "../api/index.js";
import {
  EMBED_COLOR,
  TargetError,
  artistUrl,
  label,
  plain,
  simpleCard,
  PAIR_SEPARATOR,
  splitPair,
  trackUrl,
  url,
} from "../shared.js";
import { explain, ownAccount } from "../session.js";

/** Scrobbles allowed per user per minute, so the bot cannot be used to flood. */
const SCROBBLE_LIMIT = 10;
const SCROBBLE_WINDOW = 60;

/** Last.fm rejects plays dated more than two weeks back or in the future. */
const MAX_BACKDATE_SECONDS = 14 * 24 * 60 * 60;

/** "artist - track", or whatever the caller is playing right now. */
async function subject(
  ctx: PrefixContext,
  username: string,
): Promise<{ artist: string; track: string; album?: string }> {
  const argument = ctx.argument.trim();

  if (argument) {
    const parts = argument.split(PAIR_SEPARATOR);
    if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new TargetError("Give it as `artist - track`, with a space, a dash and a space.");
    }
    return { artist: parts[0].trim(), track: parts.slice(1).join(" - ").trim() };
  }

  const { tracks } = await getRecentTracks(username, 1);
  const current = tracks[0];
  const artist = current?.artist?.name ?? current?.artist?.["#text"];
  if (!current || !artist) {
    throw new TargetError("Name a track as `artist - track`, or play something first.");
  }
  return { artist, track: current.name, album: current.album?.["#text"] || undefined };
}

function card(heading: string, body: string) {
  return simpleCard(heading, body);
}

/* ------------------------------------------------------------------ */

function loveCommand(loved: boolean) {
  return async (ctx: PrefixContext): Promise<void> => {
    const account = await ownAccount(ctx);
    const { artist, track } = await subject(ctx, account.username);

    try {
      await loveTrack(artist, track, account.sessionKey, loved);
    } catch (err) {
      explain(err);
    }

    const body = [
      `**[${label(track)}](${trackUrl(artist, track)})**`,
      `by **${plain(artist)}**`,
      "",
      `-# ${loved ? "Loved" : "Removed from your loved tracks"} on **${plain(account.username)}**.`,
    ].join("\n");

    await paginate(ctx, card(loved ? "Loved" : "Unloved", body), EMBED_COLOR);
  };
}

async function scrobble(ctx: PrefixContext): Promise<void> {
  const account = await ownAccount(ctx);

  // Bounded per user: a bot that can write to Last.fm should not be able to
  // flood an account, whatever the caller types.
  const key = `trap:lf:scrobblerate:${ctx.authorId}`;
  let used = 0;
  try {
    used = await redis.incr(key);
    if (used === 1) await redis.expire(key, SCROBBLE_WINDOW);
  } catch {
    // Cache down: allow the scrobble rather than blocking on the limiter.
  }
  if (used > SCROBBLE_LIMIT) {
    throw new TargetError(
      `That is ${SCROBBLE_LIMIT} scrobbles in a minute. Give it a moment before the next one.`,
    );
  }

  const argument = ctx.argument.trim();
  if (!argument) {
    throw new TargetError("Give it as `,scrobble artist - track`.");
  }

  const parts = argument.split(PAIR_SEPARATOR);
  if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new TargetError("Give it as `artist - track`, with a space, a dash and a space.");
  }

  const artist = parts[0].trim();
  const track = parts.slice(1).join(" - ").trim();
  const timestamp = Math.floor(Date.now() / 1000);

  let result;
  try {
    result = await scrobbleTrack({ artist, track, timestamp }, account.sessionKey);
  } catch (err) {
    explain(err);
  }

  if (result.accepted < 1) {
    await paginate(
      ctx,
      card(
        "Not scrobbled",
        [
          `Last.fm declined **${plain(track)}** by **${plain(artist)}**.`,
          result.reason ? `\n-# ${plain(result.reason)}` : "",
          "\n-# Check the artist and track are spelled as Last.fm has them.",
        ].join(""),
      ),
      EMBED_COLOR,
    );
    return;
  }

  const body = [
    `**[${label(result.track ?? track)}](${trackUrl(artist, track)})**`,
    `by **${plain(result.artist ?? artist)}**`,
    "",
    `-# Scrobbled to **${plain(account.username)}** just now.`,
  ].join("\n");

  await paginate(ctx, card("Scrobbled", body), EMBED_COLOR);
  void MAX_BACKDATE_SECONDS;
}

/** Shows a track as playing without recording a play for it. */
async function nowScrobbling(ctx: PrefixContext): Promise<void> {
  const account = await ownAccount(ctx);
  const argument = ctx.argument.trim();
  if (!argument) throw new TargetError("Give it as `,playing artist - track`.");

  const parts = argument.split(PAIR_SEPARATOR);
  if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new TargetError("Give it as `artist - track`, with a space, a dash and a space.");
  }

  const artist = parts[0].trim();
  const track = parts.slice(1).join(" - ").trim();

  try {
    await updateNowPlaying({ artist, track }, account.sessionKey);
  } catch (err) {
    explain(err);
  }

  const body = [
    `**[${label(track)}](${trackUrl(artist, track)})**`,
    `by **${plain(artist)}**`,
    "",
    `-# Showing as playing on **${plain(account.username)}**. This does not add a play.`,
  ].join("\n");

  await paginate(ctx, card("Now playing", body), EMBED_COLOR);
}

export function registerScrobbling(): void {
  register({
    name: "love",
    aliases: ["fav", "heart"],
    description: "Love the track you are playing",
    handler: guard(loveCommand(true)),
  });
  register({
    name: "unlove",
    aliases: ["unfav", "unheart"],
    description: "Remove a track from your loved tracks",
    handler: guard(loveCommand(false)),
  });
  register({
    name: "scrobble",
    aliases: ["sc", "addscrobble"],
    description: "Scrobble a track from Discord",
    handler: guard(scrobble),
  });
  register({
    name: "setplaying",
    aliases: ["nowscrobbling"],
    description: "Show a track as playing without adding a play",
    handler: guard(nowScrobbling),
  });
}
