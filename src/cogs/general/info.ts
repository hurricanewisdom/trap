import {
  getChannel,
  getGuild,
  guildEmojis,
  guildRoles,
  guildStickers,
  memberOf,
  walkMembers,
  type GuildMember,
} from "../../core/discord.js";
import { api } from "../../core/discord.js";
import { register, type PrefixContext, type PrefixHandler } from "../../core/prefix.js";
import { groupUnder, lookupIn } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { assetUrl, card, channelId, findRole, madeAt, stamp, userId, whoever, words } from "./shared.js";
import { CDN } from "./shared.js";

const TIERS = ["no boosts", "level 1", "level 2", "level 3"];

const CHANNEL_KINDS: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  13: "stage",
  15: "forum",
  16: "media",
};

// A user, not a member: this has to work for somebody who has left, which is
// what makes it useful on a ban list or an old case log.
async function userOf(id: string): Promise<{ username?: string; global_name?: string | null; avatar?: string | null; banner?: string | null; accent_color?: number | null } | null> {
  return api(`/users/${id}`);
}

function avatarOf(id: string, user: { avatar?: string | null } | null): string {
  return user?.avatar
    ? assetUrl(`avatars/${id}`, user.avatar)
    : `${CDN}/embed/avatars/${Number(BigInt(id) >> 22n) % 6}.png`;
}

function pictureCommand(
  which: "avatar" | "banner" | "serveravatar" | "serverbanner",
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const who = await whoever(ctx);
    const user = await userOf(who);
    const name = user?.global_name ?? user?.username ?? who;

    if (which === "avatar") {
      await card(ctx, [`### ${plain(String(name))}`, avatarOf(who, user)]);
      return;
    }
    if (which === "banner") {
      await card(
        ctx,
        user?.banner
          ? [`### ${plain(String(name))}`, assetUrl(`banners/${who}`, user.banner)]
          : [`### ${plain(String(name))}`, "-# no banner"],
      );
      return;
    }

    if (!ctx.guildId) {
      await card(ctx, ["That one only works in a server."]);
      return;
    }
    const member = await memberOf(ctx.guildId, who);
    const hash = which === "serveravatar" ? member?.avatar : member?.banner;
    if (!hash) {
      await card(ctx, [
        `### ${plain(String(name))}`,
        `-# no server ${which === "serveravatar" ? "avatar" : "banner"} here`,
      ]);
      return;
    }
    await card(ctx, [
      `### ${plain(String(name))}`,
      assetUrl(
        `guilds/${ctx.guildId}/users/${who}/${which === "serveravatar" ? "avatars" : "banners"}`,
        hash,
      ),
    ]);
  };
}

// Works on any server id, not only this one, which is the point of asking for
// one — but Discord only serves the hash for servers the bot can see.
function guildAsset(which: "icon" | "banner" | "splash"): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const said = words(ctx.argument)[0];
    const id = /^\d{15,25}$/.test(said ?? "") ? (said as string) : ctx.guildId;
    if (!id) {
      await card(ctx, ["Which server?", "", `-# \`guild${which} <server id>\``]);
      return;
    }

    const guild = (await getGuild(id)) as (Record<string, unknown> & { name?: string }) | null;
    if (!guild) {
      await card(ctx, ["The bot cannot see that server."]);
      return;
    }

    const hash = guild[which === "icon" ? "icon" : which] as string | null | undefined;
    if (!hash) {
      await card(ctx, [`### ${plain(guild.name ?? id)}`, `-# no ${which}`]);
      return;
    }
    await card(ctx, [
      `### ${plain(guild.name ?? id)}`,
      assetUrl(`${which === "icon" ? "icons" : which === "banner" ? "banners" : "splashes"}/${id}`, hash),
    ]);
  };
}

