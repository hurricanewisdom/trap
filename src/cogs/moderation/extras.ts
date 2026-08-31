import { sql } from "../../core/db.js";
import {
  cloneChannel,
  deleteChannel,
  getChannel,
  guildBans,
  memberOf,
  sendMessage,
  unbanMember,
} from "../../core/discord.js";
import { lookup, type PrefixContext, type PrefixHandler } from "../../core/prefix.js";
import { groupUnder, lookupIn, register } from "../../core/prefix.js";
import { provideRestrictions } from "../../core/restrict.js";
import { requireAdministrator, requireManageGuild, requireOwner } from "../../core/permissions.js";
import { humanDuration, parseDuration } from "../../helpers/duration.js";
import { plain } from "../../helpers/markdown.js";
import { card, channelId, findRole, words } from "./shared.js";

// Which commands a server has restricted at all. Read on the command path, so a
// server that has restricted nothing costs one cached empty set.
const CACHE_MS = 60_000;

const cache = new Map<string, { names: Set<string>; at: number }>();

function forget(guildId: string): void {
  cache.delete(guildId);
}

async function restrictedNames(guildId: string): Promise<Set<string>> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.names;

  const rows = await sql<{ command: string }[]>`
    SELECT DISTINCT command FROM mod_restricted WHERE guild_id = ${guildId}
  `;
  const names = new Set(rows.map((row) => row.command));
  cache.set(guildId, { names, at: Date.now() });
  return names;
}

export async function isRestricted(
  guildId: string,
  userId: string,
  command: string,
): Promise<boolean> {
  const names = await restrictedNames(guildId);
  if (!names.has(command)) return false;

  const rows = await sql<{ role_id: string }[]>`
    SELECT role_id FROM mod_restricted WHERE guild_id = ${guildId} AND command = ${command}
  `;
  const member = await memberOf(guildId, userId);
  const held = new Set(member?.roles ?? []);
  return !rows.some((row) => held.has(row.role_id));
}

async function restrictPair(
  ctx: PrefixContext,
): Promise<{ guildId: string; command: string; roleId: string } | null> {
  const guildId = await requireManageGuild(ctx, "restrict commands");
  if (!guildId) return null;

  const parts = words(ctx.argument);
  const name = parts[0]?.toLowerCase() ?? "";
  if (!name || parts.length < 2) {
    await card(ctx, ["Which command, and which role?", "", "-# `restrictcommand add ban @Staff`"]);
    return null;
  }

  // Checked against the real registry, so a typo does not silently restrict a
  // command that does not exist.
  if (!lookup(name)) {
    await card(ctx, [`There is no \`${plain(name)}\` command.`]);
    return null;
  }

  const role = await findRole(guildId, parts.slice(1).join(" "));
  if (!role) {
    await card(ctx, ["No role by that name."]);
    return null;
  }
  return { guildId, command: name, roleId: role.id };
}

function restrictEditor(adding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const got = await restrictPair(ctx);
    if (!got) return;

    if (adding) {
      await sql`
        INSERT INTO mod_restricted (guild_id, command, role_id)
        VALUES (${got.guildId}, ${got.command}, ${got.roleId})
        ON CONFLICT (guild_id, command, role_id) DO NOTHING
      `;
    } else {
      await sql`
        DELETE FROM mod_restricted
        WHERE guild_id = ${got.guildId} AND command = ${got.command} AND role_id = ${got.roleId}
      `;
    }
    forget(got.guildId);

    await card(ctx, [
      adding
        ? `Only <@&${got.roleId}> can run \`${plain(got.command)}\` now.`
        : `<@&${got.roleId}> no longer has \`${plain(got.command)}\` to itself.`,
    ]);
  };
}

async function restrictList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see restricted commands");
  if (!guildId) return;

  const rows = await sql<{ command: string; role_id: string }[]>`
    SELECT command, role_id FROM mod_restricted WHERE guild_id = ${guildId} ORDER BY command
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["No commands are restricted."]
      : [
          `${rows.length} restriction${rows.length === 1 ? "" : "s"}:`,
          ...rows.map((row) => `-# \`${plain(row.command)}\` — <@&${row.role_id}>`),
        ],
  );
}

