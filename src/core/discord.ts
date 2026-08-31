import { forgetSnipe } from "./sniping.js";
import { required } from "./env.js";
import { redis } from "./redis.js";

const API = "https://discord.com/api/v10";

export const PERMISSION = {
  administrator: 1n << 3n,
  manageGuild: 1n << 5n,
  manageRoles: 1n << 28n,
  manageChannels: 1n << 4n,
  manageMessages: 1n << 13n,
  manageWebhooks: 1n << 29n,
  banMembers: 1n << 2n,
  kickMembers: 1n << 1n,
  moderateMembers: 1n << 40n,
  manageNicknames: 1n << 27n,
  moveMembers: 1n << 24n,
  manageThreads: 1n << 34n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  attachFiles: 1n << 15n,
  embedLinks: 1n << 14n,
  addReactions: 1n << 6n,
  externalEmojis: 1n << 18n,
} as const;

const MEMBER_TTL = 600;

export async function api<T>(path: string): Promise<T | null> {
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
  user?: {
    id: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
    avatar?: string | null;
    // Which server's tag this person is wearing, if any. Discord puts it on the
    // user rather than the member, and sends it with the member list.
    primary_guild?: {
      identity_guild_id?: string | null;
      identity_enabled?: boolean | null;
      tag?: string | null;
      badge?: string | null;
    } | null;
  };
  nick?: string | null;
  roles?: string[];
  premium_since?: string | null;
  avatar?: string | null;
  banner?: string | null;
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

// The whole member objects rather than only their ids, and deliberately not
// cached: this is read to find out what people are wearing right now, and a
// ten-minute-old answer would hand out roles for a tag somebody has taken off.
export async function walkMembers(guildId: string, cap = 5000): Promise<GuildMember[] | null> {
  const held: GuildMember[] = [];
  let after = "0";

  while (held.length < cap) {
    const page = await api<GuildMember[]>(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (page === null) return null;
    if (page.length === 0) break;

    held.push(...page);
    const last = page[page.length - 1]?.user?.id;
    if (!last || page.length < 1000) break;
    after = last;
  }
  return held;
}

// True when this person is displaying this server's tag.
export function wearsTag(member: GuildMember, guildId: string): boolean {
  const worn = member.user?.primary_guild;
  return Boolean(worn?.identity_enabled && worn.identity_guild_id === guildId);
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
  body: {
    content?: string;
    allowed_mentions?: unknown;
    message_reference?: unknown;
    components?: unknown[];
    flags?: number;
  },
): Promise<Wrote<{ id: string }>> {
  return write<{ id: string }>("POST", `/channels/${channelId}/messages`, body);
}

export interface PostedMessage {
  id: string;
  channel_id?: string;
  author?: { id: string; bot?: boolean };
  content?: string;
  embeds?: Record<string, unknown>[];
  type?: number;
  pinned?: boolean;
  webhook_id?: string;
  attachments?: { url: string; content_type?: string; filename?: string }[];
  sticker_items?: { id: string }[];
  mentions?: { id: string }[];
  reactions?: { count: number }[];
}

// Discord refuses this for anything older than two weeks, and refuses a batch of
// one, so the caller has to have filtered already.
export async function bulkDelete(
  channelId: string,
  ids: string[],
  reason: string,
): Promise<number> {
  const fresh = ids.slice(0, 100);
  if (fresh.length === 0) return 0;

  if (fresh.length === 1) {
    const one = await write<void>(
      "DELETE",
      `/channels/${channelId}/messages/${fresh[0]}`,
      undefined,
      reason,
    );
    return one.ok ? 1 : 0;
  }

  const done = await write<void>(
    "POST",
    `/channels/${channelId}/messages/bulk-delete`,
    { messages: fresh },
    reason,
  );
  return done.ok ? fresh.length : 0;
}

export function clearReactions(channelId: string, messageId: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/channels/${channelId}/messages/${messageId}/reactions`);
}

export function getMessage(channelId: string, messageId: string): Promise<PostedMessage | null> {
  return api<PostedMessage>(`/channels/${channelId}/messages/${messageId}`);
}

export function editMessage(
  channelId: string,
  messageId: string,
  body: { content?: string | null; embeds?: unknown[]; components?: unknown[]; flags?: number },
): Promise<Wrote<PostedMessage>> {
  return write<PostedMessage>("PATCH", `/channels/${channelId}/messages/${messageId}`, body);
}

export function channelMessages(
  channelId: string,
  query: string,
): Promise<PostedMessage[] | null> {
  return api<PostedMessage[]>(`/channels/${channelId}/messages?${query}`);
}

export function pinnedMessages(channelId: string): Promise<PostedMessage[] | null> {
  return api<PostedMessage[]>(`/channels/${channelId}/pins`);
}

export function pinMessage(
  channelId: string,
  messageId: string,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>("PUT", `/channels/${channelId}/pins/${messageId}`, undefined, reason);
}

export function unpinMessage(
  channelId: string,
  messageId: string,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>("DELETE", `/channels/${channelId}/pins/${messageId}`, undefined, reason);
}

export function editGuild(
  guildId: string,
  body: Record<string, unknown>,
  reason: string,
): Promise<Wrote<Guild>> {
  return write<Guild>("PATCH", `/guilds/${guildId}`, body, reason);
}

export interface Webhook {
  id: string;
  type?: number;
  name?: string | null;
  channel_id?: string;
  token?: string;
  application_id?: string | null;
}

export function guildWebhooks(guildId: string): Promise<Webhook[] | null> {
  return api<Webhook[]>(`/guilds/${guildId}/webhooks`);
}

export function createWebhook(
  channelId: string,
  name: string,
  reason: string,
): Promise<Wrote<Webhook>> {
  return write<Webhook>("POST", `/channels/${channelId}/webhooks`, { name }, reason);
}

export function deleteWebhook(webhookId: string, reason: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/webhooks/${webhookId}`, undefined, reason);
}

export function executeWebhook(
  webhookId: string,
  webhookToken: string,
  body: Record<string, unknown>,
): Promise<Wrote<{ id: string }>> {
  return write<{ id: string }>(
    "POST",
    `/webhooks/${webhookId}/${webhookToken}?wait=true`,
    body,
  );
}

export function editWebhookMessage(
  webhookId: string,
  webhookToken: string,
  messageId: string,
  body: Record<string, unknown>,
): Promise<Wrote<{ id: string }>> {
  return write<{ id: string }>(
    "PATCH",
    `/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`,
    body,
  );
}

export interface GuildEmoji {
  id: string;
  name?: string | null;
  animated?: boolean;
}

export interface GuildSticker {
  id: string;
  name?: string | null;
  format_type?: number;
}

export function guildEmojis(guildId: string): Promise<GuildEmoji[] | null> {
  return api<GuildEmoji[]>(`/guilds/${guildId}/emojis`);
}

export function guildStickers(guildId: string): Promise<GuildSticker[] | null> {
  return api<GuildSticker[]>(`/guilds/${guildId}/stickers`);
}

// write() JSON-encodes its body, which cannot carry a file. An upload has to be
// multipart, with the message itself in a payload_json part.
export async function sendFile(
  channelId: string,
  body: {
    content?: string;
    allowed_mentions?: unknown;
    components?: unknown[];
    flags?: number;
  },
  file: { name: string; body: Uint8Array<ArrayBuffer> },
): Promise<Wrote<{ id: string }>> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(body));
  form.append("files[0]", new Blob([file.body]), file.name);

  try {
    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${required("DISCORD_TOKEN")}` },
      body: form,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, status: res.status, message: payload?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as { id: string } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "upload failed" };
  }
}

// The bot's own member in one guild: nickname, avatar, banner and bio. Discord
// accepts a bio here and echoes it back, but never returns it from any endpoint a
// bot may read, so it has to be remembered locally to be shown again.
export function editSelfMember(
  guildId: string,
  body: { nick?: string | null; avatar?: string | null; banner?: string | null; bio?: string },
): Promise<Wrote<GuildMember>> {
  return write<GuildMember>("PATCH", `/guilds/${guildId}/members/@me`, body);
}

// A custom emoji reacts as name:id, a unicode one as itself, and either way the
// endpoint wants it percent-encoded.
export function reactionKey(emoji: string): string {
  const custom = /^<a?:([\w~]+):(\d{15,25})>$/.exec(emoji.trim());
  return custom ? `${custom[1]}:${custom[2]}` : emoji.trim();
}

export function addReaction(
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<Wrote<void>> {
  const key = encodeURIComponent(reactionKey(emoji));
  return write<void>("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${key}/@me`);
}

