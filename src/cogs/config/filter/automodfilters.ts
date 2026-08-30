import {
  KEYWORD,
  MAX_ALLOW,
  MAX_EXEMPT_CHANNELS,
  MAX_EXEMPT_ROLES,
  blockAction,
  createRule,
  deleteRule,
  explain,
  patchRule,
  ruleFor,
  type Rule,
} from "../../../core/automod.js";
import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { parseFlags, switchWord } from "../../../helpers/flags.js";
import { card, channelId, findRole, roleList, words, registerExempt } from "./shared.js";

export interface Guarded {
  kind: string;
  command: string;
  aliases: string[];
  label: string;
  what: string;
  patterns: string[];
  blocked: string;
  whitelist?: boolean;
}

const BS = String.fromCharCode(92);

export const INVITES: Guarded = {
  kind: "invites",
  command: "invites",
  aliases: ["invite"],
  label: "Invite filter",
  what: "messages containing a server invite",
  blocked: "Invite links are not allowed here.",
  patterns: [
    `discord${BS}.(?:gg|me|io|li)/[${BS}w-]+`,
    `discord(?:app)?${BS}.com/invite/[${BS}w-]+`,
    `dsc${BS}.gg/[${BS}w-]+`,
    `invite${BS}.gg/[${BS}w-]+`,
  ],
};

export const LINKS: Guarded = {
  kind: "links",
  command: "links",
  aliases: ["link"],
  label: "Link filter",
  what: "messages containing a link",
  blocked: "Links are not allowed here.",
  patterns: [`https?://[${BS}S]+`, `www${BS}.[${BS}S]+${BS}.[a-z]{2,}`],
  whitelist: true,
};

export const GUARDED = [INVITES, LINKS];

async function held(guildId: string, spec: Guarded): Promise<Rule | null> {
  return ruleFor(guildId, spec.kind);
}

