import {
  getChannel,
  getGuild,
  guildChannels,
  guildEmojis,
  guildRoles,
  guildStickers,
  memberOf,
  walkMembers,
  type Guild,
  type GuildMember,
  type Role,
} from "../../core/discord.js";
import { api } from "../../core/discord.js";
import { register, type PrefixContext, type PrefixHandler } from "../../core/prefix.js";
import { groupUnder, lookupIn } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { assetUrl, card, channelId, findRole, madeAt, pagesOf, stamp, userId, whoever, words } from "./shared.js";
import { paginate } from "../../core/pager.js";
import { CDN } from "./shared.js";

const TIERS = ["no boosts", "level 1", "level 2", "level 3"];

// What each boost level costs, so "9 to go" can be worked out rather than left
// as a number nobody can act on.
const TIER_COST = [2, 7, 14];

const VERIFICATION = ["none", "low", "medium", "high", "highest"];

const FILTER = ["off", "members without roles", "everyone"];

const NSFW_LEVEL = ["not rated", "explicit", "safe", "age restricted"];

const EMOJI_ROOM = [50, 100, 150, 250];

// Only the ones worth naming. A role holding thirty boring permissions is
// described by the handful that let somebody do damage, not by all thirty.
const NOTABLE: [bigint, string][] = [
  [1n << 3n, "administrator"],
  [1n << 5n, "manage server"],
  [1n << 28n, "manage roles"],
  [1n << 4n, "manage channels"],
  [1n << 13n, "manage messages"],
  [1n << 29n, "manage webhooks"],
  [1n << 27n, "manage nicknames"],
  [1n << 30n, "manage expressions"],
  [1n << 2n, "ban members"],
  [1n << 1n, "kick members"],
  [1n << 40n, "timeout members"],
  [1n << 7n, "view audit log"],
  [1n << 17n, "mention everyone"],
  [1n << 33n, "manage events"],
  [1n << 34n, "manage threads"],
  [1n << 24n, "move members"],
  [1n << 22n, "mute members"],
  [1n << 23n, "deafen members"],
];

const BADGES: [number, string][] = [
  [1 << 0, "Discord staff"],
  [1 << 1, "Partner"],
  [1 << 2, "HypeSquad Events"],
  [1 << 3, "Bug Hunter"],
  [1 << 6, "Bravery"],
  [1 << 7, "Brilliance"],
  [1 << 8, "Balance"],
  [1 << 9, "Early supporter"],
  [1 << 14, "Bug Hunter tier 2"],
  [1 << 16, "Verified bot"],
  [1 << 17, "Early bot developer"],
  [1 << 18, "Moderator programs alumni"],
  [1 << 22, "Active developer"],
];

// Administrator carries everything, so listing the rest under it is noise.
function permissionsOf(bits: string | undefined): string {
  const held = BigInt(bits ?? "0");
  if (held & (1n << 3n)) return "administrator (everything)";

  const names = NOTABLE.filter(([bit]) => held & bit).map(([, name]) => name);
  if (names.length === 0) return "nothing notable";
  return names.slice(0, 8).join(", ") + (names.length > 8 ? `, +${names.length - 8} more` : "");
}

function badgesOf(flags: number | undefined): string[] {
  const held = flags ?? 0;
  return BADGES.filter(([bit]) => held & bit).map(([, name]) => name);
}

function hex(colour: number | undefined): string {
  return colour ? "#" + colour.toString(16).padStart(6, "0") : "none";
}

// Both formats at once: the date for the fact, the relative for the feel of it.
function when(value: string | number | null | undefined): string {
  return value ? `${stamp(value, "D")} (${stamp(value, "R")})` : "unknown";
}

function joinedAt(member: GuildMember | null | undefined): string | undefined {
  return (member as unknown as { joined_at?: string } | null | undefined)?.joined_at;
}