export function startThread(
  channelId: string,
  messageId: string,
  name: string,
): Promise<Wrote<{ id: string }>> {
  return write<{ id: string }>("POST", `/channels/${channelId}/messages/${messageId}/threads`, {
    name: name.slice(0, 100) || "Suggestion",
    auto_archive_duration: 1440,
  });
}

// A DM to somebody who is not the invoker: the channel has to be opened first,
// and a closed inbox is a normal outcome rather than an error.
export async function dmUser(
  userId: string,
  body: { content?: string; components?: unknown[]; flags?: number },
): Promise<boolean> {
  const opened = await write<{ id: string }>("POST", "/users/@me/channels", {
    recipient_id: userId,
  });
  if (!opened.ok) return false;

  const sent = await write<{ id: string }>(
    "POST",
    `/channels/${opened.data.id}/messages`,
    body,
  );
  return sent.ok;
}

export interface Channel {
  id: string;
  name?: string;
  type?: number;
  topic?: string | null;
  nsfw?: boolean;
  parent_id?: string | null;
  position?: number;
  rate_limit_per_user?: number;
  permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
}

export function guildChannels(guildId: string): Promise<Channel[] | null> {
  return api<Channel[]>(`/guilds/${guildId}/channels`);
}

export function getChannel(channelId: string): Promise<Channel | null> {
  return api<Channel>(`/channels/${channelId}`);
}

