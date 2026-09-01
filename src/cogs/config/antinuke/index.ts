import { sql } from "../../../core/db.js";
import { getGuild } from "../../../core/discord.js";
import { flushProtection } from "../../../core/protection.js";
import { paginate } from "../../../core/pager.js";
import { requireOwner } from "../../../core/permissions.js";
import { groupUnder, lookupIn, register, type PrefixContext } from "../../../core/prefix.js";
import { numberFor, parseFlags, unknownFlags, type CommandFlag } from "../../../helpers/flags.js";
import { plain } from "../../../helpers/markdown.js";
import { container, text, IS_COMPONENTS_V2 } from "../../../helpers/components.js";
import {
  BOUNDS,
  MODULES,
  PUNISHMENTS,
  clearList,
  listOf,
  clearSpamExempt,
  setModule,
  setPunishment,
  settingsFor,
  toggleOn,
  toggleSpamExempt,
  type Module,
  type Punishment,
} from "./store.js";
import { registerSpam } from "./spam.js";
import { registerWatch } from "./watch.js";

const USER = /^<@!?(\d{15,25})>$/;

const CHANNEL = /^<#(\d{15,25})>$/;

function channelId(token: string | undefined): string | null {
  if (!token) return null;
  const mention = CHANNEL.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

function userId(token: string | undefined): string | null {
  if (!token) return null;
  const mention = USER.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

function words(argument: string): string[] {
  return argument.trim().split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply({
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [container(null, text(lines.join("\n")))],
  });
}

function pagesOf(heading: string, lines: string[], perPage = 10, footer?: string): unknown[][] {
  if (lines.length === 0) {
    return [[{ type: 10, content: `### ${heading}\n-# ${footer ?? "nobody yet"}` }]];
  }
  const count = Math.ceil(lines.length / perPage);
  return Array.from({ length: count }, (_, page) => {
    const slice = lines.slice(page * perPage, (page + 1) * perPage);
    const tail = [footer, count > 1 ? `page ${page + 1} of ${count}` : null].filter(Boolean).join(" · ");
    return [{ type: 10, content: [`### ${heading}`, ...slice, ...(tail ? [`-# ${tail}`] : [])].join("\n") }];
  });
}

// Declared once: the help card reads these and so does the command. `--per` and
// `--window` are kept as spellings because they were the ones this shipped with.
const THRESHOLD: CommandFlag = {
  name: "threshold",
  description: "How many it takes to trip the module.",
  aliases: ["t", "count"],
  takes: "<1-50>",
};

const DURATION: CommandFlag = {
  name: "duration",
  description: "The window the count is measured over, before it resets.",
  aliases: ["per", "window", "seconds"],
  takes: "<5-600s>",
};

const COUNTING_FLAGS = [THRESHOLD, DURATION];

const ON = new Set(["on", "enable", "enabled", "true", "yes"]);

const OFF = new Set(["off", "disable", "disabled", "false", "no"]);

const WHAT: Record<Module, string> = {
  ban: "members being banned",
  kick: "members being kicked",
  channel: "channels being created or deleted",
  role: "roles being created or deleted",
  emoji: "emojis being created or deleted",
  webhook: "webhooks being created or deleted",
  bot: "bots being added",
  permissions: "dangerous permissions being granted to a role",
  webhookspam: "mass-mention spam through webhooks",
};

// `bot` and `permissions` take no threshold: one is already too many, and
// pretending otherwise would invite somebody to set it to five.
const COUNTABLE = new Set<Module>([
  "ban",
  "kick",
  "channel",
  "role",
  "emoji",
  "webhook",
  "webhookspam",
]);

function moduleCommand(module: Module) {
  return async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireOwner(ctx, "change the antinuke settings");
    if (!guildId) return;

    const parsed = parseFlags(ctx.argument);
    const said = words(parsed.rest)[0]?.toLowerCase() ?? "";
    const settings = await settingsFor(guildId);
    const held = settings.modules[module];

    // A misspelt flag would otherwise be dropped in silence, and somebody would
    // walk away believing they had set a threshold they had not.
    const strange = unknownFlags(parsed, COUNTABLE.has(module) ? COUNTING_FLAGS : []);
    if (strange.length > 0) {
      await card(ctx, [
        `\`--${plain(strange[0] ?? "", 30)}\` is not a flag here.`,
        "",
        ...(COUNTABLE.has(module)
          ? COUNTING_FLAGS.map((one) => `-# \`--${one.name} ${one.takes}\` — ${one.description}`)
          : ["-# This one takes no flags: the first one trips it."]),
      ]);
      return;
    }

    if (!said) {
      await card(ctx, [
        `### ${module} — ${held.on ? "on" : "off"}`,
        `-# Watches for ${WHAT[module]}.`,
        ...(COUNTABLE.has(module)
          ? [`-# ${held.threshold} in ${Math.round(held.windowMs / 1000)}s trips it.`]
          : ["-# The first one trips it."]),
        "",
        `-# \`antinuke ${module} on\`` +
          (COUNTABLE.has(module) ? " · `--threshold 3` · `--duration 60`" : ""),
      ]);
      return;
    }

    if (!ON.has(said) && !OFF.has(said)) {
      await card(ctx, ["On or off?", "", `-# \`antinuke ${module} on\``]);
      return;
    }

    const patch: { on: boolean; threshold?: number; windowMs?: number } = { on: ON.has(said) };
    const notes: string[] = [];

    if (COUNTABLE.has(module)) {
      const threshold = numberFor(parsed, THRESHOLD);
      if (threshold !== null) {
        if (threshold < BOUNDS.threshold.least || threshold > BOUNDS.threshold.most) {
          await card(ctx, [
            `A threshold has to be between ${BOUNDS.threshold.least} and ${BOUNDS.threshold.most}.`,
          ]);
          return;
        }
        patch.threshold = Math.round(threshold);
        notes.push(`threshold ${patch.threshold}`);
      }

      const per = numberFor(parsed, DURATION);
      if (per !== null) {
        if (per < BOUNDS.seconds.least || per > BOUNDS.seconds.most) {
          await card(ctx, [
            `A window has to be between ${BOUNDS.seconds.least} and ${BOUNDS.seconds.most} seconds.`,
          ]);
          return;
        }
        patch.windowMs = Math.round(per) * 1000;
        notes.push(`per ${Math.round(per)}s`);
      }
    }

    const next = await setModule(guildId, module, patch);
    await card(ctx, [
      `### ${module} is ${next.on ? "on" : "off"}`,
      `-# ${WHAT[module]}`,
      ...(next.on && COUNTABLE.has(module)
        ? [`-# ${next.threshold} in ${Math.round(next.windowMs / 1000)}s`]
        : []),
      ...(notes.length ? [`-# set ${notes.join(", ")}`] : []),
      ...(next.on ? [`-# punishment: **${settings.punishment}**`] : []),
    ]);
  };
}

async function punishment(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "change the antinuke punishment");
  if (!guildId) return;

  const said = words(ctx.argument)[0]?.toLowerCase() ?? "";
  if (!said) {
    const settings = await settingsFor(guildId);
    await card(ctx, [
      `### Punishment: ${settings.punishment}`,
      `-# One of ${PUNISHMENTS.map((one) => `\`${one}\``).join(" · ")}`,
    ]);
    return;
  }

  if (!(PUNISHMENTS as readonly string[]).includes(said)) {
    await card(ctx, [
      "That is not one of them.",
      "",
      `-# ${PUNISHMENTS.map((one) => `\`${one}\``).join(" · ")}`,
    ]);
    return;
  }

  await setPunishment(guildId, said as Punishment);
  await card(ctx, [
    `### Punishment is ${said}`,
    ...(said === "jail" ? ["-# Needs a jail role set — `jail` in the moderation commands."] : []),
    ...(said === "stripstaff" ? ["-# Takes every role that carries a dangerous permission."] : []),
  ]);
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "see the antinuke settings");
  if (!guildId) return;

  const settings = await settingsFor(guildId);
  const guild = await getGuild(guildId);
  const on = MODULES.filter((one) => settings.modules[one].on);

  await card(ctx, [
    `### Antinuke — ${on.length} of ${MODULES.length} on`,
    ...MODULES.map((one) => {
      const held = settings.modules[one];
      return (
        `${held.on ? "**on** " : "off "}\`${one}\`` +
        (held.on && COUNTABLE.has(one)
          ? ` — ${held.threshold} in ${Math.round(held.windowMs / 1000)}s`
          : held.on
            ? " — first one trips it"
            : "")
      );
    }),
    "",
    `-# punishment: **${settings.punishment}**`,
    `-# ${settings.trusted.size} trusted · ${settings.whitelisted.size} whitelisted`,
    `-# the server owner (<@${guild?.owner_id ?? "?"}>) is never punished`,
  ]);
}

