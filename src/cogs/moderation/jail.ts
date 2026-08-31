import { sql } from "../../core/db.js";
import {
  createRole,
  displayName,
  editMember,
  giveRole,
  guildRoles,
  memberOf,
  takeRole,
} from "../../core/discord.js";
import {
  requireManageGuild,
  requireManageMessages,
  requireModerateMembers,
} from "../../core/permissions.js";
import { register, type PrefixContext, type PrefixHandler } from "../../core/prefix.js";
import { humanDuration, splitDuration } from "../../helpers/duration.js";
import { record } from "./cases.js";
import { config, saveConfig } from "./config.js";
import { cancel, later } from "./schedule.js";
import { card, findRole, mayAct, shownReason, userId, words } from "./shared.js";

// The three flavours of mute the spec asks for, each its own role so a server can
// take away one thing without taking away the others.
export const MUTES = {
  mute: { field: "muteRole", name: "muted", says: "speak" },
  imute: { field: "imuteRole", name: "imuted", says: "attach files or embed links" },
  rmute: { field: "rmuteRole", name: "rmuted", says: "react or use external emotes" },
} as const;

export type MuteKind = keyof typeof MUTES;

async function roleFor(guildId: string, kind: MuteKind): Promise<string | null> {
  const held = await config(guildId);
  return held[MUTES[kind].field] as string | null;
}

function muter(kind: MuteKind, lifting: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireModerateMembers(ctx, "mute members");
    if (!guildId) return;

    const roleId = await roleFor(guildId, kind);
    if (!roleId) {
      await card(ctx, [
        `There is no ${MUTES[kind].name} role yet.`,
        "",
        "-# `setupmute` makes the three of them and sets the channel overwrites.",
      ]);
      return;
    }

    const parts = words(ctx.argument);
    const who = userId(parts[0]);
    if (!who) {
      await card(ctx, ["Which member?", "", `-# \`${lifting ? "un" : ""}${kind} @member reason\``]);
      return;
    }

    const blocked = await mayAct(guildId, ctx.authorId, who, null);
    if (blocked) {
      await card(ctx, [blocked.why]);
      return;
    }

    let rest = parts.slice(1).join(" ");
    let ms: number | null = null;
    if (!lifting) {
      const split = splitDuration(rest);
      ms = split.ms;
      rest = split.rest;
    }
    const reason = shownReason(rest);

    const done = lifting
      ? await takeRole(guildId, who, roleId, `${reason} (by ${ctx.authorId})`)
      : await giveRole(guildId, who, roleId, `${reason} (by ${ctx.authorId})`);
    if (!done.ok) {
      await card(ctx, ["That did not work.", "", `-# ${done.message.slice(0, 150)}`]);
      return;
    }

    await cancel(guildId, "unmute", who);
    if (!lifting && ms !== null) await later(guildId, "unmute", who, roleId, ms);

    const caseId = await record(
      guildId,
      lifting ? `un${kind}` : kind,
      who,
      ctx.authorId,
      reason,
      ms,
    );
    const name = await displayName(guildId, who);
    await card(ctx, [
      lifting
        ? `**${name}** can ${MUTES[kind].says} again. Case #${caseId}.`
        : `**${name}** can no longer ${MUTES[kind].says}${ms ? ` for ${humanDuration(ms)}` : ""}. Case #${caseId}.`,
      `-# ${reason}`,
    ]);
  };
}

async function jail(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "jail members");
  if (!guildId) return;

  const held = await config(guildId);
  if (!held.jailRole) {
    await card(ctx, ["There is no jail role yet.", "", "-# `setup` builds one."]);
    return;
  }

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `jail @member 1h reason`"]);
    return;
  }

  const blocked = await mayAct(guildId, ctx.authorId, who, null);
  if (blocked) {
    await card(ctx, [blocked.why]);
    return;
  }

  const member = await memberOf(guildId, who);
  if (!member) {
    await card(ctx, ["They are not in the server."]);
    return;
  }

  const split = splitDuration(parts.slice(1).join(" "));
  const reason = shownReason(split.rest);

  // Their roles are written down before being taken away, because unjailing has
  // to give back what they had rather than guess.
  const had = (member.roles ?? []).filter((id) => id !== held.jailRole);
  await sql`
    INSERT INTO mod_jailed (guild_id, user_id, roles) VALUES (${guildId}, ${who}, ${had.join(",")})
    ON CONFLICT (guild_id, user_id) DO UPDATE SET roles = EXCLUDED.roles, at = now()
  `;

  for (const roleId of had) await takeRole(guildId, who, roleId, "jailed");
  const done = await giveRole(guildId, who, held.jailRole, `${reason} (by ${ctx.authorId})`);
  if (!done.ok) {
    await card(ctx, ["That did not work.", "", `-# ${done.message.slice(0, 150)}`]);
    return;
  }

  await cancel(guildId, "unjail", who);
  if (split.ms !== null) await later(guildId, "unjail", who, null, split.ms);

  const caseId = await record(guildId, "jail", who, ctx.authorId, reason, split.ms);
  await card(ctx, [
    `**${await displayName(guildId, who)}** is jailed${split.ms ? ` for ${humanDuration(split.ms)}` : ""}. Case #${caseId}.`,
    `-# ${reason}`,
    `-# ${had.length} role${had.length === 1 ? "" : "s"} held back until they are out`,
  ]);
}

