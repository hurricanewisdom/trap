import { getChannel } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { requireManageGuild } from "../../../core/permissions.js";
import { groupUnder, lookupIn, register, type PrefixContext } from "../../../core/prefix.js";
import { container, text, IS_COMPONENTS_V2 } from "../../../helpers/components.js";
import { humanDuration, parseDuration } from "../../../helpers/duration.js";
import { numberFor, parseFlags, textFor, unknownFlags, type CommandFlag } from "../../../helpers/flags.js";
import { plain } from "../../../helpers/markdown.js";
import { alert, invitesPaused, pauseFor, resume } from "./act.js";
import {
  BOUNDS,
  MODULES,
  PUNISHMENTS,
  setConfig,
  setModule,
  settingsFor,
  sleeping,
  toggleWhitelist,
  whitelistOf,
  type Module,
  type Punishment,
} from "./store.js";
import { registerWatch } from "./watch.js";

const USER = /^<@!?(\d{15,25})>$/;

const CHANNEL = /^<#(\d{15,25})>$/;

const idOf = (token: string | undefined, pattern: RegExp): string | null => {
  if (!token) return null;
  const found = pattern.exec(token);
  if (found?.[1]) return found[1];
  return /^\d{15,25}$/.test(token) ? token : null;
};

const words = (argument: string) => argument.trim().split(/\s+/).filter(Boolean);

async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply({
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [container(null, text(lines.join("\n")))],
  });
}

function pagesOf(heading: string, lines: string[], footer?: string): unknown[][] {
  if (lines.length === 0) {
    return [[{ type: 10, content: `### ${heading}\n-# ${footer ?? "nobody yet"}` }]];
  }
  const count = Math.ceil(lines.length / 10);
  return Array.from({ length: count }, (_, page) => {
    const slice = lines.slice(page * 10, (page + 1) * 10);
    const tail = [footer, count > 1 ? `page ${page + 1} of ${count}` : null].filter(Boolean).join(" · ");
    return [{ type: 10, content: [`### ${heading}`, ...slice, ...(tail ? [`-# ${tail}`] : [])].join("\n") }];
  });
}

const ON = new Set(["on", "enable", "enabled", "true", "yes"]);

const OFF = new Set(["off", "disable", "disabled", "false", "no"]);

const THRESHOLD: CommandFlag = {
  name: "threshold",
  description: "How many it takes to trip the module.",
  aliases: ["t", "count"],
  takes: "<1-200>",
};

const PUNISHMENT: CommandFlag = {
  name: "punishment",
  description: "What happens to whoever trips it.",
  aliases: ["action", "do"],
  takes: "<kick|ban|timeout>",
};

// `newaccount` shares the flag's name but not its meaning: it counts days, not
// events, and a card promising "1-200" for a bound that is really 1-365 is the
// exact drift declaring flags was meant to stop.
const AGE: CommandFlag = {
  name: "threshold",
  description: "How many days old an account has to be to get in.",
  aliases: ["days", "age", "t"],
  takes: "<1-365 days>",
};

// The window is positional -- `antiraid spam on 30s` -- because that is how it
// reads out loud, but the antinuke spells the same idea `--duration`, so both
// work rather than making somebody remember which group wants which.
const DURATION: CommandFlag = {
  name: "duration",
  description: "The window the count is measured over, before it resets.",
  aliases: ["per", "window", "timeframe"],
  takes: "<3-3600s>",
};

const COUNTING = [THRESHOLD, DURATION, PUNISHMENT];

const AGED = [AGE, PUNISHMENT];

const JOIN_ONLY = [PUNISHMENT];

const WHAT: Record<Module, string> = {
  massjoin: "several accounts joining at once",
  newaccount: "accounts younger than the threshold joining",
  avatar: "members joining with no profile picture",
  automation: "accounts that look automated joining",
  spam: "one member sending too many messages",
  mentionspam: "one member sending too many mentions",
  raidspam: "a channel flooded by several accounts",
};

// `massjoin`, `spam`, `mentionspam` and `raidspam` count events in a window.
// `avatar` and `automation` are yes-or-no. `newaccount` counts days, not events.
const COUNTED = new Set<Module>(["massjoin", "spam", "mentionspam", "raidspam"]);

const TIMED = new Set<Module>(["massjoin", "spam", "raidspam", "mentionspam"]);

function flagsFor(module: Module): CommandFlag[] {
  if (module === "newaccount") return AGED;
  return COUNTED.has(module) ? COUNTING : JOIN_ONLY;
}

