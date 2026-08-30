/**
 * Thin Discord REST access for things the typed helpers make awkward.
 *
 * Guild member lists and role permissions are needed as plain data, and going
 * through discordeno's transformers would mean declaring desired properties
 * for guilds, members and roles purely to read three fields. This talks to the
 * API directly and returns the raw JSON.
 */

import { required } from "./env.js";
import { redis } from "./redis.js";

const API = "https://discord.com/api/v10";

const PERMISSION = {
  administrator: 1n << 3n,
  manageGuild: 1n << 5n,
} as const;

/** Member lists change slowly; this keeps whoknows off the API on repeat use. */
const MEMBER_TTL = 600;

async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bot ${required("DISCORD_TOKEN")}` },
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min((body.retry_after ?? 1) * 1000, 5000);
      await new Promise((r) => setTimeout(r, wait));
      return await api<T>(path);
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface GuildMember {
  user?: { id: string; username?: string; global_name?: string | null; bot?: boolean };
  nick?: string | null;
  roles?: string[];
}

export interface Guild {
  id: string;
  name: string;
  owner_id: string;
  roles?: { id: string; permissions: string }[];
}

/**
 * Every non-bot member id in a guild, cached.
 * Pages through the API; a guild larger than the cap is truncated rather than
 * hammered, which only affects who can appear in a whoknows list.
 */
/**
 * Raised when Discord could not be asked, as distinct from answering "none".
 *
 * The difference matters: a guild really can have no linked members, but a
 * failed fetch that reads as "no members" makes every server-scoped command
 * quietly report an empty server.
 */
export class MemberFetchError extends Error {
  constructor(readonly guildId: string) {
    super("could not read the member list");
    this.name = "MemberFetchError";
  }
}

/**
 * Every human member of a guild.
 *
 * Throws `MemberFetchError` rather than returning an empty set when the fetch
 * fails, and caches only a walk that completed. Caching a failure was a real
 * outage: `api()` answers null for a 403, a 500 and a network blip alike, the
 * loop below read that as "no more pages", and the empty result was then
 * served from Redis for the full TTL — so one transient error disabled every
 * guild-scoped command for ten minutes while the bot blamed a privileged
 * intent that was switched on the whole time.
 */
export async function guildMemberIds(guildId: string, cap = 5000): Promise<Set<string>> {
  const cacheKey = `trap:guild:members:${guildId}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return new Set(JSON.parse(hit) as string[]);
  } catch {
    /* fall through */
  }

  const ids: string[] = [];
  let after = "0";
  while (ids.length < cap) {
    const page = await api<GuildMember[]>(
      `/guilds/${guildId}/members?limit=1000&after=${after}`,
    );
    // null is a failed request; an exhausted list comes back as an empty array.
    if (page === null) throw new MemberFetchError(guildId);
    if (page.length === 0) break;

    for (const member of page) {
      if (member.user?.id && !member.user.bot) ids.push(member.user.id);
    }
    const last = page[page.length - 1]?.user?.id;
    if (!last || page.length < 1000) break;
    after = last;
  }

  redis.set(cacheKey, JSON.stringify(ids), "EX", MEMBER_TTL).catch(() => {});
  return new Set(ids);
}

/** Display name for a member, falling back through nick → global name → username. */
/**
 * How a member should be addressed in this guild.
 *
 * "unknown" is a placeholder for a name that could not be read, and is
 * deliberately NOT cached: caching it turns one failed request into ten
 * minutes of cards that all say "unknown", long after Discord is answering
 * again. A member who has genuinely left is cheap to re-ask about.
 */
export async function displayName(guildId: string, userId: string): Promise<string> {
  const cacheKey = `trap:guild:name:${guildId}:${userId}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return hit;
  } catch {
    /* fall through */
  }

  const member = await api<GuildMember>(`/guilds/${guildId}/members/${userId}`);
  const name = member?.nick ?? member?.user?.global_name ?? member?.user?.username ?? null;
  if (name === null) return "unknown";

  redis.set(cacheKey, name, "EX", MEMBER_TTL).catch(() => {});
  return name;
}

export async function getGuild(guildId: string): Promise<Guild | null> {
  return await api<Guild>(`/guilds/${guildId}`);
}

/**
 * True when the user may manage the guild: the owner, or anyone whose roles
 * grant Administrator or Manage Guild. Computed from role bitfields because a
 * gateway message carries no resolved permissions.
 */
export async function canManageGuild(guildId: string, userId: string): Promise<boolean> {
  const guild = await getGuild(guildId);
  if (!guild) return false;
  if (guild.owner_id === userId) return true;

  const member = await api<GuildMember>(`/guilds/${guildId}/members/${userId}`);
  if (!member?.roles) return false;

  // @everyone shares the guild id and applies to every member.
  const applicable = new Set([...member.roles, guildId]);
  let bits = 0n;
  for (const role of guild.roles ?? []) {
    if (applicable.has(role.id)) bits |= BigInt(role.permissions);
  }
  return (bits & PERMISSION.administrator) !== 0n || (bits & PERMISSION.manageGuild) !== 0n;
}
