import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import {
  HEADING,
  card,
  channelId,
  findRole,
  missing,
  needTrigger,
  roleList,
  shown,
  words,
} from "./shared.js";
import { one, toggleExclusive } from "./store.js";

const USAGE = "autoresponder exclusive <role or #channel> <trigger>";

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see the exclusive access");
  if (!guildId) return;

  const trigger = ctx.argument.trim();
  if (!trigger) {
    await card(ctx, needTrigger("autoresponder exclusive list <trigger>"));
    return;
  }

  const responder = await one(guildId, trigger);
  if (!responder) {
    await card(ctx, missing(trigger));
    return;
  }

  const { onlyRoles, onlyChannels } = responder;
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Exclusive access to ${shown(responder.trigger)}`,
      "",
      onlyRoles.length ? `Roles: ${roleList(onlyRoles)}` : "",
      onlyChannels.length
        ? `Channels: ${onlyChannels.map((id) => `<#${id}>`).join(" · ")}`
        : "",
      onlyRoles.length + onlyChannels.length === 0
        ? "Nothing is set, so it answers everyone everywhere."
        : "",
      "",
      "-# With anything listed, it only answers there or to those roles.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function main(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the exclusive access");
  if (!guildId) return;

  const parts = words(ctx.argument);
  if (parts.length < 2) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give me a role or a channel, then the trigger.",
        "",
        `-# \`${USAGE}\``,
      ].join("\n"),
    );
    return;
  }

  const target = parts[0] as string;
  const trigger = parts.slice(1).join(" ");
  const responder = await one(guildId, trigger);
  if (!responder) {
    await card(ctx, missing(trigger));
    return;
  }

  const channel = channelId(target);
  if (channel) {
    const outcome = await toggleExclusive(guildId, responder.trigger, channel, "channel");
    await card(
      ctx,
      [
        `### ${HEADING}`,
        outcome === "added"
          ? `${shown(responder.trigger)} now answers in <#${channel}>.`
          : `${shown(responder.trigger)} no longer singles out <#${channel}>.`,
      ].join("\n"),
    );
    return;
  }

  const role = await findRole(guildId, target);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role or channel."].join("\n"));
    return;
  }

  const outcome = await toggleExclusive(guildId, responder.trigger, role.id, "role");
  await card(
    ctx,
    [
      `### ${HEADING}`,
      outcome === "added"
        ? `${shown(responder.trigger)} now answers <@&${role.id}>.`
        : `${shown(responder.trigger)} no longer singles out <@&${role.id}>.`,
    ].join("\n"),
  );
}

export function registerExclusive(): void {
  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    if (sub === "list") {
      await list({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await main(ctx);
  };

  register({
    name: "exclusive",
    aliases: ["only"],
    description: "Limit a trigger to some roles or channels",
    handler,
  });

  groupUnder("autoresponder exclusive", () => {
    register({
      name: "list",
      description: "Who has exclusive access to a trigger",
      handler: list,
    });
  });
}