function moduleCommand(module: Module) {
  return async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, "change the antiraid settings");
    if (!guildId) return;

    const parsed = parseFlags(ctx.argument);
    const declared = flagsFor(module);

    const strange = unknownFlags(parsed, declared);
    if (strange.length > 0) {
      await card(ctx, [
        `\`--${plain(strange[0] ?? "", 30)}\` is not a flag here.`,
        "",
        ...declared.map((one) => `-# \`--${one.name} ${one.takes}\` — ${one.description}`),
      ]);
      return;
    }

    const parts = words(parsed.rest);
    const said = parts[0]?.toLowerCase() ?? "";
    const settings = await settingsFor(guildId);
    const held = settings.modules[module];

    if (!said) {
      await card(ctx, [
        `### ${module} — ${held.on ? "on" : "off"}`,
        `-# Watches for ${WHAT[module]}.`,
        ...(COUNTED.has(module)
          ? [`-# ${held.threshold} in ${Math.round(held.windowMs / 1000)}s trips it.`]
          : module === "newaccount"
            ? [`-# Under ${held.threshold} days old trips it.`]
            : ["-# Any one of them trips it."]),
        `-# Punishment: **${held.punishment}**`,
        "",
        `-# \`antiraid ${module} on${TIMED.has(module) ? " 30s" : ""}\``,
      ]);
      return;
    }

    if (!ON.has(said) && !OFF.has(said)) {
      await card(ctx, ["On or off?", "", `-# \`antiraid ${module} on\``]);
      return;
    }

    const patch: Partial<{ on: boolean; threshold: number; windowMs: number; punishment: Punishment }> = {
      on: ON.has(said),
    };
    const notes: string[] = [];

    // Positional first, then the flag: `antiraid spam on 30s` and
    // `antiraid spam on --duration 30s` mean the same thing.
    const flagged = TIMED.has(module) ? numberFor(parsed, DURATION) : null;
    if (TIMED.has(module) && (parts[1] || flagged !== null)) {
      const ms = flagged !== null ? flagged * 1000 : parseDuration(parts.slice(1).join(" "));
      if (ms === null) {
        await card(ctx, [`\`${plain(parts.slice(1).join(" "), 40)}\` is not a length of time.`, "", "-# `30s` · `2m` · `1m30s`"]);
        return;
      }
      const seconds = Math.round(ms / 1000);
      if (seconds < BOUNDS.seconds.least || seconds > BOUNDS.seconds.most) {
        await card(ctx, [`A window has to be between ${BOUNDS.seconds.least}s and ${BOUNDS.seconds.most}s.`]);
        return;
      }
      patch.windowMs = seconds * 1000;
      notes.push(`over ${humanDuration(patch.windowMs)}`);
    }

    const threshold = numberFor(parsed, module === "newaccount" ? AGE : THRESHOLD);
    if (threshold !== null) {
      const bound = module === "newaccount" ? BOUNDS.days : BOUNDS.threshold;
      if (threshold < bound.least || threshold > bound.most) {
        await card(ctx, [`That has to be between ${bound.least} and ${bound.most}.`]);
        return;
      }
      patch.threshold = Math.round(threshold);
      notes.push(module === "newaccount" ? `under ${patch.threshold} days` : `${patch.threshold} of them`);
    }

    const how = textFor(parsed, PUNISHMENT)?.toLowerCase();
    if (how) {
      if (!(PUNISHMENTS as readonly string[]).includes(how)) {
        await card(ctx, ["That is not a punishment.", "", `-# ${PUNISHMENTS.map((o) => `\`${o}\``).join(" · ")}`]);
        return;
      }
      patch.punishment = how as Punishment;
      notes.push(how);
    }

    const next = await setModule(guildId, module, patch);
    await card(ctx, [
      `### ${module} is ${next.on ? "on" : "off"}`,
      `-# ${WHAT[module]}`,
      ...(next.on
        ? [
            COUNTED.has(module)
              ? `-# ${next.threshold} in ${Math.round(next.windowMs / 1000)}s → **${next.punishment}**`
              : module === "newaccount"
                ? `-# under ${next.threshold} days old → **${next.punishment}**`
                : `-# → **${next.punishment}**`,
          ]
        : []),
      ...(notes.length ? [`-# set ${notes.join(", ")}`] : []),
      ...(next.on && !settings.alertChannel ? ["-# No alert channel set — `antiraid channel #here`"] : []),
    ]);
  };
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the antiraid settings");
  if (!guildId) return;

  const settings = await settingsFor(guildId);
  const paused = await invitesPaused(guildId);
  const on = MODULES.filter((one) => settings.modules[one].on);

  await card(ctx, [
    `### Antiraid — ${on.length} of ${MODULES.length} on`,
    ...MODULES.map((one) => {
      const held = settings.modules[one];
      if (!held.on) return `off \`${one}\``;
      const how = COUNTED.has(one)
        ? `${held.threshold} in ${Math.round(held.windowMs / 1000)}s`
        : one === "newaccount"
          ? `under ${held.threshold} days`
          : "any";
      return `**on** \`${one}\` — ${how} → ${held.punishment}`;
    }),
    "",
    `-# invites: ${paused ? "**paused**" : "open"}` +
      (settings.pausedUntil && settings.pausedUntil > Date.now()
        ? ` until ${`<t:${Math.floor(settings.pausedUntil / 1000)}:R>`}`
        : ""),
    `-# a raid pauses them for ${humanDuration(settings.pauseMs)}`,
    `-# alerts: ${settings.alertChannel ? `<#${settings.alertChannel}>` : "nowhere"}`,
    `-# ${settings.whitelisted.size} whitelisted`,
    ...(sleeping(settings)
      ? [`-# **switched off** until <t:${Math.floor((settings.disabledUntil ?? 0) / 1000)}:R>`]
      : []),
  ]);
}

