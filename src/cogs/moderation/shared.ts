import {
  botCeiling,
  displayName,
  guildRoles,
  memberOf,
  type GuildMember,
  type Role,
} from "../../core/discord.js";
import { notice } from "../../core/permissions.js";
import type { PrefixContext } from "../../core/prefix.js";

export const HEADING = "Moderation";

const USER = /^<@!?(\d{15,25})>$/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

export async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply(notice([`### ${HEADING}`, ...lines].join("\n")));
}

export function words(argument: string): string[] {
  return argument.trim().split(/\s+/).filter(Boolean);
}

export function userId(token: string | undefined): string | null {
  if (!token) return null;
  const mention = USER.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

export function channelId(token: string | undefined): string | null {
  if (!token) return null;
  const mention = CHANNEL_MENTION.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

export async function findRole(guildId: string, token: string): Promise<Role | null> {
  const all = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return all.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return all.find((role) => role.name.toLowerCase() === needle) ?? null;
}

export async function highestOf(guildId: string, member: GuildMember | null): Promise<number> {
  if (!member) return -1;
  const all = await guildRoles(guildId);
  let top = 0;
  for (const roleId of member.roles ?? []) {
    const found = all.find((role) => role.id === roleId);
    if (found && found.position > top) top = found.position;
  }
  return top;
}

export interface Blocked {
  why: string;
}

// Whether this moderator may act on this member, and whether the bot can. Both
// are asked before anything happens, because Discord refuses halfway through
// otherwise and the case log would record a punishment that never landed.
export async function mayAct(
  guildId: string,
  moderatorId: string,
  targetId: string,
  ownerId: string | null,
): Promise<Blocked | null> {
  if (moderatorId === targetId) return { why: "That is you." };
  if (targetId === ownerId) return { why: "That is the server owner." };

  const target = await memberOf(guildId, targetId);
  // Somebody who has already left can still be banned or unbanned by id.
  if (!target) return null;

  const ceiling = await botCeiling(guildId);
  const theirs = await highestOf(guildId, target);
  if (theirs >= ceiling.position) {
    return { why: `${await displayName(guildId, targetId)} is above the bot in the role list.` };
  }

  if (moderatorId === ownerId) return null;

  const mine = await highestOf(guildId, await memberOf(guildId, moderatorId));
  if (theirs >= mine) {
    return { why: `${await displayName(guildId, targetId)} is not below you in the role list.` };
  }
  return null;
}

export function reasonOr(said: string, moderatorId: string): string {
  const text = said.trim();
  return (text || "No reason given") + ` — by ${moderatorId}`;
}

export function shownReason(said: string): string {
  return said.trim() || "No reason given";
}