async function restrictReset(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "clear restricted commands");
  if (!guildId) return;

  const rows = await sql<{ command: string }[]>`
    DELETE FROM mod_restricted WHERE guild_id = ${guildId} RETURNING command
  `;
  forget(guildId);
  await card(ctx, [rows.length === 0 ? "Nothing was restricted." : `Cleared ${rows.length}.`]);
}

async function restrictOverview(ctx: PrefixContext): Promise<void> {
  await card(ctx, [
    "Only allow people with a certain role to use a command.",
    "",
    "-# `restrictcommand add <command> @role` · `restrictcommand remove <command> @role`",
    "-# `restrictcommand list` · `restrictcommand reset`",
  ]);
}

async function nukeChannel(guildId: string, channelId2: string, say: string | null): Promise<void> {
  const channel = await getChannel(channelId2);
  if (!channel) return;

  const made = await cloneChannel(
    guildId,
    {
      name: channel.name,
      type: channel.type,
      topic: channel.topic ?? undefined,
      nsfw: channel.nsfw,
      parent_id: channel.parent_id ?? undefined,
      position: channel.position,
      rate_limit_per_user: channel.rate_limit_per_user,
      permission_overwrites: channel.permission_overwrites,
    },
    "scheduled nuke",
  );
  if (!made.ok) return;

  await deleteChannel(channelId2, "scheduled nuke");
  await sql`
    UPDATE mod_nukes SET channel_id = ${made.data.id}
    WHERE guild_id = ${guildId} AND channel_id = ${channelId2}
  `;
  if (say) await sendMessage(made.data.id, { content: say.slice(0, 1900) });
}

export async function dueNukes(): Promise<void> {
  const rows = await sql<
    { guild_id: string; channel_id: string; message: string | null }[]
  >`
    SELECT guild_id, channel_id, message FROM mod_nukes WHERE next_at <= now() LIMIT 10
  `;
  for (const row of rows) {
    await sql`
      UPDATE mod_nukes SET next_at = now() + (interval_ms || ' milliseconds')::interval
      WHERE guild_id = ${row.guild_id} AND channel_id = ${row.channel_id}
    `;
    await nukeChannel(row.guild_id, row.channel_id, row.message);
  }
}

async function nukeAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "schedule a nuke");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const wanted = channelId(parts[0]) ?? ctx.channelId;
  const ms = parseDuration(parts[1] ?? "");
  if (ms === null || ms < 3_600_000) {
    await card(ctx, [
      "How often?",
      "",
      "-# `nuke add #channel 1d <message>` — an hour is the shortest.",
    ]);
    return;
  }

  const say = parts.slice(2).join(" ").slice(0, 1900) || null;
  await sql`
    INSERT INTO mod_nukes (guild_id, channel_id, interval_ms, message, next_at)
    VALUES (${guildId}, ${wanted}, ${ms}, ${say},
            now() + (${String(ms)} || ' milliseconds')::interval)
    ON CONFLICT (guild_id, channel_id) DO UPDATE
      SET interval_ms = EXCLUDED.interval_ms, message = EXCLUDED.message,
          next_at = EXCLUDED.next_at
  `;
  await card(ctx, [
    `<#${wanted}> will be recloned every ${humanDuration(ms)}.`,
    "-# Everything in it goes each time. `nuke remove` stops it.",
  ]);
}

async function nukeRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "remove a scheduled nuke");
  if (!guildId) return;

  const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
  const rows = await sql<{ channel_id: string }[]>`
    DELETE FROM mod_nukes WHERE guild_id = ${guildId} AND channel_id = ${wanted}
    RETURNING channel_id
  `;
  await card(ctx, [
    rows.length > 0 ? `<#${wanted}> is no longer nuked on a schedule.` : `<#${wanted}> was not scheduled.`,
  ]);
}

async function nukeList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "see scheduled nukes");
  if (!guildId) return;

  const rows = await sql<{ channel_id: string; interval_ms: string; next_at: Date }[]>`
    SELECT channel_id, interval_ms, next_at FROM mod_nukes WHERE guild_id = ${guildId}
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["Nothing is scheduled."]
      : [
          `${rows.length} scheduled:`,
          ...rows.map(
            (row) =>
              `-# <#${row.channel_id}> every ${humanDuration(Number(row.interval_ms))} · next <t:${Math.floor(row.next_at.getTime() / 1000)}:R>`,
          ),
        ],
  );
}

