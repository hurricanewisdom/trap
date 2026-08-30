import {
  KEYWORD,
  MAX_ALLOW,
  MAX_EXEMPT_ROLES,
  MAX_KEYWORDS,
  blockAction,
  createRule,
  explain,
  patchRule,
  deleteRule,
  ruleFor,
  type Rule,
} from "../../../core/automod.js";
import type { PrefixContext } from "../../../core/prefix.js";
import { requireManageChannels, requireManageGuild } from "../../../core/permissions.js";
import { HEADING, card, findRole, roleList, words } from "./shared.js";

const WORDS = "words";

const REASON = "Server word filter";

const MAX_WORD = 60;

async function rule(guildId: string): Promise<Rule | null> {
  return ruleFor(guildId, WORDS);
}

function listOf(rule: Rule | null, key: "keyword_filter" | "allow_list"): string[] {
  return rule?.trigger_metadata?.[key] ?? [];
}

async function save(
  guildId: string,
  existing: Rule | null,
  metadata: { keyword_filter?: string[]; allow_list?: string[] },
  exempt?: string[],
): Promise<{ ok: true } | { ok: false; why: string }> {
  const merged = {
    keyword_filter: metadata.keyword_filter ?? listOf(existing, "keyword_filter"),
    allow_list: metadata.allow_list ?? listOf(existing, "allow_list"),
  };

  const result = existing
    ? await patchRule(
        guildId,
        existing.id,
        { trigger_metadata: merged, ...(exempt ? { exempt_roles: exempt } : {}) },
        REASON,
      )
    : await createRule(
        guildId,
        WORDS,
        KEYWORD,
        {
          trigger_metadata: merged,
          actions: [blockAction("That word is filtered here.")],
          exempt_roles: exempt ?? [],
        },
        REASON,
      );

  return result.ok ? { ok: true } : { ok: false, why: explain(result.message) };
}

export async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "add a filtered word");
  if (!guildId) return;

  const word = ctx.argument.trim().toLowerCase();
  if (!word) {
    await card(ctx, [`### ${HEADING}`, "Use `filter add <word>`."].join("\n"));
    return;
  }
  if (word.length > MAX_WORD) {
    await card(ctx, [`### ${HEADING}`, `A filtered word can be at most ${MAX_WORD} characters.`].join("\n"));
    return;
  }

  const held = await rule(guildId);
  const current = listOf(held, "keyword_filter");
  if (current.includes(word)) {
    await card(ctx, [`### ${HEADING}`, `\`${word}\` is already filtered.`].join("\n"));
    return;
  }
  if (current.length >= MAX_KEYWORDS) {
    await card(ctx, [`### ${HEADING}`, `Discord allows ${MAX_KEYWORDS} filtered words at most.`].join("\n"));
    return;
  }

  const saved = await save(guildId, held, { keyword_filter: [...current, word] });
  await card(
    ctx,
    saved.ok
      ? [
          `### ${HEADING}`,
          `\`${word}\` is filtered. Discord blocks it before the message posts.`,
          `-# ${current.length + 1} filtered word${current.length ? "s" : ""} · \`*\` wildcards work, like \`spam*\`.`,
        ].join("\n")
      : [`### ${HEADING}`, "That could not be saved.", `-# ${saved.why}`].join("\n"),
  );
}

export async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "remove a filtered word");
  if (!guildId) return;

  const word = ctx.argument.trim().toLowerCase();
  if (!word) {
    await card(ctx, [`### ${HEADING}`, "Use `filter remove <word>`."].join("\n"));
    return;
  }

  const held = await rule(guildId);
  const current = listOf(held, "keyword_filter");
  if (!current.includes(word)) {
    await card(ctx, [`### ${HEADING}`, `\`${word}\` is not filtered.`].join("\n"));
    return;
  }

  const kept = current.filter((entry) => entry !== word);
  const saved =
    kept.length === 0 && held
      ? await deleteRule(guildId, held.id, REASON).then((r) =>
          r.ok ? { ok: true as const } : { ok: false as const, why: explain(r.message) },
        )
      : await save(guildId, held, { keyword_filter: kept });

  await card(
    ctx,
    saved.ok
      ? [
          `### ${HEADING}`,
          `\`${word}\` is no longer filtered.`,
          kept.length === 0 ? "-# That was the last one, so the rule is gone." : `-# ${kept.length} left.`,
        ].join("\n")
      : [`### ${HEADING}`, "That could not be saved.", `-# ${saved.why}`].join("\n"),
  );
}

