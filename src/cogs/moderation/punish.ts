import {
  banMember,
  banOf,
  displayName,
  getGuild,
  dmUser,
  memberOf,
  timeoutMember,
  unbanMember,
} from "../../core/discord.js";
import { sql } from "../../core/db.js";
import {
  requireBanMembers,
  requireAdministrator,
  requireManageMessages,
  requireModerateMembers,
} from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { humanDuration, splitDuration } from "../../helpers/duration.js";
import { record } from "./cases.js";
import { config, saveConfig } from "./config.js";
import { cancel, later } from "./schedule.js";
import { card, mayAct, shownReason, userId, words } from "./shared.js";

const DAY = 86_400;

async function ownerOf(guildId: string): Promise<string | null> {
  const guild = await getGuild(guildId);
  return guild?.owner_id ? String(guild.owner_id) : null;
}

// Telling somebody why they were punished is the point of a warning, and the
// attempt is separated from the outcome: a closed inbox is not a failed warning.
async function tell(userIdent: string, body: string): Promise<boolean> {
  return dmUser(userIdent, { content: body });
}

async function target(
  ctx: PrefixContext,
  guildId: string,
  token: string | undefined,
  usage: string,
): Promise<string | null> {
  const found = userId(token);
  if (!found) {
    await card(ctx, ["Which member?", "", `-# \`${usage}\``]);
    return null;
  }

  const blocked = await mayAct(guildId, ctx.authorId, found, await ownerOf(guildId));
  if (blocked) {
    await card(ctx, [blocked.why]);
    return null;
  }
  return found;
}

async function banning(ctx: PrefixContext, soft: boolean, temp: boolean): Promise<void> {
  const guildId = await requireBanMembers(ctx, "ban members");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = await target(
    ctx,
    guildId,
    parts[0],
    temp ? "tempban @member 7d reason" : "ban @member reason",
  );
  if (!who) return;

  let rest = parts.slice(1).join(" ");
  let ms: number | null = null;
  if (temp) {
    const split = splitDuration(rest);
    ms = split.ms;
    rest = split.rest;
    if (ms === null) {
      await card(ctx, ["How long for?", "", "-# `tempban @member 7d reason`"]);
      return;
    }
  }

  // A leading number is how long to purge, in days, which is what the spec calls
  // "delete history". Anything else is the reason.
  const held = await config(guildId);
  let days = held.banPurge;
  const first = rest.trim().split(/\s+/)[0] ?? "";
  if (/^[0-7]$/.test(first)) {
    days = Number(first);
    rest = rest.trim().slice(first.length).trim();
  }
  const reason = shownReason(rest);

  const name = await displayName(guildId, who);
  const seconds = soft ? DAY : days * DAY;
  const done = await banMember(guildId, who, seconds, `${reason} (by ${ctx.authorId})`);
  if (!done.ok) {
    await card(ctx, ["That did not work.", "", `-# ${done.message.slice(0, 150)}`]);
    return;
  }

  if (soft) {
    // A softban is a ban used as a purge, so the ban comes straight back off.
    await unbanMember(guildId, who, "softban");
  }

  const caseId = await record(
    guildId,
    soft ? "softban" : temp ? "tempban" : "ban",
    who,
    ctx.authorId,
    reason,
    ms,
  );
  if (temp && ms !== null) {
    await cancel(guildId, "unban", who);
    await later(guildId, "unban", who, null, ms);
  }

  await card(ctx, [
    soft
      ? `**${name}** was softbanned. Case #${caseId}.`
      : temp
        ? `**${name}** was banned for ${humanDuration(ms ?? 0)}. Case #${caseId}.`
        : `**${name}** was banned. Case #${caseId}.`,
    `-# ${reason}`,
    ...(days > 0 && !soft ? [`-# ${days} day${days === 1 ? "" : "s"} of messages removed`] : []),
  ]);
}

