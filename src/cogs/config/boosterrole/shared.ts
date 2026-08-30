import sharp from "sharp";
import {
  avatarUrl,
  botCeiling,
  giveRole,
  guildRoles,
  memberOf,
  type GuildMember,
  type Role,
} from "../../../core/discord.js";
import { notice, requireGuild, requireManageGuild } from "../../../core/permissions.js";
import type { PrefixContext } from "../../../core/prefix.js";
import { config, filters } from "./store.js";

export const HEADING = "Booster role";

export const MENTION = /^<@!?(\d{15,25})>$/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export const NAMED: Record<string, number> = {
  red: 0xed4245,
  orange: 0xe67e22,
  yellow: 0xfee75c,
  green: 0x57f287,
  blue: 0x3498db,
  purple: 0x9b59b6,
  pink: 0xeb459e,
  white: 0xffffff,
  black: 0x010101,
  grey: 0x95a5a6,
  gray: 0x95a5a6,
};

export async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

export function hex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export function parseColor(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  const named = NAMED[value];
  if (named !== undefined) return named;

  const match = HEX.exec(value);
  if (!match) return null;

  const digits = match[1] as string;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return Number.parseInt(full, 16);
}

export function randomColor(): number {
  return Math.floor(Math.random() * 0x1000000);
}

export function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

export function memberId(token: string): string | null {
  const mention = MENTION.exec(token);
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token) ? token : null;
}

export async function findRole(guildId: string, token: string): Promise<Role | null> {
  const roles = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return roles.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return roles.find((role) => role.name.toLowerCase() === needle) ?? null;
}

export async function roleById(guildId: string, roleId: string): Promise<Role | null> {
  return (await guildRoles(guildId)).find((role) => role.id === roleId) ?? null;
}

export async function requireGuildHere(ctx: PrefixContext, action: string): Promise<string | null> {
  return requireGuild(ctx, action);
}

export async function awardIfDue(guildId: string, member: GuildMember): Promise<void> {
  const userId = member.user?.id;
  if (!userId || !member.premium_since) return;

  const { awardRoleId } = await config(guildId);
  if (!awardRoleId || (member.roles ?? []).includes(awardRoleId)) return;

  const ceiling = await botCeiling(guildId);
  if (!ceiling.manageRoles) return;

  await giveRole(guildId, userId, awardRoleId, "Booster award role");
}

export async function requireBooster(ctx: PrefixContext, action: string): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  const member = await memberOf(guildId, ctx.authorId);
  if (member?.premium_since) {
    await awardIfDue(guildId, member);
    return guildId;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Only members boosting this server can ${action}.`,
      "-# Boost the server and the command opens up.",
    ].join("\n"),
  );
  return null;
}

export async function requireManager(ctx: PrefixContext, action: string): Promise<string | null> {
  const guildId = await requireManageGuild(ctx, action);
  if (!guildId) return null;
  return (await requireBotRoles(ctx, guildId)) ? guildId : null;
}

export async function requireBotRoles(ctx: PrefixContext, guildId: string): Promise<boolean> {
  const ceiling = await botCeiling(guildId);
  if (ceiling.manageRoles) return true;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "I need the **Manage Roles** permission to do that.",
      "-# Give my role that permission in Server Settings, then try again.",
    ].join("\n"),
  );
  return false;
}

export async function belowMe(guildId: string, role: Role): Promise<boolean> {
  const ceiling = await botCeiling(guildId);
  return ceiling.position > role.position;
}

export function hierarchyNote(role: Role): string {
  return [
    `### ${HEADING}`,
    `**${role.name}** sits above my own role, so I cannot change it.`,
    "-# Drag my role above it in Server Settings and try again.",
  ].join("\n");
}

export async function blockedWord(guildId: string, name: string): Promise<string | null> {
  const banned = await filters(guildId);
  if (banned.length === 0) return null;

  const haystack = name.toLowerCase();
  return banned.find((word) => haystack.includes(word)) ?? null;
}

export async function dominantColor(guildId: string, userId: string): Promise<number | null> {
  const member = await memberOf(guildId, userId);
  if (!member) return null;

  const url = avatarUrl(guildId, member);
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const { dominant } = await sharp(Buffer.from(await res.arrayBuffer())).stats();
    return (dominant.r << 16) | (dominant.g << 8) | dominant.b;
  } catch {
    return null;
  }
}

export function tierNote(message: string): string {
  const lowered = message.toLowerCase();
  if (lowered.includes("boost") || lowered.includes("premium") || lowered.includes("tier")) {
    return "-# This server needs a higher boost level for that.";
  }
  return `-# Discord said: ${message}`;
}