// The highest role a member holds, which is the one that colours their name.
function topRole(member: GuildMember | null, roles: Role[]): Role | null {
  const held = new Set(member?.roles ?? []);
  return (
    roles
      .filter((one) => held.has(one.id))
      .sort((a, b) => b.position - a.position)[0] ?? null
  );
}

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

  const guild = (await getGuild(id)) as Guild | null;
  if (!guild) {
    await card(ctx, ["The bot cannot see that server."]);
    return;
  }

  const [roles, emojis, stickers, channels, members] = await Promise.all([
    guildRoles(id),
    guildEmojis(id),
    guildStickers(id),
    guildChannels(id),
    walkMembers(id),
  ]);

  const kinds = new Map<number, number>();
  for (const one of channels ?? []) kinds.set(one.type ?? -1, (kinds.get(one.type ?? -1) ?? 0) + 1);
  const rooms = [
    [0, "text"],
    [2, "voice"],
    [4, "categories"],
    [5, "announcement"],
    [15, "forum"],
    [13, "stage"],
  ]
    .map(([type, name]) => (kinds.get(type as number) ? `${kinds.get(type as number)} ${name}` : null))
    .filter(Boolean)
    .join(" · ");

  const animated = (emojis ?? []).filter((one) => one.animated).length;
  const humans = (members ?? []).filter((one) => !one.user?.bot).length;
  const boosters = (members ?? []).filter((one) => one.premium_since).length;
  const tier = guild.premium_tier ?? 0;
  const boosts = guild.premium_subscription_count ?? 0;
  const nextTier = TIER_COST[tier];
  const room = EMOJI_ROOM[tier] ?? 50;

  const named = (label: string, channelIdOf: string | null | undefined) =>
    channelIdOf ? `${label}: <#${channelIdOf}>` : null;

  await card(ctx, [
    `### ${plain(guild.name ?? id)}`,
    ...(guild.icon ? [assetUrl(`icons/${id}`, guild.icon, 256)] : []),
    ...(guild.description ? [`-# ${plain(guild.description.slice(0, 180))}`] : []),
    `-# id: ${id}`,
    `-# owner: <@${guild.owner_id}>`,
    `-# made: ${when(madeAt(id))}`,
    `-# members: ${guild.approximate_member_count ?? members?.length ?? 0}` +
      (members ? ` · ${humans} people · ${(members.length - humans)} bots` : "") +
      (guild.approximate_presence_count ? ` · ${guild.approximate_presence_count} online` : ""),
    `-# boosts: ${boosts} (${TIERS[tier] ?? "unknown"})` +
      (nextTier && boosts < nextTier ? ` · ${nextTier - boosts} to level ${tier + 1}` : "") +
      (boosters ? ` · ${boosters} boosting` : ""),
    ...(rooms ? [`-# ${(channels ?? []).length} channels: ${rooms}`] : []),
    `-# roles: ${roles.length}/250 · emojis: ${emojis?.length ?? 0}/${room}` +
      (animated ? ` (${animated} animated)` : "") +
      ` · stickers: ${stickers?.length ?? 0}`,
    `-# verification: ${VERIFICATION[guild.verification_level ?? 0] ?? "unknown"}` +
      ` · content filter: ${FILTER[guild.explicit_content_filter ?? 0] ?? "unknown"}` +
      ` · 2FA for staff: ${guild.mfa_level ? "required" : "no"}`,
    ...(guild.nsfw_level ? [`-# age rating: ${NSFW_LEVEL[guild.nsfw_level] ?? "unknown"}`] : []),
    ...(guild.afk_channel_id
      ? [`-# afk: <#${guild.afk_channel_id}> after ${Math.round((guild.afk_timeout ?? 0) / 60)}m`]
      : []),
    ...(() => {
      const listed = [
        named("system messages", guild.system_channel_id),
        named("rules", guild.rules_channel_id),
        named("mod updates", guild.public_updates_channel_id),
      ].filter(Boolean);
      return listed.length ? [`-# ${listed.join(" · ")}`] : [];
    })(),
    ...(guild.vanity_url_code ? [`-# vanity: discord.gg/${plain(guild.vanity_url_code)}`] : []),
    `-# language: ${plain(guild.preferred_locale ?? "unknown")}`,
    ...(guild.features && guild.features.length > 0
      ? [`-# features: ${guild.features.slice(0, 10).join(", ").toLowerCase().replace(/_/g, " ")}`]
      : []),
  ]);
}

