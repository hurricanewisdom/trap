import { guildRoles, type Role } from "../../../core/discord.js";
import { notice } from "../../../core/permissions.js";
import type { PrefixContext } from "../../../core/prefix.js";

export const HEADING = "Autoresponder";

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

export function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

export async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

export function channelId(token: string): string | null {
  const mention = CHANNEL_MENTION.exec(token);
  return mention ? (mention[1] as string) : null;
}

export async function findRole(guildId: string, token: string): Promise<Role | null> {
  const roles = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return roles.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return roles.find((role) => role.name.toLowerCase() === needle) ?? null;
}

export function roleList(ids: string[]): string {
  return ids.map((id) => `<@&${id}>`).join(" · ");
}

export function shown(trigger: string): string {
  return `\`${trigger.replace(/`/g, "'").slice(0, 60)}\``;
}

export function missing(trigger: string): string {
  return [
    `### ${HEADING}`,
    `Nothing responds to ${shown(trigger)}.`,
    "",
    "-# `autoresponder list` shows every trigger.",
  ].join("\n");
}

export function needTrigger(usage: string): string {
  return [`### ${HEADING}`, "Which trigger?", "", `-# \`${usage}\``].join("\n");
}

export function splitOnComma(argument: string): { trigger: string; reply: string } | null {
  const at = argument.indexOf(",");
  if (at < 0) return null;

  const trigger = argument.slice(0, at).trim();
  const reply = argument.slice(at + 1).trim();
  if (!trigger || !reply) return null;
  return { trigger, reply };
}
