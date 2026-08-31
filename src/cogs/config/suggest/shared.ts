import { guildRoles } from "../../../core/discord.js";
import { notice } from "../../../core/permissions.js";
import type { PrefixContext } from "../../../core/prefix.js";

export const HEADING = "Suggestions";

const USER_MENTION = /^<@!?(\d{15,25})>$/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

export async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply(notice([`### ${HEADING}`, ...lines].join("\n")));
}

export function words(argument: string): string[] {
  return argument.trim().split(/\s+/).filter(Boolean);
}

export function channelId(token: string): string | null {
  const mention = CHANNEL_MENTION.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

// A number, with or without the # people naturally type in front of it.
export function suggestionId(token: string | undefined): number | null {
  if (!token) return null;
  const digits = token.replace(/^#/, "");
  if (!/^\d{1,9}$/.test(digits)) return null;

  const value = Number.parseInt(digits, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export interface Target {
  id: string;
  isRole: boolean;
}

// A member or a role, given as a mention, a raw id, or a role name.
export async function target(guildId: string, token: string): Promise<Target | null> {
  const asUser = USER_MENTION.exec(token);
  if (asUser?.[1]) return { id: asUser[1], isRole: false };

  const asRole = ROLE_MENTION.exec(token);
  if (asRole?.[1]) return { id: asRole[1], isRole: true };

  const roles = await guildRoles(guildId);
  if (/^\d{15,25}$/.test(token)) {
    const known = roles.find((role) => role.id === token);
    return { id: token, isRole: Boolean(known) };
  }

  const needle = token.toLowerCase();
  const named = roles.find((role) => role.name.toLowerCase() === needle);
  return named ? { id: named.id, isRole: true } : null;
}

export function missing(id: number): string[] {
  return [`There is no suggestion #${id}.`, "", "-# `suggest config` shows where they go."];
}