async function channel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the antiraid alert channel");
  if (!guildId) return;

  const said = words(ctx.argument)[0];
  if (!said) {
    const settings = await settingsFor(guildId);
    await card(ctx, [
      settings.alertChannel ? `Alerts go to <#${settings.alertChannel}>.` : "Alerts go nowhere.",
      "",
      "-# `antiraid channel #alerts` · `antiraid channel off`",
    ]);
    return;
  }

  if (OFF.has(said.toLowerCase()) || said.toLowerCase() === "none") {
    await setConfig(guildId, { alertChannel: null });
    await card(ctx, ["Alerts go nowhere now."]);
    return;
  }

  const id = idOf(said, CHANNEL);
  if (!id || !(await getChannel(id))) {
    await card(ctx, ["Which channel?", "", "-# `antiraid channel #alerts`"]);
    return;
  }
  await setConfig(guildId, { alertChannel: id });
  await card(ctx, [`Alerts go to <#${id}>.`]);
  await alert(guildId, ["### Antiraid alerts", "-# This channel will carry them."]);
}

function durationCommand(which: "pause" | "disable" | "duration") {
  return async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, "change the antiraid");
    if (!guildId) return;

    const said = ctx.argument.trim();
    const settings = await settingsFor(guildId);

    if (which === "duration") {
      if (!said) {
        await card(ctx, [
          `Invites pause for **${humanDuration(settings.pauseMs)}** when a raid trips it.`,
          "",
          "-# `antiraid duration 30m`",
        ]);
        return;
      }
      const ms = parseDuration(said);
      if (ms === null || ms < BOUNDS.pause.least || ms > BOUNDS.pause.most) {
        await card(ctx, [
          `Between ${humanDuration(BOUNDS.pause.least)} and ${humanDuration(BOUNDS.pause.most)}.`,
        ]);
        return;
      }
      await setConfig(guildId, { pauseMs: ms });
      await card(ctx, [`Invites will pause for **${humanDuration(ms)}**.`]);
      return;
    }

    if (which === "disable") {
      if (!said) {
        await card(ctx, [
          sleeping(settings)
            ? `The antiraid is off until <t:${Math.floor((settings.disabledUntil ?? 0) / 1000)}:R>.`
            : "The antiraid is running.",
          "",
          "-# `antiraid disable 1h` — off for a while, then back on by itself",
        ]);
        return;
      }
      const ms = parseDuration(said);
      if (ms === null || ms < 60_000 || ms > 24 * 3_600_000) {
        await card(ctx, ["Between a minute and a day.", "", "-# `antiraid disable 1h`"]);
        return;
      }
      await setConfig(guildId, { disabledUntil: new Date(Date.now() + ms) });
      await card(ctx, [
        `### Antiraid off for ${humanDuration(ms)}`,
        "-# It switches itself back on; nothing is watched until then.",
      ]);
      return;
    }

    // pause
    const ms = said ? parseDuration(said) : settings.pauseMs;
    if (ms === null || ms < BOUNDS.pause.least || ms > BOUNDS.pause.most) {
      await card(ctx, [
        `Between ${humanDuration(BOUNDS.pause.least)} and ${humanDuration(BOUNDS.pause.most)}.`,
      ]);
      return;
    }
    const ok = await pauseFor(guildId, ms, "somebody asked");
    await card(
      ctx,
      ok
        ? [`### Invites paused for ${humanDuration(ms)}`, "-# `antiraid resolve` lifts it early."]
        : ["Invites could not be paused.", "", "-# The bot needs **Manage Server**."],
    );
  };
}

