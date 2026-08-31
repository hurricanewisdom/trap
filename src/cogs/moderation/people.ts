import { sql } from "../../core/db.js";
import {
  banMember,
  displayName,
  dmUser,
  editMember,
  getGuild,
  giveRole,
  guildRoles,
  hasPermission,
  kickMember,
  memberOf,
  PERMISSION,
  takeRole,
  walkMembers,
} from "../../core/discord.js";
import {
  requireAdministrator,
  requireBanMembers,
  requireManageGuild,
  requireManageNicknames,
  requireManageRoles,
  requireMoveMembers,
  requireOwner,
} from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { humanDuration, parseDuration, splitDuration } from "../../helpers/duration.js";
import { plain } from "../../helpers/markdown.js";
import { record } from "./cases.js";
import { later, remindersFor, forget } from "./schedule.js";
import { card, channelId, findRole, mayAct, shownReason, userId, words } from "./shared.js";

// Anything that can silence, remove or impersonate somebody. Stripping staff
// means taking every role that carries one of these.
const STAFFY = [
  PERMISSION.administrator,
  PERMISSION.manageGuild,
  PERMISSION.manageRoles,
  PERMISSION.manageChannels,
  PERMISSION.manageMessages,
  PERMISSION.banMembers,
  PERMISSION.kickMembers,
  PERMISSION.moderateMembers,
  PERMISSION.manageWebhooks,
  PERMISSION.manageNicknames,
];

async function remind(ctx: PrefixContext): Promise<void> {
  const split = splitDuration(ctx.argument.trim());
  if (split.ms === null || !split.rest) {
    await card(ctx, ["When, and about what?", "", "-# `remind 2h take the bins out`"]);
    return;
  }
  if (split.ms < 60_000) {
    await card(ctx, ["A minute is the shortest reminder."]);
    return;
  }

  await later(ctx.guildId ?? "0", "remind", ctx.authorId, split.rest.slice(0, 400), split.ms);
  await card(ctx, [
    `Reminding you in ${humanDuration(split.ms)}.`,
    `-# ${plain(split.rest.slice(0, 150))}`,
    "-# It arrives as a direct message.",
  ]);
}

async function reminderList(ctx: PrefixContext): Promise<void> {
  const held = await remindersFor(ctx.guildId ?? "0", ctx.authorId);
  await card(
    ctx,
    held.length === 0
      ? ["You have no reminders."]
      : [
          `${held.length} reminder${held.length === 1 ? "" : "s"}:`,
          ...held.map((one) => `-# **${one.id}** ${plain((one.extra ?? "").slice(0, 90))}`),
        ],
  );
}

async function reminderRemove(ctx: PrefixContext): Promise<void> {
  const said = words(ctx.argument)[0] ?? "";
  if (!/^\d{1,19}$/.test(said)) {
    await card(ctx, ["Which reminder?", "", "-# `remind list` shows the ids."]);
    return;
  }

  // Checked against this person's own reminders first, so an id somebody guessed
  // cannot cancel a stranger's.
  const mine = await remindersFor(ctx.guildId ?? "0", ctx.authorId);
  if (!mine.some((one) => one.id === said)) {
    await card(ctx, ["That is not one of yours."]);
    return;
  }

  await forget(said);
  await card(ctx, ["Reminder removed."]);
}

async function rename(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageNicknames(ctx, "rename members");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `rename @member <nickname>`"]);
    return;
  }

  const blocked = await mayAct(guildId, ctx.authorId, who, null);
  if (blocked) {
    await card(ctx, [blocked.why]);
    return;
  }

  const forced = await sql<{ nickname: string }[]>`
    SELECT nickname FROM mod_forced_nicks WHERE guild_id = ${guildId} AND user_id = ${who}
  `;
  if (forced.length > 0) {
    await card(ctx, [
      `<@${who}> has a forced nickname.`,
      "",
      "-# `forcenickname @member` lifts it first.",
    ]);
    return;
  }

  const name = parts.slice(1).join(" ").trim();
  const done = await editMember(guildId, who, { nick: name || null }, `by ${ctx.authorId}`);
  await card(ctx, [
    done.ok
      ? name
        ? `<@${who}> is now **${plain(name.slice(0, 60))}**.`
        : `<@${who}>'s nickname was cleared.`
      : `That did not work. ${done.message.slice(0, 120)}`,
  ]);
}