async function unban(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBanMembers(ctx, "unban members");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  if (!who) {
    await card(ctx, ["Which user?", "", "-# `unban <id> reason`"]);
    return;
  }

  const held = await sql<{ user_id: string }[]>`
    SELECT user_id FROM mod_hardbans WHERE guild_id = ${guildId} AND user_id = ${who}
  `;
  if (held.length > 0) {
    await card(ctx, [
      "That one is hardbanned.",
      "",
      "-# An administrator has to `hardban` them again to lift it.",
    ]);
    return;
  }

  if (!(await banOf(guildId, who))) {
    await card(ctx, ["That user is not banned."]);
    return;
  }

  const reason = shownReason(parts.slice(1).join(" "));
  const done = await unbanMember(guildId, who, `${reason} (by ${ctx.authorId})`);
  if (!done.ok) {
    await card(ctx, ["That did not work.", "", `-# ${done.message.slice(0, 150)}`]);
    return;
  }

  await cancel(guildId, "unban", who);
  const caseId = await record(guildId, "unban", who, ctx.authorId, reason);
  await card(ctx, [`<@${who}> was unbanned. Case #${caseId}.`, `-# ${reason}`]);
}

async function hardban(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "hardban members");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = await target(ctx, guildId, parts[0], "hardban @member reason");
  if (!who) return;

  const reason = shownReason(parts.slice(1).join(" "));
  const already = await sql<{ user_id: string }[]>`
    DELETE FROM mod_hardbans WHERE guild_id = ${guildId} AND user_id = ${who} RETURNING user_id
  `;
  if (already.length > 0) {
    await unbanMember(guildId, who, `hardban lifted (by ${ctx.authorId})`);
    const caseId = await record(guildId, "unhardban", who, ctx.authorId, reason);
    await card(ctx, [`<@${who}> is no longer hardbanned. Case #${caseId}.`]);
    return;
  }

  await banMember(guildId, who, 0, `hardban: ${reason} (by ${ctx.authorId})`);
  await sql`
    INSERT INTO mod_hardbans (guild_id, user_id, by_id) VALUES (${guildId}, ${who}, ${ctx.authorId})
    ON CONFLICT (guild_id, user_id) DO NOTHING
  `;
  const caseId = await record(guildId, "hardban", who, ctx.authorId, reason);
  await card(ctx, [
    `<@${who}> is hardbanned. Case #${caseId}.`,
    `-# ${reason}`,
    "",
    "-# `unban` will not lift this one; run `hardban` on them again.",
  ]);
}

async function hardbanList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "see the hardban list");
  if (!guildId) return;

  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM mod_hardbans WHERE guild_id = ${guildId} ORDER BY at DESC LIMIT 50
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["Nobody is hardbanned."]
      : [`${rows.length} hardbanned:`, rows.map((row) => `<@${row.user_id}>`).join(" ")],
  );
}

async function warn(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "warn members");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = await target(ctx, guildId, parts[0], "warn @member reason");
  if (!who) return;

  const reason = shownReason(parts.slice(1).join(" "));
  const caseId = await record(guildId, "warn", who, ctx.authorId, reason);
  const guild = await getGuild(guildId);
  const reached = await tell(
    who,
    `You were warned in **${guild?.name ?? "the server"}**: ${reason}`,
  );

  await card(ctx, [
    `**${await displayName(guildId, who)}** was warned. Case #${caseId}.`,
    `-# ${reason}`,
    ...(reached ? [] : ["-# Their DMs are closed, so they were not told."]),
  ]);
}

function timeoutSetter(lifting: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireModerateMembers(ctx, "time members out");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const who = await target(
      ctx,
      guildId,
      parts[0],
      lifting ? "untimeout @member reason" : "timeout @member 10m reason",
    );
    if (!who) return;

    let rest = parts.slice(1).join(" ");
    let ms: number | null = null;
    if (!lifting) {
      const split = splitDuration(rest);
      ms = split.ms;
      rest = split.rest;
      if (ms === null) {
        await card(ctx, ["How long for?", "", "-# `timeout @member 10m reason`"]);
        return;
      }
      // Discord's own ceiling; asking for more is refused by the API.
      if (ms > 28 * 86_400_000) {
        await card(ctx, ["Discord caps a timeout at 28 days."]);
        return;
      }
    }

    const reason = shownReason(rest);
    const until = lifting ? null : new Date(Date.now() + (ms ?? 0)).toISOString();
    const done = await timeoutMember(guildId, who, until, `${reason} (by ${ctx.authorId})`);
    if (!done.ok) {
      await card(ctx, ["That did not work.", "", `-# ${done.message.slice(0, 150)}`]);
      return;
    }

    const caseId = await record(
      guildId,
      lifting ? "untimeout" : "timeout",
      who,
      ctx.authorId,
      reason,
      ms,
    );
    await card(ctx, [
      lifting
        ? `**${await displayName(guildId, who)}** is no longer timed out. Case #${caseId}.`
        : `**${await displayName(guildId, who)}** is timed out for ${humanDuration(ms ?? 0)}. Case #${caseId}.`,
      `-# ${reason}`,
    ]);
  };
}