async function serverInfo(ctx: PrefixContext): Promise<void> {
  const said = words(ctx.argument)[0];
  const id = /^\d{15,25}$/.test(said ?? "") ? (said as string) : ctx.guildId;
  if (!id) {
    await card(ctx, ["That one only works in a server."]);
    return;
  }

  const guild = (await getGuild(id)) as (Record<string, unknown> & Partial<{
    name: string;
    owner_id: string;
    premium_tier: number;
    premium_subscription_count: number;
    approximate_member_count: number;
    features: string[];
    icon: string | null;
  }>) | null;
  if (!guild) {
    await card(ctx, ["The bot cannot see that server."]);
    return;
  }

  const [roles, emojis, stickers] = await Promise.all([
    guildRoles(id),
    guildEmojis(id),
    guildStickers(id),
  ]);

  await card(ctx, [
    `### ${plain(guild.name ?? id)}`,
    ...(guild.icon ? [assetUrl(`icons/${id}`, guild.icon, 256)] : []),
    `-# owner: <@${guild.owner_id}>`,
    `-# made: ${stamp(madeAt(id), "D")}`,
    `-# members: ${guild.approximate_member_count ?? "unknown"}`,
    `-# boosts: ${guild.premium_subscription_count ?? 0} (${TIERS[guild.premium_tier ?? 0] ?? "unknown"})`,
    `-# roles: ${roles.length} · emojis: ${emojis?.length ?? 0} · stickers: ${stickers?.length ?? 0}`,
    ...(guild.features && guild.features.length > 0
      ? [`-# features: ${guild.features.slice(0, 8).join(", ").toLowerCase().replace(/_/g, " ")}`]
      : []),
  ]);
}

async function userInfo(ctx: PrefixContext): Promise<void> {
  const who = await whoever(ctx);
  const user = await userOf(who);
  if (!user) {
    await card(ctx, ["No such user."]);
    return;
  }

  const member = ctx.guildId ? await memberOf(ctx.guildId, who) : null;
  const roles = (member?.roles ?? []).map((id) => `<@&${id}>`);

  await card(ctx, [
    `### ${plain(String(user.global_name ?? user.username ?? who))}`,
    avatarOf(who, user),
    `-# id: ${who}`,
    `-# account made: ${stamp(madeAt(who), "D")}`,
    ...(member
      ? [`-# joined here: ${stamp((member as unknown as { joined_at?: string }).joined_at, "D")}`]
      : ["-# not in this server"]),
    ...(member?.nick ? [`-# nickname: ${plain(member.nick)}`] : []),
    ...(roles.length > 0
      ? [`-# ${roles.length} roles: ${roles.slice(0, 15).join(" ")}`]
      : []),
    ...((member?.premium_since ?? null) ? [`-# boosting since ${stamp(member?.premium_since, "D")}`] : []),
  ]);
}

async function roleInfo(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const role = await findRole(ctx.guildId, ctx.argument.trim());
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `roleinfo @role`"]);
    return;
  }

  const members = await walkMembers(ctx.guildId);
  const held = (members ?? []).filter((one) => (one.roles ?? []).includes(role.id)).length;
  const colour = (role as unknown as { color?: number }).color ?? 0;

  await card(ctx, [
    `### ${plain(role.name)}`,
    `-# id: ${role.id}`,
    `-# made: ${stamp(madeAt(role.id), "D")}`,
    `-# members: ${held}`,
    `-# colour: ${colour === 0 ? "none" : "#" + colour.toString(16).padStart(6, "0")}`,
    `-# position: ${role.position}`,
    `-# hoisted: ${(role as unknown as { hoist?: boolean }).hoist ? "yes" : "no"} · mentionable: ${(role as unknown as { mentionable?: boolean }).mentionable ? "yes" : "no"}`,
  ]);
}

