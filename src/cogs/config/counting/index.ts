import { channelExists, guildRoles } from "../../../core/discord.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { switchWord } from "../../../helpers/flags.js";
import { watchCounting } from "./game.js";
import {
  FLAGS,
  FLAG_NAMES,
  countingChannels,
  countingIn,
  leaderboard,
  reset as resetCount,
  set,
  setFlag,
  setup as setupChannel,
  stop,
  type Counting,
  type Flag,
} from "./store.js";

const HEADING = "Counting";

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const EMOJI = /^(?:<a?:[\w~]+:\d{15,25}>|\p{Extended_Pictographic}[\u{FE0F}\u{20E3}]*)$/u;

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function idFrom(token: string | undefined, pattern: RegExp): string | null {
  const mention = pattern.exec(token ?? "");
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token ?? "") ? (token as string) : null;
}

/**
 * Reads the leading channel argument and the counting channel behind it.
 *
 * Every command but `list` and the group roots starts with a channel, so the
 * parsing and the "that is not a counting channel" answer live here once.
 */
async function target(
  ctx: PrefixContext,
  action: string,
): Promise<{ guildId: string; held: Counting; rest: string[] } | null> {
  const guildId = await requireManageGuild(ctx, action);
  if (!guildId) return null;

  const tokens = words(ctx.argument);
  const id = idFrom(tokens[0], CHANNEL_MENTION);
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "Name a counting channel, like `#counting`."].join("\n"));
    return null;
  }
  tokens.shift();

  const held = await countingIn(id);
  if (!held) {
    await card(
      ctx,
      [`### ${HEADING}`, `<#${id}> is not a counting channel.`, "", `-# \`counting setup <#${id}>\` makes it one.`].join("\n"),
    );
    return null;
  }

  return { guildId, held, rest: tokens };
}

async function describe(held: Counting): Promise<string[]> {
  const on = FLAG_NAMES.filter((name) => held.flags[name]);
  return [
    `<#${held.channelId}> — at **${held.current}**, counting up by **${held.step}**`,
    `Record **${held.record}**${held.goalNumber === null ? "" : ` · goal **${held.goalNumber}**`}${held.lives > 0 ? ` · **${held.livesLeft}** of ${held.lives} lives` : ""}`,
    [
      held.cooldownSecs > 0 ? `cooldown ${held.cooldownSecs}s` : "",
      held.requiredRoleId ? `only <@&${held.requiredRoleId}>` : "",
      held.milestoneInterval ? `milestone every ${held.milestoneInterval}` : "",
      `${held.successEmoji} / ${held.failEmoji}`,
    ]
      .filter(Boolean)
      .join(" · "),
    on.length ? `-# On: ${on.join(", ")}` : "-# No toggles are on.",
  ];
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the counting channels");
  if (!guildId) return;

  const held = await countingChannels(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? `${held.length} channel${held.length === 1 ? "" : "s"} counting.`
        : "No channel is counting yet.",
      "",
      "`counting setup #channel` starts one",
      "`counting view #channel` shows where it is up to",
      "`counting set` and `counting toggle` change how it plays",
    ].join("\n"),
  );
}

async function setup(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set up a counting channel");
  if (!guildId) return;

  const tokens = words(ctx.argument);
  const id = idFrom(tokens.shift(), CHANNEL_MENTION);
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "Name a channel: `counting setup #channel`."].join("\n"));
    return;
  }
  if (!(await channelExists(guildId, id))) {
    await card(ctx, [`### ${HEADING}`, "I cannot see that channel."].join("\n"));
    return;
  }

  // `start=0 step=1` in the spec, and bare numbers in that order as well,
  // because that is how everybody will type it.
  let start = 0;
  let step = 1;
  for (const token of tokens) {
    const named = /^(start|step)\s*=\s*(-?\d+)$/i.exec(token);
    if (named) {
      if (named[1]?.toLowerCase() === "start") start = Number(named[2]);
      else step = Number(named[2]);
      continue;
    }
    if (/^-?\d+$/.test(token)) {
      if (start === 0) start = Number(token);
      else step = Number(token);
    }
  }

  if (step === 0) {
    await card(ctx, [`### ${HEADING}`, "A step of 0 would never reach the next number."].join("\n"));
    return;
  }

  await setupChannel(guildId, id, start, step);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${id}> is counting. The next number is **${start + step}**.`,
      `-# Counting up by ${step}. \`counting view <#${id}>\` shows the rest.`,
    ].join("\n"),
  );
}

async function view(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "see a counting channel");
  if (!found) return;
  await card(ctx, [`### ${HEADING}`, ...(await describe(found.held))].join("\n"));
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the counting channels");
  if (!guildId) return;

  const held = await countingChannels(guildId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No channel is counting yet."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held
        .map((one) => `<#${one.channelId}> — at **${one.current}**, record **${one.record}**`)
        .join("\n"),
      "",
      `-# ${held.length} channel${held.length === 1 ? "" : "s"}`,
    ].join("\n"),
  );
}

