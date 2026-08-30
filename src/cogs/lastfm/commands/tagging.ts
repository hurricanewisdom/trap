/**
 * Your own tags: adding them, removing them, and reading them back.
 *
 * These write to the caller's Last.fm account, so every one needs a session
 * key and acts only on the caller — see session.ts for why there is no way to
 * name somebody else here.
 *
 * Reading the *crowd's* tags needs no authorisation and lives in
 * tagbrowser.ts.
 */

import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  MAX_TAGS_PER_CALL,
  addTags,
  getPersonalTags,
  getUserTagsFor,
  getUserTopTags,
  removeTag,
  type TaggableKind,
} from "../api/index.js";
import { explain, ownAccount } from "../session.js";
import {
  EMBED_COLOR,
  TargetError,
  albumUrl,
  artistUrl,
  buildPages,
  currentArtist,
  currentPair,
  label,
  plain,
  resolveTarget,
  simpleCard,
  splitPair,
  trackUrl,
  url,
} from "../shared.js";

const tagUrl = (tag: string) => `https://www.last.fm/tag/${encodeURIComponent(tag)}`;

/** Last.fm silently ignores an over-long tag, so it is refused up front. */
const MAX_TAG_LENGTH = 100;

/**
 * Splits the part after `|` into individual tags.
 *
 * Commas and semicolons both separate, because people type both, and a tag
 * containing a comma is not representable in Last.fm's own API anyway.
 */
function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Reads "`<subject>` | `<tags>`" and works out what kind of thing the subject
 * is: `artist - track` is a track, a bare name is an artist. Albums need the
 * explicit `,tagalbum`, because "Radiohead - Kid A" cannot be told apart from
 * a track by looking at it.
 */
function parseSubject(argument: string): { subject: string; tags: string } {
  const [subject = "", tags = ""] = argument.split("|", 2);
  return { subject: subject.trim(), tags: tags.trim() };
}

interface Target {
  kind: TaggableKind;
  params: { artist: string; album?: string; track?: string };
  /** How to describe it in a reply. */
  name: string;
  link: string;
}

/** Resolves the thing being tagged, defaulting to what the caller is playing. */
async function resolveSubject(
  ctx: PrefixContext,
  subject: string,
  kind: TaggableKind,
): Promise<Target> {
  if (kind === "artist") {
    const artist = subject || (await currentArtist(ctx));
    return { kind, params: { artist }, name: artist, link: artistUrl(artist) };
  }

  const pair = (subject ? splitPair(subject) : null) ?? (await currentPair(ctx, kind));
  const [artist, second] = pair;

  if (kind === "album") {
    return {
      kind,
      params: { artist, album: second },
      name: `${second} by ${artist}`,
      link: albumUrl(artist, second),
    };
  }
  return {
    kind,
    params: { artist, track: second },
    name: `${second} by ${artist}`,
    link: trackUrl(artist, second),
  };
}

/** Builds the `,tag` / `,tagalbum` / `,tagtrack` handlers. */
function tagCommand(kind: TaggableKind) {
  return async (ctx: PrefixContext): Promise<void> => {
    const { subject, tags: rawTags } = parseSubject(ctx.argument);
    if (!rawTags) {
      throw new TargetError(
        `Give the tags after a \`|\`, e.g. \`,${kind === "artist" ? "tagartist" : `tag${kind}`} ${
          kind === "artist" ? "Radiohead" : "Radiohead - Kid A"
        } | shoegaze, ambient\`.`,
      );
    }

    const tags = parseTags(rawTags);
    if (tags.length === 0) throw new TargetError("No usable tags in that list.");
    if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
      throw new TargetError(`Keep each tag under ${MAX_TAG_LENGTH} characters.`);
    }

    const account = await ownAccount(ctx);
    const target = await resolveSubject(ctx, subject, kind);

    try {
      await addTags(kind, target.params, tags, account.sessionKey);
    } catch (err) {
      explain(err);
    }

    const applied = tags.slice(0, MAX_TAGS_PER_CALL);
    const dropped = tags.length - applied.length;

    await paginate(
      ctx,
      simpleCard(
        "Tagged",
        `Tagged **[${label(target.name)}](${target.link})** as ` +
          applied.map((tag) => `\`${plain(tag)}\``).join(" ") +
          (dropped > 0 ? `\n-# Last.fm takes ${MAX_TAGS_PER_CALL} tags at a time; ${dropped} were not sent.` : ""),
      ),
      EMBED_COLOR,
    );
  };
}

/** Builds the `,untag` / `,untagalbum` / `,untagtrack` handlers. */
function untagCommand(kind: TaggableKind) {
  return async (ctx: PrefixContext): Promise<void> => {
    const { subject, tags: rawTag } = parseSubject(ctx.argument);
    if (!rawTag) throw new TargetError("Give the tag to remove after a `|`.");

    const [tag] = parseTags(rawTag);
    if (!tag) throw new TargetError("No usable tag in that.");

    const account = await ownAccount(ctx);
    const target = await resolveSubject(ctx, subject, kind);

    try {
      // Last.fm takes exactly one tag per call here, unlike addTags.
      await removeTag(kind, target.params, tag, account.sessionKey);
    } catch (err) {
      explain(err);
    }

    await paginate(
      ctx,
      simpleCard(
        "Untagged",
        `Removed \`${plain(tag)}\` from **[${label(target.name)}](${target.link})**.`,
      ),
      EMBED_COLOR,
    );
  };
}

