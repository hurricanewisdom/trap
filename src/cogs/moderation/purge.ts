import {
  bulkDelete,
  channelMessages,
  clearReactions,
  type PostedMessage,
} from "../../core/discord.js";
import { requireManageMessages } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { card, userId, words } from "./shared.js";

const DEFAULT_SEARCH = 100;

const MOST = 1000;

// Discord will not bulk delete anything older than two weeks, and deleting them
// one at a time would take minutes and hammer the rate limit. Older messages are
// left alone and counted, so the reply can say why the number is short.
const FORTNIGHT = 14 * 86_400_000;

const LINK = /https?:\/\//i;

const EMOTE = /<a?:\w+:\d+>/;

const UNICODE_EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;

const MESSAGE_LINK = /(?:^|\/)(\d{15,25})\/(\d{15,25})\/(\d{15,25})$/;

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|heic)(\?|$)/i;

function ageOf(id: string): number {
  // A snowflake carries its own timestamp, so nothing has to be fetched to know
  // whether a message is too old to bulk delete.
  return Date.now() - (Number(BigInt(id) >> 22n) + 1_420_070_400_000);
}

export type Test = (message: PostedMessage) => boolean;

interface Swept {
  removed: number;
  tooOld: number;
}

async function sweep(
  channelId: string,
  keep: Test,
  search: number,
  before?: string,
): Promise<Swept> {
  const wanted: string[] = [];
  let tooOld = 0;
  let cursor = before;
  let looked = 0;

  while (looked < search && wanted.length < 100) {
    const page = await channelMessages(
      channelId,
      `limit=100${cursor ? `&before=${cursor}` : ""}`,
    );
    if (!page || page.length === 0) break;

    for (const message of page) {
      looked += 1;
      if (looked > search) break;
      if (message.pinned) continue;
      if (!keep(message)) continue;
      if (ageOf(message.id) > FORTNIGHT) {
        tooOld += 1;
        continue;
      }
      wanted.push(message.id);
      if (wanted.length >= 100) break;
    }

    cursor = page[page.length - 1]?.id;
    if (page.length < 100) break;
  }

  const removed = await bulkDelete(channelId, wanted, "purge");
  return { removed, tooOld };
}

function countOf(said: string | undefined, fallback = DEFAULT_SEARCH): number {
  if (!said || !/^\d{1,4}$/.test(said)) return fallback;
  return Math.max(1, Math.min(MOST, Number(said)));
}

async function run(
  ctx: PrefixContext,
  keep: Test,
  search: number,
  what: string,
  before?: string,
): Promise<void> {
  const done = await sweep(ctx.channelId, keep, search, before);
  await card(ctx, [
    done.removed === 0 ? `Nothing ${what} to remove.` : `Removed ${done.removed} ${what}.`,
    ...(done.tooOld > 0
      ? [`-# ${done.tooOld} were older than two weeks, which Discord will not bulk delete.`]
      : []),
  ]);
}

// Every plain variant is the same command with a different test, so they are
// declared as data rather than written out twenty times.
const FILTERS: { name: string; describes: string; what: string; keep: Test }[] = [
  { name: "bots", describes: "Purge messages from bots in chat", what: "from bots", keep: (m) => Boolean(m.author?.bot) },
  { name: "humans", describes: "Purge messages from humans in chat", what: "from humans", keep: (m) => !m.author?.bot },
  { name: "webhooks", describes: "Purge messages from webhooks in chat", what: "from webhooks", keep: (m) => Boolean(m.webhook_id) },
  { name: "links", describes: "Purge messages containing links", what: "with links", keep: (m) => LINK.test(m.content ?? "") },
  { name: "embeds", describes: "Purge embeds from chat", what: "with embeds", keep: (m) => (m.embeds ?? []).length > 0 },
  { name: "files", describes: "Purge files and attachments from chat", what: "with files", keep: (m) => (m.attachments ?? []).length > 0 },
  {
    name: "images",
    describes: "Purge images (including links) from chat",
    what: "with images",
    keep: (m) =>
      (m.attachments ?? []).some((one) => (one.content_type ?? "").startsWith("image/")) ||
      IMAGE.test(m.content ?? ""),
  },
  { name: "stickers", describes: "Purge stickers from chat", what: "with stickers", keep: (m) => (m.sticker_items ?? []).length > 0 },
  { name: "emotes", describes: "Purge emotes from chat", what: "with emotes", keep: (m) => EMOTE.test(m.content ?? "") },
  { name: "emoji", describes: "Purge emojis from chat", what: "with emoji", keep: (m) => UNICODE_EMOJI.test(m.content ?? "") },
  {
    name: "activity",
    describes: "Purge activity messages from chat",
    what: "activity messages",
    keep: (m) => typeof m.type === "number" && m.type !== 0 && m.type !== 19,
  },
];

function plainFilter(keep: Test, what: string): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageMessages(ctx, "purge messages");
    if (!guildId) return;
    await run(ctx, keep, countOf(words(ctx.argument)[0]), what);
  };
}

