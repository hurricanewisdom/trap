import { sql } from "../../core/db.js";
import {
  PERMISSION,
  cloneChannel,
  deleteChannel,
  editChannel,
  getChannel,
  guildChannels,
  setOverwrite,
  type Channel,
} from "../../core/discord.js";
import {
  requireAdministrator,
  requireManageChannels,
  requireManageGuild,
} from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { humanDuration, parseDuration } from "../../helpers/duration.js";
import { plain } from "../../helpers/markdown.js";
import { config, saveConfig } from "./config.js";
import { card, channelId, findRole, shownReason, userId, words } from "./shared.js";

const TEXTISH = new Set([0, 5, 15]);

// Reading the existing overwrite first and writing it back with one bit changed,
// because Discord replaces the whole overwrite rather than merging into it.
async function flip(
  channel: Channel,
  id: string,
  kind: 0 | 1,
  bit: bigint,
  deny: boolean,
  reason: string,
): Promise<boolean> {
  const held = (channel.permission_overwrites ?? []).find((one) => one.id === id);
  let allow = BigInt(held?.allow ?? "0");
  let denied = BigInt(held?.deny ?? "0");

  if (deny) {
    denied |= bit;
    allow &= ~bit;
  } else {
    denied &= ~bit;
  }

  const done = await setOverwrite(channel.id, id, kind, allow, denied, reason);
  return done.ok;
}

async function everyoneOf(guildId: string): Promise<string> {
  // @everyone is always the role whose id equals the guild's.
  const held = await config(guildId);
  return held.lockRole ?? guildId;
}

async function lockOne(
  guildId: string,
  channel: Channel,
  locking: boolean,
  reason: string,
): Promise<boolean> {
  return flip(channel, await everyoneOf(guildId), 0, PERMISSION.sendMessages, locking, reason);
}

async function ignored(guildId: string): Promise<Set<string>> {
  const rows = await sql<{ channel_id: string }[]>`
    SELECT channel_id FROM mod_lock_ignores WHERE guild_id = ${guildId}
  `;
  return new Set(rows.map((row) => row.channel_id));
}

function locker(locking: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(ctx, "lock channels");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const wanted = channelId(parts[0]) ?? ctx.channelId;
    const reason = shownReason(channelId(parts[0]) ? parts.slice(1).join(" ") : ctx.argument);

    const channel = await getChannel(wanted);
    if (!channel) {
      await card(ctx, ["That channel is not here."]);
      return;
    }

    const done = await lockOne(guildId, channel, locking, `${reason} (by ${ctx.authorId})`);
    await card(ctx, [
      done
        ? `<#${wanted}> is ${locking ? "locked" : "unlocked"}.`
        : "That did not work — check the bot can edit that channel.",
      ...(done ? [`-# ${reason}`] : []),
    ]);
  };
}

function lockAll(locking: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(ctx, "lock every channel");
    if (!guildId) return;

    const all = await guildChannels(guildId);
    if (!all) {
      await card(ctx, ["The channel list could not be read."]);
      return;
    }

    const skip = await ignored(guildId);
    const reason = shownReason(ctx.argument);
    let changed = 0;
    let left = 0;

    for (const channel of all) {
      if (!TEXTISH.has(channel.type ?? -1)) continue;
      if (skip.has(channel.id)) {
        left += 1;
        continue;
      }
      if (await lockOne(guildId, channel, locking, `${reason} (by ${ctx.authorId})`)) changed += 1;
    }

    await card(ctx, [
      `${changed} channel${changed === 1 ? "" : "s"} ${locking ? "locked" : "unlocked"}.`,
      ...(left > 0 ? [`-# ${left} ignored`] : []),
      `-# ${reason}`,
    ]);
  };
}

