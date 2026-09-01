import {
  MAX_EXEMPT_ROLES,
  MENTION_SPAM,
  blockAction,
  createRule,
  explain,
  mentionRule,
  patchRule,
} from "../../../core/automod.js";
import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { numberFor, parseFlags, switchWord } from "../../../helpers/flags.js";
import { HEADING, card, channelId, findRole, roleList, words, registerExempt, THRESHOLD, isListWord } from "./shared.js";

const LABEL = "Mass mention filter";

const REASON = "Server mass mention filter";

const DEFAULT_LIMIT = 5;

const MAX_LIMIT = 50;

function ownedNote(name: string): string {
  return name.startsWith("trap: ")
    ? ""
    : `-# This edits the server's existing **${name}** rule, because Discord allows only one.`;
}

async function status(ctx: PrefixContext, guildId: string): Promise<void> {
  const rule = await mentionRule(guildId);

  if (!rule) {
    await card(
      ctx,
      [
        `### ${LABEL}`,
        "No mention rule exists yet.",
        "",
        "`automod mentions on --threshold 5` creates one",
        "",
        "-# Discord enforces this itself, so the message never posts.",
      ].join("\n"),
    );
    return;
  }

  await card(
    ctx,
    [
      `### ${LABEL}`,
      rule.enabled
        ? `On. Blocking messages with **${rule.trigger_metadata?.mention_total_limit ?? DEFAULT_LIMIT}** mentions or more.`
        : `Off. It would block at **${rule.trigger_metadata?.mention_total_limit ?? DEFAULT_LIMIT}** mentions.`,
      rule.exempt_channels?.length
        ? `Skipped in ${rule.exempt_channels.map((id) => `<#${id}>`).join(" · ")}.`
        : "",
      rule.exempt_roles?.length ? `Exempt: ${roleList(rule.exempt_roles)}` : "",
      "",
      "`automod mentions on` or `off` switches it",
      "`automod mentions on --threshold <n>` sets the limit",
      "`automod mentions #channel off` skips one channel",
      "`automod mentions whitelist <role>` exempts a role",
      "",
      ownedNote(rule.name),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function main(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the mass mention filter");
  if (!guildId) return;

  const parsed = parseFlags(ctx.argument);
    const { rest } = parsed;
  const parts = words(rest);
  const threshold = numberFor(parsed, THRESHOLD);

  if (parts.length === 0 && threshold === null) {
    await status(ctx, guildId);
    return;
  }

  if (threshold !== null && (threshold < 1 || threshold > MAX_LIMIT)) {
    await card(ctx, [`### ${LABEL}`, `Discord allows a limit between 1 and ${MAX_LIMIT}.`].join("\n"));
    return;
  }

  const channel = parts[0] ? channelId(parts[0]) : null;
  const state = parts[channel ? 1 : 0] ? switchWord(parts[channel ? 1 : 0] as string) : null;
  const rule = await mentionRule(guildId);

  if (!rule) {
    const made = await createRule(
      guildId,
      "mentions",
      MENTION_SPAM,
      {
        trigger_metadata: { mention_total_limit: threshold ?? DEFAULT_LIMIT },
        actions: [blockAction("Too many mentions.")],
        enabled: state ?? true,
      },
      REASON,
    );
    await card(
      ctx,
      made.ok
        ? [`### ${LABEL}`, `On, blocking at **${threshold ?? DEFAULT_LIMIT}** mentions.`].join("\n")
        : [`### ${LABEL}`, "That could not be saved.", `-# ${explain(made.message)}`].join("\n"),
    );
    return;
  }

  const draft: Record<string, unknown> = {};
  if (threshold !== null) {
    draft.trigger_metadata = { mention_total_limit: threshold };
  }

  if (channel) {
    if (state === null) {
      await card(ctx, [`### ${LABEL}`, "Use `automod mentions #channel on` or `off`."].join("\n"));
      return;
    }
    const current = rule.exempt_channels ?? [];
    draft.exempt_channels = state
      ? current.filter((id) => id !== channel)
      : [...new Set([...current, channel])];
  } else if (state !== null) {
    draft.enabled = state;
  }

  const saved = await patchRule(guildId, rule.id, draft, REASON);
  if (!saved.ok) {
    await card(ctx, [`### ${LABEL}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"));
    return;
  }
  await status(ctx, guildId);
}

async function exempt(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "exempt a role from the mass mention filter");
  if (!guildId) return;

  const rule = await mentionRule(guildId);
  const current = rule?.exempt_roles ?? [];
  const token = ctx.argument.trim();

  if (!token || isListWord(token)) {
    await card(
      ctx,
      [
        `### ${LABEL}`,
        current.length ? roleList(current) : "No role is exempt.",
        "",
        `-# ${current.length} of ${MAX_EXEMPT_ROLES} · \`automod mentions whitelist <role>\` adds or removes one.`,
      ].join("\n"),
    );
    return;
  }

  if (!rule) {
    await card(ctx, [`### ${LABEL}`, "There is no mention rule to exempt anyone from yet."].join("\n"));
    return;
  }

  const role = await findRole(guildId, token);
  if (!role) {
    await card(ctx, [`### ${LABEL}`, "I cannot find that role."].join("\n"));
    return;
  }

  const has = current.includes(role.id);
  if (!has && current.length >= MAX_EXEMPT_ROLES) {
    await card(ctx, [`### ${LABEL}`, `Discord allows ${MAX_EXEMPT_ROLES} exempt roles at most.`].join("\n"));
    return;
  }

  const next = has ? current.filter((id) => id !== role.id) : [...current, role.id];
  const saved = await patchRule(guildId, rule.id, { exempt_roles: next }, REASON);

  await card(
    ctx,
    saved.ok
      ? [
          `### ${LABEL}`,
          has ? `<@&${role.id}> is filtered again.` : `<@&${role.id}> is exempt.`,
        ].join("\n")
      : [`### ${LABEL}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
  );
}

export function registerMentions(): void {
  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("automod mentions", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await main(ctx);
  };

  register({
    name: "mentions",
    aliases: ["mention", "pings", "ping", "massmention", "mentionspam"],
    description: "Delete messages with too many mentions",
    handler,
    flags: [THRESHOLD],
  });

  groupUnder("automod mentions", () => {
    registerExempt("automod mentions", "mass mention filter", exempt);
  });
}

export { HEADING };
