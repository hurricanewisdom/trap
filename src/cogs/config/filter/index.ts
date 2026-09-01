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
      "`automod add <word>` filters a word, `*` wildcards allowed",
      "`automod remove <word>` stops filtering it",
      "`automod ignore <word>` lets one through",
      "`automod whitelist <role>` exempts a role or channel",
      "`automod list` shows everything",
      "`automod clear` clears the lot",
      "",
      "`automod caps`, `automod emoji`, `automod spoilers`, `automod mentions` set thresholds",
      "`automod invites`, `automod links`, `automod music`, `automod spam` block content",
      "`automod regex <pattern>` filters by pattern, `automod wordmigrate` imports existing rules",
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
    const command = sub ? lookupIn("automod", sub) : undefined;

    if (command) {
      await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerFilter(): void {
  register({
    name: "automod",
    // `filter` was the name for a long time and is what everybody types, so it
    // stays reachable rather than being retired.
    aliases: ["filter", "chatfilter"],
    description: "Various tools to easily manage Discord's AutoMod",
    handler: dispatcher(overview),
  });

  groupUnder("automod", () => {
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
      name: "ignore",
      aliases: ["allow", "exclude"],
      description: "Add or remove a substring the filter lets through",
      handler: whitelist,
    });

    register({
      name: "whitelist",
      aliases: ["exempt", "wl", "exemptions"],
      description: "Exempt a role or channel from the automod",
      handler: exempt,
    });

    register({
      name: "list",
      description: "Every filtered word in this server",
      handler: list,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all word and regex filters",
      handler: reset,
    });

    registerThresholds();
    registerMentions();
    registerGuarded();
    registerContent();
    registerPatterns();
  });
}