/** `,mytags [user]` — the tags a listener uses most. */
async function myTags(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const tags = await getUserTopTags(target.username, 100);
  const heading = `${target.username}'s tags`;

  if (tags.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, "No tags yet. `,tagartist <artist> | <tags>` adds one."),
      EMBED_COLOR,
    );
    return;
  }

  const rows = tags.map((tag, index) => {
    const count = Number(tag.count ?? 0);
    return (
      `\`${index + 1}\` **[${label(tag.name)}](${url(tag.url, tagUrl(tag.name))})**` +
      (count ? ` · used ${count.toLocaleString("en-US")} times` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: target.username, noun: "tags", total: tags.length }),
    EMBED_COLOR,
  );
}

/**
 * `,tagged <tag> [artists|albums|tracks] [user]` — everything one listener has
 * filed under a tag of their own.
 */
async function tagged(ctx: PrefixContext): Promise<void> {
  const words = ctx.argument.trim().split(/\s+/).filter(Boolean);

  const kinds: Record<string, TaggableKind> = {
    artist: "artist",
    artists: "artist",
    album: "album",
    albums: "album",
    track: "track",
    tracks: "track",
    song: "track",
    songs: "track",
  };
  const kindAt = words.findIndex((word) => kinds[word.toLowerCase()] !== undefined);
  const kind: TaggableKind = kindAt === -1 ? "artist" : (kinds[(words[kindAt] ?? "").toLowerCase()] ?? "artist");
  const remaining = words.filter((_, index) => index !== kindAt);

  const { target, rest } = await resolveTarget(ctx, remaining.join(" "));
  const tag = rest.trim();
  if (!tag) throw new TargetError("Name one of your tags, e.g. `,taggedwith shoegaze albums`.");

  const { items, total } = await getPersonalTags(target.username, tag, kind, 100);
  const heading = `${target.username}'s "${tag}" ${kind}s`;

  if (items.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, `Nothing of theirs is tagged **${plain(tag)}** as ${kind}s.`),
      EMBED_COLOR,
    );
    return;
  }

  const rows = items.map((item, index) => {
    const by = item.artist?.name ?? "";
    const link =
      kind === "artist"
        ? artistUrl(item.name)
        : kind === "album"
          ? albumUrl(by, item.name)
          : trackUrl(by, item.name);
    return (
      `\`${index + 1}\` **[${label(item.name)}](${url(item.url, link)})**` +
      (by ? `\n-# ${plain(by)}` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      noun: `${kind}s`,
      total: total || items.length,
    }),
    EMBED_COLOR,
  );
}

/** `,mytagsfor [artist]` — your own tags on one artist, which only you see. */
async function myTagsFor(ctx: PrefixContext): Promise<void> {
  const { target, rest } = await resolveTarget(ctx, ctx.argument);
  const artist = rest.trim() || (await currentArtist(ctx));

  const tags = await getUserTagsFor("artist", target.username, { artist });
  const heading = `${target.username}'s tags on ${artist}`;

  if (tags.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, `No personal tags on **${plain(artist)}**. \`,tag ${plain(artist)} | <tags>\` adds some.`),
      EMBED_COLOR,
    );
    return;
  }

  await paginate(
    ctx,
    simpleCard(
      heading,
      tags.map((tag) => `**[${label(tag.name)}](${url(tag.url, tagUrl(tag.name))})**`).join(" · "),
    ),
    EMBED_COLOR,
  );
}

export function registerTagging(): void {
  register({
    name: "tagartist",
    aliases: ["addtag", "taga"],
    description: "Tag an artist on your Last.fm account",
    handler: guard(tagCommand("artist")),
  });
  register({
    name: "tagalbum",
    aliases: ["addalbumtag"],
    description: "Tag an album on your Last.fm account",
    handler: guard(tagCommand("album")),
  });
  register({
    name: "tagtrack",
    aliases: ["addtracktag"],
    description: "Tag a track on your Last.fm account",
    handler: guard(tagCommand("track")),
  });
  register({
    name: "untag",
    aliases: ["untagartist", "removetag"],
    description: "Remove one of your tags from an artist",
    handler: guard(untagCommand("artist")),
  });
  register({
    name: "untagalbum",
    aliases: [],
    description: "Remove one of your tags from an album",
    handler: guard(untagCommand("album")),
  });
  register({
    name: "untagtrack",
    aliases: [],
    description: "Remove one of your tags from a track",
    handler: guard(untagCommand("track")),
  });
  register({
    name: "mytags",
    aliases: ["usertags", "yourtags"],
    description: "The tags you use most",
    handler: guard(myTags),
  });
  register({
    name: "taggedwith",
    aliases: ["mytagged", "filedunder"],
    description: "What you have filed under one of your tags",
    handler: guard(tagged),
  });
  register({
    name: "mytagsfor",
    aliases: ["tagson"],
    description: "Your own tags on one artist",
    handler: guard(myTagsFor),
  });
}
