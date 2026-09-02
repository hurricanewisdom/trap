import { EVENTS } from "../../../core/availability.js";
import { channelExists } from "../../../core/discord.js";
import { notice, requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { EVERYWHERE, disable, enable, listing } from "../availability/store.js";

const HEADING = "Events";

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

/**
 * ⚠️ This is a second door onto the same room.
 *
 * `,disableevent` and `,enableevent` already do this, and both write the
 * `availability` table through `availability/store.ts`. These commands call the
 * very same functions rather than keeping their own record: two stores would
 * drift the moment somebody used one door and then the other, and the drift
 * would be invisible until an event stopped firing for no reason anybody could
 * see.
 */
function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function channelId(token: string | undefined): string | null {
  const mention = CHANNEL_MENTION.exec(token ?? "");
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token ?? "") ? (token as string) : null;
}

function findEvent(name: string): string | null {
  const needle = name.trim().toLowerCase();
  return EVENTS.find((one) => one.name === needle)?.name ?? null;
}

async function unknown(ctx: PrefixContext, name: string): Promise<void> {
  await card(
    ctx,
    [
      `### ${HEADING}`,
      name ? `I do not have an event called \`${name}\`.` : "Name an event.",
      "",
      EVENTS.map((one) => `\`${one.name}\``).join(" · "),
    ].join("\n"),
  );
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the events");
  if (!guildId) return;

  const off = await listing(guildId, "event");
  await card(
    ctx,
    [
      `### ${HEADING}`,
      "The things the bot does that nobody typed.",
      "",
      EVENTS.map((one) => `\`${one.name}\` — ${one.describes}`).join("\n"),
      "",
      off.length
        ? `-# ${off.length} switched off somewhere. \`events list\` shows where.`
        : "-# All of them are on everywhere.",
      "-# `events disable <event> [#channel]` switches one off.",
    ].join("\n"),
  );
}

/** disable and enable are the same command twice, with the verb swapped. */
function setter(off: boolean) {
  return async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(
      ctx,
      off ? "switch an event off" : "switch an event back on",
    );
    if (!guildId) return;

    const tokens = words(ctx.argument);
    const name = findEvent(tokens[0] ?? "");
    if (!name) {
      await unknown(ctx, tokens[0] ?? "");
      return;
    }

    // No channel means everywhere, which is what the spec says and what
    // `events disable all` spells out explicitly. But a second word that is NOT
    // a channel must not quietly mean everywhere: mistyping `#genral` would
    // switch the event off in the whole server and look like it had worked.
    const said = tokens[1];
    const target = channelId(said) ?? EVERYWHERE;

    if (said !== undefined && target === EVERYWHERE) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          `I cannot read \`${said}\` as a channel.`,
          "",
          `-# Leave it out to mean every channel: \`events ${off ? "disable" : "enable"} ${name}\`.`,
        ].join("\n"),
      );
      return;
    }

    if (target !== EVERYWHERE && !(await channelExists(guildId, target))) {
      await card(ctx, [`### ${HEADING}`, "I cannot see that channel."].join("\n"));
      return;
    }

    const where = target === EVERYWHERE ? "everywhere" : `in <#${target}>`;

    if (off) {
      const made = await disable(guildId, "event", name, target);
      await card(
        ctx,
        [
          `### ${HEADING}`,
          made ? `\`${name}\` is off ${where}.` : `\`${name}\` was already off ${where}.`,
        ].join("\n"),
      );
      return;
    }

    const gone = await enable(guildId, "event", name, target);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        gone
          ? `\`${name}\` is back on ${target === EVERYWHERE ? `everywhere — ${gone} rule${gone === 1 ? "" : "s"} cleared` : where}.`
          : `\`${name}\` was not off ${where}.`,
      ].join("\n"),
    );
  };
}

/** `events disable all <event>` — the explicit spelling of the same thing. */
function everywhere(off: boolean) {
  return async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(
      ctx,
      off ? "switch an event off everywhere" : "switch an event on everywhere",
    );
    if (!guildId) return;

    const name = findEvent(words(ctx.argument)[0] ?? "");
    if (!name) {
      await unknown(ctx, words(ctx.argument)[0] ?? "");
      return;
    }

    if (off) {
      // Clearing the per-channel rules first stops a server ending up with
      // "off everywhere" and a handful of channel rules that outlive it.
      await enable(guildId, "event", name, EVERYWHERE);
      await disable(guildId, "event", name, EVERYWHERE);
      await card(ctx, [`### ${HEADING}`, `\`${name}\` is off in every channel.`].join("\n"));
      return;
    }

    const gone = await enable(guildId, "event", name, EVERYWHERE);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        gone === 0
          ? `\`${name}\` was not off anywhere.`
          : `\`${name}\` is back on — ${gone} rule${gone === 1 ? "" : "s"} cleared.`,
      ].join("\n"),
    );
  };
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "list the switched-off events");
  if (!guildId) return;

  const off = await listing(guildId, "event");
  if (off.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, "Every event is on, in every channel."].join("\n"),
    );
    return;
  }

  const byName = new Map<string, string[]>();
  for (const rule of off) {
    const held = byName.get(rule.name);
    if (held) held.push(rule.target);
    else byName.set(rule.name, [rule.target]);
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      [...byName.entries()]
        .map(([name, targets]) =>
          targets.includes(EVERYWHERE)
            ? `\`${name}\` — off everywhere`
            : `\`${name}\` — off in ${targets.map((id) => `<#${id}>`).join(" · ")}`,
        )
        .join("\n"),
      "",
      `-# ${off.length} rule${off.length === 1 ? "" : "s"} · \`events enable <event>\` puts one back`,
    ].join("\n"),
  );
}

export function registerEvents(): void {
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

  register({
    name: "events",
    aliases: ["event", "evnt", "listener"],
    description: "Manage the events the bot runs without being asked",
    handler: dispatcher("events", overview),
  });

  groupUnder("events", () => {
    register({
      name: "disable",
      aliases: ["off"],
      description: "Disable an event in a channel, or everywhere",
      handler: dispatcher("events disable", setter(true)),
    });

    register({
      name: "enable",
      aliases: ["on"],
      description: "Re-enable an event in a channel, or everywhere",
      handler: dispatcher("events enable", setter(false)),
    });

    register({
      name: "list",
      aliases: ["ls", "show"],
      description: "View all channels where events have been disabled",
      handler: list,
    });
  });

  groupUnder("events disable", () => {
    register({
      name: "all",
      description: "Disable an event across every channel in the server",
      handler: everywhere(true),
    });
  });

  groupUnder("events enable", () => {
    register({
      name: "all",
      description: "Re-enable an event across every channel where it was disabled",
      handler: everywhere(false),
    });
  });
}