function listCommand(
  roll: "antinuke_trust" | "antinuke_whitelist",
  label: string,
  what: string,
) {
  return {
    async toggle(ctx: PrefixContext): Promise<void> {
      const guildId = await requireOwner(ctx, `change the antinuke ${label}`);
      if (!guildId) return;

      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const who = userId(words(ctx.argument)[0]);
      if (!who) {
        if (sub) {
          await card(ctx, ["Which member?", "", `-# \`antinuke ${label} @member\``]);
          return;
        }
        await card(ctx, [`Which member?`, "", `-# \`antinuke ${label} @member\``]);
        return;
      }

      const added = await toggleOn(roll, guildId, who);
      await card(ctx, [
        added ? `<@${who}> ${what}.` : `<@${who}> no longer ${what}.`,
        ...(added && roll === "antinuke_whitelist"
          ? ["-# They will not be punished by any antinuke module."]
          : []),
        ...(added && roll === "antinuke_trust"
          ? ["-# They can change these settings, and are never punished."]
          : []),
      ]);
    },

    async clear(ctx: PrefixContext): Promise<void> {
      const guildId = await requireOwner(ctx, `clear the antinuke ${label}`);
      if (!guildId) return;
      const gone = await clearList(roll, guildId);
      await card(ctx, [`### Cleared`, `-# ${gone} removed from the ${label}.`]);
    },

    async list(ctx: PrefixContext): Promise<void> {
      const guildId = await requireOwner(ctx, `see the antinuke ${label}`);
      if (!guildId) return;
      const held = await listOf(roll, guildId);
      await paginate(
        ctx,
        pagesOf(
          `${held.length} ${label}`,
          held.map((one) => `<@${one}> — \`${one}\``),
          10,
          held.length ? undefined : `nobody yet — \`antinuke ${label} @member\``,
        ),
        null,
      );
    },
  };
}