async function forceNickname(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "force a nickname");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `forcenickname @member <name>`"]);
    return;
  }

  const name = parts.slice(1).join(" ").trim();
  if (!name) {
    const gone = await sql<{ user_id: string }[]>`
      DELETE FROM mod_forced_nicks WHERE guild_id = ${guildId} AND user_id = ${who}
      RETURNING user_id
    `;
    await card(ctx, [
      gone.length > 0 ? `<@${who}>'s nickname is no longer forced.` : `<@${who}> has no forced nickname.`,
    ]);
    return;
  }

  await sql`
    INSERT INTO mod_forced_nicks (guild_id, user_id, nickname)
    VALUES (${guildId}, ${who}, ${name.slice(0, 32)})
    ON CONFLICT (guild_id, user_id) DO UPDATE SET nickname = EXCLUDED.nickname
  `;
  await editMember(guildId, who, { nick: name.slice(0, 32) }, `forced by ${ctx.authorId}`);
  await card(ctx, [
    `<@${who}> is **${plain(name.slice(0, 60))}** and cannot be renamed.`,
    "-# It is put back whenever it changes.",
  ]);
}

async function forcedList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see forced nicknames");
  if (!guildId) return;

  const rows = await sql<{ user_id: string; nickname: string }[]>`
    SELECT user_id, nickname FROM mod_forced_nicks WHERE guild_id = ${guildId} LIMIT 50
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["No nicknames are forced."]
      : [
          `${rows.length} forced:`,
          ...rows.map((row) => `-# <@${row.user_id}> — ${plain(row.nickname)}`),
        ],
  );
}

export async function reapplyNick(guildId: string, userId2: string): Promise<void> {
  const rows = await sql<{ nickname: string }[]>`
    SELECT nickname FROM mod_forced_nicks WHERE guild_id = ${guildId} AND user_id = ${userId2}
  `;
  const wanted = rows[0]?.nickname;
  if (!wanted) return;

  const member = await memberOf(guildId, userId2);
  if (member && member.nick !== wanted) {
    await editMember(guildId, userId2, { nick: wanted }, "forced nickname");
  }
}

async function stripStaff(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "strip staff roles");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `stripstaff @member`"]);
    return;
  }

  const blocked = await mayAct(guildId, ctx.authorId, who, null);
  if (blocked) {
    await card(ctx, [blocked.why]);
    return;
  }

  const member = await memberOf(guildId, who);
  const all = await guildRoles(guildId);
  let taken = 0;

  for (const roleId of member?.roles ?? []) {
    const role = all.find((one) => one.id === roleId);
    if (!role) continue;
    const bits = BigInt(role.permissions);
    if (!STAFFY.some((bit) => (bits & bit) !== 0n)) continue;
    const done = await takeRole(guildId, who, roleId, `stripped by ${ctx.authorId}`);
    if (done.ok) taken += 1;
  }

  await record(guildId, "stripstaff", who, ctx.authorId, `${taken} roles`);
  await card(ctx, [
    taken === 0 ? `<@${who}> had no staff roles.` : `Took ${taken} staff role${taken === 1 ? "" : "s"} from <@${who}>.`,
  ]);
}

async function permissionsFor(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "check permissions");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]) ?? ctx.authorId;
  const named: [string, bigint][] = [
    ["Administrator", PERMISSION.administrator],
    ["Manage Server", PERMISSION.manageGuild],
    ["Manage Roles", PERMISSION.manageRoles],
    ["Manage Channels", PERMISSION.manageChannels],
    ["Manage Messages", PERMISSION.manageMessages],
    ["Ban Members", PERMISSION.banMembers],
    ["Kick Members", PERMISSION.kickMembers],
    ["Moderate Members", PERMISSION.moderateMembers],
    ["Manage Webhooks", PERMISSION.manageWebhooks],
    ["Manage Nicknames", PERMISSION.manageNicknames],
    ["Move Members", PERMISSION.moveMembers],
  ];

  const has: string[] = [];
  for (const [label, bit] of named) {
    if (await hasPermission(guildId, who, bit)) has.push(label);
  }

  await card(ctx, [
    `**${plain(await displayName(guildId, who))}** holds:`,
    has.length === 0 ? "-# nothing on this list" : has.map((one) => `-# ${one}`).join("\n"),
  ]);
}

async function newMembers(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const said = words(ctx.argument)[0] ?? "";
  const many = /^\d{1,3}$/.test(said) ? Math.min(50, Number(said)) : 10;

  const members = await walkMembers(ctx.guildId);
  if (!members) {
    await card(ctx, ["The member list could not be read."]);
    return;
  }

  const sorted = members
    .filter((one) => one.user?.id)
    .map((one) => ({
      id: one.user?.id as string,
      joined: Date.parse(
        (one as unknown as { joined_at?: string }).joined_at ?? "1970-01-01T00:00:00Z",
      ),
    }))
    .sort((a, b) => b.joined - a.joined)
    .slice(0, many);

  await card(ctx, [
    `The ${sorted.length} most recent to join:`,
    ...sorted.map(
      (one) => `-# <@${one.id}> — <t:${Math.floor(one.joined / 1000)}:R>`,
    ),
  ]);
}

