import { sql } from "../../core/db.js";
import {
  botCeiling,
  createRole,
  deleteRole,
  displayName,
  editRole,
  giveRole,
  guildRoles,
  memberOf,
  takeRole,
  walkMembers,
  type Role,
} from "../../core/discord.js";
import { requireManageRoles } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { humanDuration, splitDuration } from "../../helpers/duration.js";
import { plain } from "../../helpers/markdown.js";
import { later, pendingFor } from "./schedule.js";
import { card, findRole, highestOf, userId, words } from "./shared.js";

const COLOUR = /^#?([0-9a-f]{6})$/i;

// A mass role change walks every member and is the one thing here that can run
// for minutes, so it is cancellable and only one runs per server at a time.
const running = new Map<string, { stop: boolean }>();

function colourOf(said: string): number | null {
  const named: Record<string, string> = {
    red: "ed4245",
    green: "57f287",
    blue: "3498db",
    yellow: "fee75c",
    purple: "9b59b6",
    pink: "eb459e",
    orange: "e67e22",
    black: "010101",
    white: "ffffff",
    grey: "95a5a6",
    gray: "95a5a6",
  };
  const key = said.trim().toLowerCase();
  const hex = named[key] ?? COLOUR.exec(key)?.[1];
  return hex ? Number.parseInt(hex, 16) : null;
}

// The bot cannot touch a role at or above its own, and saying so up front beats
// a run that fails on every member.
async function usable(ctx: PrefixContext, guildId: string, role: Role): Promise<boolean> {
  const ceiling = await botCeiling(guildId);
  if (role.position >= ceiling.position) {
    await card(ctx, [
      `<@&${role.id}> sits above the bot, so it cannot be handed out.`,
      "",
      "-# Move the bot's role higher in Server Settings.",
    ]);
    return false;
  }

  const mine = await highestOf(guildId, await memberOf(guildId, ctx.authorId));
  if (role.position >= mine) {
    await card(ctx, [`<@&${role.id}> is not below your own highest role.`]);
    return false;
  }
  return true;
}

async function pair(
  ctx: PrefixContext,
  usage: string,
): Promise<{ guildId: string; who: string; role: Role } | null> {
  const guildId = await requireManageRoles(ctx, "change roles");
  if (!guildId) return null;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  const token = parts.slice(1).join(" ");
  if (!who || !token) {
    await card(ctx, ["Which member, and which role?", "", `-# \`${usage}\``]);
    return null;
  }

  const role = await findRole(guildId, token);
  if (!role) {
    await card(ctx, ["No role by that name."]);
    return null;
  }
  if (!(await usable(ctx, guildId, role))) return null;
  return { guildId, who, role };
}

function oneMember(adding: boolean | null): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const got = await pair(ctx, adding === false ? "role remove @member @role" : "role @member @role");
    if (!got) return;

    const member = await memberOf(got.guildId, got.who);
    const has = (member?.roles ?? []).includes(got.role.id);
    // Bare `role` toggles, which is what "modify a member's roles" means when it
    // is given no direction.
    const give = adding === null ? !has : adding;

    const done = give
      ? await giveRole(got.guildId, got.who, got.role.id, `by ${ctx.authorId}`)
      : await takeRole(got.guildId, got.who, got.role.id, `by ${ctx.authorId}`);

    await card(ctx, [
      done.ok
        ? `<@&${got.role.id}> ${give ? "given to" : "taken from"} <@${got.who}>.`
        : `That did not work. ${done.message.slice(0, 120)}`,
    ]);
  };
}

async function temprole(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "give temporary roles");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `temprole @member 2h @role`"]);
    return;
  }

  const split = splitDuration(parts.slice(1).join(" "));
  if (split.ms === null || !split.rest) {
    await card(ctx, ["How long, and which role?", "", "-# `temprole @member 2h @role`"]);
    return;
  }

  const role = await findRole(guildId, split.rest);
  if (!role) {
    await card(ctx, ["No role by that name."]);
    return;
  }
  if (!(await usable(ctx, guildId, role))) return;

  const done = await giveRole(guildId, who, role.id, `temporary, by ${ctx.authorId}`);
  if (!done.ok) {
    await card(ctx, ["That did not work.", "", `-# ${done.message.slice(0, 150)}`]);
    return;
  }

  await later(guildId, "role", who, role.id, split.ms);
  await card(ctx, [`<@${who}> has <@&${role.id}> for ${humanDuration(split.ms)}.`]);
}