async function lockRole(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the lock role");
  if (!guildId) return;

  const token = ctx.argument.trim();
  const role = token ? await findRole(guildId, token) : null;
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `lockdown role @role`"]);
    return;
  }

  await saveConfig(guildId, { lockRole: role.id });
  await card(ctx, [`Locking now changes <@&${role.id}>.`]);
}

function ignoreEditor(adding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageGuild(ctx, "change the lockdown ignores");
    if (!guildId) return;

    const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
    if (adding) {
      await sql`
        INSERT INTO mod_lock_ignores (guild_id, channel_id) VALUES (${guildId}, ${wanted})
        ON CONFLICT (guild_id, channel_id) DO NOTHING
      `;
    } else {
      await sql`
        DELETE FROM mod_lock_ignores WHERE guild_id = ${guildId} AND channel_id = ${wanted}
      `;
    }

    await card(ctx, [
      adding
        ? `<#${wanted}> is left alone by \`lockdown all\` and \`unlock all\`.`
        : `<#${wanted}> is no longer ignored.`,
    ]);
  };
}

async function ignoreList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the lockdown ignores");
  if (!guildId) return;

  const held = [...(await ignored(guildId))];
  await card(
    ctx,
    held.length === 0
      ? ["No channels are ignored."]
      : [`${held.length} ignored:`, held.map((id) => `<#${id}>`).join(" ")],
  );
}

function visibility(hiding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(ctx, "hide channels");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const wanted = channelId(parts[0]) ?? ctx.channelId;
    const rest = channelId(parts[0]) ? parts.slice(1).join(" ") : ctx.argument.trim();

    const channel = await getChannel(wanted);
    if (!channel) {
      await card(ctx, ["That channel is not here."]);
      return;
    }

    // A role or a member; falling back to @everyone is what "hide this channel"
    // means with nothing else said.
    const who = userId(rest);
    const role = rest && !who ? await findRole(guildId, rest) : null;
    const id = role?.id ?? who ?? (await everyoneOf(guildId));
    const kind: 0 | 1 = who && !role ? 1 : 0;

    const done = await flip(
      channel,
      id,
      kind,
      PERMISSION.viewChannel,
      hiding,
      `by ${ctx.authorId}`,
    );
    await card(ctx, [
      done
        ? `<#${wanted}> is ${hiding ? "hidden from" : "visible to"} ${kind === 1 ? `<@${id}>` : `<@&${id}>`}.`
        : "That did not work.",
    ]);
  };
}

async function talk(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change who can talk");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const wanted = channelId(parts[0]) ?? ctx.channelId;
  const rest = channelId(parts[0]) ? parts.slice(1).join(" ") : ctx.argument.trim();

  const channel = await getChannel(wanted);
  if (!channel) {
    await card(ctx, ["That channel is not here."]);
    return;
  }

  const role = rest ? await findRole(guildId, rest) : null;
  const id = role?.id ?? (await everyoneOf(guildId));
  const held = (channel.permission_overwrites ?? []).find((one) => one.id === id);
  const denied = (BigInt(held?.deny ?? "0") & PERMISSION.sendMessages) !== 0n;

  const done = await flip(
    channel,
    id,
    0,
    PERMISSION.sendMessages,
    !denied,
    `by ${ctx.authorId}`,
  );
  await card(ctx, [
    done
      ? `<@&${id}> can ${denied ? "now" : "no longer"} talk in <#${wanted}>.`
      : "That did not work.",
  ]);
}

function fileToggle(allowing: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(ctx, "change file permissions");
    if (!guildId) return;

    const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
    const channel = await getChannel(wanted);
    if (!channel) {
      await card(ctx, ["That channel is not here."]);
      return;
    }

    const id = await everyoneOf(guildId);
    const ok =
      (await flip(channel, id, 0, PERMISSION.attachFiles, !allowing, `by ${ctx.authorId}`)) &&
      (await flip(
        await (getChannel(wanted) as Promise<Channel>),
        id,
        0,
        PERMISSION.embedLinks,
        !allowing,
        `by ${ctx.authorId}`,
      ));

    await card(ctx, [
      ok
        ? `Files and links are ${allowing ? "allowed" : "blocked"} in <#${wanted}>.`
        : "That did not work.",
    ]);
  };
}

