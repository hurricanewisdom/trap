import { api, memberOf } from "../../../core/discord.js";
import { onMemberJoin, onMessage, type MessageEvent } from "../../../core/hooks.js";
import { recordProtection } from "../../../core/protection.js";
import { humanDuration } from "../../../helpers/duration.js";
import { alert, pauseFor, respond } from "./act.js";
import { settingsFor, sleeping, type Settings } from "./store.js";

const madeAt = (id: string) => Number(BigInt(id) >> 22n) + 1_420_070_400_000;

/**
 * Discord's own opinion of an account, which is the only trustworthy signal
 * here. Everything else about "is this automated" is guesswork.
 *
 * `1 << 20` is the spammer flag Discord sets itself. It is not in the
 * documentation, so it is treated as one signal among several rather than as
 * proof, and a member is only acted on when the evidence is not just "new".
 */
const SPAMMER = 1 << 20;

interface Joiner {
  id: string;
  username?: string;
  avatar?: string | null;
  flags?: number;
  public_flags?: number;
}

function automationScore(user: Joiner, member: Record<string, unknown> | null): string[] {
  const said: string[] = [];

  if (((user.flags ?? 0) | (user.public_flags ?? 0)) & SPAMMER) {
    said.push("flagged as a spammer by Discord");
  }
  if (member?.["unusual_dm_activity_until"]) {
    said.push("flagged for unusual DM activity");
  }
  if (!user.avatar) said.push("no avatar");

  const age = Date.now() - madeAt(user.id);
  if (age < 24 * 3_600_000) said.push("made in the last day");

  // A username that is only letters and digits with a long digit run is what a
  // generated account looks like. On its own it means nothing.
  if (/^[a-z]+\d{4,}$/i.test(user.username ?? "")) said.push("generated-looking name");

  return said;
}

// Joins per guild, for the massjoin window.
const arrivals = new Map<string, number[]>();

function joinBurst(guildId: string, windowMs: number): number {
  const now = Date.now();
  const held = (arrivals.get(guildId) ?? []).filter((at) => now - at < windowMs);
  held.push(now);
  arrivals.set(guildId, held);
  return held.length;
}

async function onJoin(guildId: string, userId: string): Promise<void> {
  const began = Date.now();
  const settings = await settingsFor(guildId);
  if (sleeping(settings)) return;
  if (settings.whitelisted.has(userId)) return;

  const anyOn = (["massjoin", "newaccount", "avatar", "automation"] as const).some(
    (one) => settings.modules[one].on,
  );
  if (!anyOn) return;

  // A burst is about the server, not the person, so it is counted before any
  // decision about this particular member.
  const mass = settings.modules.massjoin;
  if (mass.on) {
    const burst = joinBurst(guildId, mass.windowMs);
    if (burst >= mass.threshold) {
      arrivals.delete(guildId);
      const paused = await pauseFor(
        guildId,
        settings.pauseMs,
        `${burst} joins in ${Math.round(mass.windowMs / 1000)}s`,
      );
      recordProtection({
        guildId,
        source: "antiraid:massjoin",
        actor: userId,
        detail: `${burst} joins in ${Math.round(mass.windowMs / 1000)}s`,
        outcome: paused ? "invites paused" : "could not pause invites",
        tookMs: Date.now() - began,
      });
      await alert(guildId, [
        "### Raid",
        `-# ${burst} accounts joined in ${Math.round(mass.windowMs / 1000)}s`,
        paused
          ? `-# Invites paused for ${humanDuration(settings.pauseMs)} — \`antiraid resolve\` to lift it`
          : "-# Invites could **not** be paused; the bot needs Manage Server",
      ]);
    }
  }

  const user = await api<Joiner>(`/users/${userId}`);
  if (!user) return;
  const member = (await memberOf(guildId, userId)) as unknown as Record<string, unknown> | null;

  const checks: [keyof Settings["modules"], () => string | null][] = [
    [
      "newaccount",
      () => {
        const days = settings.modules.newaccount.threshold;
        const age = Date.now() - madeAt(userId);
        return age < days * 86_400_000
          ? `account is ${humanDuration(age)} old, under ${days} days`
          : null;
      },
    ],
    ["avatar", () => (user.avatar ? null : "no profile picture")],
    [
      "automation",
      () => {
        const signals = automationScore(user, member);
        // One signal is a coincidence. Two is a pattern. Acting on one would
        // kick every new member who has not set an avatar yet.
        return signals.length >= 2 ? `looks automated: ${signals.join(", ")}` : null;
      },
    ],
  ];

  for (const [module, test] of checks) {
    const watch = settings.modules[module];
    if (!watch.on) continue;
    const why = test();
    if (!why) continue;

    await respond({ guildId, userId, module, how: watch.punishment, detail: why, began });
    return;
  }
}