async function timeoutList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireModerateMembers(ctx, "see who is timed out");
  if (!guildId) return;

  const rows = await sql<{ target_id: string }[]>`
    SELECT DISTINCT target_id FROM mod_cases
    WHERE guild_id = ${guildId} AND action = 'timeout'
    ORDER BY target_id LIMIT 100
  `;

  const now = Date.now();
  const held: string[] = [];
  for (const row of rows) {
    const member = await memberOf(guildId, row.target_id);
    const until = (member as { communication_disabled_until?: string | null } | null)
      ?.communication_disabled_until;
    if (until && Date.parse(until) > now) held.push(row.target_id);
  }

  await card(
    ctx,
    held.length === 0
      ? ["Nobody is timed out."]
      : [`${held.length} timed out:`, held.map((id) => `<@${id}>`).join(" ")],
  );
}

async function banPurgeDefault(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBanMembers(ctx, "change the ban purge default");
  if (!guildId) return;

  const said = words(ctx.argument)[0] ?? "";
  if (!/^[0-7]$/.test(said)) {
    const held = await config(guildId);
    await card(ctx, [
      `Bans remove ${held.banPurge} day${held.banPurge === 1 ? "" : "s"} of messages by default.`,
      "",
      "-# `ban purge <0-7>`",
    ]);
    return;
  }

  await saveConfig(guildId, { banPurge: Number(said) });
  await card(ctx, [`Bans now remove ${said} day${said === "1" ? "" : "s"} of messages.`]);
}

async function banRecent(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBanMembers(ctx, "see recent bans");
  if (!guildId) return;

  const rows = await sql<{ case_id: number; target_id: string; reason: string | null }[]>`
    SELECT case_id, target_id, reason FROM mod_cases
    WHERE guild_id = ${guildId} AND action IN ('ban', 'tempban', 'hardban', 'softban')
    ORDER BY case_id DESC LIMIT 10
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["No bans recorded here."]
      : [
          "The last bans:",
          ...rows.map(
            (row) => `-# **#${row.case_id}** <@${row.target_id}> — ${row.reason ?? "no reason"}`,
          ),
        ],
  );
}

export function registerPunish(): void {
  const under =
    (owner: string, fallback: PrefixHandler): PrefixHandler =>
    async (ctx: PrefixContext) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn(owner, sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await fallback(ctx);
    };

  register({
    name: "ban",
    description: "Bans the mentioned user",
    handler: under("ban", (ctx) => banning(ctx, false, false)),
  });
  groupUnder("ban", () => {
    register({
      name: "purge",
      description: "Set default message history purge upon ban",
      handler: banPurgeDefault,
    });
    register({ name: "recent", description: "The most recent bans", handler: banRecent });
  });

  register({
    name: "softban",
    description: "Softbans the mentioned user, deleting a day of messages",
    handler: (ctx) => banning(ctx, true, false),
  });
  register({
    name: "tempban",
    description: "Temporarily ban a member",
    handler: (ctx) => banning(ctx, false, true),
  });
  register({ name: "unban", description: "Unbans the mentioned user", handler: unban });

  register({
    name: "hardban",
    description: "Keep a member banned",
    handler: under("hardban", hardban),
  });
  groupUnder("hardban", () => {
    register({
      name: "list",
      description: "View list of hardbanned members",
      handler: hardbanList,
    });
  });

  register({ name: "warn", description: "Warns a member and messages them why", handler: warn });

  register({
    name: "timeout",
    aliases: ["to"],
    description: "Mutes a member using Discord's timeout",
    handler: under("timeout", timeoutSetter(false)),
  });
  groupUnder("timeout", () => {
    register({
      name: "list",
      description: "View list of timed out members",
      handler: timeoutList,
    });
  });

  register({
    name: "untimeout",
    aliases: ["unto"],
    description: "Removes a timeout for a member",
    handler: timeoutSetter(true),
  });
}
