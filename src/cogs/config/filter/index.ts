import { KEYWORD, keywordSlots, rules } from "../../../core/automod.js";
import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { HEADING, card, words } from "./shared.js";
import { add, exempt, list, remove, reset, whitelist } from "./words.js";
import { registerThresholds } from "./thresholds.js";
import { registerMentions } from "./mentions.js";
import { registerGuarded } from "./automodfilters.js";
import { registerContent } from "./content.js";
import { registerPatterns } from "./patterns.js";

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the filters");
  if (!guildId) return;

  const held = await rules(guildId);
  const ours = held.filter((rule) => rule.name.startsWith("trap: "));
  const used = held.filter((rule) => rule.trigger_type === KEYWORD).length;
  const free = await keywordSlots(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Filtered words are enforced by Discord itself, so a blocked message never posts.",
      "",
      "`filter add <word>` filters a word, `*` wildcards allowed",
      "`filter remove <word>` stops filtering it",
      "`filter whitelist <word>` lets one through",
      "`filter exempt <role>` exempts a role",
      "`filter list` shows everything",
      "`filter reset` clears the lot",
      "",
      "`filter caps`, `filter emoji`, `filter spoilers`, `filter massmention` set thresholds",
      "`filter invites`, `filter links`, `filter musicfiles`, `filter spam` block content",
      "`filter regex <pattern>` filters by pattern, `filter wordmigrate` imports existing rules",
      "",
      ours.length
        ? `-# Rules in place: ${ours.map((rule) => `\`${rule.name.slice(6)}\``).join(" · ")}`
        : "-# No filter rules yet.",
      `-# ${used} of 6 keyword rules used in this server, ${free} free.`,
    ].join("\n"),
  );
}

function dispatcher(fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const command = sub ? lookupIn("filter", sub) : undefined;

    if (command) {
      await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerFilter(): void {
  register({
    name: "filter",
    aliases: ["chatfilter"],
    description: "Keep the chat clean",
    handler: dispatcher(overview),
  });

  groupUnder("filter", () => {
    register({
      name: "add",
      description: "Filter a word",
      handler: add,
    });

    register({
      name: "remove",
      aliases: ["delete", "rm"],
      description: "Stop filtering a word",
      handler: remove,
    });

    register({
      name: "whitelist",
      aliases: ["allow"],
      description: "Let a word through the filter",
      handler: whitelist,
    });

    register({
      name: "exempt",
      description: "Exempt a role from the word filter",
      handler: exempt,
    });

    register({
      name: "list",
      description: "Every filtered word in this server",
      handler: list,
    });

    register({
      name: "reset",
      description: "Clear every filtered word",
      handler: reset,
    });

    registerThresholds();
    registerMentions();
    registerGuarded();
    registerContent();
    registerPatterns();
  });
}
