import { required } from "./env.js";
import { redis } from "./redis.js";

const API = "https://discord.com/api/v10";

export const PERMISSION = {
  administrator: 1n << 3n,
  manageGuild: 1n << 5n,
  manageRoles: 1n << 28n,
  manageChannels: 1n << 4n,
  manageMessages: 1n << 13n,
} as const;

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
  user?: { id: string; username?: string; global_name?: string | null; bot?: boolean; avatar?: string | null };
  nick?: string | null;
  roles?: string[];
  premium_since?: string | null;
  avatar?: string | null;
}

export interface Role {
  id: string;
  name: string;
  permissions: string;
  position: number;
  color?: number;
  colors?: { primary_color: number; secondary_color: number | null; tertiary_color: number | null };
  icon?: string | null;
  managed?: boolean;
}

export interface Guild {
  id: string;
  name: string;
  owner_id: string;
  premium_tier?: number;
  premium_subscription_count?: number;
  approximate_member_count?: number;
  features?: string[];
  roles?: Role[];
}

export type Wrote<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

function detail(payload: { errors?: unknown } | null): string | null {
  const found: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || found.length > 2) return;
    const record = node as Record<string, unknown>;

    if (Array.isArray(record._errors)) {
      for (const entry of record._errors as { code?: string; message?: string }[]) {
        if (entry?.message) found.push(entry.code ? `${entry.code}: ${entry.message}` : entry.message);
      }
      return;
    }
    for (const value of Object.values(record)) walk(value);
  };

  walk(payload?.errors);
  return found.length ? found.join("; ") : null;
}

export async function write<T>(
  method: string,
  path: string,
  body?: unknown,
  reason?: string,
): Promise<Wrote<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${required("DISCORD_TOKEN")}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(reason ? { "X-Audit-Log-Reason": reason.slice(0, 400) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (res.status === 429) {
      const wait = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, Math.min((wait.retry_after ?? 1) * 1000, 5000)));
      return await write<T>(method, path, body, reason);
    }

    if (res.status === 204) return { ok: true, data: undefined as T };

    const payload = (await res.json().catch(() => null)) as
      | { message?: string; code?: number; errors?: unknown }
      | null;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: detail(payload) ?? payload?.message ?? `Discord returned ${res.status}`,
      };
    }
    return { ok: true, data: payload as T };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Request failed" };
  }
}

export class MemberFetchError extends Error {
  constructor(readonly guildId: string) {
    super("could not read the member list");
    this.name = "MemberFetchError";
  }
}

export async function guildMemberIds(guildId: string, cap = 5000): Promise<Set<string>> {
  const cacheKey = `trap:guild:members:${guildId}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return new Set(JSON.parse(hit) as string[]);
  } catch {}

  const ids: string[] = [];
  let after = "0";
  while (ids.length < cap) {
    const page = await api<GuildMember[]>(
      `/guilds/${guildId}/members?limit=1000&after=${after}`,
    );

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

export async function displayName(guildId: string, userId: string): Promise<string> {
  const cacheKey = `trap:guild:name:${guildId}:${userId}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return hit;
  } catch {}

  const member = await api<GuildMember>(`/guilds/${guildId}/members/${userId}`);
  const name = member?.nick ?? member?.user?.global_name ?? member?.user?.username ?? null;
  if (name === null) return "unknown";

  redis.set(cacheKey, name, "EX", MEMBER_TTL).catch(() => {});
  return name;
}

export async function getGuild(guildId: string): Promise<Guild | null> {
  return await api<Guild>(`/guilds/${guildId}?with_counts=true`);
}

export async function hasPermission(
  guildId: string,
  userId: string,
  needed: bigint,
): Promise<boolean> {
  const guild = await getGuild(guildId);
  if (!guild) return false;
  if (guild.owner_id === userId) return true;

  const member = await api<GuildMember>(`/guilds/${guildId}/members/${userId}`);
  if (!member?.roles) return false;

  const applicable = new Set([...member.roles, guildId]);
  let bits = 0n;
  for (const role of guild.roles ?? []) {
    if (applicable.has(role.id)) bits |= BigInt(role.permissions);
  }
  return (bits & PERMISSION.administrator) !== 0n || (bits & needed) !== 0n;
}

