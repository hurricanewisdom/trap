import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { flagOn, parseFlags } from "../../../helpers/flags.js";
import { VARIABLES, preview, unknownTokens } from "../greetings/variables.js";
import { registerExclusive } from "./exclusive.js";
import { watchMessages } from "./responder.js";
import { registerRoles } from "./roles.js";
import { HEADING, card, missing, needTrigger, shown, splitOnComma } from "./shared.js";
import {
  MAX_REPLY,
  MAX_RESPONDERS,
  MAX_TRIGGER,
  all,
  one,
  remove as drop,
  reset as wipeAll,
  save,
  type Responder,
} from "./store.js";

const BARE = ["strict", "ticket", "delete", "reply"];

function marks(held: Responder): string {
  const parts = [
    held.strict ? "strict" : null,
    held.ticket ? "ticket" : null,
    held.wipe ? "deletes" : null,
    held.quote ? "replies" : null,
    held.give.length ? `+${held.give.length} role${held.give.length === 1 ? "" : "s"}` : null,
    held.take.length ? `-${held.take.length} role${held.take.length === 1 ? "" : "s"}` : null,
    held.onlyRoles.length + held.onlyChannels.length ? "exclusive" : null,
  ].filter(Boolean);
  return parts.length ? ` · *${parts.join(", ")}*` : "";
}

function rows(held: Responder[], prefix: string): string {
  return held
    .map((responder) => `${shown(responder.trigger)}${marks(responder)}\n-# ${prefix}${responder.reply.replace(/\n/g, " ").slice(0, 70)}`)
    .join("\n");
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the autoresponders");
  if (!guildId) return;

  const held = await all(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Answer automatically when a message contains a trigger.",
      "",
      "`autoresponder add <trigger>, <reply>` creates one",
      "`autoresponder update <trigger>, <reply>` changes the reply",
      "`autoresponder remove <trigger>` deletes one",
      "`autoresponder list` shows them all",
      "`autoresponder variables` lists what a reply can use",
      "`autoresponder role` gives or takes roles on a trigger",
      "`autoresponder exclusive` limits one to roles or channels",
      "`autoresponder reset` clears the lot",
      "",
      "-# Flags on add and update: `--strict` whole message only, `--delete` removes",
      "-# the trigger message, `--reply` answers as a reply, `--ticket` marks it as one.",
      `-# ${held.length} of ${MAX_RESPONDERS} used in this server.`,
    ].join("\n"),
  );
}

function writer(updating: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(
      ctx,
      updating ? "update an autoresponder" : "add an autoresponder",
    );
    if (!guildId) return;

    const { rest, flags } = parseFlags(ctx.argument, BARE);
    const split = splitOnComma(rest);

    if (!split) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          "Separate the trigger from the reply with a comma.",
          "",
          `-# \`autoresponder ${updating ? "update" : "add"} <trigger>, <reply>\``,
          "-# For example: `autoresponder add hello, hey {user}!`",
        ].join("\n"),
      );
      return;
    }

    const { trigger, reply } = split;
    if (trigger.length > MAX_TRIGGER) {
      await card(ctx, [`### ${HEADING}`, `Keep a trigger under ${MAX_TRIGGER} characters.`].join("\n"));
      return;
    }
    if (reply.length > MAX_REPLY) {
      await card(ctx, [`### ${HEADING}`, `Keep a reply under ${MAX_REPLY} characters.`].join("\n"));
      return;
    }

    const existing = await one(guildId, trigger);
    if (updating && !existing) {
      await card(ctx, missing(trigger));
      return;
    }
    if (!updating && existing) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          `${shown(existing.trigger)} already answers.`,
          "",
          "-# `autoresponder update <trigger>, <reply>` changes it.",
        ].join("\n"),
      );
      return;
    }
    if (!updating && (await all(guildId)).length >= MAX_RESPONDERS) {
      await card(
        ctx,
        [`### ${HEADING}`, `A server can hold ${MAX_RESPONDERS} autoresponders, and they are all used.`].join("\n"),
      );
      return;
    }

    const unknown = unknownTokens(reply);
    await save(
      guildId,
      trigger,
      reply,
      {
        strict: flagOn(flags, "strict") ?? existing?.strict ?? false,
        ticket: flagOn(flags, "ticket") ?? existing?.ticket ?? false,
        wipe: flagOn(flags, "delete") ?? existing?.wipe ?? false,
        quote: flagOn(flags, "reply") ?? existing?.quote ?? false,
      },
      ctx.authorId,
    );

    const saved = (await one(guildId, trigger)) as Responder;
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `${shown(saved.trigger)} now answers${marks(saved)}`,
        "",
        preview(saved.reply, {
          guildId,
          channelId: ctx.channelId,
          userId: ctx.authorId,
        }).slice(0, 600),
        unknown.length ? `\n-# Not a variable, left as written: ${unknown.map((token) => `\`${token}\``).join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  };
}