async function userInfo(ctx: PrefixContext): Promise<void> {
  const who = await whoever(ctx);
  const user = (await userOf(who)) as (Record<string, unknown> & {
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
    banner?: string | null;
    accent_color?: number | null;
    bot?: boolean;
    public_flags?: number;
  }) | null;
  if (!user) {
    await card(ctx, ["No such user."]);
    return;
  }

  const member = ctx.guildId ? await memberOf(ctx.guildId, who) : null;
  const [roles, everyone] = ctx.guildId
    ? await Promise.all([guildRoles(ctx.guildId), walkMembers(ctx.guildId)])
    : [[] as Role[], null];

  const held = (member?.roles ?? []).map((id) => `<@&${id}>`);
  const top = topRole(member, roles);
  const badges = badgesOf(user.public_flags);

  // Every role's permissions or-ed together is what the member can actually do,
  // which is more useful than the permissions of any one of them.
  const bits = (member?.roles ?? []).reduce((sum, id) => {
    const one = roles.find((role) => role.id === id);
    return one ? sum | BigInt(one.permissions ?? "0") : sum;
  }, 0n);

  const joined = joinedAt(member);
  const order = joined && everyone
    ? everyone
        .filter((one) => joinedAt(one))
        .sort((a, b) => Date.parse(String(joinedAt(a))) - Date.parse(String(joinedAt(b))))
        .findIndex((one) => one.user?.id === who) + 1
    : 0;

  const timeout = (member as unknown as { communication_disabled_until?: string | null } | null)
    ?.communication_disabled_until;
  const tag = (user as unknown as { primary_guild?: { identity_guild_id?: string | null; tag?: string | null } })
    .primary_guild;

  await card(ctx, [
    `### ${plain(String(user.global_name ?? user.username ?? who))}`,
    ...(user.global_name && user.username ? [`-# @${plain(user.username)}`] : []),
    avatarOf(who, user),
    `-# id: ${who}`,
    ...(user.bot ? ["-# this is a bot"] : []),
    `-# account made: ${when(madeAt(who))}`,
    ...(member
      ? [
          `-# joined here: ${when(joined)}` +
            (order && everyone ? ` · ${order}${ordinal(order)} of ${everyone.length} to join` : ""),
        ]
      : ["-# not in this server"]),
    ...(member?.nick ? [`-# nickname: ${plain(member.nick)}`] : []),
    ...(badges.length ? [`-# badges: ${badges.join(", ")}`] : []),
    ...(top ? [`-# top role: <@&${top.id}> · colour ${hex(top.color)}`] : []),
    ...(member ? [`-# permissions: ${permissionsOf(bits.toString())}`] : []),
    ...((member?.premium_since ?? null)
      ? [`-# boosting since ${when(member?.premium_since)}`]
      : []),
    ...(timeout && Date.parse(timeout) > Date.now()
      ? [`-# timed out until ${stamp(timeout)}`]
      : []),
    ...(tag?.tag && tag.identity_guild_id
      ? [`-# wearing the ${plain(tag.tag)} server tag`]
      : []),
    ...(user.banner ? [`-# has a banner · accent ${hex(user.accent_color ?? undefined)}`] : []),
    ...(held.length > 0 ? [`-# ${held.length} roles: ${held.slice(0, 20).join(" ")}`] : []),
  ]);
}

// 1st, 2nd, 3rd, 4th — and 11th through 13th, which are the ones a naive
// version gets wrong.
function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

async function roleInfo(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const role = await findRole(ctx.guildId, ctx.argument.trim());
  if (!role) {
    await card(ctx, ["Which role?", "", "-# `roleinfo @role`"]);
    return;
  }

  const [members, roles] = await Promise.all([
    walkMembers(ctx.guildId),
    guildRoles(ctx.guildId),
  ]);
  const wearing = (members ?? []).filter(
    (one) => role.id === ctx.guildId || (one.roles ?? []).includes(role.id),
  );
  const colours = role.colors;

  await card(ctx, [
    `### ${plain(role.name)}`,
    ...(role.icon ? [assetUrl(`role-icons/${role.id}`, role.icon, 128)] : []),
    `-# id: ${role.id}`,
    `-# made: ${when(madeAt(role.id))}`,
    `-# members: ${wearing.length}` +
      (members ? ` of ${members.length} (${Math.round((wearing.length / Math.max(1, members.length)) * 100)}%)` : ""),
    colours?.secondary_color
      ? `-# gradient: ${hex(colours.primary_color)} to ${hex(colours.secondary_color)}`
      : `-# colour: ${hex(role.color)}`,
    `-# position: ${role.position} of ${roles.length}` +
      (role.position === Math.max(...roles.map((one) => one.position)) ? " (the highest)" : ""),
    `-# shown separately: ${role.hoist ? "yes" : "no"} · anyone can mention: ${role.mentionable ? "yes" : "no"}`,
    ...(role.unicode_emoji ? [`-# emoji: ${role.unicode_emoji}`] : []),
    `-# permissions: ${permissionsOf(role.permissions)}`,
    ...(role.managed
      ? [
          role.tags?.premium_subscriber !== undefined
            ? "-# managed by Discord: this is the booster role"
            : role.tags?.bot_id
              ? `-# managed by <@${role.tags.bot_id}>, so it cannot be given out by hand`
              : "-# managed by an integration, so it cannot be given out by hand",
        ]
      : []),
    ...(wearing.length > 0
      ? [`-# ${wearing.slice(0, 15).map((one) => `<@${one.user?.id}>`).join(" ")}` +
          (wearing.length > 15 ? ` and ${wearing.length - 15} more — see \`members\`` : "")]
      : []),
  ]);
}