async function board(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the counting leaderboard");
  if (!guildId) return;

  const tokens = words(ctx.argument);
  const id = idFrom(tokens[0], CHANNEL_MENTION) ?? (await countingChannels(guildId))[0]?.channelId;
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "No channel is counting yet."].join("\n"));
    return;
  }

  const top = await leaderboard(id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Top counters in <#${id}>`,
      top.length
        ? top
            .map((one, at) => `**${at + 1}.** <@${one.userId}> — ${one.counts} count${one.counts === 1 ? "" : "s"}`)
            .join("\n")
        : "Nobody has counted here yet.",
    ].join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "stop a counting channel");
  if (!guildId) return;

  const id = idFrom(words(ctx.argument)[0], CHANNEL_MENTION);
  if (!id) {
    await card(ctx, [`### ${HEADING}`, "Name the channel to stop."].join("\n"));
    return;
  }

  const gone = await stop(id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone ? `<#${id}> is no longer counting. Its scores are gone too.` : "That channel was not counting.",
    ].join("\n"),
  );
}

async function resetIt(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "reset a count");
  if (!found) return;

  await resetCount(found.held.channelId, 0, found.held.lives);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${found.held.channelId}> is back to **0**. It reached **${found.held.current}**.`,
      `-# The record of **${found.held.record}** is kept.`,
    ].join("\n"),
  );
}

async function toggle(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "change a counting setting");
  if (!found) return;

  const name = (found.rest[0] ?? "").toLowerCase() as Flag;
  if (!FLAG_NAMES.includes(name)) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Name one of these:",
        FLAG_NAMES.map((one) => `\`${one}\``).join(" · "),
      ].join("\n"),
    );
    return;
  }

  // A second word switches it explicitly; without one it flips.
  const asked = switchWord(found.rest[1] ?? "");
  const next = asked === null ? !found.held.flags[name] : asked;

  await setFlag(found.held.channelId, name, next);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `\`${name}\` is **${next ? "on" : "off"}** in <#${found.held.channelId}>.`,
      next === FLAGS[name] ? "-# That is the default." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function numberSetter(
  field: "cooldown_secs" | "lives" | "step" | "current",
  what: string,
  low: number,
  high: number,
) {
  return async (ctx: PrefixContext): Promise<void> => {
    const found = await target(ctx, `set the ${what}`);
    if (!found) return;

    const value = Number.parseInt(found.rest[0] ?? "", 10);
    if (!Number.isInteger(value) || value < low || value > high) {
      await card(ctx, [`### ${HEADING}`, `Give a whole number from ${low} to ${high}.`].join("\n"));
      return;
    }
    if (field === "step" && value === 0) {
      await card(ctx, [`### ${HEADING}`, "A step of 0 would never reach the next number."].join("\n"));
      return;
    }

    await set(found.held.channelId, field, value);
    // Setting the lives ceiling refills them, or the channel keeps however many
    // were left from a smaller allowance.
    if (field === "lives") await set(found.held.channelId, "lives_left", value);

    await card(
      ctx,
      [
        `### ${HEADING}`,
        `The ${what} in <#${found.held.channelId}> is **${value}**${field === "cooldown_secs" && value === 0 ? "** (off)" : ""}.`,
        field === "current" ? `-# The next number is **${value + found.held.step}**.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  };
}

async function setEmoji(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "set a counting reaction");
  if (!found) return;

  const which = (found.rest[0] ?? "").toLowerCase();
  if (which !== "success" && which !== "fail") {
    await card(ctx, [`### ${HEADING}`, "Say which one: `success` or `fail`."].join("\n"));
    return;
  }

  const emoji = found.rest[1] ?? "";
  if (!EMOJI.test(emoji)) {
    await card(ctx, [`### ${HEADING}`, "Give one emoji."].join("\n"));
    return;
  }

  await set(found.held.channelId, which === "success" ? "success_emoji" : "fail_emoji", emoji);
  await card(
    ctx,
    [`### ${HEADING}`, `${emoji} marks a ${which === "success" ? "correct" : "wrong"} count in <#${found.held.channelId}>.`].join("\n"),
  );
}

async function setRole(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "restrict counting to a role");
  if (!found) return;

  if (found.rest.length === 0) {
    await set(found.held.channelId, "required_role_id", null);
    await card(ctx, [`### ${HEADING}`, `Anyone can count in <#${found.held.channelId}>.`].join("\n"));
    return;
  }

  const id = idFrom(found.rest[0], ROLE_MENTION);
  const role = id ? (await guildRoles(found.guildId)).find((one) => one.id === id) : null;
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  await set(found.held.channelId, "required_role_id", role.id);
  await card(
    ctx,
    [`### ${HEADING}`, `Only <@&${role.id}> can count in <#${found.held.channelId}>.`].join("\n"),
  );
}

async function setGoal(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "set a counting goal");
  if (!found) return;

  if (found.rest.length === 0) {
    await set(found.held.channelId, "goal_number", null);
    await set(found.held.channelId, "goal_role_id", null);
    await set(found.held.channelId, "goal_message", null);
    await card(ctx, [`### ${HEADING}`, `<#${found.held.channelId}> has no goal now.`].join("\n"));
    return;
  }

  const number = Number.parseInt(found.rest[0] ?? "", 10);
  if (!Number.isInteger(number) || number <= 0) {
    await card(ctx, [`### ${HEADING}`, "Give the number to reach."].join("\n"));
    return;
  }

  const rest = found.rest.slice(1);
  const roleId = idFrom(rest[0], ROLE_MENTION);
  if (roleId) rest.shift();
  const message = rest.join(" ").trim();

  await set(found.held.channelId, "goal_number", number);
  await set(found.held.channelId, "goal_role_id", roleId);
  await set(found.held.channelId, "goal_message", message || null);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${found.held.channelId}> is aiming for **${number}**.`,
      roleId ? `-# Whoever gets there is given <@&${roleId}>.` : "",
      message ? `-# It will say: ${message}` : "",
      "-# `{count}` and `{user}` work in the message.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function setMilestone(ctx: PrefixContext): Promise<void> {
  const found = await target(ctx, "set the counting milestones");
  if (!found) return;

  if (found.rest.length === 0) {
    await set(found.held.channelId, "milestone_interval", null);
    await set(found.held.channelId, "milestone_template", null);
    await card(ctx, [`### ${HEADING}`, `<#${found.held.channelId}> has no milestones now.`].join("\n"));
    return;
  }

  const interval = Number.parseInt(found.rest[0] ?? "", 10);
  if (!Number.isInteger(interval) || interval <= 0) {
    await card(ctx, [`### ${HEADING}`, "Give how often, like `100`."].join("\n"));
    return;
  }

  const template = found.rest.slice(1).join(" ").trim();
  await set(found.held.channelId, "milestone_interval", interval);
  await set(found.held.channelId, "milestone_template", template || null);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${found.held.channelId}> marks every **${interval}**.`,
      template ? `-# It will say: ${template}` : "-# `{count}`, `{user}` and `{channel}` work in the message.",
    ].join("\n"),
  );
}

