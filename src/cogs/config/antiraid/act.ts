import {
  banMember,
  getGuild,
  kickMember,
  sendMessage,
  timeoutMember,
  write,
} from "../../../core/discord.js";
import { recordProtection } from "../../../core/protection.js";
import { humanDuration } from "../../../helpers/duration.js";
import { plain } from "../../../helpers/markdown.js";
import { settingsFor, setConfig, type Punishment } from "./store.js";

/**
 * Pausing invites is the only lever Discord gives for "stop people arriving".
 *
 * It is a guild **feature** rather than a setting, toggled by rewriting the
 * whole features array, so the array has to be read first and put back with one
 * entry added or removed. Sending a features list that drops the others would
 * turn them off.
 */
const PAUSED = "INVITES_DISABLED";

export async function invitesPaused(guildId: string): Promise<boolean> {
  const guild = await getGuild(guildId);
  return (guild?.features ?? []).includes(PAUSED);
}

export async function pauseInvites(guildId: string, on: boolean): Promise<boolean> {
  const guild = await getGuild(guildId);
  if (!guild) return false;

  const others = (guild.features ?? []).filter((one) => one !== PAUSED);
  const done = await write(
    "PATCH",
    `/guilds/${guildId}`,
    { features: on ? [...others, PAUSED] : others },
    on ? "antiraid: invites paused" : "antiraid: invites resumed",
  );
  return done.ok;
}

// One timer per guild, so a second raid while one is already paused extends the
// pause rather than starting a second timer that resumes early.
const resuming = new Map<string, ReturnType<typeof setTimeout>>();

export async function pauseFor(guildId: string, ms: number, why: string): Promise<boolean> {
  const ok = await pauseInvites(guildId, true);
  if (!ok) return false;

  await setConfig(guildId, { pausedUntil: new Date(Date.now() + ms) });

  const held = resuming.get(guildId);
  if (held) clearTimeout(held);

  const timer = setTimeout(() => {
    void (async () => {
      resuming.delete(guildId);
      await pauseInvites(guildId, false);
      await setConfig(guildId, { pausedUntil: null });
      await alert(guildId, [
        "### Invites open again",
        `-# The pause after ${plain(why, 80)} has run out.`,
      ]);
    })();
  }, ms);
  timer.unref?.();
  resuming.set(guildId, timer);
  return true;
}

export async function resume(guildId: string): Promise<boolean> {
  const held = resuming.get(guildId);
  if (held) {
    clearTimeout(held);
    resuming.delete(guildId);
  }
  await setConfig(guildId, { pausedUntil: null });
  return pauseInvites(guildId, false);
}

/** Where the alerts go, if anywhere. Silence is the default. */
export async function alert(guildId: string, lines: string[]): Promise<void> {
  const settings = await settingsFor(guildId);
  if (!settings.alertChannel) return;

  await sendMessage(settings.alertChannel, {
    flags: 1 << 15,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, components: [{ type: 10, content: lines.join("\n") }] }],
  }).catch(() => undefined);
}

const TIMEOUT_MS = 60 * 60_000;

export async function punish(
  guildId: string,
  userId: string,
  how: Punishment,
  why: string,
): Promise<string> {
  const reason = `antiraid: ${why}`.slice(0, 500);

  if (how === "ban") {
    const done = await banMember(guildId, userId, 0, reason);
    return done.ok ? "banned" : `could not ban (${done.message.slice(0, 50)})`;
  }
  if (how === "timeout") {
    // The API takes the moment it ends, not how long it lasts.
    const until = new Date(Date.now() + TIMEOUT_MS).toISOString();
    const done = await timeoutMember(guildId, userId, until, reason);
    return done.ok ? `timed out for ${humanDuration(TIMEOUT_MS)}` : `could not time out (${done.message.slice(0, 50)})`;
  }
  const done = await kickMember(guildId, userId, reason);
  return done.ok ? "kicked" : `could not kick (${done.message.slice(0, 50)})`;
}

/** Punish, log with the time it took, and tell the alert channel. */
export async function respond(options: {
  guildId: string;
  userId: string;
  module: string;
  how: Punishment;
  detail: string;
  began: number;
}): Promise<void> {
  const outcome = await punish(options.guildId, options.userId, options.how, options.detail);

  recordProtection({
    guildId: options.guildId,
    source: `antiraid:${options.module}`,
    actor: options.userId,
    detail: options.detail,
    outcome,
    tookMs: Date.now() - options.began,
  });

  await alert(options.guildId, [
    "### Antiraid",
    `-# <@${options.userId}> (${options.userId})`,
    `-# ${plain(options.detail, 120)}`,
    `-# ${outcome} — **in ${Date.now() - options.began}ms**`,
  ]);
}
