import { channelExists, memberOf } from "../../../core/discord.js";
import {
  requireGuild,
  requireManageChannels,
  requireManageMessages,
} from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { switchWord } from "../../../helpers/flags.js";
import { LABEL, publish, refresh } from "./post.js";
import { card, channelId, missing, suggestionId, target, words } from "./shared.js";
import {
  config,
  create,
  find,
  ignoredIn,
  isIgnored,
  nextId,
  saveConfig,
  setReply,
  setStatus,
  toggleIgnore,
  type Status,
} from "./store.js";

const MOST = 1500;

async function submit(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "suggest something");
  if (!guildId) return;

  const held = await config(guildId);
  if (!held.channelId) {
    await card(ctx, [
      "Suggestions have nowhere to go yet.",
      "",
      "-# Somebody with Manage Channels can run `suggest set #channel`.",
    ]);
    return;
  }
  if (held.locked) {
    await card(ctx, ["Suggestions are closed here."]);
    return;
  }

  const member = await memberOf(guildId, ctx.authorId);
  if (await isIgnored(guildId, ctx.authorId, member?.roles ?? [])) {
    await card(ctx, ["You cannot post suggestions in this server."]);
    return;
  }

  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["What would you like to suggest?", "", "-# `suggest <your idea>`"]);
    return;
  }

  // Where it goes now is not always where it ends up: with review on it waits in
  // the review channel, and only reaches the public one once it is approved.
  const waiting = held.review && Boolean(held.reviewId);
  const into = waiting ? (held.reviewId as string) : held.channelId;

  const id = await nextId(guildId);
  const one = await create(guildId, id, ctx.authorId, said.slice(0, MOST));
  const posted = await publish(guildId, one, held, into, !waiting);

  if (!posted) {
    await card(ctx, [
      "That could not be posted.",
      "",
      "-# The bot may not be able to write in that channel.",
    ]);
    return;
  }

  await card(ctx, [
    waiting
      ? `Suggestion #${id} has been sent for review.`
      : `Suggestion #${id} is up in <#${held.channelId}>.`,
  ]);
}

function statusSetter(status: Status, said: string): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageMessages(ctx, "change a suggestion's status");
    if (!guildId) return;

    const id = suggestionId(words(ctx.argument)[0]);
    if (id === null) {
      await card(ctx, ["Which suggestion?", "", `-# \`suggest ${said} <id>\``]);
      return;
    }

    const before = await find(guildId, id);
    if (!before) {
      await card(ctx, missing(id));
      return;
    }

    const one = await setStatus(guildId, id, status);
    if (!one) {
      await card(ctx, missing(id));
      return;
    }

    const held = await config(guildId);

    // Approving something that is still sitting in the review channel is what
    // publishes it, rather than only relabelling it where nobody can see it.
    const inReview = Boolean(held.reviewId) && before.channelId === held.reviewId;
    if (status === "approved" && inReview && held.channelId) {
      const posted = await publish(guildId, one, held, held.channelId, true);
      await card(ctx, [
        posted
          ? `Suggestion #${id} is approved and now in <#${held.channelId}>.`
          : `Suggestion #${id} is approved, but could not be posted publicly.`,
      ]);
      return;
    }

    const shown = await refresh(one);
    await card(ctx, [
      `Suggestion #${id} is now **${LABEL[status]}**.`,
      ...(shown ? [] : ["", "-# The original message could not be edited."]),
    ]);
  };
}

async function reply(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "reply to a suggestion");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const id = suggestionId(parts[0]);
  const comment = parts.slice(1).join(" ").trim();
  if (id === null || !comment) {
    await card(ctx, ["Which suggestion, and what reply?", "", "-# `suggest reply <id> <comment>`"]);
    return;
  }

  const one = await setReply(guildId, id, comment.slice(0, 500), ctx.authorId);
  if (!one) {
    await card(ctx, missing(id));
    return;
  }

  const shown = await refresh(one);
  await card(ctx, [
    `Replied to suggestion #${id}.`,
    ...(shown ? [] : ["", "-# The original message could not be edited."]),
  ]);
}