export async function canManageGuild(guildId: string, userId: string): Promise<boolean> {
  const guild = await getGuild(guildId);
  if (!guild) return false;
  if (guild.owner_id === userId) return true;

  const member = await api<GuildMember>(`/guilds/${guildId}/members/${userId}`);
  if (!member?.roles) return false;

  const applicable = new Set([...member.roles, guildId]);
  let bits = 0n;
  for (const role of guild.roles ?? []) {
    if (applicable.has(role.id)) bits |= BigInt(role.permissions);
  }
  return (bits & PERMISSION.administrator) !== 0n || (bits & PERMISSION.manageGuild) !== 0n;
}

export async function guildRoles(guildId: string): Promise<Role[]> {
  return (await api<Role[]>(`/guilds/${guildId}/roles`)) ?? [];
}

export async function memberOf(guildId: string, userId: string): Promise<GuildMember | null> {
  return api<GuildMember>(`/guilds/${guildId}/members/${userId}`);
}

export async function isBoosting(guildId: string, userId: string): Promise<boolean> {
  const member = await memberOf(guildId, userId);
  return Boolean(member?.premium_since);
}

export interface RolePayload {
  name?: string;
  color?: number;
  colors?: { primary_color: number; secondary_color?: number | null; tertiary_color?: number | null };
  icon?: string | null;
  permissions?: string;
  hoist?: boolean;
  mentionable?: boolean;
}

export function createRole(guildId: string, body: RolePayload, reason: string): Promise<Wrote<Role>> {
  return write<Role>("POST", `/guilds/${guildId}/roles`, body, reason);
}

export function editRole(
  guildId: string,
  roleId: string,
  body: RolePayload,
  reason: string,
): Promise<Wrote<Role>> {
  return write<Role>("PATCH", `/guilds/${guildId}/roles/${roleId}`, body, reason);
}

export function deleteRole(guildId: string, roleId: string, reason: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/guilds/${guildId}/roles/${roleId}`, undefined, reason);
}

export function giveRole(
  guildId: string,
  userId: string,
  roleId: string,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, reason);
}

export function takeRole(
  guildId: string,
  userId: string,
  roleId: string,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>(
    "DELETE",
    `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    undefined,
    reason,
  );
}

export function moveRole(
  guildId: string,
  roleId: string,
  position: number,
  reason: string,
): Promise<Wrote<Role[]>> {
  return write<Role[]>("PATCH", `/guilds/${guildId}/roles`, [{ id: roleId, position }], reason);
}

export interface Ceiling {
  manageRoles: boolean;
  position: number;
}

export async function botCeiling(guildId: string): Promise<Ceiling> {
  const guild = await getGuild(guildId);
  const me = await memberOf(guildId, botId());
  if (!guild || !me) return { manageRoles: false, position: 0 };

  const mine = (guild.roles ?? []).filter((role) => (me.roles ?? []).includes(role.id));
  let bits = 0n;
  for (const role of mine) bits |= BigInt(role.permissions);

  return {
    manageRoles:
      (bits & PERMISSION.administrator) !== 0n || (bits & PERMISSION.manageRoles) !== 0n,
    position: mine.reduce((highest, role) => Math.max(highest, role.position), 0),
  };
}

export function botId(): string {
  const token = required("DISCORD_TOKEN").split(".")[0] ?? "";
  try {
    return Buffer.from(token, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function avatarUrl(guildId: string, member: GuildMember): string | null {
  const userId = member.user?.id;
  if (!userId) return null;
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${member.avatar}.png?size=128`;
  }
  if (member.user?.avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=128`;
  }
  return null;
}

export function sendMessage(
  channelId: string,
  body: { content?: string; allowed_mentions?: unknown },
): Promise<Wrote<{ id: string }>> {
  return write<{ id: string }>("POST", `/channels/${channelId}/messages`, body);
}

export function deleteMessage(channelId: string, messageId: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/channels/${channelId}/messages/${messageId}`);
}

export async function channelExists(guildId: string, channelId: string): Promise<boolean> {
  const channels = await api<{ id: string }[]>(`/guilds/${guildId}/channels`);
  return (channels ?? []).some((channel) => channel.id === channelId);
}
