import { PERMISSION, deleteMessage, hasPermission, memberOf } from "../../../core/discord.js";
import { onMessage, type MessageEvent } from "../../../core/hooks.js";
import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { flagNumber, parseFlags, switchWord } from "../../../helpers/flags.js";
import { HEADING, card, channelId, findRole, roleList, words, registerExempt } from "./shared.js";
import { allSettings, clearKind, setChannel, setEnabled, setThreshold, toggleRole } from "./store.js";

const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;

const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;

const SPOILER = /\|\|[^|]+\|\|/g;

const MIN_CAPS_LENGTH = 8;

export interface Threshold {
  kind: string;
  command: string;
  aliases: string[];
  label: string;
  what: string;
  unit: string;
  fallback: number;
  count: (content: string) => number;
  measure: (content: string) => number | null;
}

export const CAPS: Threshold = {
  kind: "caps",
  command: "caps",
  aliases: ["uppercase"],
  label: "Caps filter",
  what: "messages that are mostly uppercase",
  unit: "percent uppercase",
  fallback: 70,
  count: (content) => content.replace(/[^A-Z]/g, "").length,
  measure: (content) => {
    const letters = content.replace(/[^a-zA-Z]/g, "");
    if (letters.length < MIN_CAPS_LENGTH) return null;
    return Math.round((letters.replace(/[^A-Z]/g, "").length / letters.length) * 100);
  },
};

export const EMOJI: Threshold = {
  kind: "emoji",
  command: "emoji",
  aliases: ["emojis"],
  label: "Emoji filter",
  what: "messages with too many emoji",
  unit: "emoji",
  fallback: 10,
  count: (content) =>
    (content.match(CUSTOM_EMOJI)?.length ?? 0) +
    (content.replace(CUSTOM_EMOJI, "").match(UNICODE_EMOJI)?.length ?? 0),
  measure: (content) => EMOJI.count(content),
};

export const SPOILERS: Threshold = {
  kind: "spoilers",
  command: "spoilers",
  aliases: ["spoiler"],
  label: "Spoiler filter",
  what: "messages with too many spoilers",
  unit: "spoilers",
  fallback: 5,
  count: (content) => content.match(SPOILER)?.length ?? 0,
  measure: (content) => SPOILERS.count(content),
};

export const THRESHOLDS = [CAPS, EMOJI, SPOILERS];

async function status(ctx: PrefixContext, guildId: string, spec: Threshold): Promise<void> {
  const held = (await allSettings(guildId)).get(spec.kind);
  const limit = held?.threshold ?? spec.fallback;

  await card(
    ctx,
    [
      `### ${spec.label}`,
      held?.enabled
        ? `On. Deleting ${spec.what} at **${limit} ${spec.unit}** or more.`
        : `Off. It would delete ${spec.what} at **${limit} ${spec.unit}** or more.`,
      held?.exemptChannels?.length ? `Skipped in ${held.exemptChannels.map((id) => `<#${id}>`).join(" · ")}.` : "",
      held?.exemptRoles?.length ? `Exempt: ${roleList(held.exemptRoles)}` : "",
      "",
      `\`filter ${spec.command} on\` or \`off\` switches it`,
      `\`filter ${spec.command} on --threshold <n>\` sets the limit`,
      `\`filter ${spec.command} #channel off\` skips one channel`,
      `\`filter ${spec.command} exempt <role>\` exempts a role`,
      "",
      "-# Members with Manage Server are never filtered.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function build(spec: Threshold): void {
  const main = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `change the ${spec.label.toLowerCase()}`);
    if (!guildId) return;

    const { rest, flags } = parseFlags(ctx.argument);
    const parts = words(rest);
    const threshold = flagNumber(flags, "threshold", "limit", "t");

    if (parts.length === 0 && threshold === null) {
      await status(ctx, guildId, spec);
      return;
    }

    const channel = parts[0] ? channelId(parts[0]) : null;
    const wordAt = channel ? 1 : 0;
    const state = parts[wordAt] ? switchWord(parts[wordAt] as string) : null;

    if (threshold !== null) {
      if (threshold < 1 || threshold > 1000) {
        await card(ctx, [`### ${spec.label}`, "Give a threshold between 1 and 1000."].join("\n"));
        return;
      }
      await setThreshold(guildId, spec.kind, threshold);
    }

    if (channel) {
      if (state === null) {
        await card(
          ctx,
          [`### ${spec.label}`, `Use \`filter ${spec.command} #channel on\` or \`off\`.`].join("\n"),
        );
        return;
      }
      await setChannel(guildId, spec.kind, channel, !state);
      await card(
        ctx,
        [
          `### ${spec.label}`,
          state ? `<#${channel}> is filtered again.` : `<#${channel}> is skipped.`,
        ].join("\n"),
      );
      return;
    }

    if (state !== null) await setEnabled(guildId, spec.kind, state);
    await status(ctx, guildId, spec);
  };

  const exempt = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `exempt a role from the ${spec.label.toLowerCase()}`);
    if (!guildId) return;

    const token = ctx.argument.trim();
    const held = (await allSettings(guildId)).get(spec.kind);
    const current = held?.exemptRoles ?? [];

    if (!token || token.toLowerCase() === "list") {
      await card(
        ctx,
        [
          `### ${spec.label}`,
          current.length ? roleList(current) : "No role is exempt.",
          "",
          `-# ${current.length} exempt · \`filter ${spec.command} exempt <role>\` adds or removes one.`,
        ].join("\n"),
      );
      return;
    }

    const role = await findRole(guildId, token);
    if (!role) {
      await card(ctx, [`### ${spec.label}`, "I cannot find that role."].join("\n"));
      return;
    }

    const outcome = await toggleRole(guildId, spec.kind, role.id);
    await card(
      ctx,
      [
        `### ${spec.label}`,
        outcome === "added" ? `<@&${role.id}> is exempt.` : `<@&${role.id}> is filtered again.`,
      ].join("\n"),
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
  });
}

export async function reset(guildId: string, kind: string): Promise<void> {
  await clearKind(guildId, kind);
}

async function police(event: MessageEvent): Promise<void> {
  if (!event.content) return;

  const settings = await allSettings(event.guildId);
  if (settings.size === 0) return;

  for (const spec of THRESHOLDS) {
    const held = settings.get(spec.kind);
    if (!held?.enabled) continue;
    if (held.exemptChannels.includes(event.channelId)) continue;

    const measured = spec.measure(event.content);
    if (measured === null || measured < (held.threshold ?? spec.fallback)) continue;

    if (held.exemptRoles.length) {
      const member = await memberOf(event.guildId, event.authorId);
      if ((member?.roles ?? []).some((id) => held.exemptRoles.includes(id))) continue;
    }
    if (await hasPermission(event.guildId, event.authorId, PERMISSION.manageGuild)) continue;

    await deleteMessage(event.channelId, event.messageId);
    return;
  }
}

export function registerThresholds(): void {
  onMessage(police, "filter");
  for (const spec of THRESHOLDS) build(spec);
}