// Bans or kicks everybody who joined inside a window. Deliberately reports what
// it would do before doing it is not possible here, so the window is capped and
// the count is always said out loud.
async function sweepJoiners(
  ctx: PrefixContext,
  guildId: string,
  since: number,
  action: "ban" | "kick",
  reason: string,
): Promise<void> {
  const members = await walkMembers(guildId);
  if (!members) {
    await card(ctx, ["The member list could not be read."]);
    return;
  }

  const caught = members.filter((one) => {
    const at = Date.parse((one as unknown as { joined_at?: string }).joined_at ?? "");
    return Number.isFinite(at) && at >= since && one.user?.id && !one.user.bot;
  });

  if (caught.length === 0) {
    await card(ctx, ["Nobody joined in that time."]);
    return;
  }

  let done = 0;
  for (const one of caught) {
    const id = one.user?.id as string;
    const out =
      action === "ban"
        ? await banMember(guildId, id, 86_400, `${reason} (by ${ctx.authorId})`)
        : await kickMember(guildId, id, `${reason} (by ${ctx.authorId})`);
    if (out.ok) {
      done += 1;
      await record(guildId, action === "ban" ? "ban" : "kick", id, ctx.authorId, reason);
    }
  }

  await card(ctx, [
    `${done} of ${caught.length} ${action === "ban" ? "banned" : "kicked"}.`,
    `-# ${reason}`,
  ]);
}

async function recentBan(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBanMembers(ctx, "ban recent joiners");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const many = /^\d{1,3}$/.test(parts[0] ?? "") ? Number(parts[0]) : 0;
  if (many <= 0) {
    await card(ctx, ["How many of the most recent?", "", "-# `recentban 10 raid`"]);
    return;
  }

  const members = await walkMembers(guildId);
  if (!members) {
    await card(ctx, ["The member list could not be read."]);
    return;
  }

  const sorted = members
    .filter((one) => one.user?.id && !one.user.bot)
    .sort(
      (a, b) =>
        Date.parse((b as unknown as { joined_at?: string }).joined_at ?? "") -
        Date.parse((a as unknown as { joined_at?: string }).joined_at ?? ""),
    )
    .slice(0, Math.min(100, many));

  const reason = shownReason(parts.slice(1).join(" "));
  let done = 0;
  for (const one of sorted) {
    const out = await banMember(guildId, one.user?.id as string, 86_400, `${reason} (by ${ctx.authorId})`);
    if (out.ok) {
      done += 1;
      await record(guildId, "ban", one.user?.id as string, ctx.authorId, reason);
    }
  }

  await card(ctx, [`${done} of the ${sorted.length} most recent joiners banned.`, `-# ${reason}`]);
}

async function raid(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBanMembers(ctx, "act on a raid");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const ms = parseDuration(parts[0] ?? "");
  if (ms === null) {
    await card(ctx, ["How far back?", "", "-# `raid 10m ban raiding`"]);
    return;
  }
  if (ms > 86_400_000) {
    await card(ctx, ["A day is as far back as this goes."]);
    return;
  }

  const action = (parts[1] ?? "ban").toLowerCase() === "kick" ? "kick" : "ban";
  const reason = shownReason(parts.slice(2).join(" ")) || "Raid";
  await sweepJoiners(ctx, guildId, Date.now() - ms, action, reason);
}

async function dump(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "dump a role");
  if (!guildId) return;

  const role = await findRole(guildId, ctx.argument.trim());
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `dump @role`"]);
    return;
  }

  const members = await walkMembers(guildId);
  const held = (members ?? []).filter((one) => (one.roles ?? []).includes(role.id));
  await card(ctx, [
    `**${plain(role.name)}** has ${held.length} member${held.length === 1 ? "" : "s"}.`,
    ...(held.length === 0
      ? []
      : [held.slice(0, 60).map((one) => `<@${one.user?.id}>`).join(" ")]),
    ...(held.length > 60 ? [`-# and ${held.length - 60} more`] : []),
  ]);
}

function voiceMove(all: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireMoveMembers(ctx, "move members between voice channels");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const into = channelId(parts[parts.length - 1]);
    if (!into) {
      await card(ctx, [
        "Which channel?",
        "",
        `-# \`${all ? "moveall #channel" : "drag @member #channel"}\``,
      ]);
      return;
    }

    // Discord only reports who is in a voice channel over the gateway, and this
    // bot does not ask for that intent, so a move is per named member.
    const who = parts.slice(0, -1).map(userId).filter(Boolean) as string[];
    if (who.length === 0) {
      await card(ctx, [
        all
          ? "Who is in a voice channel is only sent over the gateway, which this bot does not listen to."
          : "Which member?",
        "",
        all
          ? "-# `drag @member @member #channel` moves named people instead."
          : "-# `drag @member #channel`",
      ]);
      return;
    }

    let moved = 0;
    for (const id of who) {
      const done = await editMember(guildId, id, { channel_id: into }, `by ${ctx.authorId}`);
      if (done.ok) moved += 1;
    }
    await card(ctx, [`Moved ${moved} of ${who.length} into <#${into}>.`]);
  };
}

