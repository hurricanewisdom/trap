import { getChannel } from "../../../core/discord.js";
import { notice, requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { VARIABLES, preview, unknownTokens } from "../greetings/variables.js";
import {
  ARCHIVE_CHOICES,
  DEFAULT_ARCHIVE,
  DEFAULT_NAME,
  MAX_CHANNELS,
  MAX_REACTIONS,
  MAX_SLOWMODE,
  addChannel,
  addReactionTo,
  allThreads,
  clearChannels,
  clearReactionsFor,
  removeChannel,
  removeReactionFrom,
  setField,
  threadFor,
} from "./store.js";
import { watchForThreads } from "./watch.js";

const HEADING = "Autothread";

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

const EMOJI = /^(?:<a?:[\w~]+:\d{15,25}>|\p{Extended_Pictographic}[\u{FE0F}\u{20E3}]*)$/u;

/** Text (0), announcement (5) and their voice text chat (2, 13) carry messages a
 * thread can hang off. A forum (15) has no channel-level messages, and a thread
 * (10-12) cannot hold another thread. */
const THREADABLE = new Set([0, 2, 5, 13]);

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function channelId(token: string): string | null {
  const mention = CHANNEL_MENTION.exec(token ?? "");
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token ?? "") ? token : null;
}

function minutes(value: number): string {
  if (value === 60) return "1 hour";
  if (value === 1440) return "1 day";
  if (value === 4320) return "3 days";
  return "1 week";
}

function seconds(value: number): string {
  if (value === 0) return "off";
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  return `${Math.round(value / 3600)}h`;
}

/**
 * Resolves the channel argument, or explains why it cannot be used.
 *
 * Every command in this group but `list`, `clear` and `variables` takes a
 * channel first, so the parsing and all four refusals live here once.
 */
async function target(
  ctx: PrefixContext,
  guildId: string,
  token: string | undefined,
  mustExist: boolean,
): Promise<string | null> {
  const id = channelId(token ?? "");
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "Name a channel, like `#general`."].join("\n"));
    return null;
  }

  if (mustExist) {
    const held = await threadFor(guildId, id);
    if (!held) {
      await card(
        ctx,
        [`### ${HEADING}`, `<#${id}> is not making threads.`, "", `-# \`autothread add <#${id}>\` starts it.`].join("\n"),
      );
      return null;
    }
    return id;
  }

  const channel = await getChannel(id);
  if (!channel) {
    await card(ctx, [`### ${HEADING}`, "I cannot see that channel."].join("\n"));
    return null;
  }
  if (!THREADABLE.has(channel.type ?? -1)) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        channel.type === 15 || channel.type === 16
          ? "A forum already makes a thread of every post, so there is nothing to add."
          : "Threads cannot be started on messages in that kind of channel.",
      ].join("\n"),
    );
    return null;
  }
  return id;
}

async function listBody(guildId: string): Promise<string> {
  const held = await allThreads(guildId);
  if (held.size === 0) {
    return [
      `### ${HEADING}`,
      "No channel is making threads.",
      "",
      "`autothread add #channel` starts one",
    ].join("\n");
  }

  const lines = [...held.values()].map((one) => {
    const bits = [
      `\`${one.name}\``,
      minutes(one.archiveMinutes),
      one.slowmodeSeconds ? `slowmode ${seconds(one.slowmodeSeconds)}` : "",
      one.script ? "with a message" : "",
      one.reactions.length ? one.reactions.join(" ") : "",
    ].filter(Boolean);
    return `<#${one.channelId}> — ${bits.join(" · ")}`;
  });

  return [
    `### ${HEADING}`,
    "A thread is started on every message in these channels.",
    lines.join("\n"),
    "",
    `-# ${held.size} of ${MAX_CHANNELS} · \`autothread remove #channel\` stops one`,
  ].join("\n");
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the automatic threads");
  if (!guildId) return;
  await card(ctx, await listBody(guildId));
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "list the automatic threads");
  if (!guildId) return;
  await card(ctx, await listBody(guildId));
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "start making threads in a channel");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], false);
  if (!id) return;

  // `name=` is how the spec writes it, so it is what the command takes. Anything
  // after the channel with no `name=` is treated as the name too, because typing
  // it that way is the obvious mistake.
  const rest = parts.slice(1).join(" ").trim();
  const named = /^name\s*=\s*(.+)$/is.exec(rest);
  const name = (named?.[1] ?? rest).trim() || DEFAULT_NAME;

  if (name.length > 100) {
    await card(ctx, [`### ${HEADING}`, "A thread name is 100 characters at most."].join("\n"));
    return;
  }

  const held = await allThreads(guildId);
  if (!held.has(id) && held.size >= MAX_CHANNELS) {
    await card(ctx, [`### ${HEADING}`, `That is ${MAX_CHANNELS} channels already.`].join("\n"));
    return;
  }

  const unknown = unknownTokens(name);
  await addChannel(guildId, id, name, held.get(id)?.archiveMinutes ?? DEFAULT_ARCHIVE);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Every message in <#${id}> gets a thread named \`${preview(name, { guildId, channelId: id, userId: ctx.authorId })}\`.`,
      unknown.length
        ? `-# \`${unknown.join("` `")}\` ${unknown.length === 1 ? "is not a variable, so it is" : "are not variables, so they are"} left as typed. \`autothread variables\` lists them.`
        : "",
      "",
      `-# Archives after ${minutes(held.get(id)?.archiveMinutes ?? DEFAULT_ARCHIVE)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "stop making threads in a channel");
  if (!guildId) return;

  const id = channelId(words(ctx.argument)[0] ?? "");
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "Name a channel, like `#general`."].join("\n"));
    return;
  }

  const gone = await removeChannel(guildId, id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone
        ? `<#${id}> no longer makes threads. The ones already made stay.`
        : `<#${id}> was not making threads.`,
    ].join("\n"),
  );
}

