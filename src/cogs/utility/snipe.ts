import {
  onMessage,
  onMessageDelete,
  onMessageEdit,
  onReactionAdd,
  onReactionRemove,
  type MessageEvent,
} from "../../core/hooks.js";
import { notice, requireGuild, requireManageMessages } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { clearSnipes, provideSnipes, snipeable } from "../../core/sniping.js";
import { plain } from "../../helpers/markdown.js";
import {
  clear,
  deletedIn,
  editedIn,
  forget,
  noteDeleted,
  noteEdited,
  noteReaction,
  noteRemoved,
  reactionsOn,
  recall,
  remember,
  removedIn,
  type Seen,
} from "./store.js";

const HEADING = "Snipe";

const BODY_LIMIT = 1200;

const LINK = /channels\/(?:\d{15,25}|@me)\/(\d{15,25})\/(\d{15,25})/;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function quote(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "*No text.*";
  const cut = trimmed.length > BODY_LIMIT ? trimmed.slice(0, BODY_LIMIT) + "..." : trimmed;
  return cut
    .split("\n")
    .map((line) => "> " + plain(line))
    .join("\n");
}

function when(at: number): string {
  return `<t:${Math.floor(at / 1000)}:R>`;
}

function attached(files: string[]): string {
  if (files.length === 0) return "";
  return `-# ${files.length === 1 ? "Attachment" : "Attachments"}: ${files
    .map((name) => `\`${name.replace(/`/g, "'")}\``)
    .join(" · ")}`;
}

function nth(argument: string, total: number): number | null {
  const raw = argument.trim().split(/\s+/)[0] ?? "";
  if (!raw) return 0;

  const wanted = Number.parseInt(raw, 10);
  if (!Number.isFinite(wanted) || wanted < 1) return null;
  return wanted > total ? null : wanted - 1;
}

function counted(index: number, total: number): string {
  return total > 1 ? `-# ${index + 1} of ${total}` : "";
}

async function allowed(ctx: PrefixContext, guildId: string): Promise<boolean> {
  if (await snipeable(guildId, ctx.channelId)) return true;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Sniping is switched off in this channel.",
      "",
      "-# A server manager set `filter snipe`.",
    ].join("\n"),
  );
  return false;
}

async function snipe(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "snipe a message");
  if (!guildId || !(await allowed(ctx, guildId))) return;

  const held = deletedIn(ctx.channelId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "Nothing has been deleted here recently."].join("\n"));
    return;
  }

  const index = nth(ctx.argument, held.length);
  if (index === null) {
    await card(
      ctx,
      [`### ${HEADING}`, `There ${held.length === 1 ? "is" : "are"} only ${held.length} to choose from.`].join("\n"),
    );
    return;
  }

  const entry = held[index] as (typeof held)[number];
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@${entry.authorId}> · deleted, sent ${when(entry.at)}`,
      "",
      quote(entry.content),
      attached(entry.files),
      counted(index, held.length),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function editSnipe(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "snipe an edit");
  if (!guildId || !(await allowed(ctx, guildId))) return;

  const held = editedIn(ctx.channelId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "Nothing has been edited here recently."].join("\n"));
    return;
  }

  const index = nth(ctx.argument, held.length);
  if (index === null) {
    await card(
      ctx,
      [`### ${HEADING}`, `There ${held.length === 1 ? "is" : "are"} only ${held.length} to choose from.`].join("\n"),
    );
    return;
  }

  const entry = held[index] as (typeof held)[number];
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@${entry.authorId}> · edited ${when(entry.at)}`,
      "",
      "**Before**",
      quote(entry.before),
      "**After**",
      quote(entry.content),
      counted(index, held.length),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function reactionSnipe(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "snipe a reaction");
  if (!guildId || !(await allowed(ctx, guildId))) return;

  const entry = removedIn(ctx.channelId)[0];
  if (!entry) {
    await card(ctx, [`### ${HEADING}`, "No reaction has been removed here recently."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@${entry.userId}> removed ${plain(entry.emoji)} ${when(entry.at)}`,
      "",
      `-# On [this message](https://discord.com/channels/${guildId}/${ctx.channelId}/${entry.messageId})`,
    ].join("\n"),
  );
}