function slowmode(turningOn: boolean | null): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageChannels(ctx, "change slowmode");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const wanted = channelId(parts[0]) ?? ctx.channelId;
    const said = channelId(parts[0]) ? parts.slice(1).join(" ") : ctx.argument.trim();

    if (turningOn === null) {
      const channel = await getChannel(wanted);
      const now = channel?.rate_limit_per_user ?? 0;
      await card(ctx, [
        now === 0
          ? `<#${wanted}> has no slowmode.`
          : `<#${wanted}> allows one message every ${humanDuration(now * 1000)}.`,
        "",
        "-# `slowmode on #channel 10s` · `slowmode off #channel`",
      ]);
      return;
    }

    let seconds = 0;
    if (turningOn) {
      const ms = parseDuration(said || "10s");
      if (ms === null) {
        await card(ctx, ["How long between messages?", "", "-# `slowmode on #channel 10s`"]);
        return;
      }
      // Discord's own ceiling.
      seconds = Math.min(21_600, Math.round(ms / 1000));
    }

    const done = await editChannel(wanted, { rate_limit_per_user: seconds }, `by ${ctx.authorId}`);
    await card(ctx, [
      done.ok
        ? seconds === 0
          ? `Slowmode is off in <#${wanted}>.`
          : `One message every ${humanDuration(seconds * 1000)} in <#${wanted}>.`
        : `That did not work. ${done.message.slice(0, 120)}`,
    ]);
  };
}

async function topic(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the channel topic");
  if (!guildId) return;

  const said = ctx.argument.trim();
  const done = await editChannel(
    ctx.channelId,
    { topic: said.slice(0, 1024) },
    `by ${ctx.authorId}`,
  );
  await card(ctx, [
    done.ok
      ? said
        ? `Topic set: ${plain(said.slice(0, 200))}`
        : "Topic cleared."
      : `That did not work. ${done.message.slice(0, 120)}`,
  ]);
}

// Thirty seconds, then back, and the timer is deliberately in memory: if the bot
// restarts mid-way the channel is left NSFW, which is why it says so.
async function naughty(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "change the channel rating");
  if (!guildId) return;

  const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
  const channel = await getChannel(wanted);
  if (!channel) {
    await card(ctx, ["That channel is not here."]);
    return;
  }
  if (channel.nsfw) {
    await card(ctx, ["That channel is already marked NSFW."]);
    return;
  }

  const on = await editChannel(wanted, { nsfw: true }, `by ${ctx.authorId}`);
  if (!on.ok) {
    await card(ctx, ["That did not work.", "", `-# ${on.message.slice(0, 140)}`]);
    return;
  }

  await card(ctx, [
    `<#${wanted}> is NSFW for 30 seconds.`,
    "-# If the bot restarts in that time it stays NSFW.",
  ]);
  setTimeout(() => {
    void editChannel(wanted, { nsfw: false }, "naughty expired").catch(() => {});
  }, 30_000).unref?.();
}

// Irreversible: the channel and everything in it goes. Asking twice is worth one
// extra keystroke, and it is the difference between a mistyped subcommand and a
// lost channel.
const armed = new Map<string, number>();

const ARM_MS = 30_000;