async function clear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "clear the automatic threads");
  if (!guildId) return;

  const count = await clearChannels(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      count === 0
        ? "No channel was making threads."
        : `${count} ${count === 1 ? "channel" : "channels"} stopped. The threads already made stay.`,
    ].join("\n"),
  );
}

async function archive(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change how long threads stay open");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], true);
  if (!id) return;

  const asked = Number.parseInt(parts[1] ?? "", 10);
  if (!ARCHIVE_CHOICES.includes(asked as (typeof ARCHIVE_CHOICES)[number])) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Discord allows four lengths, in minutes:",
        ARCHIVE_CHOICES.map((one) => `\`${one}\` — ${minutes(one)}`).join(" · "),
      ].join("\n"),
    );
    return;
  }

  await setField(guildId, id, "archive_minutes", asked);
  await card(
    ctx,
    [`### ${HEADING}`, `Threads in <#${id}> archive after ${minutes(asked)} of quiet.`].join("\n"),
  );
}

async function slowmode(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the slowmode on new threads");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], true);
  if (!id) return;

  const asked = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(asked) || asked < 0 || asked > MAX_SLOWMODE) {
    await card(
      ctx,
      [`### ${HEADING}`, `Give a number of seconds from 0 to ${MAX_SLOWMODE} (six hours).`].join("\n"),
    );
    return;
  }

  await setField(guildId, id, "slowmode_seconds", asked);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      asked === 0
        ? `New threads in <#${id}> have no slowmode.`
        : `New threads in <#${id}> start with a ${seconds(asked)} slowmode.`,
      "-# Threads already made keep the slowmode they were given.",
    ].join("\n"),
  );
}

async function name(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the name given to threads");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], true);
  if (!id) return;

  const wanted = parts.slice(1).join(" ").trim();
  if (!wanted) {
    const held = await threadFor(guildId, id);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `Threads in <#${id}> are named \`${held?.name ?? DEFAULT_NAME}\`.`,
        "",
        `-# \`autothread name <#${id}> <name>\` changes it · \`autothread variables\` lists what it can use`,
      ].join("\n"),
    );
    return;
  }
  if (wanted.length > 100) {
    await card(ctx, [`### ${HEADING}`, "A thread name is 100 characters at most."].join("\n"));
    return;
  }

  await setField(guildId, id, "name", wanted);
  const unknown = unknownTokens(wanted);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Threads in <#${id}> are now named \`${preview(wanted, { guildId, channelId: id, userId: ctx.authorId })}\`.`,
      unknown.length
        ? `-# \`${unknown.join("` `")}\` ${unknown.length === 1 ? "is not a variable" : "are not variables"}, so ${unknown.length === 1 ? "it is" : "they are"} left as typed.`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function script(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "set the message posted in threads");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], true);
  if (!id) return;

  const body = parts.slice(1).join(" ").trim();
  if (!body) {
    const held = await threadFor(guildId, id);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        held?.script
          ? `Threads in <#${id}> open with:\n>>> ${held.script}`
          : `Threads in <#${id}> open with nothing.`,
        "",
        `-# \`autothread message <#${id}> <text>\` sets it · \`autothread message remove <#${id}>\` clears it`,
      ].join("\n"),
    );
    return;
  }

  await setField(guildId, id, "script", body.slice(0, 2000));
  const unknown = unknownTokens(body);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Threads in <#${id}> now open with:`,
      `>>> ${preview(body, { guildId, channelId: id, userId: ctx.authorId })}`,
      unknown.length ? `-# \`${unknown.join("` `")}\` left as typed.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function scriptRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "clear the message posted in threads");
  if (!guildId) return;

  const id = await target(ctx, guildId, words(ctx.argument)[0], true);
  if (!id) return;

  await setField(guildId, id, "script", null);
  await card(ctx, [`### ${HEADING}`, `Threads in <#${id}> open with nothing now.`].join("\n"));
}

