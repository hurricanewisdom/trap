import { deleteMessage, editMessage, getGuild, sendFile, sendMessage } from "../../../core/discord.js";
import { onMessage, type MessageEvent } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import { matchPrefix } from "../../../core/prefixes.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { paginateWith } from "../../../core/pager.js";
import { resolveAccent } from "../../../core/accent.js";
import {
  IS_COMPONENTS_V2,
  accented,
  gallery,
  text,
} from "../../../helpers/components.js";
import { switchWord } from "../../../helpers/flags.js";
import { compact, plain } from "../../../helpers/markdown.js";
import { grab, probe, type Facts } from "./download.js";
import { readAlbum, readCard, resolved } from "./opengraph.js";
import { SITE_NAMES, albumFor, countsUrl, findLink, hostedAt, isShort } from "./sites.js";
import { settings, save, type Settings } from "./store.js";

const HEADING = "Reposter";

const SUPPRESS_EMBEDS = 1 << 2;

const COOLDOWN_MS = 3000;

const SEEN = 3000;

const fired = new Map<string, number>();

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function offCooldown(channelId: string, userId: string): boolean {
  const key = `${channelId}:${userId}`;
  const now = Date.now();
  if (now - (fired.get(key) ?? 0) < COOLDOWN_MS) return false;

  fired.set(key, now);
  if (fired.size > SEEN) {
    for (const [held, at] of fired) if (now - at > COOLDOWN_MS) fired.delete(held);
  }
  return true;
}

const MB = 1024 * 1024;

// Nothing this long fits an upload, so the download slot is not spent on it.
const MAX_SECONDS = 45 * 60;

function uploadCap(tier: number): number {
  const whole = tier >= 3 ? 100 * MB : tier >= 2 ? 50 * MB : 10 * MB;
  return Math.floor(whole * 0.9);
}

const COUNTS: { key: keyof Facts; icon: string; label: string }[] = [
  { key: "views", icon: "👁️", label: "views" },
  { key: "likes", icon: "❤️", label: "likes" },
  { key: "comments", icon: "💬", label: "comments" },
  { key: "shares", icon: "🔁", label: "shares" },
];

// Only the counts a site actually reports are shown, so tiktok gets shares and
// youtube does not, rather than a row of zeroes.
function stats(facts: Facts): string {
  return COUNTS.map((one) => {
    const value = facts[one.key];
    return typeof value === "number" ? `${one.icon}${one.label}: ${compact(value)}` : null;
  })
    .filter(Boolean)
    .join(" · ");
}

// The caption is the same whichever route produced the video, so a repost never
// reads differently depending on which one answered.
function caption(event: MessageEvent, facts: Facts, held: Settings): string {
  if (!held.embed) return "";

  const line = stats(facts);
  return [
    facts.title ? "**" + plain(facts.title.slice(0, 120)) + "**" : "",
    facts.uploader
      ? "-# " + plain(facts.uploader) + (line ? " · " + line : "")
      : line
        ? "-# " + line
        : "",
    "-# posted by <@" + event.authorId + ">",
  ]
    .filter(Boolean)
    .join("\n");
}

// A photo post has no video in it at all, so it is paged rather than uploaded:
// the images are public URLs the fixer generates, which Discord fetches itself.
// Nothing is downloaded and nothing is attached.
async function postAlbum(
  event: MessageEvent,
  url: string,
  numbers: string | null,
  held: Settings,
): Promise<boolean> {
  const album = await readAlbum(url);
  if (!album || album.images.length === 0) return false;

  // The photos and the numbers live in different places. The fixer lists the
  // images; yt-dlp will not touch a photo post but answers happily for the same
  // id asked for as a video, and that is where the counts are.
  const facts = numbers ? await probe(numbers) : null;
  const line = facts ? stats(facts) : "";

  const heading = [
    album.title ? "**" + plain(album.title.slice(0, 120)) + "**" : "",
    album.uploader
      ? "-# " + plain(album.uploader) + (line ? " · " + line : "")
      : line
        ? "-# " + line
        : "",
  ].filter(Boolean);

  const pages = album.images.map((image, at) => [
    ...(held.embed && heading.length > 0 ? [text(heading.join("\n"))] : []),
    gallery({ url: image }),
    text(
      "-# photo " +
        (at + 1) +
        " of " +
        album.images.length +
        (held.embed ? " · posted by <@" + event.authorId + ">" : ""),
    ),
  ]);

  const posted = await paginateWith(
    async (body) => {
      const sent = await sendMessage(event.channelId, {
        ...body,
        allowed_mentions: { parse: [] },
      });
      return sent.ok ? sent.data : null;
    },
    event.channelId,
    event.authorId,
    pages,
    null,
    held.container,
  );
  return posted !== null;
}

