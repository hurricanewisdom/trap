import {
  KEYWORD,
  MAX_KEYWORDS,
  MAX_REGEX,
  blockAction,
  createRule,
  deleteRule,
  explain,
  patchRule,
  ruleFor,
  rules,
} from "../../../core/automod.js";
import { requireManageGuild } from "../../../core/permissions.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { HEADING, card, words } from "./shared.js";

const REGEX = "regex";

const WORDS = "words";

const REASON = "Server pattern filter";

export async function regex(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change the pattern filter");
  if (!guildId) return;

  const rule = await ruleFor(guildId, REGEX);
  const current = rule?.trigger_metadata?.regex_patterns ?? [];
  const pattern = ctx.argument.trim();

  if (!pattern) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        current.length
          ? current.map((entry) => `\`${entry.replace(/`/g, "'")}\``).join("\n")
          : "No patterns are set.",
        "",
        `-# ${current.length} of ${MAX_REGEX} · \`automod regex <pattern>\` adds or removes one.`,
        "-# Discord's engine has no backreferences or lookaround.",
      ].join("\n"),
    );
    return;
  }

  const has = current.includes(pattern);

  if (has) {
    const kept = current.filter((entry) => entry !== pattern);
    const saved =
      kept.length === 0 && rule
        ? await deleteRule(guildId, rule.id, REASON)
        : await patchRule(guildId, rule?.id ?? "", { trigger_metadata: { regex_patterns: kept } }, REASON);

    await card(
      ctx,
      saved.ok
        ? [`### ${HEADING}`, `That pattern is gone.`, kept.length ? `-# ${kept.length} left.` : "-# That was the last one."].join("\n")
        : [`### ${HEADING}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
    );
    return;
  }

  if (current.length >= MAX_REGEX) {
    await card(
      ctx,
      [`### ${HEADING}`, `Discord allows ${MAX_REGEX} patterns on a rule, and they are all used.`].join("\n"),
    );
    return;
  }

  const next = [...current, pattern];
  const saved = rule
    ? await patchRule(guildId, rule.id, { trigger_metadata: { regex_patterns: next } }, REASON)
    : await createRule(
        guildId,
        REGEX,
        KEYWORD,
        {
          trigger_metadata: { regex_patterns: next },
          actions: [blockAction("That message matched a filtered pattern.")],
        },
        REASON,
      );

  await card(
    ctx,
    saved.ok
      ? [
          `### ${HEADING}`,
          "That pattern is filtered. Discord blocks a match before it posts.",
          `-# ${next.length} of ${MAX_REGEX} patterns.`,
        ].join("\n")
      : [`### ${HEADING}`, "Discord refused that pattern.", `-# ${explain(saved.message)}`].join("\n"),
  );
}

export async function wordmigrate(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "migrate filtered words");
  if (!guildId) return;

  const all = await rules(guildId);
  const ours = all.find((rule) => rule.name === `trap: ${WORDS}`);
  const others = all.filter(
    (rule) => rule.trigger_type === KEYWORD && rule.name !== `trap: ${WORDS}` && !rule.name.startsWith("trap: "),
  );

  const found = [...new Set(others.flatMap((rule) => rule.trigger_metadata?.keyword_filter ?? []))];
  if (found.length === 0) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Nothing to migrate.",
        "",
        "-# Filtered words already live in Discord's AutoMod, so `automod add` writes straight there.",
        "-# This only picks up words from keyword rules made by hand or another bot.",
      ].join("\n"),
    );
    return;
  }

  const held = ours?.trigger_metadata?.keyword_filter ?? [];
  const fresh = found.filter((word) => !held.includes(word));
  if (fresh.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, `All ${found.length} of those words are already filtered.`].join("\n"),
    );
    return;
  }

  const merged = [...held, ...fresh].slice(0, MAX_KEYWORDS);
  const saved = ours
    ? await patchRule(guildId, ours.id, { trigger_metadata: { keyword_filter: merged } }, REASON)
    : await createRule(
        guildId,
        WORDS,
        KEYWORD,
        {
          trigger_metadata: { keyword_filter: merged },
          actions: [blockAction("That word is filtered here.")],
        },
        REASON,
      );

  await card(
    ctx,
    saved.ok
      ? [
          `### ${HEADING}`,
          `Copied ${fresh.length} word${fresh.length === 1 ? "" : "s"} from ${others.length} rule${others.length === 1 ? "" : "s"}.`,
          `-# From: ${others.map((rule) => `**${rule.name}**`).join(", ")}`,
          "-# Those rules are untouched, so nothing is enforced twice unless you remove them yourself.",
        ].join("\n")
      : [`### ${HEADING}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
  );
}

export function registerPatterns(): void {
  register({
    name: "regex",
    aliases: ["pattern"],
    description: "Filter messages matching a pattern",
    handler: regex,
  });

  register({
    name: "wordmigrate",
    aliases: ["migrate"],
    description: "Copy filtered words out of other AutoMod rules",
    handler: wordmigrate,
  });
}

export { words };