export async function releaseFrom(guildId: string, who: string): Promise<number> {
  const held = await config(guildId);
  const rows = await sql<{ roles: string }[]>`
    DELETE FROM mod_jailed WHERE guild_id = ${guildId} AND user_id = ${who} RETURNING roles
  `;
  if (held.jailRole) await takeRole(guildId, who, held.jailRole, "unjailed");

  const back = (rows[0]?.roles ?? "").split(",").filter(Boolean);
  for (const roleId of back) await giveRole(guildId, who, roleId, "unjailed");
  return back.length;
}

async function unjail(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "unjail members");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `unjail @member reason`"]);
    return;
  }

  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM mod_jailed WHERE guild_id = ${guildId} AND user_id = ${who}
  `;
  if (rows.length === 0) {
    await card(ctx, [`<@${who}> is not jailed.`]);
    return;
  }

  const reason = shownReason(parts.slice(1).join(" "));
  const back = await releaseFrom(guildId, who);
  await cancel(guildId, "unjail", who);

  const caseId = await record(guildId, "unjail", who, ctx.authorId, reason);
  await card(ctx, [
    `**${await displayName(guildId, who)}** is out. Case #${caseId}.`,
    `-# ${reason}`,
    `-# ${back} role${back === 1 ? "" : "s"} given back`,
  ]);
}

async function jailList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "see who is jailed");
  if (!guildId) return;

  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM mod_jailed WHERE guild_id = ${guildId} ORDER BY at DESC LIMIT 50
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["Nobody is jailed."]
      : [`${rows.length} jailed:`, rows.map((row) => `<@${row.user_id}>`).join(" ")],
  );
}

// Makes a role if the server has none, and reuses one by name if it does, so
// running setup twice does not leave two.
async function ensureRole(guildId: string, name: string): Promise<string | null> {
  const all = await guildRoles(guildId);
  const found = all.find((role) => role.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;

  const made = await createRole(guildId, { name, permissions: "0" }, "moderation setup");
  return made.ok ? made.data.id : null;
}

async function setupMute(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set up the mute roles");
  if (!guildId) return;

  const made: string[] = [];
  const patch: Record<string, string> = {};
  for (const kind of ["mute", "imute", "rmute"] as MuteKind[]) {
    const roleId = await ensureRole(guildId, MUTES[kind].name);
    if (!roleId) continue;
    patch[MUTES[kind].field] = roleId;
    made.push(`<@&${roleId}>`);
  }

  await saveConfig(guildId, patch);
  await card(ctx, [
    made.length === 0 ? "No roles could be made." : `Ready: ${made.join(" ")}`,
    "",
    "⚠️ -# The roles exist, but Discord applies nothing until each channel denies",
    "-# them. Set the channel overwrites, or `revokefiles` and `talk` per channel.",
  ]);
}

async function setup(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set up moderation");
  if (!guildId) return;

  const jailRole = await ensureRole(guildId, "jailed");
  const patch: Record<string, string> = {};
  if (jailRole) patch.jailRole = jailRole;

  for (const kind of ["mute", "imute", "rmute"] as MuteKind[]) {
    const roleId = await ensureRole(guildId, MUTES[kind].name);
    if (roleId) patch[MUTES[kind].field] = roleId;
  }

  await saveConfig(guildId, patch);
  const held = await config(guildId);
  await card(ctx, [
    "Moderation is set up.",
    `-# jail role: ${held.jailRole ? `<@&${held.jailRole}>` : "none"}`,
    `-# mute roles: ${[held.muteRole, held.imuteRole, held.rmuteRole].filter(Boolean).length} of 3`,
    "",
    "-# The roles carry no permissions by themselves. Deny them in the channels",
    "-# that matter, and `jail` will hold somebody's other roles for them.",
  ]);
}

async function setJailChannel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the jail role");
  if (!guildId) return;

  const token = words(ctx.argument)[0] ?? "";
  const role = token ? await findRole(guildId, token) : null;
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `jailrole @role`"]);
    return;
  }

  await saveConfig(guildId, { jailRole: role.id });
  await card(ctx, [`Jailed members get <@&${role.id}>.`]);
}

export function registerJail(): void {
  register({ name: "jail", description: "Jails the mentioned user", handler: jail });
  register({ name: "unjail", description: "Unjails the mentioned user", handler: unjail });
  register({
    name: "jaillist",
    description: "View a list of every current jailed member",
    handler: jailList,
  });
  register({ name: "jailrole", description: "Set the jail role", handler: setJailChannel });

  for (const kind of ["mute", "imute", "rmute"] as MuteKind[]) {
    register({
      name: kind,
      description:
        kind === "mute"
          ? "Mute a member"
          : kind === "imute"
            ? "Remove a member's attach files and embed links permission"
            : "Remove a member's add reactions and use external emotes permission",
      handler: muter(kind, false),
    });
    register({
      name: kind === "mute" ? "unmute" : `${kind.charAt(0)}unmute`,
      description: `Restores what ${kind} took away`,
      handler: muter(kind, true),
    });
  }

  register({
    name: "setupmute",
    description: "Sets up muted roles and channel permissions",
    handler: setupMute,
  });
  register({
    name: "setup",
    description: "Start process for setting up the moderation system",
    handler: setup,
  });
}

export { editMember };