export function editChannel(
  channelId: string,
  body: Record<string, unknown>,
  reason: string,
): Promise<Wrote<Channel>> {
  return write<Channel>("PATCH", `/channels/${channelId}`, body, reason);
}

export function deleteChannel(channelId: string, reason: string): Promise<Wrote<Channel>> {
  return write<Channel>("DELETE", `/channels/${channelId}`, undefined, reason);
}

export function cloneChannel(
  guildId: string,
  body: Record<string, unknown>,
  reason: string,
): Promise<Wrote<Channel>> {
  return write<Channel>("POST", `/guilds/${guildId}/channels`, body, reason);
}

// type 0 is a role overwrite, type 1 a member one. Both allow and deny are sent
// every time, because Discord replaces the whole overwrite rather than merging.
export function setOverwrite(
  channelId: string,
  id: string,
  kind: 0 | 1,
  allow: bigint,
  deny: bigint,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>(
    "PUT",
    `/channels/${channelId}/permissions/${id}`,
    { type: kind, allow: allow.toString(), deny: deny.toString() },
    reason,
  );
}

export function guildInvites(guildId: string): Promise<{ code: string }[] | null> {
  return api<{ code: string }[]>(`/guilds/${guildId}/invites`);
}

export function deleteInvite(code: string, reason: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/invites/${code}`, undefined, reason);
}

export function banMember(
  guildId: string,
  userId: string,
  seconds: number,
  reason: string,
): Promise<Wrote<void>> {
  return write<void>(
    "PUT",
    `/guilds/${guildId}/bans/${userId}`,
    { delete_message_seconds: Math.max(0, Math.min(604800, seconds)) },
    reason,
  );
}

export function unbanMember(guildId: string, userId: string, reason: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/guilds/${guildId}/bans/${userId}`, undefined, reason);
}

export function kickMember(guildId: string, userId: string, reason: string): Promise<Wrote<void>> {
  return write<void>("DELETE", `/guilds/${guildId}/members/${userId}`, undefined, reason);
}

export interface Ban {
  user: { id: string; username?: string };
  reason: string | null;
}

export function guildBans(guildId: string, after = "0"): Promise<Ban[] | null> {
  return api<Ban[]>(`/guilds/${guildId}/bans?limit=1000&after=${after}`);
}

export function banOf(guildId: string, userId: string): Promise<Ban | null> {
  return api<Ban>(`/guilds/${guildId}/bans/${userId}`);
}

// Discord's own timeout. `until` is an ISO string, or null to lift it.
export function timeoutMember(
  guildId: string,
  userId: string,
  until: string | null,
  reason: string,
): Promise<Wrote<GuildMember>> {
  return write<GuildMember>(
    "PATCH",
    `/guilds/${guildId}/members/${userId}`,
    { communication_disabled_until: until },
    reason,
  );
}

export function editMember(
  guildId: string,
  userId: string,
  body: Record<string, unknown>,
  reason: string,
): Promise<Wrote<GuildMember>> {
  return write<GuildMember>("PATCH", `/guilds/${guildId}/members/${userId}`, body, reason);
}

export function deleteMessage(channelId: string, messageId: string): Promise<Wrote<void>> {
  forgetSnipe(channelId, messageId);
  return write<void>("DELETE", `/channels/${channelId}/messages/${messageId}`);
}

export async function channelExists(guildId: string, channelId: string): Promise<boolean> {
  const channels = await api<{ id: string }[]>(`/guilds/${guildId}/channels`);
  return (channels ?? []).some((channel) => channel.id === channelId);
}