async function deliver(
  event: MessageEvent,
  found: NonNullable<ReturnType<typeof findLink>>,
  held: Settings,
): Promise<boolean> {
  const guild = await getGuild(event.guildId);
  const cap = uploadCap(Number(guild?.premium_tier ?? 0));

  // A short link says nothing about what it points at, and tiktok's resolve to
  // either a video or a photo post, which need entirely different handling. So it
  // is followed first, and everything after this works on where it landed.
  const target = isShort(found.site, found.original)
    ? await resolved(found.original)
    : found.original;

  const album = albumFor(found.site, target);
  if (album && (await postAlbum(event, album, countsUrl(found.site, target), held))) return true;

  const fixer = found.site.through ? hostedAt(target, found.site.through) : null;

  // The site itself first. Reddit answers this address with 403 whatever is asked
  // of it, so when the site refuses, the rewrite host is asked instead: it serves
  // the video and the counts that the site would not.
  let facts = await probe(target);
  let source = target;
  if (!facts && fixer) {
    const card = await readCard(fixer);
    if (card) {
      facts = card.facts;
      // The file the fixer advertises, not the fixer's page: fetching that page
      // as a downloader would follow its redirect straight back to the site that
      // is refusing us.
      source = card.media ?? fixer;

      // Whichever host serves the file may publish no numbers at all, so a second
      // one is read for those alone. Only in this path, which is already the slow
      // one, and only when the first came back empty.
      const bare = facts.views === null && facts.likes === null && facts.comments === null;
      const elsewhere = bare && found.site.figures ? hostedAt(target, found.site.figures) : null;
      if (elsewhere) {
        const more = await readCard(elsewhere);
        if (more) {
          facts = {
            ...facts,
            title: facts.title || more.facts.title,
            uploader: facts.uploader || more.facts.uploader,
            views: more.facts.views,
            likes: more.facts.likes,
            comments: more.facts.comments,
            shares: more.facts.shares,
          };
        }
      }
    }
  }

  const tooLong = facts !== null && facts.duration !== null && facts.duration > MAX_SECONDS;
  // Deliberately not checked against `facts.bytes`: that is the size of the best
  // format on offer, not of the one actually requested. Youtube reports 232MB for
  // a video this downloads at 20MB, which rejected every youtube link before it
  // was ever tried. The real ceiling is enforced during the download instead.
  if (facts && !tooLong) {
    const file = await grab(source, cap);
    if (file) {
      const words = caption(event, facts, held);
      const boxed = {
        flags: IS_COMPONENTS_V2,
        components: [
          accented(
            {
              type: 17,
              components: [
                ...(words ? [text(words)] : []),
                gallery({ url: `attachment://${file.name}` }),
              ],
            },
            resolveAccent(null),
          ),
        ],
        allowed_mentions: { parse: [] },
      };
      const bare = { content: words || undefined, allowed_mentions: { parse: [] } };

      const sent = await sendFile(event.channelId, held.container ? boxed : bare, {
        name: file.name,
        body: file.body,
      });
      if (sent.ok) return true;
    }
  }

  // Most sites have no rewrite host, and Discord plays several of them already,
  // so there is nothing useful left to fall back to
  if (!fixer) return false;

  // Always plain, even with the container switched on: a Components V2 message
  // carries no content for Discord to unfurl, and the whole point of falling back
  // to a link is that Discord turns it into a player.
  //
  // The counts go on the link too, so a repost carries the same numbers whether
  // the file made it through or not.
  const line = facts ? stats(facts) : "";
  const body = held.embed
    ? [fixer, line ? "-# " + line : "", "-# from <@" + event.authorId + ">"]
        .filter(Boolean)
        .join("\n")
    : fixer;
  const sent = await sendMessage(event.channelId, {
    content: body,
    allowed_mentions: { parse: [] },
  });
  return sent.ok;
}