async function nukeView(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "see a scheduled nuke");
  if (!guildId) return;

  const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
  const rows = await sql<{ message: string | null }[]>`
    SELECT message FROM mod_nukes WHERE guild_id = ${guildId} AND channel_id = ${wanted}
  `;
  if (rows.length === 0) {
    await card(ctx, [`<#${wanted}> is not scheduled.`]);
    return;
  }
  await card(ctx, [
    `After each nuke of <#${wanted}>:`,
    rows[0]?.message ? plain(rows[0].message.slice(0, 500)) : "-# nothing is posted",
  ]);
}

async function nukeArchive(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "change nuke archiving");
  if (!guildId) return;

  await card(ctx, [
    "Pins are not archived on a scheduled nuke.",
    "",
    "-# `pins archive` flushes a channel's pins before one, and the clone keeps",
    "-# none of the old channel's messages by design.",
  ]);
}

// One unban-all per server at a time, and cancellable, because a large ban list
// takes minutes at Discord's rate limit.
const unbanning = new Map<string, { stop: boolean }>();

async function unbanAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "unban everybody");
  if (!guildId) return;

  if (unbanning.has(guildId)) {
    await card(ctx, ["Already running.", "", "-# `unbanall cancel` stops it."]);
    return;
  }

  const held = await guildBans(guildId);
  if (!held) {
    await card(ctx, ["The ban list could not be read."]);
    return;
  }
  if (held.length === 0) {
    await card(ctx, ["Nobody is banned."]);
    return;
  }

  const hard = await sql<{ user_id: string }[]>`
    SELECT user_id FROM mod_hardbans WHERE guild_id = ${guildId}
  `;
  const keep = new Set(hard.map((row) => row.user_id));

  const token = { stop: false };
  unbanning.set(guildId, token);
  await card(ctx, [
    `Unbanning ${held.length - keep.size} of ${held.length}.`,
    ...(keep.size > 0 ? [`-# ${keep.size} hardbanned, which are left alone`] : []),
    "-# `unbanall cancel` stops it.",
  ]);

  let done = 0;
  try {
    for (const one of held) {
      if (token.stop) break;
      if (keep.has(one.user.id)) continue;
      const out = await unbanMember(guildId, one.user.id, `unbanall by ${ctx.authorId}`);
      if (out.ok) done += 1;
    }
  } finally {
    unbanning.delete(guildId);
  }

  await card(ctx, [`${done} unbanned.`, ...(token.stop ? ["-# Stopped early."] : [])]);
}

async function unbanAllCancel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "stop unbanning everybody");
  if (!guildId) return;

  const token = unbanning.get(guildId);
  if (!token) {
    await card(ctx, ["Nothing is running."]);
    return;
  }
  token.stop = true;
  await card(ctx, ["Stopping."]);
}

export function registerExtras(): void {
  provideRestrictions(isRestricted);

  register({
    name: "restrictcommand",
    aliases: ["restrict"],
    description: "Only allow people with a certain role to use a command",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("restrictcommand", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await restrictOverview(ctx);
    },
  });
  groupUnder("restrictcommand", () => {
    register({
      name: "add",
      description: "Allow a role exclusive use of a command",
      handler: restrictEditor(true),
    });
    register({
      name: "remove",
      description: "Remove a role's exclusive use of a command",
      handler: restrictEditor(false),
    });
    register({
      name: "list",
      description: "View a list of every restricted command",
      handler: restrictList,
    });
    register({
      name: "reset",
      description: "Removes every restricted command",
      handler: restrictReset,
    });
  });

  groupUnder("nuke", () => {
    register({ name: "add", description: "Schedule a nuke for a channel", handler: nukeAdd });
    register({
      name: "remove",
      description: "Remove a scheduled nuke for a channel",
      handler: nukeRemove,
    });
    register({ name: "list", description: "View all scheduled nukes", handler: nukeList });
    register({
      name: "view",
      description: "View the message posted after a scheduled nuke",
      handler: nukeView,
    });
    register({
      name: "archive",
      description: "Archive pins upon scheduled nuke",
      handler: nukeArchive,
    });
  });

  register({
    name: "unbanall",
    description: "Unbans every member in a guild",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("unbanall", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await unbanAll(ctx);
    },
  });
  groupUnder("unbanall", () => {
    register({
      name: "cancel",
      description: "Cancels an unban all task running",
      handler: unbanAllCancel,
    });
  });
}