async function channelInfo(ctx: PrefixContext): Promise<void> {
  const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
  const channel = await getChannel(wanted);
  if (!channel) {
    await card(ctx, ["That channel is not here."]);
    return;
  }

  await card(ctx, [
    `### ${plain(channel.name ?? wanted)}`,
    `-# id: ${wanted}`,
    `-# kind: ${CHANNEL_KINDS[channel.type ?? -1] ?? "unknown"}`,
    `-# made: ${stamp(madeAt(wanted), "D")}`,
    ...(channel.topic ? [`-# topic: ${plain(channel.topic.slice(0, 200))}`] : []),
    ...(channel.nsfw ? ["-# marked NSFW"] : []),
    ...(channel.rate_limit_per_user
      ? [`-# slowmode: one message every ${channel.rate_limit_per_user}s`]
      : []),
    ...(channel.parent_id ? [`-# under: <#${channel.parent_id}>`] : []),
  ]);
}

async function memberCount(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const guild = await getGuild(ctx.guildId);
  const members = await walkMembers(ctx.guildId);
  const humans = (members ?? []).filter((one) => !one.user?.bot).length;
  const bots = (members ?? []).length - humans;

  await card(ctx, [
    `### ${plain(guild?.name ?? "this server")}`,
    `-# ${guild?.approximate_member_count ?? members?.length ?? 0} members`,
    `-# ${humans} people · ${bots} bots`,
  ]);
}

// The three "list everything" commands differ only in what they list.
function listing(
  what: "roles" | "emotes" | "bots",
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    if (!ctx.guildId) return;

    if (what === "roles") {
      const roles = (await guildRoles(ctx.guildId))
        .filter((one) => one.name !== "@everyone")
        .sort((a, b) => b.position - a.position);
      await card(ctx, [
        `### ${roles.length} roles`,
        roles.slice(0, 60).map((one) => `<@&${one.id}>`).join(" ") || "-# none",
        ...(roles.length > 60 ? [`-# and ${roles.length - 60} more`] : []),
      ]);
      return;
    }

    if (what === "emotes") {
      const emojis = (await guildEmojis(ctx.guildId)) ?? [];
      await card(ctx, [
        `### ${emojis.length} emotes`,
        emojis
          .slice(0, 80)
          .map((one) => `<${one.animated ? "a" : ""}:${one.name}:${one.id}>`)
          .join(" ") || "-# none",
        ...(emojis.length > 80 ? [`-# and ${emojis.length - 80} more`] : []),
      ]);
      return;
    }

    const members = await walkMembers(ctx.guildId);
    const bots = (members ?? []).filter((one) => one.user?.bot);
    await card(ctx, [
      `### ${bots.length} bots`,
      bots.slice(0, 50).map((one) => `<@${one.user?.id}>`).join(" ") || "-# none",
      ...(bots.length > 50 ? [`-# and ${bots.length - 50} more`] : []),
    ]);
  };
}

async function membersOf(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const role = await findRole(ctx.guildId, ctx.argument.trim());
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `members @role`"]);
    return;
  }

  const members = await walkMembers(ctx.guildId);
  const held = (members ?? []).filter((one) => (one.roles ?? []).includes(role.id));
  await card(ctx, [
    `### ${held.length} in ${plain(role.name)}`,
    held.slice(0, 60).map((one) => `<@${one.user?.id}>`).join(" ") || "-# nobody",
    ...(held.length > 60 ? [`-# and ${held.length - 60} more`] : []),
  ]);
}

function boostersOf(lost: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    if (!ctx.guildId) return;

    const members = await walkMembers(ctx.guildId);
    const boosting = (members ?? [])
      .filter((one) => (one as GuildMember).premium_since)
      .sort(
        (a, b) => Date.parse(String(b.premium_since)) - Date.parse(String(a.premium_since)),
      );

    if (lost) {
      // Nothing records who stopped, and Discord does not say, so this is honest
      // about being unable to answer rather than showing an empty list.
      await card(ctx, [
        "### Lost boosters",
        "-# Discord does not report when somebody stops boosting, and nothing here",
        "-# was recording it before now, so there is nothing to show.",
      ]);
      return;
    }

    await card(ctx, [
      `### ${boosting.length} boosting`,
      ...(boosting.length === 0
        ? ["-# nobody"]
        : boosting
            .slice(0, 25)
            .map((one) => `-# <@${one.user?.id}> — since ${stamp(one.premium_since, "D")}`)),
    ]);
  };
}