export function registerCounting(): void {
  watchCounting();

  const dispatcher = (path: string, fallback: PrefixHandler): PrefixHandler =>
    async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn(path, sub) : undefined;

      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
        return;
      }
      await fallback(ctx);
    };

  async function setOverview(ctx: PrefixContext): Promise<void> {
    const guildId = await requireManageGuild(ctx, "see the counting settings");
    if (!guildId) return;

    await card(
      ctx,
      [
        `### ${HEADING}`,
        "What a counting channel can be told:",
        "`cooldown` `current` `emoji` `goal` `lives` `milestone` `role` `step`",
        "",
        "-# Each takes the channel first: `counting set step #counting 2`.",
      ].join("\n"),
    );
  }

  register({
    name: "counting",
    // `count` is deliberately not an alias: Last.fm already answers to it and
    // the configuration cog loads first, so taking it would quietly remove
    // that command from the bot.
    aliases: ["number", "numb"],
    description: "Run a configurable counting game in a channel",
    handler: dispatcher("counting", overview),
  });

  groupUnder("counting", () => {
    register({ name: "leaderboard", aliases: ["lb", "top"], description: "View the top counters for a counting channel", handler: board });
    register({ name: "list", aliases: ["ls"], description: "View all counting channels configured in this server", handler: list });
    register({ name: "remove", aliases: ["delete", "del", "rm", "stop"], description: "Stop a channel from being used for counting", handler: remove });
    register({ name: "reset", aliases: ["clear", "purge"], description: "Manually reset the count back to 0", handler: resetIt });
    register({ name: "set", description: "Configure values for a counting channel", handler: dispatcher("counting set", setOverview) });
    register({ name: "setup", aliases: ["create", "enable", "add"], description: "Turn a channel into a counting channel", handler: setup });
    register({ name: "toggle", description: "Toggle a boolean counting setting on or off", handler: toggle });
    register({ name: "view", aliases: ["settings", "info"], description: "View a counting channel's progress and settings", handler: view });
  });

  groupUnder("counting set", () => {
    register({ name: "cooldown", aliases: ["slowmode"], description: "Set a per-user cooldown between counts", handler: numberSetter("cooldown_secs", "cooldown", 0, 21600) });
    register({ name: "current", aliases: ["count", "now"], description: "Manually set the current count without triggering a reset", handler: numberSetter("current", "count", -1_000_000, 1_000_000) });
    register({ name: "emoji", description: "Set the reaction emoji used for correct or incorrect counts", handler: setEmoji });
    register({ name: "goal", description: "Set a target number for the count to reach", handler: setGoal });
    register({ name: "lives", aliases: ["strikes"], description: "Set how many mistakes are allowed before the count resets", handler: numberSetter("lives", "lives", 0, 100) });
    register({ name: "milestone", description: "Set how often milestone messages are sent", handler: setMilestone });
    register({ name: "role", description: "Restrict counting to a specific role, or clear the requirement", handler: setRole });
    register({ name: "step", description: "Set how much each correct count must increase by", handler: numberSetter("step", "step", -1000, 1000) });
  });
}
