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
import { applyComponents, emojiFor } from "../button/render.js";
import {
  MAX_OPTIONS,
  MAX_PLACEHOLDER,
  addOption,
  clearGuild,
  clearMessage,
  latestIn,
  optionsIn,
  optionsOn,
  placeholderFor,
  removeOption,
  reorder,
  setDescription,
  setPlaceholder,
  type DropdownRole,
} from "./store.js";

const HEADING = "Dropdown roles";

/** Distinct from `rb:` and `brl:`, so all three can share a message. */
const PREFIX = "ddr:";

const LINK = /channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const EMOJI = /^(?:<a?:[\w~]+:\d{15,25}>|\p{Extended_Pictographic}[\u{FE0F}\u{20E3}]*)$/u;

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
  rest: string[];
}

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
    return { channelId: match[2] as string, messageId: match[3] as string, rest: tokens };
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
  return { channelId: ctx.channelId, messageId, rest: tokens };
}

/**
 * The whole menu as one action row, or nothing at all.
 *
 * A select is not a row of buttons: it sits alone in its own row, and a row
 * holding one is what `ours()` in the shared renderer recognises by its
 * custom id. With no options left the row simply is not built, which is how
 * clearing takes the menu off the message.
 */
async function rowFor(messageId: string): Promise<unknown[]> {
  const held = await optionsOn(messageId);
  if (held.length === 0) return [];

  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${PREFIX}${messageId}`,
          placeholder: (await placeholderFor(messageId)) ?? "Pick your roles",
          // Zero minimum so a member can deselect everything and end up with
          // none of them, which is the only way to give a role back.
          min_values: 0,
          max_values: held.length,
          options: held.map((one) => ({
            label: (one.label ?? one.roleId).slice(0, 100),
            value: one.roleId,
            ...(one.description ? { description: one.description.slice(0, 100) } : {}),
            ...(one.emoji ? { emoji: emojiFor(one.emoji) } : {}),
          })),
        },
      ],
    },
  ];
}

async function paint(ctx: PrefixContext, spot: Target, said: string[]): Promise<void> {
  const done = await applyComponents(spot.channelId, spot.messageId, PREFIX, await rowFor(spot.messageId));
  await card(
    ctx,
    [`### ${HEADING}`, ...said, done.ok ? "" : `-# The message was not updated: ${done.why}`]
      .filter(Boolean)
      .join("\n"),
  );
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "see the dropdown roles");
  if (!guildId) return;

  const held = await optionsIn(guildId);
  const messages = new Set(held.map((one) => one.messageId));

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? `${held.length} option${held.length === 1 ? "" : "s"} across ${messages.size} message${messages.size === 1 ? "" : "s"}.`
        : "No message has a role dropdown yet.",
      "",
      "`dropdownrole add <link> @role [emoji] [label]` adds an option",
      "`dropdownrole list` shows them all",
      "",
      "-# Picking an option gives the role, unpicking it takes the role back.",
    ].join("\n"),
  );
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "add a dropdown role");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = spot.rest;
  if (tokens.length === 0) {
    await card(ctx, [`### ${HEADING}`, "Name the role the option should hand out."].join("\n"));
    return;
  }

  const role = await findRole(guildId, tokens.shift() as string);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  // The same four refusals as autorole and buttonrole, for the same reason:
  // each would otherwise fail on every pick rather than once here.
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
        `**${role.name}** has **Administrator**, so I will not put it in a menu.`,
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

  const held = await optionsOn(spot.messageId);
  if (held.some((one) => one.roleId === role.id)) {
    await card(ctx, [`### ${HEADING}`, `<@&${role.id}> is already in that dropdown.`].join("\n"));
    return;
  }
  if (held.length >= MAX_OPTIONS) {
    await card(
      ctx,
      [`### ${HEADING}`, `A dropdown holds ${MAX_OPTIONS} options at most, which is Discord's limit.`].join("\n"),
    );
    return;
  }

  let emoji: string | null = null;
  if (tokens[0] && EMOJI.test(tokens[0])) emoji = tokens.shift() as string;

  const label = (tokens.join(" ").trim() || role.name).slice(0, 100);
  const position = await addOption(guildId, spot.channelId, spot.messageId, {
    roleId: role.id,
    emoji,
    label,
  });

  await paint(ctx, spot, [`Option **${position}** hands out <@&${role.id}>.`]);
}

