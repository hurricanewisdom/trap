import { deleteMessage, editMessage, sendMessage } from "../../../core/discord.js";
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
import { SITES, findLink } from "./sites.js";
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

  const body = held.embed
    ? `${found.rewritten}\n-# from <@${event.authorId}>`
    : found.rewritten;

  const sent = await sendMessage(event.channelId, {
    content: body,
    allowed_mentions: { parse: [] },
  });
  if (!sent.ok) return;

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
      `-# Reposts ${SITES.map((site) => site.name).join(", ")} through a service that lets Discord play the video.`,
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
  onMessage(repost, "reposter");

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