async function channelInfo(ctx: PrefixContext): Promise<void> {
  const wanted = channelId(words(ctx.argument)[0]) ?? ctx.channelId;
  const channel = await getChannel(wanted);
  if (!channel) {
    await card(ctx, ["That channel is not here."]);
    return;
  }

  const overwrites = channel.permission_overwrites ?? [];
  const forRoles = overwrites.filter((one) => one.type === 0).length;
  const voice = channel.type === 2 || channel.type === 13;

  await card(ctx, [
    `### ${plain(channel.name ?? wanted)}`,
    `-# id: ${wanted}`,
    `-# kind: ${CHANNEL_KINDS[channel.type ?? -1] ?? "unknown"}`,
    `-# made: ${when(madeAt(wanted))}`,
    ...(channel.parent_id ? [`-# under: <#${channel.parent_id}>`] : []),
    ...(channel.position !== undefined ? [`-# position: ${channel.position}`] : []),
    ...(channel.topic ? [`-# topic: ${plain(channel.topic.slice(0, 200))}`] : []),
    ...(channel.nsfw ? ["-# marked NSFW"] : []),
    ...(channel.rate_limit_per_user
      ? [`-# slowmode: one message every ${channel.rate_limit_per_user}s`]
      : []),
    ...(voice
      ? [
          `-# bitrate: ${Math.round((channel.bitrate ?? 0) / 1000)}kbps` +
            ` · limit: ${channel.user_limit ? `${channel.user_limit} people` : "none"}` +
            ` · region: ${plain(channel.rtc_region ?? "automatic")}`,
        ]
      : []),
    ...(channel.available_tags?.length
      ? [
          `-# ${channel.available_tags.length} tags: ` +
            channel.available_tags.slice(0, 8).map((one) => plain(one.name)).join(", "),
        ]
      : []),
    ...(channel.default_auto_archive_duration
      ? [`-# threads archive after ${channel.default_auto_archive_duration / 60}h`]
      : []),
    ...(channel.message_count !== undefined ? [`-# ${channel.message_count} messages`] : []),
    ...(overwrites.length
      ? [
          `-# ${overwrites.length} permission overrides ` +
            `(${forRoles} roles, ${overwrites.length - forRoles} members)`,
        ]
      : ["-# no permission overrides, so it inherits the category"]),
    // The last message id is a snowflake, so the time it carries costs no extra
    // request and no Read Message History to answer "is this channel dead".
    ...(channel.last_message_id
      ? [`-# last message: ${stamp(madeAt(channel.last_message_id))}`]
      : []),
  ]);
}

async function memberCount(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const guild = await getGuild(ctx.guildId);
  const members = await walkMembers(ctx.guildId);
  const all = members ?? [];
  const humans = all.filter((one) => !one.user?.bot).length;
  const boosters = all.filter((one) => one.premium_since).length;

  const now = Date.now();
  const since = (days: number) =>
    all.filter((one) => {
      const at = joinedAt(one);
      return at ? now - Date.parse(at) < days * 86_400_000 : false;
    }).length;

  const newest = [...all]
    .filter((one) => joinedAt(one))
    .sort((a, b) => Date.parse(String(joinedAt(b))) - Date.parse(String(joinedAt(a))))[0];

  await card(ctx, [
    `### ${plain(guild?.name ?? "this server")}`,
    `-# ${guild?.approximate_member_count ?? all.length} members`,
    `-# ${humans} people · ${all.length - humans} bots`,
    ...(guild?.approximate_presence_count
      ? [`-# ${guild.approximate_presence_count} online right now`]
      : []),
    ...(boosters ? [`-# ${boosters} boosting`] : []),
    `-# joined today: ${since(1)} · this week: ${since(7)} · this month: ${since(30)}`,
    ...(newest ? [`-# newest: <@${newest.user?.id}>, ${stamp(joinedAt(newest))}`] : []),
  ]);
}

