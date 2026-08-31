import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { provideLimits, DEFAULTS } from "../../../core/throttle.js";
import { switchWord } from "../../../helpers/flags.js";
import { BOUNDS, limits, reset, save } from "./store.js";

const HEADING = "Command limits";

async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply(notice([`### ${HEADING}`, ...lines].join("\n")));
}

function state(held: { perUser: number; perGuild: number; windowMs: number; on: boolean }): string[] {
  const seconds = Math.round(held.windowMs / 1000);
  return [
    held.on ? "On." : "Off. Anyone can run commands as fast as they like.",
    `-# per person: ${held.perUser} commands every ${seconds}s`,
    `-# per server: ${held.perGuild} commands every ${seconds}s`,
  ];
}

function number(argument: string): number | null {
  const said = argument.trim().split(/\s+/)[0] ?? "";
  if (!/^\d{1,5}$/.test(said)) return null;

  const value = Number.parseInt(said, 10);
  return Number.isInteger(value) ? value : null;
}

function counter(
  field: "perUser" | "perGuild",
  label: string,
  bound: { least: number; most: number },
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageGuild(ctx, "change the command limits");
    if (!guildId) return;

    const held = await limits(guildId);
    const wanted = number(ctx.argument);
    if (wanted === null) {
      await card(ctx, [
        `${label} is ${held[field]} commands every ${Math.round(held.windowMs / 1000)}s.`,
        "",
        `-# \`ratelimit ${field === "perUser" ? "user" : "server"} <${bound.least}-${bound.most}>\``,
      ]);
      return;
    }
    if (wanted < bound.least || wanted > bound.most) {
      await card(ctx, [`Pick a number between ${bound.least} and ${bound.most}.`]);
      return;
    }

    // A server ceiling under the personal one means one person alone trips the
    // ceiling, and everybody else is refused for reasons they are never told.
    if (field === "perUser" && wanted > held.perGuild) {
      await card(ctx, [
        `The server allows only ${held.perGuild} commands in that time, so ${wanted} each would never be reached.`,
        "",
        "-# Raise `ratelimit server` first.",
      ]);
      return;
    }
    if (field === "perGuild" && wanted < held.perUser) {
      await card(ctx, [
        `One person may already run ${held.perUser}, so a server ceiling of ${wanted} would stop everybody else.`,
        "",
        "-# Lower `ratelimit user` first.",
      ]);
      return;
    }

    const next = await save(guildId, { [field]: wanted });
    await card(ctx, state(next));
  };
}

async function window(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change the command limits");
  if (!guildId) return;

  const held = await limits(guildId);
  const wanted = number(ctx.argument);
  if (wanted === null) {
    await card(ctx, [
      `The limits are counted over ${Math.round(held.windowMs / 1000)} seconds.`,
      "",
      `-# \`ratelimit window <${BOUNDS.seconds.least}-${BOUNDS.seconds.most}>\``,
    ]);
    return;
  }
  if (wanted < BOUNDS.seconds.least || wanted > BOUNDS.seconds.most) {
    await card(ctx, [
      `Pick a number of seconds between ${BOUNDS.seconds.least} and ${BOUNDS.seconds.most}.`,
    ]);
    return;
  }

  const next = await save(guildId, { windowMs: wanted * 1000 });
  await card(ctx, state(next));
}

async function toDefaults(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change the command limits");
  if (!guildId) return;

  const next = await reset(guildId);
  await card(ctx, ["Back to the defaults.", ...state(next).slice(1)]);
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the command limits");
  if (!guildId) return;

  const wanted = switchWord(ctx.argument.trim().split(/\s+/)[0] ?? "");
  const held = wanted === null ? await limits(guildId) : await save(guildId, { on: wanted });

  await card(ctx, [
    ...state(held),
    "",
    "`ratelimit on` or `off` · `ratelimit user 5` · `ratelimit server 30` · `ratelimit window 10`",
    "`ratelimit reset` puts all three back.",
    "-# Somebody over the limit is told once, then ignored for half a minute.",
    "-# This counts commands. Reposting, autoresponders and the filter answer",
    "-# ordinary messages and have their own separate cooldowns.",
  ]);
}

export function registerRateLimit(): void {
  // The command path reads this, so it comes from the cog's cache rather than the
  // database, and falls back to the defaults rather than to no limit at all.
  provideLimits(async (guildId) => limits(guildId));

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("ratelimit", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "ratelimit",
    aliases: ["cooldown", "antispam"],
    description: "How many commands a person or a server may run",
    handler,
  });

  groupUnder("ratelimit", () => {
    register({
      name: "user",
      aliases: ["person", "member"],
      description: "Commands one person may run in the window",
      handler: counter("perUser", "Per person", BOUNDS.perUser),
    });
    register({
      name: "server",
      aliases: ["guild"],
      description: "Commands the whole server may run in the window",
      handler: counter("perGuild", "Per server", BOUNDS.perGuild),
    });
    register({
      name: "window",
      aliases: ["seconds"],
      description: "How many seconds the limits are counted over",
      handler: window,
    });
    register({
      name: "reset",
      aliases: ["default", "defaults"],
      description: `Back to ${DEFAULTS.perUser} per person and ${DEFAULTS.perGuild} per server`,
      handler: toDefaults,
    });
  });
}