async function temproleList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "see temporary roles");
  if (!guildId) return;

  const held = await pendingFor(guildId, "role");
  await card(
    ctx,
    held.length === 0
      ? ["No temporary roles are running."]
      : [
          `${held.length} running:`,
          ...held.slice(0, 20).map((one) => `-# <@${one.targetId}> — <@&${one.extra}>`),
        ],
  );
}

async function roleCreate(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "create roles");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const colour = colourOf(parts[0] ?? "");
  const name = (colour === null ? parts.join(" ") : parts.slice(1).join(" ")).trim();
  if (!name) {
    await card(ctx, ["What should it be called?", "", "-# `role create #ff0000 Regulars`"]);
    return;
  }

  const made = await createRole(
    guildId,
    { name: name.slice(0, 100), ...(colour === null ? {} : { color: colour }) },
    `by ${ctx.authorId}`,
  );
  await card(
    ctx,
    made.ok ? [`Made <@&${made.data.id}>.`] : [`That did not work. ${made.message.slice(0, 120)}`],
  );
}

async function roleDelete(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "delete roles");
  if (!guildId) return;

  const role = await findRole(guildId, ctx.argument.trim());
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `role delete @role`"]);
    return;
  }
  if (!(await usable(ctx, guildId, role))) return;

  const done = await deleteRole(guildId, role.id, `by ${ctx.authorId}`);
  await card(
    ctx,
    done.ok
      ? [`**${plain(role.name)}** is gone.`]
      : [`That did not work. ${done.message.slice(0, 120)}`],
  );
}

function roleEditor(
  what: "name" | "color" | "hoist" | "mentionable" | "icon",
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageRoles(ctx, "edit roles");
    if (!guildId) return;

    const parts = words(ctx.argument);
    // Colour and icon take their value first, the rest take it last, which is the
    // order the spec lists the arguments in.
    const leading = what === "color" || what === "icon";
    const token = leading ? parts.slice(1).join(" ") : parts.slice(0, -1).join(" ");
    const value = leading ? (parts[0] ?? "") : (parts[parts.length - 1] ?? "");

    const role = token ? await findRole(guildId, token) : null;
    if (!role || !value) {
      await card(ctx, [
        "Which role?",
        "",
        `-# \`role ${what === "name" ? "edit @role <name>" : what === "color" ? "color #ff0000 @role" : what === "icon" ? "icon <url> @role" : `${what} @role`}\``,
      ]);
      return;
    }
    if (!(await usable(ctx, guildId, role))) return;

    let body: Record<string, unknown>;
    if (what === "name") body = { name: value.slice(0, 100) };
    else if (what === "color") {
      const colour = colourOf(value);
      if (colour === null) {
        await card(ctx, ["That is not a colour.", "", "-# `#ff0000`, or a name like `red`."]);
        return;
      }
      body = { color: colour };
    } else if (what === "icon") body = { icon: value };
    else body = { [what]: !(role as unknown as Record<string, boolean>)[what] };

    const done = await editRole(guildId, role.id, body, `by ${ctx.authorId}`);
    await card(
      ctx,
      done.ok
        ? [`**${plain(role.name)}** updated.`]
        : [`That did not work. ${done.message.slice(0, 140)}`],
    );
  };
}

async function toggleFlag(ctx: PrefixContext, flag: "hoist" | "mentionable"): Promise<void> {
  const guildId = await requireManageRoles(ctx, "edit roles");
  if (!guildId) return;

  const role = await findRole(guildId, ctx.argument.trim());
  if (!role) {
    await card(ctx, ["Which role?", "", `-# \`role ${flag} @role\``]);
    return;
  }
  if (!(await usable(ctx, guildId, role))) return;

  const now = !(role as unknown as Record<string, boolean>)[flag];
  const done = await editRole(guildId, role.id, { [flag]: now }, `by ${ctx.authorId}`);
  await card(ctx, [
    done.ok
      ? `**${plain(role.name)}** is ${now ? "now" : "no longer"} ${flag === "hoist" ? "shown separately" : "mentionable"}.`
      : `That did not work. ${done.message.slice(0, 120)}`,
  ]);
}

