import { sql } from "../../../core/db.js";
import {
  banMember,
  dmUser,
  getGuild,
  giveRole,
  guildRoles,
  kickMember,
  memberOf,
  takeRole,
  write,
} from "../../../core/discord.js";
import { onAuditAction, type AuditActionEvent } from "../../../core/hooks.js";
import { recordProtection, took } from "../../../core/protection.js";
import { settingsFor, type Module, type Punishment } from "./store.js";

// Discord's audit log action numbers. Named because `32` at a call site is
// unreadable, and watching the wrong number means watching the wrong thing.
const ACTION: Record<number, { module: Module; what: string }> = {
  10: { module: "channel", what: "created a channel" },
  12: { module: "channel", what: "deleted a channel" },
  20: { module: "kick", what: "kicked a member" },
  22: { module: "ban", what: "banned a member" },
  28: { module: "bot", what: "added a bot" },
  30: { module: "role", what: "created a role" },
  31: { module: "permissions", what: "changed a role's permissions" },
  32: { module: "role", what: "deleted a role" },
  50: { module: "webhook", what: "created a webhook" },
  52: { module: "webhook", what: "deleted a webhook" },
  60: { module: "emoji", what: "created an emoji" },
  62: { module: "emoji", what: "deleted an emoji" },
};

// Rolling counts per guild, per person, per module. In memory: this is a
// tripwire, not a ledger, and it is read on every audited action.
const seen = new Map<string, number[]>();

function countUp(guildId: string, userId: string, module: Module, windowMs: number): number {
  const key = `${guildId}:${userId}:${module}`;
  const now = Date.now();
  const held = (seen.get(key) ?? []).filter((at) => now - at < windowMs);
  held.push(now);
  seen.set(key, held);
  return held.length;
}

// Half an hour of quiet drops a guild's counters entirely.
setInterval(() => {
  const now = Date.now();
  for (const [key, held] of seen) {
    if (held.every((at) => now - at > 1_800_000)) seen.delete(key);
  }
}, 600_000).unref?.();

const DANGEROUS = [
  [1n << 3n, "administrator"],
  [1n << 5n, "manage server"],
  [1n << 28n, "manage roles"],
  [1n << 4n, "manage channels"],
  [1n << 2n, "ban members"],
  [1n << 1n, "kick members"],
  [1n << 29n, "manage webhooks"],
  [1n << 30n, "manage expressions"],
] as const;

export function dangerousBits(permissions: bigint): string[] {
  return DANGEROUS.filter(([bit]) => permissions & bit).map(([, name]) => name);
}

// The gateway sends permissions as a json **number** where the REST audit log
// sends a string. Everything watched here sits below bit 31, so the precision a
// large number would lose does not reach it -- but the conversion goes through
// a string either way rather than through Number.
function asBits(value: unknown): bigint {
  const said = String(value ?? "0").trim();
  return /^\d+$/.test(said) ? BigInt(said) : 0n;
}

/** What a role change *added*, which is not the same as what the role now has. */
function grantedBy(event: AuditActionEvent): string[] {
  const change = (event.changes ?? []).find((one) => one.key === "permissions");
  if (!change) return [];
  return dangerousBits(asBits(change.new_value) & ~asBits(change.old_value));
}

async function jailRoleOf(guildId: string): Promise<string | null> {
  const rows = await sql<{ jail_role: string | null }[]>`
    SELECT jail_role FROM mod_config WHERE guild_id = ${guildId}
  `.catch(() => [] as { jail_role: string | null }[]);
  return rows[0]?.jail_role ?? null;
}

/** Takes every role carrying a dangerous permission, leaving the harmless ones. */
export async function stripStaff(guildId: string, userId: string): Promise<number> {
  const [member, roles] = await Promise.all([memberOf(guildId, userId), guildRoles(guildId)]);
  if (!member) return 0;

  const held = new Set(member.roles ?? []);
  const risky = roles.filter(
    (one) => held.has(one.id) && dangerousBits(asBits(one.permissions)).length > 0,
  );

  let taken = 0;
  for (const one of risky) {
    const done = await takeRole(guildId, userId, one.id, "antinuke: stripped staff role");
    if (done.ok) taken += 1;
  }
  return taken;
}

