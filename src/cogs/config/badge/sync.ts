import {
  giveRole,
  memberOf,
  sendMessage,
  takeRole,
  walkMembers,
  wearsTag,
} from "../../../core/discord.js";
import { render } from "../greetings/variables.js";
import {
  awarded,
  config,
  forgetAwarded,
  markAwarded,
  roles,
  DEFAULT_MESSAGE,
} from "./store.js";

const REASON = "server tag";

export interface Swept {
  wearing: number;
  given: number;
  taken: number;
  announced: number;
  failed: number;
}

// Reads the member list fresh, gives the configured roles to everybody wearing
// this server's tag, and takes them back from everybody who has stopped. Both
// directions matter: a reward nobody ever loses is just a role handout.
export async function sweep(guildId: string, announce: boolean): Promise<Swept | null> {
  const held = await config(guildId);
  const wanted = await roles(guildId);

  const members = await walkMembers(guildId);
  if (!members) return null;

  const already = await awarded(guildId);
  const out: Swept = { wearing: 0, given: 0, taken: 0, announced: 0, failed: 0 };
  const nowWearing: string[] = [];
  const nowBare: string[] = [];

  for (const member of members) {
    const userId = member.user?.id;
    if (!userId || member.user?.bot) continue;

    const has = new Set(member.roles ?? []);

    if (wearsTag(member, guildId)) {
      out.wearing += 1;
      nowWearing.push(userId);

      for (const roleId of wanted) {
        if (has.has(roleId)) continue;
        const done = await giveRole(guildId, userId, roleId, REASON);
        if (done.ok) out.given += 1;
        else out.failed += 1;
      }

      // Thanked once, when they first put it on, not every time this runs.
      if (announce && held.channelId && !already.has(userId)) {
        const body = await render(held.message ?? DEFAULT_MESSAGE, {
          guildId,
          channelId: held.channelId,
          userId,
        });
        const sent = await sendMessage(held.channelId, {
          content: body.slice(0, 2000),
          allowed_mentions: { parse: ["users", "roles"] },
        });
        if (sent.ok) out.announced += 1;
      }
      continue;
    }

    nowBare.push(userId);
    for (const roleId of wanted) {
      if (!has.has(roleId)) continue;
      const done = await takeRole(guildId, userId, roleId, REASON);
      if (done.ok) out.taken += 1;
      else out.failed += 1;
    }
  }

  await markAwarded(guildId, nowWearing);
  // Somebody who takes the tag off is forgotten, so putting it back on is
  // thanked again rather than silently.
  await forgetAwarded(guildId, nowBare);
  return out;
}

// One member, when something about them changed. Cheap enough to run on an event
// and does the same thing a sweep would do for that one person.
export async function checkOne(guildId: string, userId: string): Promise<void> {
  const held = await config(guildId);
  if (!held.enabled) return;

  const wanted = await roles(guildId);
  if (wanted.length === 0) return;

  const member = await memberOf(guildId, userId);
  if (!member || member.user?.bot) return;

  const has = new Set(member.roles ?? []);
  const already = await awarded(guildId);

  if (!wearsTag(member, guildId)) {
    for (const roleId of wanted) {
      if (has.has(roleId)) await takeRole(guildId, userId, roleId, REASON);
    }
    await forgetAwarded(guildId, [userId]);
    return;
  }

  for (const roleId of wanted) {
    if (!has.has(roleId)) await giveRole(guildId, userId, roleId, REASON);
  }

  if (already.has(userId)) return;
  await markAwarded(guildId, [userId]);

  if (!held.channelId) return;
  const body = await render(held.message ?? DEFAULT_MESSAGE, {
    guildId,
    channelId: held.channelId,
    userId,
  });
  await sendMessage(held.channelId, {
    content: body.slice(0, 2000),
    allowed_mentions: { parse: ["users", "roles"] },
  });
}