// Walking every member, which is why it reports as it goes and can be stopped.
async function mass(
  ctx: PrefixContext,
  guildId: string,
  role: Role,
  give: boolean,
  which: (roles: string[], bot: boolean) => boolean,
  what: string,
): Promise<void> {
  if (running.has(guildId)) {
    await card(ctx, ["A mass role change is already running here.", "", "-# `role cancel` stops it."]);
    return;
  }

  const members = await walkMembers(guildId);
  if (!members) {
    await card(ctx, ["The member list could not be read."]);
    return;
  }

  const token = { stop: false };
  running.set(guildId, token);
  await card(ctx, [
    `Working through ${members.length} members. \`role cancel\` stops it.`,
  ]);

  let changed = 0;
  try {
    for (const member of members) {
      if (token.stop) break;
      const id = member.user?.id;
      if (!id) continue;
      if (!which(member.roles ?? [], Boolean(member.user?.bot))) continue;

      const has = (member.roles ?? []).includes(role.id);
      if (give === has) continue;

      const done = give
        ? await giveRole(guildId, id, role.id, `mass, by ${ctx.authorId}`)
        : await takeRole(guildId, id, role.id, `mass, by ${ctx.authorId}`);
      if (done.ok) changed += 1;
    }
  } finally {
    running.delete(guildId);
  }

  await card(ctx, [
    `${give ? "Gave" : "Took"} <@&${role.id}> ${give ? "to" : "from"} ${changed} ${what}.`,
    ...(token.stop ? ["-# Stopped early."] : []),
  ]);
}

function massRole(
  which: (roles: string[], bot: boolean) => boolean,
  what: string,
  give: boolean,
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageRoles(ctx, "change roles in bulk");
    if (!guildId) return;

    const role = await findRole(guildId, ctx.argument.trim());
    if (!role) {
      await card(ctx, ["Which role?", "", `-# \`role ${what} @role\``]);
      return;
    }
    if (!(await usable(ctx, guildId, role))) return;
    await mass(ctx, guildId, role, give, which, what);
  };
}

function hasRole(give: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageRoles(ctx, "change roles in bulk");
    if (!guildId) return;

    const parts = words(ctx.argument);
    if (parts.length < 2) {
      await card(ctx, [
        "Which role, and which to give?",
        "",
        `-# \`role has @role ${give ? "@give" : "@remove"}\``,
      ]);
      return;
    }

    const source = await findRole(guildId, parts[0] as string);
    const wanted = await findRole(guildId, parts.slice(1).join(" "));
    if (!source || !wanted) {
      await card(ctx, ["One of those roles does not exist."]);
      return;
    }
    if (!(await usable(ctx, guildId, wanted))) return;

    await mass(ctx, guildId, wanted, give, (roles) => roles.includes(source.id), "members with it");
  };
}

async function roleCancel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "stop a mass role change");
  if (!guildId) return;

  const token = running.get(guildId);
  if (!token) {
    await card(ctx, ["Nothing is running."]);
    return;
  }
  token.stop = true;
  await card(ctx, ["Stopping."]);
}

async function topColor(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "change a role colour");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const colour = colourOf(parts[0] ?? "");
  if (colour === null) {
    await card(ctx, ["Which colour?", "", "-# `role topcolor #ff0000 [@member]`"]);
    return;
  }

  const who = userId(parts[1]) ?? ctx.authorId;
  const member = await memberOf(guildId, who);
  const all = await guildRoles(guildId);
  let top: Role | null = null;
  for (const roleId of member?.roles ?? []) {
    const found = all.find((role) => role.id === roleId);
    if (found && (!top || found.position > top.position)) top = found;
  }

  if (!top) {
    await card(ctx, ["They have no roles to colour."]);
    return;
  }
  if (!(await usable(ctx, guildId, top))) return;

  const done = await editRole(guildId, top.id, { color: colour }, `by ${ctx.authorId}`);
  await card(ctx, [
    done.ok ? `**${plain(top.name)}** recoloured.` : `That did not work. ${done.message.slice(0, 120)}`,
  ]);
}