async function punish(
  guildId: string,
  userId: string,
  how: Punishment,
  why: string,
): Promise<string> {
  const reason = `antinuke: ${why}`.slice(0, 500);

  if (how === "ban") {
    const done = await banMember(guildId, userId, 0, reason);
    return done.ok ? "banned" : `could not ban (${done.message.slice(0, 60)})`;
  }
  if (how === "kick") {
    const done = await kickMember(guildId, userId, reason);
    return done.ok ? "kicked" : `could not kick (${done.message.slice(0, 60)})`;
  }
  if (how === "stripstaff") {
    const taken = await stripStaff(guildId, userId);
    return taken > 0 ? `stripped of ${taken} role${taken === 1 ? "" : "s"}` : "had no staff roles";
  }

  const jail = await jailRoleOf(guildId);
  if (!jail) {
    // Doing nothing would leave whoever it is in place with their roles, so a
    // punishment that cannot be carried out falls back rather than giving up.
    const taken = await stripStaff(guildId, userId);
    return `no jail role set, so stripped ${taken} role${taken === 1 ? "" : "s"} instead`;
  }
  await stripStaff(guildId, userId);
  const done = await giveRole(guildId, userId, jail, reason);
  return done.ok ? "jailed" : `could not jail (${done.message.slice(0, 60)})`;
}

async function tellOwner(guildId: string, said: string[]): Promise<void> {
  const guild = await getGuild(guildId);
  if (!guild?.owner_id) return;
  await dmUser(guild.owner_id, {
    flags: 1 << 15,
    components: [{ type: 17, components: [{ type: 10, content: said.join("\n") }] }],
  }).catch(() => {});
}

let selfId = "";
function me(): string {
  if (selfId) return selfId;
  const first = (process.env.DISCORD_TOKEN ?? "").split(".")[0] ?? "";
  try {
    selfId = Buffer.from(first, "base64").toString("utf8");
  } catch {
    selfId = "";
  }
  return selfId;
}

async function react(event: AuditActionEvent): Promise<void> {
  // Started before anything is read, so the number covers the whole response:
  // reading the settings, reverting a grant, and carrying out the punishment.
  const began = Date.now();

  const watched = ACTION[event.actionType];
  if (!watched) return;

  const settings = await settingsFor(event.guildId);
  const watch = settings.modules[watched.module];
  if (!watch.on) return;

  // The bot itself, the server's owner, anyone trusted with these settings, and
  // anyone explicitly excluded. Discord will not let the owner be punished in
  // any case, so trying would only produce noise.
  const guild = await getGuild(event.guildId);
  if (
    event.actorId === me() ||
    event.actorId === guild?.owner_id ||
    settings.trusted.has(event.actorId) ||
    settings.whitelisted.has(event.actorId)
  ) {
    return;
  }

  let detail = watched.what;

  // Permissions are different: the grant is reverted immediately, before any
  // counting, because an administrator handed out is dangerous while the count
  // is still one.
  if (watched.module === "permissions") {
    const granted = grantedBy(event);
    if (granted.length === 0) return;
    detail = `granted ${granted.join(", ")}`;

    const change = (event.changes ?? []).find((one) => one.key === "permissions");
    await write(
      "PATCH",
      `/guilds/${event.guildId}/roles/${event.targetId}`,
      { permissions: asBits(change?.old_value).toString() },
      "antinuke: reverted a dangerous permission grant",
    ).catch(() => undefined);
  }

  const count = countUp(event.guildId, event.actorId, watched.module, watch.windowMs);
  if (count < watch.threshold) return;

  seen.delete(`${event.guildId}:${event.actorId}:${watched.module}`);
  const outcome = await punish(event.guildId, event.actorId, settings.punishment, detail);

  const spent = took(began);

  await tellOwner(event.guildId, [
    "### Antinuke tripped",
    `-# <@${event.actorId}> (${event.actorId}) in **${guild?.name ?? event.guildId}**`,
    `-# ${detail} · ${count} in ${Math.round(watch.windowMs / 1000)}s`,
    `-# ${outcome} — **acted in ${spent}**`,
  ]);

  recordProtection({
    guildId: event.guildId,
    source: `antinuke:${watched.module}`,
    actor: event.actorId,
    detail,
    outcome,
    tookMs: Date.now() - began,
  });
}

export function registerWatch(): void {
  onAuditAction(react);
}

/** Exposed for the tests, which must never call the punishing path. */
export { react as reactForTests, ACTION };