/** A role or a 1-based index, the way the spec asks. */
async function pick(
  ctx: PrefixContext,
  guildId: string,
  messageId: string,
  token: string | undefined,
): Promise<DropdownRole | null> {
  const held = await optionsOn(messageId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "That message has no dropdown roles."].join("\n"));
    return null;
  }

  // An index is tried first: a bare number is never a role name worth guessing.
  const index = Number.parseInt(token ?? "", 10);
  if (Number.isInteger(index) && index >= 1 && index <= held.length) return held[index - 1] as DropdownRole;

  const role = await findRole(guildId, token ?? "");
  const roleId = role?.id ?? (/^\d{15,25}$/.test(token ?? "") ? token : null);
  const found = held.find((one) => one.roleId === roleId);

  if (!found) {
    await card(
      ctx,
      [`### ${HEADING}`, `Name a role in that dropdown, or an index from 1 to ${held.length}.`].join("\n"),
    );
    return null;
  }
  return found;
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "remove a dropdown role");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const one = await pick(ctx, guildId, spot.messageId, spot.rest[0]);
  if (!one) return;

  await removeOption(one.id);
  await reorder((await optionsOn(spot.messageId)).map((row) => row.id));
  await paint(ctx, spot, [`<@&${one.roleId}> is out of the dropdown. Members who took it keep it.`]);
}

async function describe(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "describe a dropdown role");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const one = await pick(ctx, guildId, spot.messageId, spot.rest[0]);
  if (!one) return;

  const text = spot.rest.slice(1).join(" ").trim();
  await setDescription(one.id, text ? text.slice(0, 100) : null);
  await paint(ctx, spot, [
    text
      ? `<@&${one.roleId}> reads "${text.slice(0, 100)}" underneath.`
      : `<@&${one.roleId}> has no description now.`,
  ]);
}

async function placeholder(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "set the dropdown placeholder");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const text = spot.rest.join(" ").trim();
  await setPlaceholder(guildId, spot.messageId, text ? text.slice(0, MAX_PLACEHOLDER) : null);
  await paint(ctx, spot, [
    text ? `The dropdown reads "${text.slice(0, MAX_PLACEHOLDER)}" when nothing is picked.` : "The placeholder is back to normal.",
  ]);
}

