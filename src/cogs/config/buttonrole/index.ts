import type { Role } from "../../../core/discord.js";

import {
  PERMISSION,
  botCeiling,
  giveRole,
  guildRoles,
  memberOf,
  takeRole,
} from "../../../core/discord.js";
import { onComponent } from "../../../core/hooks.js";
import { notice, requireManageRoles } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { applyRows } from "../button/render.js";
import {
  MAX_PER_MESSAGE,
  addRoleButton,
  clearGuild,
  clearMessage,
  latestIn,
  removeRoleButton,
  reorder,
  roleButtonById,
  rolesIn,
  rolesOn,
} from "./store.js";

const HEADING = "Button roles";

/** Distinct from the response buttons' `rb:`, so neither dispatcher sees the
 * other's presses and neither renderer eats the other's rows. */
const PREFIX = "brl:";

const LINK = /channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const EMOJI = /^(?:<a?:[\w~]+:\d{15,25}>|\p{Extended_Pictographic}[\u{FE0F}\u{20E3}]*)$/u;

const STYLES: Record<string, number> = {
  primary: 1,
  blurple: 1,
  secondary: 2,
  grey: 2,
  gray: 2,
  success: 3,
  green: 3,
  danger: 4,
  red: 4,
};

function styleName(value: number): string {
  if (value === 1) return "primary";
  if (value === 3) return "success";
  if (value === 4) return "danger";
  return "secondary";
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

async function findRole(guildId: string, token: string): Promise<Role | null> {
  const roles = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return roles.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return roles.find((role) => role.name.toLowerCase() === needle) ?? null;
}

interface Target {
  channelId: string;
  messageId: string;
  rest: string;
}

/** The message from the argument, or the last one configured in this channel. */
async function target(ctx: PrefixContext, guildId: string): Promise<Target | null> {
  const tokens = words(ctx.argument);
  const at = tokens.findIndex((token) => LINK.test(token));

  if (at >= 0) {
    const match = LINK.exec(tokens[at] as string);
    if (!match || match[1] !== guildId) {
      await card(ctx, [`### ${HEADING}`, "That link points at another server."].join("\n"));
      return null;
    }
    tokens.splice(at, 1);
    return {
      channelId: match[2] as string,
      messageId: match[3] as string,
      rest: tokens.join(" ").trim(),
    };
  }

  const messageId = await latestIn(guildId, ctx.channelId);
  if (!messageId) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give me a message link from this server.",
        "",
        "-# Right click one of my messages and Copy Message Link.",
        "-# After the first one, this channel remembers it and the link is optional.",
      ].join("\n"),
    );
    return null;
  }
  return { channelId: ctx.channelId, messageId, rest: tokens.join(" ").trim() };
}