async function resolve(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "resolve the antiraid state");
  if (!guildId) return;

  const paused = await invitesPaused(guildId);
  const settings = await settingsFor(guildId);

  if (!paused && !sleeping(settings)) {
    await card(ctx, [
      "### Nothing to resolve",
      "-# Invites are open and the antiraid is running.",
    ]);
    return;
  }

  const lines: string[] = ["### Resolved"];
  if (paused) {
    lines.push((await resume(guildId)) ? "-# Invites are open again." : "-# Invites could **not** be reopened.");
  }
  if (sleeping(settings)) {
    await setConfig(guildId, { disabledUntil: null });
    lines.push("-# The antiraid is watching again.");
  }
  await card(ctx, lines);
}

async function whitelist(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change the antiraid whitelist");
  if (!guildId) return;

  const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
  const nested = sub ? lookupIn("antiraid whitelist", sub) : undefined;
  if (nested) {
    await nested.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
    return;
  }

  const who = idOf(words(ctx.argument)[0], USER);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `antiraid whitelist @member` · `antiraid whitelist list`"]);
    return;
  }

  const added = await toggleWhitelist(guildId, who);
  await card(ctx, [
    added ? `<@${who}> is excluded from the antiraid.` : `<@${who}> is no longer excluded.`,
  ]);
}

async function whitelistList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the antiraid whitelist");
  if (!guildId) return;

  const held = await whitelistOf(guildId);
  await paginate(
    ctx,
    pagesOf(
      `${held.length} excluded`,
      held.map((one) => `<@${one}> — \`${one}\``),
      held.length ? undefined : "nobody yet — `antiraid whitelist @member`",
    ),
    null,
  );
}

async function root(ctx: PrefixContext): Promise<void> {
  const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
  const found = sub ? lookupIn("antiraid", sub) : undefined;
  if (found) {
    await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
    return;
  }
  await overview(ctx);
}

export function registerAntiraid(): void {
  registerWatch();

  register({
    name: "antiraid",
    // `raid` is deliberately absent. Moderation already has a real `,raid`
    // command for clearing up after one, and the config cog loads first, so
    // taking it as an alias here silently refused the actual command.
    aliases: ["warden", "wd"],
    description: "Automatically detect and prevent raids",
    handler: root,
  });

  groupUnder("antiraid", () => {
    register({ name: "automation", aliases: ["antispoof", "spoof", "browser", "selfbot", "alt", "web"], description: "Prevent likely automated accounts from joining", handler: moduleCommand("automation"), flags: JOIN_ONLY });
    register({ name: "avatar", aliases: ["pfp", "pfpcheck", "nopfp", "requirepfp"], description: "Require new members to have a profile picture", handler: moduleCommand("avatar"), flags: JOIN_ONLY });
    register({ name: "channel", aliases: ["alertchannel", "alerts", "log", "logs"], description: "Where raid and spam alerts are sent", handler: channel });
    register({ name: "disable", aliases: ["temp", "stop", "cancel"], description: "Temporarily switch the antiraid off", handler: durationCommand("disable") });
    register({ name: "duration", aliases: ["pausefor", "lockfor", "freezefor"], description: "How long invites pause when a raid is detected", handler: durationCommand("duration") });
    register({ name: "massjoin", aliases: ["massjoins", "mass", "join", "joins"], description: "Prevent several members joining at once", handler: moduleCommand("massjoin"), flags: COUNTING });
    register({ name: "mentionspam", aliases: ["mention", "mentions", "pingspam", "pings"], description: "Punish members that send too many mentions", handler: moduleCommand("mentionspam"), flags: COUNTING });
    register({ name: "newaccount", aliases: ["new", "accountage", "account", "age"], description: "Prevent members with new accounts from joining", handler: moduleCommand("newaccount"), flags: AGED });
    register({ name: "pause", aliases: ["lock", "freeze"], description: "Manually pause invites", handler: durationCommand("pause") });
    register({ name: "raidspam", aliases: ["flood", "massspam", "floodspam", "channelspam"], description: "Detect a channel being flooded and lock it", handler: moduleCommand("raidspam"), flags: COUNTING });
    register({ name: "resolve", aliases: ["status", "state", "resume", "unpause", "unlock", "unfreeze"], description: "Resolve the current raid or spam state", handler: resolve });
    register({ name: "settings", aliases: ["config", "cfg", "configuration", "overview", "view", "ov"], description: "View the current antiraid configuration", handler: overview });
    register({ name: "spam", aliases: ["msgspam", "messagespam"], description: "Detect one member spamming messages", handler: moduleCommand("spam"), flags: COUNTING });
    register({ name: "whitelist", aliases: ["exempt", "wl"], description: "Exclude a user from the antiraid", handler: whitelist });
  });

  groupUnder("antiraid whitelist", () => {
    register({ name: "list", aliases: ["ls", "view"], description: "View who is excluded from the antiraid", handler: whitelistList });
  });
}