async function clearSnipe(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "clear the snipes");
  if (!guildId) return;

  const gone = clearSnipes(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone === 0
        ? "There was nothing stored to clear."
        : `Cleared ${gone} stored ${gone === 1 ? "entry" : "entries"}.`,
      "",
      "-# Deleted messages, edits and reactions, across every channel in this server.",
    ].join("\n"),
  );
}

async function reactionHistory(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "see the reaction history");
  if (!guildId) return;

  const token = ctx.argument.trim();
  const match = LINK.exec(token);
  const messageId = match?.[2] ?? (/^\d{15,25}$/.test(token) ? token : null);

  if (!messageId) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give me a message link.",
        "",
        "-# `snipe reactionhistory <link>` · right click a message and Copy Message Link.",
      ].join("\n"),
    );
    return;
  }

  const held = reactionsOn(messageId);
  if (!held || held.list.length === 0) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Nothing is logged for that message.",
        "",
        "-# Only reactions seen since the bot last started are kept.",
      ].join("\n"),
    );
    return;
  }

  if (held.guildId !== guildId) {
    await card(ctx, [`### ${HEADING}`, "That message is not in this server."].join("\n"));
    return;
  }

  const rows = held.list
    .slice(-20)
    .reverse()
    .map(
      (entry) =>
        `${entry.added ? "added" : "removed"} ${plain(entry.emoji)} · <@${entry.userId}> ${when(entry.at)}`,
    );

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `${held.list.length} logged ${held.list.length === 1 ? "reaction" : "reactions"}`,
      "",
      rows.join("\n"),
      held.list.length > rows.length ? `-# Showing the most recent ${rows.length}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function seenFrom(event: MessageEvent): Seen {
  return {
    messageId: event.messageId,
    authorId: event.authorId,
    content: event.content,
    files: event.attachments.map((file) => file.filename ?? "file").filter(Boolean),
  };
}

export function registerSnipe(): void {
  provideSnipes({ clear, forget });

  onMessage(async (event) => {
    remember(event.guildId, event.channelId, seenFrom(event));
  }, "snipe");

  onMessageDelete(async (event) => {
    const seen = recall(event.channelId, event.messageId);
    if (!seen) return;
    forget(event.channelId, event.messageId);
    if (!(await snipeable(event.guildId, event.channelId))) return;
    noteDeleted(event.guildId, event.channelId, seen);
  });

  onMessageEdit(async (event) => {
    const seen = recall(event.channelId, event.messageId);
    if (!seen || seen.content === event.content) return;

    remember(event.guildId, event.channelId, { ...seen, content: event.content });
    if (!(await snipeable(event.guildId, event.channelId))) return;
    noteEdited(
      event.guildId,
      event.channelId,
      { ...seen, content: event.content },
      seen.content,
    );
  });

  onReactionAdd(async (event) => {
    if (!event.guildId || !event.emoji) return;
    noteReaction(event.guildId, event.channelId, event.messageId, {
      userId: event.userId,
      emoji: event.emoji,
      added: true,
      at: Date.now(),
    });
  }, "snipe");

  onReactionRemove(async (event) => {
    if (!event.guildId || !event.emoji) return;
    noteReaction(event.guildId, event.channelId, event.messageId, {
      userId: event.userId,
      emoji: event.emoji,
      added: false,
      at: Date.now(),
    });
    if (!(await snipeable(event.guildId, event.channelId))) return;
    noteRemoved(event.guildId, event.channelId, {
      messageId: event.messageId,
      userId: event.userId,
      emoji: event.emoji,
      at: Date.now(),
    });
  }, "snipe");

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("snipe", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await snipe(ctx);
  };

  register({
    name: "snipe",
    aliases: ["s"],
    description: "Show the last message deleted here",
    handler,
  });

  groupUnder("snipe", () => {
    register({
      name: "edit",
      aliases: ["editsnipe", "e"],
      description: "Show the last message edited here",
      handler: editSnipe,
    });

    register({
      name: "reaction",
      aliases: ["reactionsnipe", "rs"],
      description: "Show the last reaction removed here",
      handler: reactionSnipe,
    });

    register({
      name: "clear",
      aliases: ["clearsnipe", "reset"],
      description: "Clear every stored snipe in this server",
      handler: clearSnipe,
    });

    register({
      name: "reactionhistory",
      aliases: ["history", "rh"],
      description: "Every reaction logged for one message",
      handler: reactionHistory,
    });
  });
}