async function status(ctx: PrefixContext, guildId: string, spec: Guarded): Promise<void> {
  const rule = await held(guildId, spec);
  const allowed = rule?.trigger_metadata?.allow_list ?? [];

  await card(
    ctx,
    [
      `### ${spec.label}`,
      !rule
        ? `Off. Nothing is blocking ${spec.what}.`
        : rule.enabled
          ? `On. Discord blocks ${spec.what} before they post.`
          : `Set up but switched off.`,
      rule?.exempt_channels?.length
        ? `Skipped in ${rule.exempt_channels.map((id) => `<#${id}>`).join(" · ")}.`
        : "",
      rule?.exempt_roles?.length ? `Exempt: ${roleList(rule.exempt_roles)}` : "",
      spec.whitelist && allowed.length ? `Allowed: ${allowed.map((e) => `\`${e}\``).join(" · ")}` : "",
      "",
      `\`filter ${spec.command} on\` or \`off\` switches it`,
      `\`filter ${spec.command} #channel off\` skips one channel`,
      `\`filter ${spec.command} exempt <role>\` exempts a role`,
      spec.whitelist ? `\`filter ${spec.command} whitelist <text>\` lets a link through` : "",
      "",
      "-# Enforced by Discord itself, so a blocked message never posts.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function build(spec: Guarded): void {
  const main = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `change the ${spec.label.toLowerCase()}`);
    if (!guildId) return;

    const { rest } = parseFlags(ctx.argument);
    const parts = words(rest);

    if (parts.length === 0) {
      await status(ctx, guildId, spec);
      return;
    }

    const channel = parts[0] ? channelId(parts[0]) : null;
    const state = parts[channel ? 1 : 0] ? switchWord(parts[channel ? 1 : 0] as string) : null;
    const rule = await held(guildId, spec);

    if (channel) {
      if (!rule) {
        await card(ctx, [`### ${spec.label}`, `Switch it on first with \`filter ${spec.command} on\`.`].join("\n"));
        return;
      }
      if (state === null) {
        await card(ctx, [`### ${spec.label}`, `Use \`filter ${spec.command} #channel on\` or \`off\`.`].join("\n"));
        return;
      }

      const current = rule.exempt_channels ?? [];
      if (!state && current.length >= MAX_EXEMPT_CHANNELS) {
        await card(ctx, [`### ${spec.label}`, `Discord allows ${MAX_EXEMPT_CHANNELS} skipped channels at most.`].join("\n"));
        return;
      }

      const next = state ? current.filter((id) => id !== channel) : [...new Set([...current, channel])];
      const saved = await patchRule(guildId, rule.id, { exempt_channels: next }, spec.label);
      await card(
        ctx,
        saved.ok
          ? [`### ${spec.label}`, state ? `<#${channel}> is filtered again.` : `<#${channel}> is skipped.`].join("\n")
          : [`### ${spec.label}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
      );
      return;
    }

    if (state === null) {
      await status(ctx, guildId, spec);
      return;
    }

    if (!state) {
      if (!rule) {
        await card(ctx, [`### ${spec.label}`, "It is already off."].join("\n"));
        return;
      }
      const gone = await deleteRule(guildId, rule.id, spec.label);
      await card(
        ctx,
        gone.ok
          ? [`### ${spec.label}`, `Off. ${spec.what[0]?.toUpperCase()}${spec.what.slice(1)} are allowed again.`].join("\n")
          : [`### ${spec.label}`, "That could not be removed.", `-# ${explain(gone.message)}`].join("\n"),
      );
      return;
    }

    if (rule) {
      const saved = await patchRule(guildId, rule.id, { enabled: true }, spec.label);
      await card(
        ctx,
        saved.ok
          ? [`### ${spec.label}`, `On. Discord blocks ${spec.what}.`].join("\n")
          : [`### ${spec.label}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
      );
      return;
    }

    const made = await createRule(
      guildId,
      spec.kind,
      KEYWORD,
      {
        trigger_metadata: { regex_patterns: spec.patterns, allow_list: [] },
        actions: [blockAction(spec.blocked)],
      },
      spec.label,
    );
    await card(
      ctx,
      made.ok
        ? [`### ${spec.label}`, `On. Discord blocks ${spec.what} before they post.`].join("\n")
        : [`### ${spec.label}`, "That could not be created.", `-# ${explain(made.message)}`].join("\n"),
    );
  };

  const exempt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `exempt a role from the ${spec.label.toLowerCase()}`);
    if (!guildId) return;

    const rule = await held(guildId, spec);
    const current = rule?.exempt_roles ?? [];
    const token = ctx.argument.trim();

    if (!token || token.toLowerCase() === "list") {
      await card(
        ctx,
        [
          `### ${spec.label}`,
          current.length ? roleList(current) : "No role is exempt.",
          "",
          `-# ${current.length} of ${MAX_EXEMPT_ROLES} · \`filter ${spec.command} exempt <role>\` adds or removes one.`,
        ].join("\n"),
      );
      return;
    }

    if (!rule) {
      await card(ctx, [`### ${spec.label}`, `Switch it on first with \`filter ${spec.command} on\`.`].join("\n"));
      return;
    }

    const role = await findRole(guildId, token);
    if (!role) {
      await card(ctx, [`### ${spec.label}`, "I cannot find that role."].join("\n"));
      return;
    }

    const has = current.includes(role.id);
    if (!has && current.length >= MAX_EXEMPT_ROLES) {
      await card(ctx, [`### ${spec.label}`, `Discord allows ${MAX_EXEMPT_ROLES} exempt roles at most.`].join("\n"));
      return;
    }

    const next = has ? current.filter((id) => id !== role.id) : [...current, role.id];
    const saved = await patchRule(guildId, rule.id, { exempt_roles: next }, spec.label);
    await card(
      ctx,
      saved.ok
        ? [`### ${spec.label}`, has ? `<@&${role.id}> is filtered again.` : `<@&${role.id}> is exempt.`].join("\n")
        : [`### ${spec.label}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
    );
  };

  const whitelist = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `whitelist a link`);
    if (!guildId) return;

    const rule = await held(guildId, spec);
    const allowed = rule?.trigger_metadata?.allow_list ?? [];
    const token = words(ctx.argument).filter((word) => !channelId(word)).join(" ").trim();

    if (!token) {
      await card(
        ctx,
        [
          `### ${spec.label}`,
          allowed.length ? allowed.map((e) => `\`${e}\``).join(" · ") : "Nothing is allowed through.",
          "",
          `-# ${allowed.length} of ${MAX_ALLOW} · \`filter ${spec.command} whitelist <text>\` adds or removes one.`,
          "-# Discord applies an allow list to the whole server, not one channel.",
        ].join("\n"),
      );
      return;
    }

    if (!rule) {
      await card(ctx, [`### ${spec.label}`, `Switch it on first with \`filter ${spec.command} on\`.`].join("\n"));
      return;
    }

    const has = allowed.includes(token);
    if (!has && allowed.length >= MAX_ALLOW) {
      await card(ctx, [`### ${spec.label}`, `Discord allows ${MAX_ALLOW} entries at most.`].join("\n"));
      return;
    }

    const next = has ? allowed.filter((e) => e !== token) : [...allowed, token];
    const saved = await patchRule(
      guildId,
      rule.id,
      { trigger_metadata: { regex_patterns: spec.patterns, allow_list: next } },
      spec.label,
    );
    await card(
      ctx,
      saved.ok
        ? [`### ${spec.label}`, has ? `\`${token}\` is blocked again.` : `\`${token}\` is allowed through.`].join("\n")
        : [`### ${spec.label}`, "That could not be saved.", `-# ${explain(saved.message)}`].join("\n"),
    );
  };

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn(`filter ${spec.command}`, sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await main(ctx);
  };

  register({
    name: spec.command,
    aliases: spec.aliases,
    description: `Delete ${spec.what}`,
    handler,
  });

  groupUnder(`filter ${spec.command}`, () => {
    registerExempt(`filter ${spec.command}`, spec.label.toLowerCase(), exempt);

    if (spec.whitelist) {
      register({
        name: "whitelist",
        aliases: ["allow"],
        description: "Let a link through the filter",
        handler: whitelist,
      });
    }
  });
}

export function registerGuarded(): void {
  for (const spec of GUARDED) build(spec);
}