async function setChannel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "set the suggestion channel");
  if (!guildId) return;

  const token = words(ctx.argument)[0] ?? "";
  const wanted = channelId(token);
  if (!wanted) {
    await card(ctx, ["Which channel?", "", "-# `suggest set #channel`"]);
    return;
  }
  if (!(await channelExists(guildId, wanted))) {
    await card(ctx, ["That channel is not in this server."]);
    return;
  }

  await saveConfig(guildId, { channelId: wanted });
  await card(ctx, [`New suggestions go to <#${wanted}>.`]);
}

async function reviewChannel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "set the review channel");
  if (!guildId) return;

  const token = words(ctx.argument)[0] ?? "";
  const wanted = channelId(token);
  if (!wanted) {
    await card(ctx, ["Which channel?", "", "-# `suggest review channel #channel`"]);
    return;
  }
  if (!(await channelExists(guildId, wanted))) {
    await card(ctx, ["That channel is not in this server."]);
    return;
  }

  await saveConfig(guildId, { reviewId: wanted });
  await card(ctx, [`Suggestions awaiting approval go to <#${wanted}>.`]);
}

async function review(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change suggestion review");
  if (!guildId) return;

  const wanted = switchWord(words(ctx.argument)[0] ?? "");
  const held = wanted === null ? await config(guildId) : await saveConfig(guildId, { review: wanted });

  if (wanted === true && !held.reviewId) {
    await card(ctx, [
      "Review is on, but there is no review channel yet.",
      "",
      "-# `suggest review channel #channel` — until then suggestions go straight up.",
    ]);
    return;
  }

  await card(ctx, [
    held.review
      ? "Suggestions wait for approval before they are shown."
      : "Suggestions are shown as soon as they are made.",
    ...(wanted === null ? ["", "-# `suggest review on` or `off`"] : []),
  ]);
}

async function threads(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change suggestion threads");
  if (!guildId) return;

  const wanted = switchWord(words(ctx.argument)[0] ?? "");
  const held =
    wanted === null ? await config(guildId) : await saveConfig(guildId, { threads: wanted });

  await card(ctx, [
    held.threads
      ? "Each suggestion gets a thread to discuss it in."
      : "Suggestions are posted without a thread.",
    ...(wanted === null ? ["", "-# `suggest threads on` or `off`"] : []),
  ]);
}

async function reactions(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the suggestion reactions");
  if (!guildId) return;

  const parts = words(ctx.argument);
  if (parts.length < 2) {
    const held = await config(guildId);
    await card(ctx, [
      `Voting with ${held.upvote} and ${held.downvote}.`,
      "",
      "-# `suggest reactions <upvote> <downvote>`",
    ]);
    return;
  }

  const [up, down] = parts as [string, string];
  await saveConfig(guildId, { upvote: up.slice(0, 60), downvote: down.slice(0, 60) });
  await card(ctx, [
    `New suggestions are voted on with ${up} and ${down}.`,
    "",
    "-# A custom emoji has to be from a server the bot is in.",
  ]);
}

function locker(locked: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(ctx, "open or close suggestions");
    if (!guildId) return;

    await saveConfig(guildId, { locked });
    await card(ctx, [
      locked ? "Suggestions are closed." : "Suggestions are open.",
      "",
      `-# \`suggest ${locked ? "unlock" : "lock"}\` puts it back.`,
    ]);
  };
}

