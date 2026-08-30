import { guildRoles, type Role } from "../../../core/discord.js";
import { notice } from "../../../core/permissions.js";
import {
  groupUnder,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";

export const HEADING = "Filter";

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

export function roleList(ids: string[]): string {
  return ids.map((id) => `<@&${id}>`).join(" · ");
}

export function registerExempt(path: string, describe: string, handler: PrefixHandler): void {
  register({
    name: "exempt",
    description: `Exempt a role from the ${describe}`,
    handler,
  });

  groupUnder(`${path} exempt`, () => {
    register({
      name: "list",
      description: `Roles exempt from the ${describe}`,
      handler,
    });
  });
}
