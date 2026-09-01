import { guildRoles, memberOf, type Role } from "../../core/discord.js";
import { notice } from "../../core/permissions.js";
import type { PrefixContext } from "../../core/prefix.js";

export const CDN = "https://cdn.discordapp.com";

const USER = /^<@!?(\d{15,25})>$/;

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const CHANNEL_MENTION = /^<#(\d{15,25})>$/;

export async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply(notice(lines.join("\n")));
}

// A page is one text block, the same shape `card` posts, so a paginated list and
// a plain one look identical apart from the buttons underneath.
export function pagesOf(
  heading: string,
  lines: string[],
  perPage = 10,
  footer?: string,
): unknown[][] {
  if (lines.length === 0) {
    return [[{ type: 10, content: `### ${heading}\n-# ${footer ?? "nothing here"}` }]];
  }

  const count = Math.ceil(lines.length / perPage);
  return Array.from({ length: count }, (_, page) => {
    const slice = lines.slice(page * perPage, (page + 1) * perPage);
    const tail = [footer, count > 1 ? `page ${page + 1} of ${count}` : null]
      .filter(Boolean)
      .join(" · ");
    return [
      {
        type: 10,
        content: [`### ${heading}`, ...slice, ...(tail ? [`-# ${tail}`] : [])].join("\n"),
      },
    ];
  });
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
  // An empty name would match every role through the contains fallback, and
  // `roleinfo` with no argument would confidently describe @everyone.
  if (!token.trim()) return null;

  const all = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return all.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return (
    all.find((role) => role.name.toLowerCase() === needle) ??
    all.find((role) => role.name.toLowerCase().includes(needle)) ??
    null
  );
}

// Somebody named, or the person asking. Almost every information command wants
// this and nothing more.
export async function whoever(ctx: PrefixContext): Promise<string> {
  return userId(words(ctx.argument)[0]) ?? ctx.authorId;
}

// An animated avatar is a gif and a still one is not, and asking for the wrong
// extension gets a 415 rather than a picture.
export function assetUrl(base: string, hash: string, size = 1024): string {
  return `${CDN}/${base}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=${size}`;
}

export async function memberAvatar(guildId: string, id: string): Promise<string | null> {
  const member = await memberOf(guildId, id);
  return member?.avatar ? assetUrl(`guilds/${guildId}/users/${id}/avatars`, member.avatar) : null;
}

export function stamp(iso: string | number | null | undefined, style = "R"): string {
  const at = typeof iso === "number" ? iso : Date.parse(String(iso ?? ""));
  return Number.isFinite(at) ? `<t:${Math.floor(at / 1000)}:${style}>` : "unknown";
}

// A snowflake carries the time it was made, which is how "account created" is
// known without asking Discord anything.
export function madeAt(id: string): number {
  try {
    return Number(BigInt(id) >> 22n) + 1_420_070_400_000;
  } catch {
    return 0;
  }
}