async function clear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "clear the dropdown roles");
  if (!guildId) return;

  if (words(ctx.argument).some((token) => LINK.test(token))) {
    const spot = await target(ctx, guildId);
    if (!spot) return;
    const gone = await clearMessage(spot.messageId);
    await paint(ctx, spot, [
      gone === 0 ? "That message had no dropdown roles." : `Removed ${gone} from that message.`,
    ]);
    return;
  }

  const { removed, messages } = await clearGuild(guildId);
  for (const one of messages) await applyComponents(one.channelId, one.messageId, PREFIX, []);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      removed === 0
        ? "There were no dropdown roles in this server."
        : `Removed ${removed} option${removed === 1 ? "" : "s"} from ${messages.length} message${messages.length === 1 ? "" : "s"}.`,
      messages.length ? "-# Members keep the roles they already took." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "list the dropdown roles");
  if (!guildId) return;

  const held = await optionsIn(guildId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No message has a role dropdown yet."].join("\n"));
    return;
  }

  const byMessage = new Map<string, typeof held>();
  for (const one of held) {
    const found = byMessage.get(one.messageId);
    if (found) found.push(one);
    else byMessage.set(one.messageId, [one]);
  }

  const blocks = [];
  for (const [messageId, ones] of byMessage) {
    const link = `https://discord.com/channels/${guildId}/${ones[0]?.channelId}/${messageId}`;
    const said = await placeholderFor(messageId);
    blocks.push(
      [
        `[message](${link}) in <#${ones[0]?.channelId}>${said ? ` — "${said}"` : ""}`,
        ...ones.map(
          (one) =>
            `**${one.position}.** <@&${one.roleId}>${one.emoji ? ` ${one.emoji}` : ""}${one.label ? ` · ${one.label}` : ""}${one.description ? `\n-# ${one.description}` : ""}`,
        ),
      ].join("\n"),
    );
  }

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
  const guildId = await requireManageRoles(ctx, "re-apply the dropdown roles");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const done = await applyComponents(spot.channelId, spot.messageId, PREFIX, await rowFor(spot.messageId));
  const held = await optionsOn(spot.messageId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      done.ok
        ? held.length === 0
          ? "That message has no options, so the dropdown is off it."
          : `Put the dropdown back with ${held.length} option${held.length === 1 ? "" : "s"}.`
        : done.why,
      done.ok ? "-# Any button roles on the message are untouched." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function registerDropdownRoles(): void {
  onComponent(PREFIX, async (interaction: any) => {
    const messageId = String(interaction.data?.customId ?? "").slice(PREFIX.length);
    const guildId = String(interaction.guildId ?? "");
    const userId = String(interaction.user?.id ?? interaction.member?.id ?? "");
    const picked: string[] = (interaction.data?.values ?? []).map(String);

    if (!guildId || !userId) return;

    const held = await optionsOn(messageId);
    if (held.length === 0) {
      await interaction.respond({ content: "That dropdown is no longer configured." }, { isPrivate: true });
      return;
    }

    const ceiling = await botCeiling(guildId);
    const roles = await guildRoles(guildId);
    const member = await memberOf(guildId, userId);
    const has = new Set(member?.roles ?? []);

    const given: string[] = [];
    const taken: string[] = [];
    const stuck: string[] = [];

    for (const one of held) {
      const role = roles.find((r) => r.id === one.roleId);
      if (!role) continue;

      // Checked on every pick, not only when the option was made: the bot's
      // role can be dragged below it afterwards.
      if (!ceiling.manageRoles || role.position >= ceiling.position) {
        if (picked.includes(one.roleId) !== has.has(one.roleId)) stuck.push(role.name);
        continue;
      }

      const want = picked.includes(one.roleId);
      if (want && !has.has(one.roleId)) {
        const done = await giveRole(guildId, userId, one.roleId, "Dropdown role");
        if (done.ok) given.push(role.name);
      } else if (!want && has.has(one.roleId)) {
        const done = await takeRole(guildId, userId, one.roleId, "Dropdown role");
        if (done.ok) taken.push(role.name);
      }
    }

    const lines = [
      given.length ? `Given you **${given.join("**, **")}**.` : "",
      taken.length ? `Taken back **${taken.join("**, **")}**.` : "",
      stuck.length ? `I cannot change **${stuck.join("**, **")}** — my own role is not above it.` : "",
    ].filter(Boolean);

    await interaction.respond(
      { content: lines.length ? lines.join("\n") : "Nothing changed." },
      { isPrivate: true },
    );
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("dropdownrole", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "dropdownrole",
    aliases: ["dropdownroles", "selectrole", "selectroles", "dropdown", "dd"],
    description: "Allow members to self-assign roles via a dropdown menu",
    handler,
  });

  groupUnder("dropdownrole", () => {
    register({ name: "add", aliases: ["create", "new"], description: "Add a role option to a message's dropdown", handler: add });
    register({ name: "clear", aliases: ["reset", "purge"], description: "Remove all dropdown roles from a message or the entire server", handler: clear });
    register({ name: "description", aliases: ["desc"], description: "Set or clear the description shown beneath an option", handler: describe });
    register({ name: "list", aliases: ["ls"], description: "View every dropdown role configured in this server", handler: list });
    register({ name: "placeholder", aliases: ["ph"], description: "Set the placeholder shown when nothing is selected", handler: placeholder });
    register({ name: "remove", aliases: ["delete", "del", "rm"], description: "Remove a role option by role or position index", handler: remove });
    register({ name: "render", aliases: ["refresh", "sync"], description: "Re-apply the dropdown to a message", handler: refresh });
  });
}