async function removeOne(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "remove an autoresponder");
  if (!guildId) return;

  const trigger = ctx.argument.trim();
  if (!trigger) {
    await card(ctx, needTrigger("autoresponder remove <trigger>"));
    return;
  }

  const gone = await drop(guildId, trigger);
  await card(
    ctx,
    gone
      ? [`### ${HEADING}`, `${shown(trigger)} no longer answers.`].join("\n")
      : missing(trigger),
  );
}

async function listAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "list the autoresponders");
  if (!guildId) return;

  const held = await all(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length === 0 ? "Nothing answers automatically yet." : rows(held.slice(0, 20), ""),
      "",
      held.length
        ? `-# ${held.length} of ${MAX_RESPONDERS}${held.length > 20 ? ", showing the first 20" : ""}`
        : "-# `autoresponder add <trigger>, <reply>` makes one.",
    ].join("\n"),
  );
}

async function listTickets(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "list the ticket autoresponders");
  if (!guildId) return;

  const held = (await all(guildId)).filter((responder) => responder.ticket);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length === 0 ? "No autoresponder is marked as a ticket one." : rows(held.slice(0, 20), ""),
      "",
      held.length
        ? `-# ${held.length} marked${held.length > 20 ? ", showing the first 20" : ""}`
        : "-# Mark one with `autoresponder add <trigger>, <reply> --ticket`.",
    ].join("\n"),
  );
}

async function variables(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the variables");
  if (!guildId) return;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Anything in braces is filled in when the reply is posted.",
      "",
      VARIABLES.map((variable) => `\`${variable.token}\` ${variable.describes}`).join("\n"),
      "",
      "-# Anything in braces that is not on this list is left exactly as written.",
    ].join("\n"),
  );
}

async function resetAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "clear the autoresponders");
  if (!guildId) return;

  const gone = await wipeAll(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone === 0
        ? "There was nothing to clear."
        : `Cleared ${gone} autoresponder${gone === 1 ? "" : "s"}, with their roles and exclusives.`,
    ].join("\n"),
  );
}

export function registerAutoresponder(): void {
  watchMessages();

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("autoresponder", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "autoresponder",
    aliases: ["autoreply", "ar"],
    description: "Answer automatically when a message matches a trigger",
    handler,
  });

  groupUnder("autoresponder", () => {
    register({ name: "add", aliases: ["create"], description: "Create a reply for a trigger", handler: writer(false) });
    register({ name: "update", aliases: ["edit"], description: "Change the reply for a trigger", handler: writer(true) });
    register({ name: "remove", aliases: ["delete", "rm"], description: "Remove a reply for a trigger", handler: removeOne });
    register({ name: "variables", aliases: ["vars"], description: "What a reply can use", handler: variables });
    register({ name: "reset", aliases: ["clear"], description: "Remove every auto response", handler: resetAll });

    register({
      name: "list",
      aliases: ["all"],
      description: "Every trigger in this server",
      handler: async (ctx) => {
        const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        if (sub === "tickets") {
          await listTickets({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
          return;
        }
        await listAll(ctx);
      },
    });

    groupUnder("autoresponder list", () => {
      register({
        name: "tickets",
        description: "Triggers marked as ticket replies",
        handler: listTickets,
      });
    });

    registerRoles();
    registerExclusive();
  });
}
