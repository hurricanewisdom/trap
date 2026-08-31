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
import { switchWord } from "../../../helpers/flags.js";
import { compact, plain } from "../../../helpers/markdown.js";
import { grab, probe, type Facts } from "./download.js";
import { SITE_NAMES, findLink } from "./sites.js";
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

function stats(facts: Facts): string {
  return [
    facts.views === null ? null : compact(facts.views) + " views",
    facts.likes === null ? null : compact(facts.likes) + " likes",
    facts.comments === null ? null : compact(facts.comments) + " comments",
    facts.shares === null ? null : compact(facts.shares) + " shares",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Sends the video itself, falling back to the rewritten link when the site will
// not give it up, the file is too big, or yt-dlp is not installed. That fallback
// matters: a reposter that goes quiet whenever an extractor breaks is worse than
// one that posts a link which plays.
async function deliver(
  event: MessageEvent,
  found: NonNullable<ReturnType<typeof findLink>>,
  held: Settings,
): Promise<boolean> {
  const guild = await getGuild(event.guildId);
  const cap = uploadCap(Number(guild?.premium_tier ?? 0));

  const facts = await probe(found.original);
  const tooLong = facts !== null && facts.duration !== null && facts.duration > MAX_SECONDS;
  if (facts && !tooLong && (facts.bytes === null || facts.bytes <= cap)) {
    const file = await grab(found.original, cap);
    if (file) {
      const line = stats(facts);
      const caption = held.embed
        ? [
            facts.title ? "**" + plain(facts.title.slice(0, 120)) + "**" : "",
            facts.uploader ? "-# " + plain(facts.uploader) + (line ? " · " + line : "") : line ? "-# " + line : "",
            "-# posted by <@" + event.authorId + ">",
          ]
            .filter(Boolean)
            .join("\n")
        : "";

      const sent = await sendFile(
        event.channelId,
        { content: caption || undefined, allowed_mentions: { parse: [] } },
        { name: file.name, body: file.body },
      );
      if (sent.ok) return true;
    }
  }

  // Most sites have no rewrite host, and Discord plays several of them already,
  // so there is nothing useful left to fall back to
  if (!found.rewritten || found.rewritten === found.original) return false;

  const body = held.embed
    ? found.rewritten + "\n-# from <@" + event.authorId + ">"
    : found.rewritten;
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