const trust = listCommand("antinuke_trust", "trust", "can manage the antinuke");

const whitelist = listCommand("antinuke_whitelist", "whitelist", "is excluded from the antinuke");

/**
 * Channels where a webhook may mass-mention.
 *
 * One command rather than three, because an exemption list is read far more
 * often than it is edited: no argument shows it, a channel toggles it, and
 * `clear` empties it.
 */
async function spamExempt(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "change the webhook spam exemptions");
  if (!guildId) return;

  const said = words(ctx.argument)[0] ?? "";
  const settings = await settingsFor(guildId);

  if (!said) {
    const held = [...settings.spamExempt];
    await card(ctx, [
      `### ${held.length} exempt channel${held.length === 1 ? "" : "s"}`,
      ...(held.length
        ? held.map((one) => `<#${one}> — \`${one}\``)
        : ["-# None. A webhook mass-mentioning anywhere is treated as an attack."]),
      "",
      "-# `antinuke webhookspam exempt #channel` · `… exempt clear`",
    ]);
    return;
  }

  if (/^(clear|reset|purge)$/i.test(said)) {
    const gone = await clearSpamExempt(guildId);
    await card(ctx, ["### Cleared", `-# ${gone} channel${gone === 1 ? "" : "s"} no longer exempt.`]);
    return;
  }

  const channel = channelId(said);
  if (!channel) {
    await card(ctx, ["Which channel?", "", "-# `antinuke webhookspam exempt #announcements`"]);
    return;
  }

  const added = await toggleSpamExempt(guildId, channel);
  await card(ctx, [
    added
      ? `Webhooks may mass-mention in <#${channel}>.`
      : `<#${channel}> is no longer exempt.`,
    ...(added
      ? ["-# Nothing posted there by a webhook will be removed, whatever it mentions."]
      : []),
  ]);
}

/**
 * What the protective features have actually done, and how quickly.
 *
 * The antinuke tells the owner as it happens; the filters delete a message and
 * say nothing at all. Without this there was no way to tell a filter that is
 * working from one that is switched off, which is the question somebody asks
 * right after they set one up.
 */
async function log(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "see what the protections have done");
  if (!guildId) return;

  // Anything still buffered belongs in the answer, or the log contradicts the
  // message somebody just watched disappear.
  await flushProtection();

  const rows = await sql<
    { source: string; actor: string; detail: string; outcome: string; took_ms: number; at: Date }[]
  >`
    SELECT source, actor, detail, outcome, took_ms, at FROM protection_events
    WHERE guild_id = ${guildId} ORDER BY at DESC LIMIT 200
  `;

  const lines = rows.map((row) => {
    const when = `<t:${Math.floor(row.at.getTime() / 1000)}:R>`;
    const who = /^\d{15,25}$/.test(row.actor) ? `<@${row.actor}>` : `\`${plain(row.actor, 30)}\``;
    return (
      `\`${plain(row.source, 24)}\` ${who} — ${plain(row.detail, 60)}` +
      `\n-# ${plain(row.outcome, 60)} · **${row.took_ms}ms** · ${when}`
    );
  });

  const quickest = rows.length ? Math.min(...rows.map((one) => one.took_ms)) : 0;
  const slowest = rows.length ? Math.max(...rows.map((one) => one.took_ms)) : 0;

  await paginate(
    ctx,
    pagesOf(
      `${rows.length} protection action${rows.length === 1 ? "" : "s"}`,
      lines,
      6,
      rows.length
        ? `newest first · ${quickest}ms fastest, ${slowest}ms slowest`
        : "nothing yet — the antinuke and the filters both record here",
    ),
    null,
  );
}