async function repost(event: MessageEvent): Promise<void> {
  if (!event.content) return;

  const held = await settings(event.guildId);
  if (!held.enabled) return;

  let content = event.content;
  if (held.prefixed) {
    const used = await matchPrefix(content, event.guildId);
    if (used === null) return;
    content = content.slice(used.length).trim();
  }

  const found = findLink(content, held.strict);
  if (!found) return;
  if (!offCooldown(event.channelId, event.authorId)) return;

  const sent = await deliver(event, found, held);
  if (!sent) return;

  if (held.wipe) {
    await deleteMessage(event.channelId, event.messageId);
    return;
  }
  if (held.suppress) {
    await editMessage(event.channelId, event.messageId, { flags: SUPPRESS_EMBEDS });
  }
}

interface Toggle {
  name: string;
  field: keyof Settings;
  describes: string;
  on: string;
  off: string;
}

const TOGGLES: Toggle[] = [
  {
    name: "embed",
    field: "embed",
    describes: "the line naming who posted it",
    on: "Reposts say who posted the link.",
    off: "Reposts are the link on its own.",
  },
  {
    name: "strict",
    field: "strict",
    describes: "matching a link anywhere in a message",
    on: "A link anywhere in a message is reposted.",
    off: "Only a message that is nothing but the link is reposted.",
  },
  {
    name: "suppress",
    field: "suppress",
    describes: "hiding the original preview",
    on: "The original message's own preview is hidden.",
    off: "The original preview is left alone.",
  },
  {
    name: "delete",
    field: "wipe",
    describes: "deleting the original message",
    on: "The original message is deleted after reposting.",
    off: "The original message is kept.",
  },
  {
    name: "container",
    field: "container",
    describes: "drawing a box around the repost",
    on: "Reposts are drawn inside a container.",
    off: "Reposts are posted plainly, with no container.",
  },
  {
    name: "prefix",
    field: "prefixed",
    describes: "requiring a prefix before the link",
    on: "Only a link written after a server prefix is reposted.",
    off: "Any matching link is reposted.",
  },
];

function state(held: Settings): string {
  return [
    held.enabled ? "On." : "Off.",
    `-# who posted it: ${held.embed ? "shown" : "hidden"}`,
    `-# links anywhere in a message: ${held.strict ? "on" : "off"}`,
    `-# original preview: ${held.suppress ? "hidden" : "kept"}`,
    `-# original message: ${held.wipe ? "deleted" : "kept"}`,
    `-# container: ${held.container ? "drawn" : "none"}`,
    `-# prefix required: ${held.prefixed ? "yes" : "no"}`,
  ].join("\n");
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change the reposter");
  if (!guildId) return;

  const wanted = switchWord(ctx.argument.trim().split(/\s+/)[0] ?? "");
  const held = wanted === null ? await settings(guildId) : await save(guildId, { enabled: wanted });

  await card(
    ctx,
    [
      `### ${HEADING}`,
      state(held),
      "",
      "`reposter on` or `off` switches the whole thing",
      TOGGLES.map((one) => `\`reposter ${one.name} on\` or \`off\` · ${one.describes}`).join("\n"),
      "",
      `-# Downloads and reposts: ${SITE_NAMES.join(", ")}.`,
      "-# Where a site refuses, the link is rewritten instead so Discord still plays it.",
    ].join("\n"),
  );
}

function toggler(one: Toggle): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageGuild(ctx, `change ${one.describes}`);
    if (!guildId) return;

    const wanted = switchWord(ctx.argument.trim().split(/\s+/)[0] ?? "");
    if (wanted === null) {
      const held = await settings(guildId);
      await card(
        ctx,
        [
          `### ${HEADING}`,
          held[one.field] ? one.on : one.off,
          "",
          `-# \`reposter ${one.name} on\` or \`off\``,
        ].join("\n"),
      );
      return;
    }

    await save(guildId, { [one.field]: wanted } as Partial<Settings>);
    await card(ctx, [`### ${HEADING}`, wanted ? one.on : one.off].join("\n"));
  };
}

export function registerReposter(): void {
  // Not awaited: emitMessage runs handlers in order, and a download takes
  // seconds, which would hold up the filter and everything after it.
  onMessage(async (event) => {
    void repost(event).catch((err) => console.error("repost failed:", err));
  }, "reposter");

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("reposter", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "reposter",
    aliases: ["repost"],
    description: "Repost social media links so the video plays",
    handler,
  });

  groupUnder("reposter", () => {
    for (const one of TOGGLES) {
      register({
        name: one.name,
        description: `Switch ${one.describes}`,
        handler: toggler(one),
      });
    }
  });
}