function substringFilter(where: "contains" | "startswith" | "endswith"): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageMessages(ctx, "purge messages");
    if (!guildId) return;

    const said = ctx.argument.trim().toLowerCase();
    if (!said) {
      await card(ctx, ["Which text?", "", `-# \`purge ${where} <text>\``]);
      return;
    }

    const keep: Test = (m) => {
      const body = (m.content ?? "").toLowerCase();
      return where === "contains"
        ? body.includes(said)
        : where === "startswith"
          ? body.startsWith(said)
          : body.endsWith(said);
    };
    await run(ctx, keep, DEFAULT_SEARCH, `that ${where.replace("with", " with ")} that`);
  };
}

function idFrom(said: string | undefined): string | null {
  if (!said) return null;
  const link = MESSAGE_LINK.exec(said.trim());
  if (link?.[3]) return link[3];
  return /^\d{15,25}$/.test(said.trim()) ? said.trim() : null;
}

function positional(which: "after" | "before" | "upto"): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageMessages(ctx, "purge messages");
    if (!guildId) return;

    const id = idFrom(words(ctx.argument)[0]);
    if (!id) {
      await card(ctx, ["Which message?", "", `-# \`purge ${which} <message link>\``]);
      return;
    }

    if (which === "before") {
      await run(ctx, () => true, DEFAULT_SEARCH, "messages", id);
      return;
    }

    // After and up-to both mean everything newer than that message; up-to
    // includes it.
    const keep: Test = (m) => BigInt(m.id) > BigInt(id) || (which === "upto" && m.id === id);
    await run(ctx, keep, MOST, "messages");
  };
}

async function between(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "purge messages");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const from = idFrom(parts[0]);
  const to = idFrom(parts[1]);
  if (!from || !to) {
    await card(ctx, ["Which two messages?", "", "-# `purge between <start> <finish>`"]);
    return;
  }

  const low = BigInt(from) < BigInt(to) ? BigInt(from) : BigInt(to);
  const high = BigInt(from) < BigInt(to) ? BigInt(to) : BigInt(from);
  await run(ctx, (m) => BigInt(m.id) > low && BigInt(m.id) < high, MOST, "messages between them");
}

async function mentions(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "purge messages");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Whose mentions?", "", "-# `purge mentions @member`"]);
    return;
  }

  await run(
    ctx,
    (m) => (m.mentions ?? []).some((one) => one.id === who) || (m.content ?? "").includes(who),
    countOf(parts[1]),
    "mentioning them",
  );
}

// Reactions are cleared rather than the messages removed, which is what somebody
// asking to purge reactions means.
async function reactions(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "purge reactions");
  if (!guildId) return;

  const search = countOf(words(ctx.argument)[0]);
  const page = await channelMessages(ctx.channelId, `limit=${Math.min(100, search)}`);
  let cleared = 0;
  for (const message of page ?? []) {
    if ((message.reactions ?? []).length === 0) continue;
    const done = await clearReactions(ctx.channelId, message.id);
    if (done.ok) cleared += 1;
  }

  await card(ctx, [
    cleared === 0 ? "No reactions to clear." : `Cleared reactions from ${cleared} messages.`,
  ]);
}

async function purgeMain(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "purge messages");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  const search = countOf(who ? parts[1] : parts[0]);

  if (!who && parts.length > 0 && !/^\d{1,4}$/.test(parts[0] ?? "")) {
    await card(ctx, ["How many, or whose?", "", "-# `purge 50` · `purge @member 50`"]);
    return;
  }

  await run(ctx, (m) => !who || m.author?.id === who, search, who ? "from them" : "messages");
}

export function registerPurge(): void {
  register({
    name: "purge",
    aliases: ["clear", "prune"],
    description: "Deletes the specified amount of messages from the current channel",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("purge", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await purgeMain(ctx);
    },
  });

  groupUnder("purge", () => {
    for (const one of FILTERS) {
      register({
        name: one.name,
        description: one.describes,
        handler: plainFilter(one.keep, one.what),
      });
    }

    register({
      name: "contains",
      description: "Purges messages containing a given substring",
      handler: substringFilter("contains"),
    });
    register({
      name: "startswith",
      description: "Purge messages that start with a given substring",
      handler: substringFilter("startswith"),
    });
    register({
      name: "endswith",
      description: "Purge messages that end with a given substring",
      handler: substringFilter("endswith"),
    });

    register({
      name: "after",
      description: "Purge messages after a given message",
      handler: positional("after"),
    });
    register({
      name: "before",
      description: "Purge messages before a given message",
      handler: positional("before"),
    });
    register({
      name: "upto",
      description: "Purge messages up to a message link",
      handler: positional("upto"),
    });
    register({ name: "between", description: "Purge between two messages", handler: between });
    register({
      name: "mentions",
      description: "Purge mentions for a member from chat",
      handler: mentions,
    });
    register({
      name: "reactions",
      description: "Purge reactions from messages in chat",
      handler: reactions,
    });
  });
}