function stickyEditor(adding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireOwner(ctx, "change sticky roles");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const who = userId(parts[0]);
    const role = parts.length > 1 ? await findRole(guildId, parts.slice(1).join(" ")) : null;
    if (!who || !role) {
      await card(ctx, [
        "Which member, and which role?",
        "",
        `-# \`stickyrole ${adding ? "add" : "remove"} @member @role\``,
      ]);
      return;
    }

    if (adding) {
      await sql`
        INSERT INTO mod_sticky_roles (guild_id, user_id, role_id)
        VALUES (${guildId}, ${who}, ${role.id})
        ON CONFLICT (guild_id, user_id, role_id) DO NOTHING
      `;
    } else {
      await sql`
        DELETE FROM mod_sticky_roles
        WHERE guild_id = ${guildId} AND user_id = ${who} AND role_id = ${role.id}
      `;
    }

    await card(ctx, [
      adding
        ? `<@&${role.id}> comes back to <@${who}> when they rejoin.`
        : `<@&${role.id}> no longer comes back to <@${who}>.`,
    ]);
  };
}

async function stickyList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "see sticky roles");
  if (!guildId) return;

  const rows = await sql<{ user_id: string; role_id: string }[]>`
    SELECT user_id, role_id FROM mod_sticky_roles WHERE guild_id = ${guildId} LIMIT 50
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["No sticky roles."]
      : [
          `${rows.length}:`,
          ...rows.map((row) => `-# <@${row.user_id}> — <@&${row.role_id}>`),
        ],
  );
}

export async function reapplySticky(guildId: string, userId2: string): Promise<void> {
  const rows = await sql<{ role_id: string }[]>`
    SELECT role_id FROM mod_sticky_roles WHERE guild_id = ${guildId} AND user_id = ${userId2}
  `;
  for (const row of rows) await giveRole(guildId, userId2, row.role_id, "sticky role");
}

export async function sendReminder(userId2: string, body: string): Promise<void> {
  await dmUser(userId2, { content: `Reminder: ${body}` });
}

export function registerPeople(): void {
  register({
    name: "remind",
    aliases: ["reminder"],
    description: "Get a reminder after a while",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("remind", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await remind(ctx);
    },
  });
  groupUnder("remind", () => {
    register({ name: "list", description: "View a list of your reminders", handler: reminderList });
    register({ name: "remove", description: "Remove a reminder", handler: reminderRemove });
  });
  register({
    name: "reminders",
    description: "View a list of your reminders",
    handler: reminderList,
  });

  register({ name: "rename", description: "Assigns a member a new nickname", handler: rename });
  register({
    name: "forcenickname",
    aliases: ["forcenick"],
    description: "Force a member's nickname",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("forcenickname", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await forceNickname(ctx);
    },
  });
  groupUnder("forcenickname", () => {
    register({
      name: "list",
      description: "View a list of all forced nicknames",
      handler: forcedList,
    });
  });

  register({ name: "stripstaff", description: "Strip staff roles from a member", handler: stripStaff });
  register({
    name: "permissions",
    aliases: ["perms"],
    description: "Check permissions for a member",
    handler: permissionsFor,
  });
  register({
    name: "newmembers",
    description: "View list of recently joined members",
    handler: newMembers,
  });
  register({
    name: "recentban",
    description: "Chunk ban recently joined members",
    handler: recentBan,
  });
  register({
    name: "raid",
    description: "Remove members who joined during a raid",
    handler: raid,
  });
  register({ name: "dump", description: "Dumps all members of a role", handler: dump });
  register({ name: "drag", description: "Drag members to a voice channel", handler: voiceMove(false) });
  register({
    name: "moveall",
    description: "Move all members in a voice channel to another",
    handler: voiceMove(true),
  });

  register({
    name: "stickyrole",
    description: "Reapplies a role on join",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("stickyrole", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await stickyEditor(true)(ctx);
    },
  });
  groupUnder("stickyrole", () => {
    register({ name: "add", description: "Reapplies a role on join", handler: stickyEditor(true) });
    register({
      name: "remove",
      description: "Removes sticky role on join",
      handler: stickyEditor(false),
    });
    register({ name: "list", description: "View a list of every sticky role", handler: stickyList });
  });
}

export { getGuild };