async function reactions(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the thread reactions");
  if (!guildId) return;

  const held = await allThreads(guildId);
  const withAny = [...held.values()].filter((one) => one.reactions.length);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      withAny.length
        ? withAny.map((one) => `<#${one.channelId}> — ${one.reactions.join(" ")}`).join("\n")
        : "Nothing is reacted to a threaded message.",
      "",
      "`autothread reactions add #channel 👍` adds one",
      `-# Up to ${MAX_REACTIONS} per channel, put on the message rather than in the thread.`,
    ].join("\n"),
  );
}

async function reactionAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "add a thread reaction");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], true);
  if (!id) return;

  const emoji = parts[1] ?? "";
  if (!EMOJI.test(emoji)) {
    await card(
      ctx,
      [`### ${HEADING}`, "Give one emoji, either a standard one or a custom one from this server."].join("\n"),
    );
    return;
  }

  const held = await threadFor(guildId, id);
  if ((held?.reactions.length ?? 0) >= MAX_REACTIONS && !held?.reactions.includes(emoji)) {
    await card(
      ctx,
      [`### ${HEADING}`, `That is ${MAX_REACTIONS} already, which is as many as I add.`].join("\n"),
    );
    return;
  }

  await addReactionTo(guildId, id, emoji);
  await card(
    ctx,
    [`### ${HEADING}`, `${emoji} goes on every message in <#${id}> that gets a thread.`].join("\n"),
  );
}

async function reactionRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "remove a thread reaction");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = await target(ctx, guildId, parts[0], true);
  if (!id) return;

  const gone = await removeReactionFrom(guildId, id, parts[1] ?? "");
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone ? `${parts[1]} is no longer added in <#${id}>.` : "That emoji was not being added.",
    ].join("\n"),
  );
}

async function reactionClear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "clear the thread reactions");
  if (!guildId) return;

  const id = await target(ctx, guildId, words(ctx.argument)[0], true);
  if (!id) return;

  const count = await clearReactionsFor(guildId, id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      count === 0 ? `Nothing was being added in <#${id}>.` : `${count} removed from <#${id}>.`,
    ].join("\n"),
  );
}

async function variables(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the thread name variables");
  if (!guildId) return;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "A thread name and its opening message can use these:",
      VARIABLES.map((one) => `\`${one.token}\` — ${one.describes}`).join("\n"),
      "",
      `-# Anything else in braces is left exactly as typed. The default name is \`${DEFAULT_NAME}\`.`,
    ].join("\n"),
  );
}

function dispatcher(path: string, fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn(path, sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerAutothread(): void {
  watchForThreads();

  register({
    name: "autothread",
    aliases: ["autothreads", "threadify", "athread"],
    description: "Automatically create a thread for every message in a channel",
    handler: dispatcher("autothread", overview),
  });

  groupUnder("autothread", () => {
    register({
      name: "add",
      aliases: ["create", "enable", "set"],
      description: "Create a thread for every message sent in a channel",
      handler: add,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm", "disable"],
      description: "Stop creating threads in a channel",
      handler: remove,
    });

    register({
      name: "list",
      aliases: ["ls", "show"],
      description: "View every channel which creates threads",
      handler: list,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Stop creating threads in every channel",
      handler: clear,
    });

    register({
      name: "archive",
      aliases: ["duration"],
      description: "Set how long created threads stay active, in minutes",
      handler: archive,
    });

    register({
      name: "slowmode",
      aliases: ["cooldown"],
      description: "Set the slowmode applied to created threads",
      handler: slowmode,
    });

    register({
      name: "name",
      aliases: ["rename", "title"],
      description: "Change the name given to created threads",
      handler: name,
    });

    register({
      name: "message",
      aliases: ["script", "embed", "msg"],
      description: "Send a script inside every created thread",
      handler: dispatcher("autothread message", script),
    });

    register({
      name: "reactions",
      aliases: ["reaction", "react"],
      description: "React to messages which have a thread created for them",
      handler: dispatcher("autothread reactions", reactions),
    });

    register({
      name: "variables",
      aliases: ["vars", "help"],
      description: "View the variables usable in a thread name",
      handler: variables,
    });
  });

  groupUnder("autothread message", () => {
    register({
      name: "remove",
      aliases: ["delete", "del", "rm", "clear", "reset"],
      description: "Stop sending a message inside created threads",
      handler: scriptRemove,
    });
  });

  groupUnder("autothread reactions", () => {
    register({
      name: "add",
      aliases: ["create", "new"],
      description: "Add an emoji reacted onto messages which get a thread",
      handler: reactionAdd,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove an emoji from a channel's reactions",
      handler: reactionRemove,
    });

    register({
      name: "clear",
      aliases: ["reset"],
      description: "Remove every reaction from a channel",
      handler: reactionClear,
    });
  });
}
