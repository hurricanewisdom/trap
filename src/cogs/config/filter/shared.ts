import type { CommandFlag } from "../../../helpers/flags.js";

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

/**
 * The words that mean "show me the list" rather than "toggle this one".
 *
 * The subcommands registered under `whitelist` and `ignore` exist for the help
 * card, but the parent commands take their handler directly rather than
 * dispatching, so the word arrives as an ordinary argument. Without this it is
 * looked up as a role name and the reply is "I cannot find that role."
 */
const LIST_WORDS = new Set(["list", "view", "show", "all", "exemptions", "exempted"]);

export function isListWord(token: string): boolean {
  return LIST_WORDS.has(token.trim().toLowerCase());
}

export function roleList(ids: string[]): string {
  return ids.map((id) => `<@&${id}>`).join(" · ");
}

export function registerExempt(path: string, describe: string, handler: PrefixHandler): void {
  register({
    name: "whitelist",
    aliases: ["exempt", "wl", "exemptions"],
    description: `Exempt a role or channel from the ${describe}`,
    handler,
  });

  groupUnder(`${path} whitelist`, () => {
    register({
      name: "view",
      aliases: ["list"],
      description: `Roles and channels exempt from the ${describe}`,
      handler,
    });
  });
}

/**
 * The one flag every counting filter takes.
 *
 * Declared here rather than in each of the three files that read it, so the
 * help card and all three parsers cannot disagree about what it is called.
 */
export const THRESHOLD: CommandFlag = {
  name: "threshold",
  description: "How many it takes before the message is deleted.",
  aliases: ["limit", "t"],
  takes: "<number>",
};