async function ignore(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change who can suggest");
  if (!guildId) return;

  const token = words(ctx.argument)[0] ?? "";
  if (!token) {
    await card(ctx, ["Which member or role?", "", "-# `suggest ignore @someone`"]);
    return;
  }

  const found = await target(guildId, token);
  if (!found) {
    await card(ctx, ["No member or role by that name."]);
    return;
  }

  const added = await toggleIgnore(guildId, found.id, found.isRole);
  const shown = found.isRole ? `<@&${found.id}>` : `<@${found.id}>`;
  await card(ctx, [
    added ? `${shown} can no longer post suggestions.` : `${shown} can post suggestions again.`,
    "",
    "-# Naming the same one again undoes it.",
  ]);
}

async function ignoreList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see who is ignored");
  if (!guildId) return;

  const held = await ignoredIn(guildId);
  if (held.length === 0) {
    await card(ctx, ["Nobody is ignored."]);
    return;
  }

  await card(ctx, [
    `${held.length} ignored:`,
    held
      .map((one) => (one.isRole ? `<@&${one.targetId}>` : `<@${one.targetId}>`))
      .join(" · "),
  ]);
}

async function shownConfig(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the suggestion settings");
  if (!guildId) return;

  const held = await config(guildId);
  const ignored = await ignoredIn(guildId);

  await card(ctx, [
    held.locked ? "Closed." : held.channelId ? "Open." : "Not set up yet.",
    `-# channel: ${held.channelId ? `<#${held.channelId}>` : "none"}`,
    `-# review: ${held.review ? "on" : "off"}`,
    `-# review channel: ${held.reviewId ? `<#${held.reviewId}>` : "none"}`,
    `-# threads: ${held.threads ? "on" : "off"}`,
    `-# voting: ${held.upvote} ${held.downvote}`,
    `-# ignored: ${ignored.length}`,
    "",
    "-# `suggest set #channel` · `suggest review on` · `suggest threads on`",
  ]);
}

const STATUS_COMMANDS: { name: string; status: Status; describes: string }[] = [
  { name: "approve", status: "approved", describes: "Approved" },
  { name: "deny", status: "denied", describes: "Denied" },
  { name: "consider", status: "considering", describes: "In Consideration" },
  { name: "progress", status: "progress", describes: "In Progress" },
  { name: "reset", status: "pending", describes: "Pending" },
];

export function registerSuggest(): void {
  const handler: PrefixHandler = async (ctx) => {
    const first = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = first ? lookupIn("suggest", first) : undefined;

    // A word that names a subcommand is one; anything else is somebody's idea.
    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await submit(ctx);
  };

  register({
    name: "suggest",
    aliases: ["suggestion"],
    description: "Suggest a new idea or feature to server staff",
    handler,
  });

  groupUnder("suggest", () => {
    for (const one of STATUS_COMMANDS) {
      register({
        name: one.name,
        description: `Change a suggestion status to ${one.describes}`,
        handler: statusSetter(one.status, one.name),
      });
    }

    register({ name: "reply", description: "Reply to a suggestion", handler: reply });
    register({ name: "set", description: "Set the channel for new suggestions", handler: setChannel });
    register({ name: "config", description: "View suggestion system configuration", handler: shownConfig });
    register({ name: "reactions", description: "Set custom reactions for new suggestions", handler: reactions });
    register({ name: "threads", description: "Create a thread along with the suggestion message", handler: threads });
    register({ name: "lock", description: "Disable suggestions system", handler: locker(true) });
    register({ name: "unlock", description: "Enable suggestions system", handler: locker(false) });

    register({
      name: "review",
      description: "Enable or disable review of suggestions before displayed publicly",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("suggest review", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await review(ctx);
      },
    });

    groupUnder("suggest review", () => {
      register({
        name: "channel",
        description: "Set the review channel for suggestions that require approval",
        handler: reviewChannel,
      });
    });

    register({
      name: "ignore",
      description: "Prevent members or roles from creating suggestions",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("suggest ignore", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await ignore(ctx);
      },
    });

    groupUnder("suggest ignore", () => {
      register({
        name: "list",
        description: "List all ignored members or roles",
        handler: ignoreList,
      });
    });
  });
}