async function nuke(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "clone this channel");
  if (!guildId) return;

  const key = `${ctx.channelId}:${ctx.authorId}`;
  const at = armed.get(key) ?? 0;
  if (Date.now() - at > ARM_MS) {
    armed.set(key, Date.now());
    await card(ctx, [
      "This deletes this channel and everything in it, then rebuilds it empty.",
      "",
      "-# Run `nuke` again within 30 seconds to go ahead.",
    ]);
    return;
  }
  armed.delete(key);

  const channel = await getChannel(ctx.channelId);
  if (!channel) {
    await card(ctx, ["That channel could not be read."]);
    return;
  }

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
    `nuked by ${ctx.authorId}`,
  );
  if (!made.ok) {
    await card(ctx, ["That did not work.", "", `-# ${made.message.slice(0, 140)}`]);
    return;
  }

  // The old channel goes last, so a failure leaves the server with two channels
  // rather than none.
  await deleteChannel(ctx.channelId, `nuked by ${ctx.authorId}`);
}

async function clearInvites(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "clear invites");
  if (!guildId) return;

  const { guildInvites, deleteInvite } = await import("../../core/discord.js");
  const held = await guildInvites(guildId);
  if (!held) {
    await card(ctx, ["The invite list could not be read."]);
    return;
  }

  let gone = 0;
  for (const one of held) {
    const done = await deleteInvite(one.code, `by ${ctx.authorId}`);
    if (done.ok) gone += 1;
  }
  await card(ctx, [gone === 0 ? "There were no invites." : `Removed ${gone} invites.`]);
}

export function registerChannels(): void {
  register({
    name: "lockdown",
    aliases: ["lock"],
    description: "Lockdown a channel",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("lockdown", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await locker(true)(ctx);
    },
  });
  groupUnder("lockdown", () => {
    register({ name: "all", description: "Locks all channels", handler: lockAll(true) });
    register({ name: "role", description: "Set the default lock role", handler: lockRole });
    register({
      name: "ignore",
      description: "Keep a channel out of lockdown all",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("lockdown ignore", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await ignoreEditor(true)(ctx);
      },
    });
    groupUnder("lockdown ignore", () => {
      register({ name: "add", description: "Set an ignored lockdown channel", handler: ignoreEditor(true) });
      register({
        name: "remove",
        description: "Remove an ignored lockdown channel",
        handler: ignoreEditor(false),
      });
      register({ name: "list", description: "View all ignored lockdown channels", handler: ignoreList });
    });
  });

  register({
    name: "unlock",
    description: "Unlock a channel",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("unlock", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await locker(false)(ctx);
    },
  });
  groupUnder("unlock", () => {
    register({ name: "all", description: "Unlocks every channel", handler: lockAll(false) });
  });

  register({ name: "hide", description: "Hide a channel from a role or member", handler: visibility(true) });
  register({ name: "unhide", description: "Unhide a channel", handler: visibility(false) });
  register({ name: "talk", description: "Toggle a channel to text for a role", handler: talk });

  register({
    name: "slowmode",
    description: "Restricts members to one message per interval",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("slowmode", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await slowmode(null)(ctx);
    },
  });
  groupUnder("slowmode", () => {
    register({ name: "on", description: "Enable slowmode in a channel", handler: slowmode(true) });
    register({ name: "off", description: "Disables slowmode in a channel", handler: slowmode(false) });
  });

  register({
    name: "revokefiles",
    description: "Removes or assigns permission to attach files and embed links",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("revokefiles", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await fileToggle(false)(ctx);
    },
  });
  groupUnder("revokefiles", () => {
    register({ name: "on", description: "Allow files and links in a channel", handler: fileToggle(true) });
    register({ name: "off", description: "Block files and links in a channel", handler: fileToggle(false) });
  });

  register({ name: "topic", description: "Change the current channel topic", handler: topic });
  register({ name: "naughty", description: "Temporarily make a channel NSFW", handler: naughty });
  register({
    name: "nuke",
    description: "Clone the current channel",
    handler: async (ctx) => {
      // Without this, `nuke list` fell through to the bare handler and destroyed
      // the channel somebody was only trying to read a list in.
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("nuke", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await nuke(ctx);
    },
  });
  register({
    name: "clearinvites",
    description: "Remove all existing invites in guild",
    handler: clearInvites,
  });
}
