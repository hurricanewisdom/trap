import { provideIgnores } from "../../../core/ignores.js";
import { notice, requireAdministrator } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { MAX_IGNORES, add, all, ignores, remove, type Kind } from "./store.js";

const HEADING = "Ignore";

const CHANNEL = /^<#(\d{15,25})>$/;

const MEMBER = /^<@!?(\d{15,25})>$/;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function targetOf(token: string | undefined): { id: string; kind: Kind } | null {
  if (!token) return null;

  const channel = CHANNEL.exec(token);
  if (channel) return { id: channel[1] as string, kind: "channel" };

  const member = MEMBER.exec(token);
  if (member) return { id: member[1] as string, kind: "member" };

  return null;
}

function shows(held: { targetId: string; kind: Kind }): string {
  return held.kind === "channel" ? `<#${held.targetId}>` : `<@${held.targetId}>`;
}

function needTarget(usage: string): string {
  return [
    `### ${HEADING}`,
    "Give me a member or a channel.",
    "",
    `-# \`${usage}\``,
  ].join("\n");
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "see what is ignored");
  if (!guildId) return;

  const held = await all(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      "I read nothing from an ignored member or channel.",
      "",
      "`ignore <member or #channel>` switches one on or off",
      "`ignore add <member or #channel>` ignores one",
      "`ignore remove <member or #channel>` stops ignoring",
      "`ignore list` shows them all",
      "",
      `-# ${held.length} of ${MAX_IGNORES} ignored here.`,
      "-# The `ignore` commands keep working in an ignored channel, so this is never a dead end.",
    ].join("\n"),
  );
}

async function ignoreOne(ctx: PrefixContext, wanted: "add" | "remove" | "toggle"): Promise<void> {
  const action =
    wanted === "remove" ? "stop ignoring somebody" : "ignore a member or a channel";
  const guildId = await requireAdministrator(ctx, action);
  if (!guildId) return;

  const target = targetOf(ctx.argument.trim().split(/\s+/)[0]);
  if (!target) {
    await card(
      ctx,
      needTarget(
        wanted === "toggle"
          ? "ignore <member or #channel>"
          : `ignore ${wanted} <member or #channel>`,
      ),
    );
    return;
  }

  const already = await ignores(guildId, target.id);
  const adding = wanted === "toggle" ? !already : wanted === "add";

  if (adding && !already && (await all(guildId)).length >= MAX_IGNORES) {
    await card(
      ctx,
      [`### ${HEADING}`, `A server can ignore ${MAX_IGNORES} things, and they are all used.`].join("\n"),
    );
    return;
  }

  if (adding) {
    const made = await add(guildId, target.id, target.kind);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        made
          ? `Ignoring ${shows({ targetId: target.id, kind: target.kind })}.`
          : `${shows({ targetId: target.id, kind: target.kind })} was already ignored.`,
        made && target.kind === "channel"
          ? "\n-# I still answer `ignore` there, so you can undo this from inside it."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }

  const gone = await remove(guildId, target.id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone
        ? `No longer ignoring ${shows({ targetId: target.id, kind: target.kind })}.`
        : `${shows({ targetId: target.id, kind: target.kind })} was not ignored.`,
    ].join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "list what is ignored");
  if (!guildId) return;

  const held = await all(guildId);
  if (held.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, "Nothing is ignored here.", "", "-# `ignore add <member or #channel>` starts."].join("\n"),
    );
    return;
  }

  const members = held.filter((one) => one.kind === "member");
  const channels = held.filter((one) => one.kind === "channel");

  await card(
    ctx,
    [
      `### ${HEADING}`,
      members.length ? `**Members**\n${members.slice(0, 30).map(shows).join(" · ")}` : "",
      channels.length ? `**Channels**\n${channels.slice(0, 30).map(shows).join(" · ")}` : "",
      "",
      `-# ${held.length} of ${MAX_IGNORES}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function registerIgnore(): void {
  provideIgnores(async (guildId, channelId, userId) => {
    const held = await all(guildId);
    if (held.length === 0) return false;
    return held.some((one) => one.targetId === channelId || one.targetId === userId);
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("ignore", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    if (!sub) {
      await overview(ctx);
      return;
    }
    await ignoreOne(ctx, "toggle");
  };

  register({
    name: "ignore",
    aliases: ["ignored"],
    description: "Stop reading a member or a channel",
    handler,
  });

  groupUnder("ignore", () => {
    register({
      name: "add",
      description: "Ignore a member or a channel",
      handler: (ctx) => ignoreOne(ctx, "add"),
    });

    register({
      name: "remove",
      aliases: ["delete", "rm"],
      description: "Stop ignoring a member or a channel",
      handler: (ctx) => ignoreOne(ctx, "remove"),
    });

    register({
      name: "list",
      aliases: ["all"],
      description: "Every ignored member and channel",
      handler: list,
    });
  });
}