export async function whitelist(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "whitelist a word");
  if (!guildId) return;

  const word = ctx.argument.trim().toLowerCase();
  const held = await rule(guildId);
  const allowed = listOf(held, "allow_list");

  if (!word) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        allowed.length ? allowed.map((entry) => `\`${entry}\``).join(" · ") : "Nothing is whitelisted.",
        "",
        `-# ${allowed.length} whitelisted · \`filter whitelist <word>\` adds or removes one.`,
      ].join("\n"),
    );
    return;
  }

  if (!held) {
    await card(ctx, [`### ${HEADING}`, "There is no word filter to whitelist against yet."].join("\n"));
    return;
  }

  const has = allowed.includes(word);
  if (!has && allowed.length >= MAX_ALLOW) {
    await card(ctx, [`### ${HEADING}`, `Discord allows ${MAX_ALLOW} whitelisted words at most.`].join("\n"));
    return;
  }

  const next = has ? allowed.filter((entry) => entry !== word) : [...allowed, word];
  const saved = await save(guildId, held, { allow_list: next });

  await card(
    ctx,
    saved.ok
      ? [
          `### ${HEADING}`,
          has ? `\`${word}\` is no longer whitelisted.` : `\`${word}\` is allowed through the filter.`,
        ].join("\n")
      : [`### ${HEADING}`, "That could not be saved.", `-# ${saved.why}`].join("\n"),
  );
}

export async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "list the filtered words");
  if (!guildId) return;

  const held = await rule(guildId);
  const filtered = listOf(held, "keyword_filter");
  const allowed = listOf(held, "allow_list");

  if (filtered.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No words are filtered."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      filtered.slice(0, 60).map((entry) => `\`${entry}\``).join(" · "),
      allowed.length ? `\n**Whitelisted**\n${allowed.map((e) => `\`${e}\``).join(" · ")}` : "",
      "",
      `-# ${filtered.length} filtered${filtered.length > 60 ? ", showing 60" : ""}` +
        `${held?.enabled === false ? " · the rule is switched off" : ""}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function reset(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "reset the word filter");
  if (!guildId) return;

  const held = await rule(guildId);
  if (!held) {
    await card(ctx, [`### ${HEADING}`, "There is no word filter to reset."].join("\n"));
    return;
  }

  const gone = await deleteRule(guildId, held.id, REASON);
  await card(
    ctx,
    gone.ok
      ? [`### ${HEADING}`, "Every filtered word is gone."].join("\n")
      : [`### ${HEADING}`, "That could not be removed.", `-# ${explain(gone.message)}`].join("\n"),
  );
}

export async function exempt(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "exempt a role from the word filter");
  if (!guildId) return;

  const held = await rule(guildId);
  const current = held?.exempt_roles ?? [];
  const token = ctx.argument.trim();

  if (!token || token.toLowerCase() === "list") {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        current.length ? roleList(current) : "No role is exempt from the word filter.",
        "",
        `-# ${current.length} of ${MAX_EXEMPT_ROLES} · \`filter exempt <role>\` adds or removes one.`,
      ].join("\n"),
    );
    return;
  }

  if (!held) {
    await card(ctx, [`### ${HEADING}`, "There is no word filter to exempt anyone from yet."].join("\n"));
    return;
  }

  const role = await findRole(guildId, token);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  const has = current.includes(role.id);
  if (!has && current.length >= MAX_EXEMPT_ROLES) {
    await card(ctx, [`### ${HEADING}`, `Discord allows ${MAX_EXEMPT_ROLES} exempt roles at most.`].join("\n"));
    return;
  }

  const next = has ? current.filter((id) => id !== role.id) : [...current, role.id];
  const saved = await patchRule(guildId, held.id, { exempt_roles: next }, REASON);

  await card(
    ctx,
    saved.ok
      ? [
          `### ${HEADING}`,
          has ? `<@&${role.id}> is filtered again.` : `<@&${role.id}> is exempt from the word filter.`,
        ].join("\n")
      : [`### ${HEADING}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
  );
}

export function wordCount(rule: Rule | null): number {
  return listOf(rule, "keyword_filter").length;
}

export { words };