// Messages per member per channel, and per channel across members.
const byMember = new Map<string, number[]>();

const byChannel = new Map<string, Set<string>>();

const channelCount = new Map<string, number[]>();

function bump(map: Map<string, number[]>, key: string, windowMs: number): number {
  const now = Date.now();
  const held = (map.get(key) ?? []).filter((at) => now - at < windowMs);
  held.push(now);
  map.set(key, held);
  return held.length;
}

setInterval(() => {
  const now = Date.now();
  for (const map of [byMember, channelCount, arrivals]) {
    for (const [key, held] of map) {
      if (held.every((at) => now - at > 120_000)) map.delete(key);
    }
  }
  byChannel.clear();
}, 120_000).unref?.();

async function onSaid(event: MessageEvent): Promise<void> {
  if (!event.guildId) return;

  const settings = await settingsFor(event.guildId);
  if (sleeping(settings)) return;
  if (settings.whitelisted.has(event.authorId)) return;

  const began = Date.now();

  // One member sending too many mentions.
  const mention = settings.modules.mentionspam;
  if (mention.on) {
    const many = (event.mentions ?? 0) + (event.mentionsEveryone ? mention.threshold : 0);
    if (many >= mention.threshold) {
      await respond({
        guildId: event.guildId,
        userId: event.authorId,
        module: "mentionspam",
        how: mention.punishment,
        detail: `${many} mentions in one message`,
        began,
      });
      return;
    }
  }

  // One member sending too many messages.
  const spam = settings.modules.spam;
  if (spam.on) {
    const count = bump(byMember, `${event.guildId}:${event.authorId}`, spam.windowMs);
    if (count >= spam.threshold) {
      byMember.delete(`${event.guildId}:${event.authorId}`);
      await respond({
        guildId: event.guildId,
        userId: event.authorId,
        module: "spam",
        how: spam.punishment,
        detail: `${count} messages in ${Math.round(spam.windowMs / 1000)}s`,
        began,
      });
      return;
    }
  }

  // Many *different* accounts flooding one channel, which is the raid version
  // of the same thing and wants the channel locked rather than one person hit.
  const flood = settings.modules.raidspam;
  if (!flood.on) return;

  const key = `${event.guildId}:${event.channelId}`;
  const count = bump(channelCount, key, flood.windowMs);
  const who = byChannel.get(key) ?? new Set<string>();
  who.add(event.authorId);
  byChannel.set(key, who);

  // Two people talking fast is a conversation. The distinct-account count is
  // what separates a flood from a busy channel.
  if (count >= flood.threshold && who.size >= Math.max(3, Math.floor(flood.threshold / 3))) {
    channelCount.delete(key);
    byChannel.delete(key);

    const locked = await lockChannel(event.channelId);
    recordProtection({
      guildId: event.guildId,
      source: "antiraid:raidspam",
      actor: event.channelId,
      detail: `${count} messages from ${who.size} accounts in ${Math.round(flood.windowMs / 1000)}s`,
      outcome: locked ? "channel locked" : "could not lock the channel",
      tookMs: Date.now() - began,
    });
    await alert(event.guildId, [
      "### Channel flooded",
      `-# <#${event.channelId}> — ${count} messages from ${who.size} accounts`,
      locked ? "-# Locked. `antiraid resolve` opens it again." : "-# Could **not** lock it.",
    ]);
  }
}

// Taking Send Messages from @everyone, which is the same thing `lockdown` does.
async function lockChannel(channelId: string): Promise<boolean> {
  const channel = await api<{ guild_id?: string }>(`/channels/${channelId}`);
  const guildId = channel?.guild_id;
  if (!guildId) return false;

  const { setOverwrite } = await import("../../../core/discord.js");
  // Deny Send Messages to @everyone, whose role id is the guild's own.
  const done = await setOverwrite(
    channelId,
    guildId,
    0,
    0n,
    1n << 11n,
    "antiraid: channel flooded",
  );
  return done.ok;
}

export async function unlockChannel(channelId: string, guildId: string): Promise<boolean> {
  const { setOverwrite } = await import("../../../core/discord.js");
  const done = await setOverwrite(channelId, guildId, 0, 0n, 0n, "antiraid: resolved");
  return done.ok;
}

export function registerWatch(): void {
  onMemberJoin(async ({ guildId, userId }) => {
    await onJoin(guildId, userId);
  });
  onMessage(onSaid);
}