async function root(ctx: PrefixContext): Promise<void> {
  const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
  const found = sub ? lookupIn("antinuke", sub) : undefined;
  if (found) {
    await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
    return;
  }
  await overview(ctx);
}

export function registerAntinuke(): void {
  registerWatch();
  registerSpam();

  register({
    name: "antinuke",
    aliases: ["antiwizz", "an", "aw"],
    description: "Protect your server from malicious users",
    handler: root,
  });

  groupUnder("antinuke", () => {
    register({ name: "ban", aliases: ["bans"], description: "Prevent members from being banned", handler: moduleCommand("ban"), flags: COUNTING_FLAGS });
    register({ name: "bot", aliases: ["bots", "botadd"], description: "Prevent bots from being added", handler: moduleCommand("bot") });
    register({ name: "channel", aliases: ["channels"], description: "Prevent channels being created or deleted", handler: moduleCommand("channel"), flags: COUNTING_FLAGS });
    register({ name: "emoji", aliases: ["emojis"], description: "Prevent emojis being created or deleted", handler: moduleCommand("emoji"), flags: COUNTING_FLAGS });
    register({ name: "kick", aliases: ["kicks"], description: "Prevent members from being kicked", handler: moduleCommand("kick"), flags: COUNTING_FLAGS });
    register({ name: "permissions", aliases: ["permission", "perms"], description: "Revert and punish dangerous permission grants", handler: moduleCommand("permissions") });
    register({ name: "punishment", aliases: ["action"], description: "Set the punishment for a tripped threshold", handler: punishment });
    register({ name: "role", aliases: ["roles"], description: "Prevent roles being created or deleted", handler: moduleCommand("role"), flags: COUNTING_FLAGS });
    register({
      name: "log",
      aliases: ["logs", "recent", "actions"],
      description: "What the protections have done, and how long each took",
      handler: log,
    });
    register({
      name: "settings",
      aliases: ["config", "cfg", "configuration", "overview", "view", "ov"],
      description: "View the current antinuke protection settings",
      handler: overview,
    });
    register({ name: "webhook", aliases: ["webhooks"], description: "Prevent webhooks being created or deleted", handler: moduleCommand("webhook"), flags: COUNTING_FLAGS });
    register({
      name: "webhookspam",
      aliases: ["wspam", "hookspam", "whspam", "mentionspam", "whook", "wh", "spam"],
      description: "Detect mass-mention spam sent through webhooks",
      flags: COUNTING_FLAGS,
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const nested = sub ? lookupIn("antinuke webhookspam", sub) : undefined;
        if (nested) {
          await nested.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await moduleCommand("webhookspam")(ctx);
      },
    });

    register({
      name: "trust",
      aliases: ["manager", "mod", "admin"],
      description: "Allow a member to manage the antinuke settings",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const nested = sub ? lookupIn("antinuke trust", sub) : undefined;
        if (nested) {
          await nested.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await trust.toggle(ctx);
      },
    });

    register({
      name: "whitelist",
      aliases: ["exempt", "wl"],
      description: "Exclude a user from being affected by the antinuke",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const nested = sub ? lookupIn("antinuke whitelist", sub) : undefined;
        if (nested) {
          await nested.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await whitelist.toggle(ctx);
      },
    });
  });

  groupUnder("antinuke webhookspam", () => {
    register({
      name: "exempt",
      aliases: ["allow", "ignore", "channel", "channels"],
      description: "Channels where a webhook may mass-mention",
      handler: spamExempt,
    });
  });

  groupUnder("antinuke trust", () => {
    register({ name: "clear", aliases: ["reset", "purge"], description: "Remove all antinuke managers", handler: trust.clear });
    register({ name: "list", aliases: ["ls", "view"], description: "View who may manage the antinuke", handler: trust.list });
  });

  groupUnder("antinuke whitelist", () => {
    register({ name: "clear", aliases: ["reset", "purge"], description: "Remove all whitelisted users", handler: whitelist.clear });
    register({ name: "list", aliases: ["ls", "view"], description: "View who is excluded from the antinuke", handler: whitelist.list });
  });
}