// The three "list everything" commands differ only in what they list. All of
// them page now, because a server with 200 roles was previously told about 60.
function listing(what: "roles" | "emotes" | "bots"): PrefixHandler {
  return async (ctx: PrefixContext) => {
    if (!ctx.guildId) return;

    if (what === "roles") {
      const [roles, members] = await Promise.all([
        guildRoles(ctx.guildId),
        walkMembers(ctx.guildId),
      ]);
      const listed = roles
        .filter((one) => one.name !== "@everyone")
        .sort((a, b) => b.position - a.position);

      // One pass over the members rather than one filter per role: a hundred
      // roles against five thousand members is half a million comparisons the
      // other way round.
      const counts = new Map<string, number>();
      for (const one of members ?? []) {
        for (const id of one.roles ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
      }

      const lines = listed.map(
        (one) =>
          `<@&${one.id}> — ${counts.get(one.id) ?? 0} members · ${hex(one.color)}` +
          (one.hoist ? " · hoisted" : "") +
          (one.managed ? " · managed" : ""),
      );
      await paginate(ctx, pagesOf(`${listed.length} roles`, lines, 10, "highest first"), null);
      return;
    }

    if (what === "emotes") {
      const emojis = (await guildEmojis(ctx.guildId)) ?? [];
      const lines = emojis.map(
        (one) =>
          `<${one.animated ? "a" : ""}:${one.name}:${one.id}> \`:${plain(one.name ?? "")}:\`` +
          (one.animated ? " · animated" : "") +
          ` · ${stamp(madeAt(one.id), "D")}`,
      );
      const animated = emojis.filter((one) => one.animated).length;
      await paginate(
        ctx,
        pagesOf(
          `${emojis.length} emotes`,
          lines,
          12,
          `${animated} animated · ${emojis.length - animated} static`,
        ),
        null,
      );
      return;
    }

    const members = await walkMembers(ctx.guildId);
    const bots = (members ?? []).filter((one) => one.user?.bot);
    const lines = bots
      .sort((a, b) => Date.parse(String(joinedAt(a))) - Date.parse(String(joinedAt(b))))
      .map((one) => {
        const flags =
          (one.user as unknown as { public_flags?: number } | undefined)?.public_flags ?? 0;
        return (
          `<@${one.user?.id}> — joined ${stamp(joinedAt(one), "D")}` +
          (flags & (1 << 16) ? " · verified" : "")
        );
      });
    await paginate(ctx, pagesOf(`${bots.length} bots`, lines, 10, "oldest first"), null);
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
  // A member's `roles` never lists @everyone, whose id is the server's own, so
  // asking for it the obvious way answers "nobody" on a role that holds all of
  // them. It is the one role that has to be special-cased.
  const everyone = role.id === ctx.guildId;
  const held = (members ?? [])
    .filter((one) => everyone || (one.roles ?? []).includes(role.id))
    .sort((a, b) => Date.parse(String(joinedAt(a))) - Date.parse(String(joinedAt(b))));

  const lines = held.map(
    (one) =>
      `<@${one.user?.id}> — joined ${stamp(joinedAt(one), "D")}` +
      (one.nick ? ` · ${plain(one.nick)}` : ""),
  );
  await paginate(
    ctx,
    pagesOf(`${held.length} in ${plain(role.name)}`, lines, 10, "oldest first"),
    null,
  );
}

function boostersOf(lost: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    if (!ctx.guildId) return;

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

    const [members, guild] = await Promise.all([
      walkMembers(ctx.guildId),
      getGuild(ctx.guildId),
    ]);
    const boosting = (members ?? [])
      .filter((one) => (one as GuildMember).premium_since)
      .sort((a, b) => Date.parse(String(a.premium_since)) - Date.parse(String(b.premium_since)));

    const lines = boosting.map(
      (one) =>
        `<@${one.user?.id}> — since ${stamp(one.premium_since, "D")} ` +
        `(${stamp(one.premium_since, "R")})`,
    );

    const tier = guild?.premium_tier ?? 0;
    const boosts = guild?.premium_subscription_count ?? boosting.length;
    const next = TIER_COST[tier];
    const footer =
      `${boosts} boosts · ${TIERS[tier] ?? "unknown"}` +
      (next && boosts < next ? ` · ${next - boosts} to level ${tier + 1}` : "");

    // Discord counts subscriptions on the guild, not boosters in it, so a server
    // can report boosts while no current member carries premium_since — the ones
    // who bought them have left, and the tier stays. Saying "0 boosting" under a
    // footer reading "28 boosts" looks like a bug unless the gap is named.
    if (boosting.length === 0 && boosts > 0) {
      await card(ctx, [
        "### Nobody is boosting",
        `-# Discord reports ${boosts} boosts on this server (${TIERS[tier] ?? "unknown"}), but no`,
        "-# current member is flagged as boosting. Boosts bought by people who have",
        "-# since left still count towards the tier, and Discord does not say who they were.",
      ]);
      return;
    }

    await paginate(ctx, pagesOf(`${boosting.length} boosting`, lines, 10, footer), null);
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
    guild?: {
      id: string;
      name: string;
      icon?: string | null;
      banner?: string | null;
      splash?: string | null;
      description?: string | null;
      features?: string[];
      verification_level?: number;
      premium_subscription_count?: number;
      vanity_url_code?: string | null;
      nsfw_level?: number;
    };
    channel?: { name?: string; id?: string; type?: number };
    inviter?: { id?: string; username?: string; global_name?: string | null };
    approximate_member_count?: number;
    approximate_presence_count?: number;
    expires_at?: string | null;
    type?: number;
    target_type?: number;
  }>(`/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`);

  if (!invite) {
    await card(ctx, ["That invite is not valid."]);
    return;
  }

  const guild = invite.guild;
  const online = invite.approximate_presence_count;
  const members = invite.approximate_member_count;

  await card(ctx, [
    `### ${plain(guild?.name ?? invite.code)}`,
    ...(guild?.icon ? [assetUrl(`icons/${guild.id}`, guild.icon, 256)] : []),
    ...(guild?.description ? [`-# ${plain(guild.description.slice(0, 180))}`] : []),
    `-# code: ${plain(invite.code)} · discord.gg/${plain(invite.code)}`,
    ...(guild ? [`-# server id: ${guild.id}`] : []),
    ...(guild ? [`-# server made: ${when(madeAt(guild.id))}`] : []),
    ...(invite.channel?.name
      ? [
          `-# channel: #${plain(invite.channel.name)}` +
            (invite.channel.type !== undefined
              ? ` (${CHANNEL_KINDS[invite.channel.type] ?? "unknown"})`
              : ""),
        ]
      : []),
    ...(invite.inviter
      ? [
          `-# from: ${plain(String(invite.inviter.global_name ?? invite.inviter.username))}` +
            (invite.inviter.id ? ` (${invite.inviter.id})` : ""),
        ]
      : ["-# from: nobody, so this is a vanity or widget invite"]),
    `-# members: ${members ?? "unknown"}` +
      (online !== undefined ? ` · online: ${online}` : "") +
      (members && online ? ` · ${Math.round((online / members) * 100)}% active` : ""),
    ...(guild?.premium_subscription_count
      ? [`-# boosts: ${guild.premium_subscription_count}`]
      : []),
    ...(guild?.verification_level !== undefined
      ? [`-# verification: ${VERIFICATION[guild.verification_level] ?? "unknown"}`]
      : []),
    ...(guild?.nsfw_level ? [`-# age rating: ${NSFW_LEVEL[guild.nsfw_level] ?? "unknown"}`] : []),
    ...(guild?.vanity_url_code ? [`-# vanity: discord.gg/${plain(guild.vanity_url_code)}`] : []),
    `-# expires: ${invite.expires_at ? when(invite.expires_at) : "never"}`,
    ...(guild?.features && guild.features.length > 0
      ? [`-# features: ${guild.features.slice(0, 8).join(", ").toLowerCase().replace(/_/g, " ")}`]
      : []),
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