async function paint(ctx: PrefixContext, spot: Target, said: string[]): Promise<void> {
  const done = await applyRows(spot.channelId, spot.messageId, PREFIX, await rolesOn(spot.messageId));
  await card(
    ctx,
    [`### ${HEADING}`, ...said, done.ok ? "" : `-# The message was not updated: ${done.why}`]
      .filter(Boolean)
      .join("\n"),
  );
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "see the button roles");
  if (!guildId) return;

  const held = await rolesIn(guildId);
  const messages = new Set(held.map((one) => one.messageId));

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? `${held.length} button${held.length === 1 ? "" : "s"} across ${messages.size} message${messages.size === 1 ? "" : "s"}.`
        : "No message hands out roles yet.",
      "",
      "`buttonrole add <link> @role [style] [emoji] [label]` attaches one",
      "`buttonrole list` shows them all, `buttonrole remove @role` takes one off",
      "",
      "-# Pressing a button gives the role, or takes it back if they already have it.",
    ].join("\n"),
  );
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "add a button role");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = words(spot.rest);
  if (tokens.length === 0) {
    await card(ctx, [`### ${HEADING}`, "Name the role the button should hand out."].join("\n"));
    return;
  }

  const role = await findRole(guildId, tokens.shift() as string);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  // The same four refusals autorole makes, and for the same reason: each would
  // otherwise fail on every press rather than once here.
  if (role.id === guildId) {
    await card(ctx, [`### ${HEADING}`, "Everyone already has @everyone."].join("\n"));
    return;
  }
  if (role.managed) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `**${role.name}** is managed by Discord, so nobody can hand it out.`,
        "-# Bot roles, integration roles and the booster role all work this way.",
      ].join("\n"),
    );
    return;
  }
  if ((BigInt(role.permissions || "0") & PERMISSION.administrator) !== 0n) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `**${role.name}** has **Administrator**, so I will not put it behind a button.`,
        "-# Anyone who can see the message could take the server.",
      ].join("\n"),
    );
    return;
  }

  const ceiling = await botCeiling(guildId);
  if (!ceiling.manageRoles) {
    await card(ctx, [`### ${HEADING}`, "I do not have **Manage Roles**."].join("\n"));
    return;
  }
  if (role.position >= ceiling.position) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `**${role.name}** sits above my own role, so I cannot hand it out.`,
        "-# Drag my role above it in Server Settings and try again.",
      ].join("\n"),
    );
    return;
  }

  const held = await rolesOn(spot.messageId);
  if (held.some((one) => one.roleId === role.id)) {
    await card(ctx, [`### ${HEADING}`, `<@&${role.id}> already has a button on that message.`].join("\n"));
    return;
  }
  if (held.length >= MAX_PER_MESSAGE) {
    await card(ctx, [`### ${HEADING}`, `That message already holds ${MAX_PER_MESSAGE} buttons.`].join("\n"));
    return;
  }

  let style = 2;
  if (tokens[0] && STYLES[tokens[0].toLowerCase()] !== undefined) {
    style = STYLES[(tokens.shift() as string).toLowerCase()] as number;
  }
  let emoji: string | null = null;
  if (tokens[0] && EMOJI.test(tokens[0])) emoji = tokens.shift() as string;

  // Whatever is left is the label; with nothing left the role's own name is it,
  // which is what somebody pressing a role button expects to read anyway.
  const label = (tokens.join(" ").trim() || role.name).slice(0, 80);

  const position = await addRoleButton(guildId, spot.channelId, spot.messageId, {
    roleId: role.id,
    style,
    emoji,
    label,
  });

  await paint(ctx, spot, [`Button **${position}** hands out <@&${role.id}> — ${styleName(style)}.`]);
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "remove a button role");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const held = await rolesOn(spot.messageId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "That message has no button roles."].join("\n"));
    return;
  }

  // The spec takes "a role or index", so both are tried: an index first, since
  // a bare number is never a role name worth guessing at.
  const token = words(spot.rest)[0] ?? "";
  const index = Number.parseInt(token, 10);
  let gone = Number.isInteger(index) && index >= 1 && index <= held.length ? held[index - 1] : undefined;

  if (!gone) {
    const role = await findRole(guildId, token);
    const roleId = role?.id ?? (/^\d{15,25}$/.test(token) ? token : null);
    gone = held.find((one) => one.roleId === roleId);
  }

  if (!gone) {
    await card(
      ctx,
      [`### ${HEADING}`, `Name a role on that message, or an index from 1 to ${held.length}.`].join("\n"),
    );
    return;
  }

  await removeRoleButton(gone.id);
  await reorder((await rolesOn(spot.messageId)).map((one) => one.id));
  await paint(ctx, spot, [`<@&${gone.roleId}> no longer has a button. Members who took it keep it.`]);
}

