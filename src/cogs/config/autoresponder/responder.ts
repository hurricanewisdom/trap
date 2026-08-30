import { deleteMessage, giveRole, memberOf, sendMessage, takeRole } from "../../../core/discord.js";
import { onMessage, type MessageEvent } from "../../../core/hooks.js";
import { render } from "../greetings/variables.js";
import { all, type Responder } from "./store.js";

const COOLDOWN_MS = 4000;

const REPLY_LIMIT = 2000;

const SEEN = 4000;

const fired = new Map<string, number>();

function offCooldown(guildId: string, channelId: string, trigger: string): boolean {
  const key = `${guildId}:${channelId}:${trigger}`;
  const now = Date.now();
  const last = fired.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) return false;

  fired.set(key, now);
  if (fired.size > SEEN) {
    for (const [held, at] of fired) {
      if (now - at > COOLDOWN_MS) fired.delete(held);
    }
  }
  return true;
}

function matches(held: Responder, content: string): boolean {
  const lowered = content.toLowerCase();
  if (held.strict) return lowered.trim() === held.trigger;

  const at = lowered.indexOf(held.trigger);
  if (at < 0) return false;

  const before = lowered[at - 1];
  const after = lowered[at + held.trigger.length];
  const edge = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
  return edge(before) && edge(after);
}

async function permitted(held: Responder, event: MessageEvent): Promise<boolean> {
  if (held.onlyChannels.length === 0 && held.onlyRoles.length === 0) return true;
  if (held.onlyChannels.includes(event.channelId)) return true;
  if (held.onlyRoles.length === 0) return false;

  const member = await memberOf(event.guildId, event.authorId);
  return (member?.roles ?? []).some((id) => held.onlyRoles.includes(id));
}

async function applyRoles(held: Responder, event: MessageEvent): Promise<void> {
  for (const roleId of held.give) {
    await giveRole(event.guildId, event.authorId, roleId, "Autoresponder");
  }
  for (const roleId of held.take) {
    await takeRole(event.guildId, event.authorId, roleId, "Autoresponder");
  }
}

async function respond(event: MessageEvent): Promise<void> {
  if (!event.content) return;

  const held = await all(event.guildId);
  if (held.length === 0) return;

  const hit = held.find((responder) => matches(responder, event.content));
  if (!hit) return;
  if (!(await permitted(hit, event))) return;
  if (!offCooldown(event.guildId, event.channelId, hit.trigger)) return;

  await applyRoles(hit, event);

  if (hit.wipe) await deleteMessage(event.channelId, event.messageId);

  const body = await render(hit.reply, {
    guildId: event.guildId,
    channelId: event.channelId,
    userId: event.authorId,
  });
  if (!body.trim()) return;

  await sendMessage(event.channelId, {
    content: body.slice(0, REPLY_LIMIT),
    allowed_mentions: { parse: ["users", "roles"] },
    ...(hit.quote && !hit.wipe
      ? { message_reference: { message_id: event.messageId, fail_if_not_exists: false } }
      : {}),
  });
}

export function watchMessages(): void {
  onMessage(respond, "autoresponder");
}