// Roles are already written down when somebody is jailed, so restoring reuses
// that rather than inventing a second store.
async function roleRestore(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "restore roles");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `role restore @member`"]);
    return;
  }

  const rows = await sql<{ roles: string }[]>`
    SELECT roles FROM mod_jailed WHERE guild_id = ${guildId} AND user_id = ${who}
  `;
  const held = (rows[0]?.roles ?? "").split(",").filter(Boolean);
  if (held.length === 0) {
    await card(ctx, [
      `Nothing is being held for <@${who}>.`,
      "",
      "-# Only roles taken away by `jail` are kept.",
    ]);
    return;
  }

  let back = 0;
  for (const roleId of held) {
    const done = await giveRole(guildId, who, roleId, `restored by ${ctx.authorId}`);
    if (done.ok) back += 1;
  }
  await card(ctx, [`Gave <@${who}> ${back} role${back === 1 ? "" : "s"} back.`]);
}

async function roleOverview(ctx: PrefixContext): Promise<void> {
  await card(ctx, [
    "Modify a member's roles.",
    "",
    "-# `role @member @role` toggles · `role add` · `role remove`",
    "-# `role create` · `role delete` · `role edit` · `role color` · `role icon`",
    "-# `role hoist` · `role mentionable` · `role humans` · `role bots` · `role has`",
    "-# `role restore` · `role topcolor` · `role cancel`",
  ]);
}

export function registerRoles(): void {
  register({
    name: "role",
    aliases: ["r"],
    description: "Modify a member's roles",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("role", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      if (words(ctx.argument).length >= 2) {
        await oneMember(null)(ctx);
        return;
      }
      await roleOverview(ctx);
    },
  });

  groupUnder("role", () => {
    register({ name: "add", description: "Adds role to a member", handler: oneMember(true) });
    register({
      name: "remove",
      description: "Removes role from a member",
      handler: oneMember(false),
    });
    register({ name: "create", description: "Creates a role", handler: roleCreate });
    register({ name: "delete", description: "Deletes a role", handler: roleDelete });
    register({ name: "edit", description: "Change a role name", handler: roleEditor("name") });
    register({ name: "icon", description: "Set an icon for a role", handler: roleEditor("icon") });
    register({
      name: "hoist",
      description: "Toggle hoisting a role",
      handler: (ctx) => toggleFlag(ctx, "hoist"),
    });
    register({
      name: "mentionable",
      description: "Toggle mentioning a role",
      handler: (ctx) => toggleFlag(ctx, "mentionable"),
    });
    register({
      name: "topcolor",
      description: "Changes the highest role's colour",
      handler: topColor,
    });
    register({ name: "restore", description: "Restore roles to a member", handler: roleRestore });
    register({
      name: "cancel",
      description: "Cancels a mass role task running",
      handler: roleCancel,
    });

    register({
      name: "color",
      aliases: ["colour"],
      description: "Set a color for a role",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("role color", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await roleEditor("color")(ctx);
      },
    });
    groupUnder("role color", () => {
      register({
        name: "gradient",
        description: "Set a gradient colour for a role",
        handler: async (ctx) => {
          await card(ctx, [
            "Discord has no gradient role colours.",
            "",
            "-# `role color #ff0000 @role` sets the one colour a role can have.",
          ]);
        },
      });
    });

    register({
      name: "humans",
      description: "Add a role to all humans",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("role humans", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await massRole((_, bot) => !bot, "humans", true)(ctx);
      },
    });
    groupUnder("role humans", () => {
      register({
        name: "remove",
        description: "Remove a role from all humans",
        handler: massRole((_, bot) => !bot, "humans", false),
      });
    });

    register({
      name: "bots",
      description: "Add a role to all bots",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("role bots", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await massRole((_, bot) => bot, "bots", true)(ctx);
      },
    });
    groupUnder("role bots", () => {
      register({
        name: "remove",
        description: "Remove a role from all bots",
        handler: massRole((_, bot) => bot, "bots", false),
      });
    });

    register({
      name: "has",
      description: "Add a role to members with a specific role",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("role has", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await hasRole(true)(ctx);
      },
    });
    groupUnder("role has", () => {
      register({
        name: "remove",
        description: "Remove a role from members with a specific role",
        handler: hasRole(false),
      });
    });
  });

  register({
    name: "temprole",
    description: "Temporarily give a role to a member",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("temprole", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await temprole(ctx);
    },
  });
  groupUnder("temprole", () => {
    register({
      name: "list",
      description: "List all active temporary roles",
      handler: temproleList,
    });
  });
}