async function inviteInfo(ctx: PrefixContext): Promise<void> {
  const said = words(ctx.argument)[0] ?? "";
  const code = said.replace(/^https?:\/\/(discord\.gg|discord\.com\/invite)\//i, "").trim();
  if (!code) {
    await card(ctx, ["Which invite?", "", "-# `inviteinfo <code>`"]);
    return;
  }

  const invite = await api<{
    code: string;
    guild?: { id: string; name: string; icon?: string | null };
    channel?: { name?: string };
    inviter?: { username?: string; global_name?: string | null };
    approximate_member_count?: number;
    approximate_presence_count?: number;
    expires_at?: string | null;
  }>(`/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`);

  if (!invite) {
    await card(ctx, ["That invite is not valid."]);
    return;
  }

  await card(ctx, [
    `### ${plain(invite.guild?.name ?? invite.code)}`,
    ...(invite.guild?.icon ? [assetUrl(`icons/${invite.guild.id}`, invite.guild.icon, 256)] : []),
    `-# code: ${plain(invite.code)}`,
    ...(invite.channel?.name ? [`-# channel: #${plain(invite.channel.name)}`] : []),
    ...(invite.inviter
      ? [`-# from: ${plain(String(invite.inviter.global_name ?? invite.inviter.username))}`]
      : []),
    `-# members: ${invite.approximate_member_count ?? "unknown"} · online: ${invite.approximate_presence_count ?? "unknown"}`,
    `-# expires: ${invite.expires_at ? stamp(invite.expires_at) : "never"}`,
  ]);
}

export function registerInfo(): void {
  register({ name: "avatar", aliases: ["av", "pfp"], description: "Get avatar of a member or yourself", handler: pictureCommand("avatar") });
  register({ name: "banner", description: "Get the banner of a member or yourself", handler: pictureCommand("banner") });
  register({ name: "serveravatar", aliases: ["sav"], description: "Get the server avatar of a member", handler: pictureCommand("serveravatar") });
  register({ name: "serverbanner", description: "Get the server banner of a member", handler: pictureCommand("serverbanner") });
  register({ name: "guildicon", aliases: ["icon"], description: "Returns guild icon", handler: guildAsset("icon") });
  register({ name: "guildbanner", description: "Returns guild banner", handler: guildAsset("banner") });
  register({ name: "splash", description: "Returns splash background", handler: guildAsset("splash") });

  register({ name: "serverinfo", aliases: ["si", "guildinfo"], description: "View information about a server", handler: serverInfo });
  register({ name: "userinfo", aliases: ["ui", "whois"], description: "View information about a member", handler: userInfo });
  register({ name: "roleinfo", description: "View information about a role", handler: roleInfo });
  register({ name: "channelinfo", description: "View information about a channel", handler: channelInfo });
  register({ name: "membercount", aliases: ["mc"], description: "View server member count", handler: memberCount });

  register({ name: "roles", description: "View all roles in the server", handler: listing("roles") });
  register({ name: "emotes", description: "View all emotes in the server", handler: listing("emotes") });
  register({ name: "bots", description: "View all bots in the server", handler: listing("bots") });
  register({ name: "members", description: "View members in a role", handler: membersOf });
  register({ name: "inviteinfo", description: "View basic invite code information", handler: inviteInfo });

  register({
    name: "boosters",
    description: "View all recent server boosters",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("boosters", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await boostersOf(false)(ctx);
    },
  });
  groupUnder("boosters", () => {
    register({
      name: "lost",
      description: "View list of most recent lost boosters",
      handler: boostersOf(true),
    });
  });
}
