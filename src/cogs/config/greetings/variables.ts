import { displayName, getGuild, memberOf } from "../../../core/discord.js";

export interface Variable {
  token: string;
  describes: string;
}

export const VARIABLES: Variable[] = [
  { token: "{user}", describes: "mentions the member" },
  { token: "{user.name}", describes: "their username" },
  { token: "{user.display}", describes: "their nickname here, or username" },
  { token: "{user.display_name}", describes: "the same thing, spelled the long way" },
  { token: "{user.id}", describes: "their id" },
  { token: "{user.avatar}", describes: "a link to their avatar" },
  { token: "{guild}", describes: "the server name" },
  { token: "{guild.id}", describes: "the server id" },
  { token: "{guild.boosts}", describes: "how many boosts the server has" },
  { token: "{guild.level}", describes: "the server's boost level" },
  { token: "{guild.members}", describes: "how many members the server has" },
  { token: "{channel}", describes: "mentions the channel this was posted in" },
];

export interface Context {
  guildId: string;
  channelId: string;
  userId: string;
}

async function values(context: Context): Promise<Record<string, string>> {
  const [guild, member, nick] = await Promise.all([
    getGuild(context.guildId),
    memberOf(context.guildId, context.userId),
    displayName(context.guildId, context.userId),
  ]);

  const avatar = member?.user?.avatar
    ? `https://cdn.discordapp.com/avatars/${context.userId}/${member.user.avatar}.png?size=256`
    : "";

  return {
    "{user}": `<@${context.userId}>`,
    "{user.name}": member?.user?.username ?? nick,
    "{user.display}": nick,
    "{user.display_name}": nick,
    "{user.id}": context.userId,
    "{user.avatar}": avatar,
    "{guild}": guild?.name ?? "this server",
    "{guild.id}": context.guildId,
    "{guild.boosts}": String(guild?.premium_subscription_count ?? 0),
    "{guild.level}": String(guild?.premium_tier ?? 0),
    "{guild.members}": String(guild?.approximate_member_count ?? 0),
    "{channel}": `<#${context.channelId}>`,
  };
}

export async function render(template: string, context: Context): Promise<string> {
  const table = await values(context);
  return template.replace(/\{[a-z.]+\}/gi, (token) => table[token.toLowerCase()] ?? token);
}

export function preview(template: string, context: Context): string {
  return template.replace(/\{[a-z.]+\}/gi, (token) => {
    const lowered = token.toLowerCase();
    if (lowered === "{user}") return `<@${context.userId}>`;
    if (lowered === "{channel}") return `<#${context.channelId}>`;
    return token;
  });
}

export function unknownTokens(template: string): string[] {
  const known = new Set(VARIABLES.map((entry) => entry.token));
  const found = template.match(/\{[a-z.]+\}/gi) ?? [];
  return [...new Set(found.map((token) => token.toLowerCase()))].filter(
    (token) => !known.has(token),
  );
}
