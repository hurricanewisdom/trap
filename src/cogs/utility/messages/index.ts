import {
  channelMessages,
  pinMessage,
  pinnedMessages,
  unpinMessage,
} from "../../../core/discord.js";
import { notice, requireGuild, requireManageMessages } from "../../../core/permissions.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { plain } from "../../../helpers/markdown.js";

const HEADING = "Messages";

const LINK = /channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

const CHANNEL = /^<#(\d{15,25})>$/;

const PIN_CAP = 50;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function jump(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function targetMessage(argument: string, guildId: string): string | null {
  const match = LINK.exec(argument.trim());
  if (match && match[1] === guildId) return match[3] as string;
  const bare = argument.trim();
  return /^\d{15,25}$/.test(bare) ? bare : null;
}

async function pin(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "pin a message");
  if (!guildId) return;

  let messageId = targetMessage(ctx.argument, guildId);
  if (!messageId) {
    if (ctx.argument.trim()) {
      await card(
        ctx,
        [`### ${HEADING}`, "That is not a message link from this server.", "", "-# `pin` on its own takes the last message."].join("\n"),
      );
      return;
    }
    const recent = await channelMessages(ctx.channelId, "limit=5");
    const found = (recent ?? []).find((message) => message.id !== ctx.messageId);
    if (!found) {
      await card(ctx, [`### ${HEADING}`, "There is nothing here to pin."].join("\n"));
      return;
    }
    messageId = found.id;
  }

  const held = await pinnedMessages(ctx.channelId);
  if (held && held.length >= PIN_CAP) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `This channel already holds Discord's limit of ${PIN_CAP} pins.`,
        "",
        "-# `pins archive` clears them into the archive channel.",
      ].join("\n"),
    );
    return;
  }

  const done = await pinMessage(ctx.channelId, messageId, `Pinned by ${ctx.authorId}`);
  await card(
    ctx,
    done.ok
      ? [`### ${HEADING}`, `[That message](${jump(guildId, ctx.channelId, messageId)}) is pinned.`].join("\n")
      : [`### ${HEADING}`, "I could not pin it.", `-# ${done.message.slice(0, 160)}`].join("\n"),
  );
}

async function unpin(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "unpin a message");
  if (!guildId) return;

  let messageId = targetMessage(ctx.argument, guildId);
  if (!messageId) {
    if (ctx.argument.trim()) {
      await card(ctx, [`### ${HEADING}`, "That is not a message link from this server."].join("\n"));
      return;
    }
    const held = await pinnedMessages(ctx.channelId);
    const newest = (held ?? [])[0];
    if (!newest) {
      await card(ctx, [`### ${HEADING}`, "Nothing is pinned here."].join("\n"));
      return;
    }
    messageId = newest.id;
  }

  const done = await unpinMessage(ctx.channelId, messageId, `Unpinned by ${ctx.authorId}`);
  await card(
    ctx,
    done.ok
      ? [`### ${HEADING}`, "That message is no longer pinned."].join("\n")
      : [`### ${HEADING}`, "I could not unpin it.", `-# ${done.message.slice(0, 160)}`].join("\n"),
  );
}

async function firstMessage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "look up the first message");
  if (!guildId) return;

  const mention = CHANNEL.exec(ctx.argument.trim());
  const channelId = mention ? (mention[1] as string) : ctx.channelId;

  const oldest = await channelMessages(channelId, "after=0&limit=1");
  const found = (oldest ?? [])[0];
  if (!found) {
    await card(
      ctx,
      [`### ${HEADING}`, "I cannot read that channel, or it has no messages."].join("\n"),
    );
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `The first message in <#${channelId}>`,
      "",
      `<@${found.author?.id ?? "0"}> · [jump](${jump(guildId, channelId, found.id)})`,
      found.content ? `-# ${plain(found.content.replace(/\n/g, " ").slice(0, 140))}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function registerMessages(): void {
  register({ name: "pin", description: "Pin the last message, or one by link", handler: pin });
  register({ name: "unpin", description: "Unpin a message", handler: unpin });
  register({
    name: "firstmessage",
    aliases: ["first"],
    description: "Link the first message in a channel",
    handler: firstMessage,
  });
}