async function clear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "clear the button roles");
  if (!guildId) return;

  if (words(ctx.argument).some((token) => LINK.test(token))) {
    const spot = await target(ctx, guildId);
    if (!spot) return;
    const gone = await clearMessage(spot.messageId);
    await paint(ctx, spot, [
      gone === 0 ? "That message had no button roles." : `Removed ${gone} from that message.`,
    ]);
    return;
  }

  const { removed, messages } = await clearGuild(guildId);
  for (const one of messages) await applyRows(one.channelId, one.messageId, PREFIX, []);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      removed === 0
        ? "There were no button roles in this server."
        : `Removed ${removed} button${removed === 1 ? "" : "s"} from ${messages.length} message${messages.length === 1 ? "" : "s"}.`,
      messages.length ? "-# Members keep the roles they already took." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "list the button roles");
  if (!guildId) return;

  const held = await rolesIn(guildId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No message hands out roles yet."].join("\n"));
    return;
  }

  const byMessage = new Map<string, typeof held>();
  for (const one of held) {
    const found = byMessage.get(one.messageId);
    if (found) found.push(one);
    else byMessage.set(one.messageId, [one]);
  }

  const blocks = [...byMessage.entries()].map(([messageId, ones]) => {
    const link = `https://discord.com/channels/${guildId}/${ones[0]?.channelId}/${messageId}`;
    return [
      `[message](${link}) in <#${ones[0]?.channelId}>`,
      ...ones.map(
        (one) =>
          `**${one.position}.** <@&${one.roleId}> — \`${styleName(one.style)}\`${one.emoji ? ` · ${one.emoji}` : ""}${one.label ? ` · ${one.label}` : ""}`,
      ),
    ].join("\n");
  });

  await card(
    ctx,
    [
      `### ${HEADING}`,
      blocks.join("\n\n"),
      "",
      `-# ${held.length} across ${byMessage.size} message${byMessage.size === 1 ? "" : "s"}`,
    ].join("\n"),
  );
}

async function refresh(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "re-apply the button roles");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const done = await applyRows(spot.channelId, spot.messageId, PREFIX, await rolesOn(spot.messageId));
  await card(
    ctx,
    [
      `### ${HEADING}`,
      done.ok
        ? done.count === 0
          ? "That message hands out nothing, so it now has no role buttons on it."
          : `Put ${done.count} button${done.count === 1 ? "" : "s"} back on that message.`
        : done.why,
    ].join("\n"),
  );
}

export function registerButtonRoles(): void {
  onComponent(PREFIX, async (interaction: any) => {
    const id = String(interaction.data?.customId ?? "").slice(PREFIX.length);
    const held = await roleButtonById(id);
    const guildId = String(interaction.guildId ?? "");
    const userId = String(interaction.user?.id ?? interaction.member?.id ?? "");

    if (!held || !guildId || !userId) {
      await interaction.respond({ content: "That button is no longer configured." }, { isPrivate: true });
      return;
    }

    // The hierarchy is checked again on every press, not only when the button
    // was made: the bot's role can be dragged down afterwards, and then the
    // press has to say so rather than failing silently.
    const ceiling = await botCeiling(guildId);
    const role = (await guildRoles(guildId)).find((one) => one.id === held.roleId);
    if (!role) {
      await interaction.respond({ content: "That role no longer exists." }, { isPrivate: true });
      return;
    }
    if (!ceiling.manageRoles || role.position >= ceiling.position) {
      await interaction.respond(
        { content: `I cannot hand out **${role.name}** any more — my own role is not above it.` },
        { isPrivate: true },
      );
      return;
    }

    const member = await memberOf(guildId, userId);
    const has = (member?.roles ?? []).includes(held.roleId);
    const done = has
      ? await takeRole(guildId, userId, held.roleId, "Button role")
      : await giveRole(guildId, userId, held.roleId, "Button role");

    await interaction.respond(
      {
        content: done.ok
          ? has
            ? `Taken **${role.name}** back off you.`
            : `You now have **${role.name}**.`
          : "Discord would not let me change that role.",
      },
      { isPrivate: true },
    );
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("buttonrole", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "buttonrole",
    aliases: ["buttonroles", "btr"],
    description: "Allow members to self-assign roles via buttons",
    handler,
  });

  groupUnder("buttonrole", () => {
    register({
      name: "add",
      aliases: ["create", "new"],
      description: "Add a button role to a message",
      handler: add,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all button roles from a message or the entire server",
      handler: clear,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View every button role configured in this server",
      handler: list,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove a button role from a message",
      handler: remove,
    });

    register({
      name: "render",
      aliases: ["refresh", "sync"],
      description: "Re-apply all role components to a message",
      handler: refresh,
    });
  });
}
