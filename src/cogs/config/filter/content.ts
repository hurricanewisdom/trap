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
import { card, channelId, findRole, roleList, words, registerExempt } from "./shared.js";
import { allSettings, setChannel, setEnabled, setThreshold, toggleRole } from "./store.js";

const MUSIC = "musicfiles";

const SPAM = "spam";

const MUSIC_FILE = /\.(?:mp3|wav|flac|ogg|m4a|aac|wma|opus|aiff?|mid|midi)$/i;

const SPAM_WINDOW_MS = 5000;

const SPAM_FALLBACK = 5;

const recent = new Map<string, number[]>();

export function isMusic(event: MessageEvent): boolean {
  return event.attachments.some(
    (file) =>
      (file.contentType ?? "").startsWith("audio/") || MUSIC_FILE.test(file.filename ?? ""),
  );
}

function tooFast(guildId: string, channelId: string, userId: string, limit: number): boolean {
  const key = `${guildId}:${channelId}:${userId}`;
  const now = Date.now();
  const seen = (recent.get(key) ?? []).filter((at) => now - at < SPAM_WINDOW_MS);

  seen.push(now);
  recent.set(key, seen);

  if (recent.size > 5000) recent.clear();
  return seen.length > limit;
}

async function exemptHere(
  event: MessageEvent,
  exemptRoles: string[],
): Promise<boolean> {
  if (exemptRoles.length) {
    const member = await memberOf(event.guildId, event.authorId);
    if ((member?.roles ?? []).some((id) => exemptRoles.includes(id))) return true;
  }
  return hasPermission(event.guildId, event.authorId, PERMISSION.manageGuild);
}

async function police(event: MessageEvent): Promise<void> {
  const settings = await allSettings(event.guildId);
  if (settings.size === 0) return;

  const music = settings.get(MUSIC);
  if (music?.enabled && !music.exemptChannels.includes(event.channelId) && isMusic(event)) {
    if (!(await exemptHere(event, music.exemptRoles))) {
      await deleteMessage(event.channelId, event.messageId);
      return;
    }
  }

  const spam = settings.get(SPAM);
  if (!spam?.enabled || spam.exemptChannels.includes(event.channelId)) return;
  if (!tooFast(event.guildId, event.channelId, event.authorId, spam.threshold ?? SPAM_FALLBACK)) return;
  if (await exemptHere(event, spam.exemptRoles)) return;

  await deleteMessage(event.channelId, event.messageId);
}

interface Simple {
  kind: string;
  command: string;
  aliases: string[];
  label: string;
  what: string;
  threshold?: { unit: string; fallback: number };
}

const SPECS: Simple[] = [
  {
    kind: MUSIC,
    command: "musicfiles",
    aliases: ["music"],
    label: "Music file filter",
    what: "messages carrying a music file",
  },
  {
    kind: SPAM,
    command: "spam",
    aliases: ["antispam"],
    label: "Spam filter",
    what: "messages sent too fast",
    threshold: { unit: "messages per five seconds", fallback: SPAM_FALLBACK },
  },
];

async function status(ctx: PrefixContext, guildId: string, spec: Simple): Promise<void> {
  const held = (await allSettings(guildId)).get(spec.kind);
  const limit = held?.threshold ?? spec.threshold?.fallback;

  await card(
    ctx,
    [
      `### ${spec.label}`,
      held?.enabled
        ? `On. Deleting ${spec.what}${spec.threshold ? ` above **${limit} ${spec.threshold.unit}**` : ""}.`
        : `Off. It would delete ${spec.what}${spec.threshold ? ` above **${limit} ${spec.threshold.unit}**` : ""}.`,
      held?.exemptChannels?.length
        ? `Skipped in ${held.exemptChannels.map((id) => `<#${id}>`).join(" · ")}.`
        : "",
      held?.exemptRoles?.length ? `Exempt: ${roleList(held.exemptRoles)}` : "",
      "",
      `\`filter ${spec.command} on\` or \`off\` switches it`,
      spec.threshold ? `\`filter ${spec.command} on --threshold <n>\` sets the rate` : "",
      `\`filter ${spec.command} #channel off\` skips one channel`,
      `\`filter ${spec.command} exempt <role>\` exempts a role`,
      "",
      "-# Members with Manage Server are never filtered.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function build(spec: Simple): void {
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

    if (threshold !== null) {
      if (!spec.threshold) {
        await card(ctx, [`### ${spec.label}`, "This filter has no threshold to set."].join("\n"));
        return;
      }
      if (threshold < 1 || threshold > 100) {
        await card(ctx, [`### ${spec.label}`, "Give a rate between 1 and 100."].join("\n"));
        return;
      }
      await setThreshold(guildId, spec.kind, threshold);
    }

    const channel = parts[0] ? channelId(parts[0]) : null;
    const state = parts[channel ? 1 : 0] ? switchWord(parts[channel ? 1 : 0] as string) : null;

    if (channel) {
      if (state === null) {
        await card(ctx, [`### ${spec.label}`, `Use \`filter ${spec.command} #channel on\` or \`off\`.`].join("\n"));
        return;
      }
      await setChannel(guildId, spec.kind, channel, !state);
      await card(
        ctx,
        [`### ${spec.label}`, state ? `<#${channel}> is filtered again.` : `<#${channel}> is skipped.`].join("\n"),
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
    const current = (await allSettings(guildId)).get(spec.kind)?.exemptRoles ?? [];

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

export function registerContent(): void {
  onMessage(police);
  for (const spec of SPECS) build(spec);
}
