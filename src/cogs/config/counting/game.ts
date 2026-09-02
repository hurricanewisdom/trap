import {
  addReaction,
  deleteMessage,
  giveRole,
  memberOf,
  pinMessage,
  sendMessage,
} from "../../../core/discord.js";
import { onMessage, onMessageEdit, type MessageEvent } from "../../../core/hooks.js";
import {
  advance,
  countingIn,
  lastCountAt,
  reset,
  score,
  type Counting,
} from "./store.js";

/**
 * Arithmetic, without an evaluator.
 *
 * `math` mode has to read `5+5` and `(2*3)+4`, and the obvious way to do that
 * is the one way it must not be done: this is a string a stranger typed in a
 * public channel. A recursive-descent parser over digits and five operators
 * cannot execute anything, so there is nothing to escape.
 */
export function arithmetic(text: string): number | null {
  const source = text.replace(/\s+/g, "");
  if (!source || !/^[\d+\-*/().]+$/.test(source)) return null;

  let at = 0;

  const expression = (): number | null => {
    let left = term();
    if (left === null) return null;

    while (source[at] === "+" || source[at] === "-") {
      const op = source[at] as string;
      at += 1;
      const right = term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const term = (): number | null => {
    let left = factor();
    if (left === null) return null;

    while (source[at] === "*" || source[at] === "/") {
      const op = source[at] as string;
      at += 1;
      const right = factor();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };

  const factor = (): number | null => {
    if (source[at] === "-") {
      at += 1;
      const value = factor();
      return value === null ? null : -value;
    }
    if (source[at] === "(") {
      at += 1;
      const inside = expression();
      if (inside === null || source[at] !== ")") return null;
      at += 1;
      return inside;
    }

    const start = at;
    while (at < source.length && /[\d.]/.test(source[at] as string)) at += 1;
    if (at === start) return null;

    const value = Number(source.slice(start, at));
    return Number.isFinite(value) ? value : null;
  };

  const answer = expression();
  return answer !== null && at === source.length ? answer : null;
}

/** What the member typed, as a number, or null if it is not a count at all. */
function readNumber(content: string, allowMath: boolean): number | null {
  const first = content.trim().split(/\s+/)[0] ?? "";
  if (/^-?\d+$/.test(first)) return Number(first);
  if (!allowMath) return null;

  const value = arithmetic(content.trim());
  return value !== null && Number.isInteger(value) ? value : null;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (whole, name: string) => {
    const held = values[String(name).toLowerCase()];
    return held === undefined ? whole : String(held);
  });
}

async function fail(event: MessageEvent, held: Counting, why: string): Promise<void> {
  await addReaction(event.channelId, event.messageId, held.failEmoji);
  if (held.flags.deleteinvalid) await deleteMessage(event.channelId, event.messageId);

  if (!held.flags.resetonfail) return;

  // Lives are spent before the count is: `lives 3` means three mistakes are
  // absorbed and the fourth resets.
  if (held.lives > 0 && held.livesLeft > 1) {
    await reset(event.channelId, held.current, held.livesLeft - 1);
    // The count survives, so put it back where it was rather than to the start.
    await advance(event.channelId, held.current, held.lastUserId ?? "", held.record);
    if (held.flags.announceresets) {
      await sendMessage(event.channelId, {
        content: `${why} **${held.livesLeft - 1}** ${held.livesLeft - 1 === 1 ? "life" : "lives"} left. The count is still **${held.current}**.`,
        allowed_mentions: { parse: [] },
      });
    }
    return;
  }

  await reset(event.channelId, 0, held.lives);
  if (held.flags.announceresets) {
    await sendMessage(event.channelId, {
      content: `${why} The count is back to **0**. It reached **${held.current}**.`,
      allowed_mentions: { parse: [] },
    });
  }
}

async function play(event: MessageEvent): Promise<void> {
  const held = await countingIn(event.channelId);
  if (!held) return;

  const wanted = readNumber(event.content, held.flags.math);

  if (wanted === null) {
    // Not a count at all. Only `deleteothers` has an opinion about that.
    if (held.flags.deleteothers) await deleteMessage(event.channelId, event.messageId);
    return;
  }

  const member = await memberOf(event.guildId, event.authorId);

  if (held.requiredRoleId && !(member?.roles ?? []).includes(held.requiredRoleId)) {
    await addReaction(event.channelId, event.messageId, held.failEmoji);
    if (held.flags.deleteinvalid) await deleteMessage(event.channelId, event.messageId);
    return;
  }

  if (!held.flags.repeat && held.lastUserId === event.authorId) {
    await fail(event, held, "The same person counted twice in a row.");
    return;
  }

  if (held.cooldownSecs > 0) {
    const last = await lastCountAt(event.channelId, event.authorId);
    if (last && Date.now() - last.getTime() < held.cooldownSecs * 1000) {
      await addReaction(event.channelId, event.messageId, held.failEmoji);
      if (held.flags.deleteinvalid) await deleteMessage(event.channelId, event.messageId);
      return;
    }
  }

  const expected = held.current + held.step;
  if (wanted !== expected) {
    await fail(event, held, `<@${event.authorId}> broke the count at **${wanted}**, expecting **${expected}**.`);
    return;
  }

  await advance(event.channelId, expected, event.authorId, expected);
  await score(event.channelId, event.authorId);
  await addReaction(event.channelId, event.messageId, held.successEmoji);

  if (held.flags.announcerecords && expected > held.record) {
    await sendMessage(event.channelId, {
      content: `**${expected}** — a new record for this channel.`,
      allowed_mentions: { parse: [] },
    });
  }

  if (held.milestoneInterval && expected % held.milestoneInterval === 0) {
    const body = fill(held.milestoneTemplate ?? "**{count}** reached.", {
      count: expected,
      user: `<@${event.authorId}>`,
      channel: `<#${event.channelId}>`,
    });
    const sent = await sendMessage(event.channelId, {
      content: body,
      allowed_mentions: { parse: [] },
    });
    if (held.flags.pinmilestones && sent.ok) await pinMessage(event.channelId, sent.data.id, "Counting milestone");
  }

  if (held.goalNumber !== null && expected === held.goalNumber) {
    if (held.goalRoleId) await giveRole(event.guildId, event.authorId, held.goalRoleId, "Counting goal");
    await sendMessage(event.channelId, {
      content: fill(held.goalMessage ?? "**{count}** — the goal is reached.", {
        count: expected,
        user: `<@${event.authorId}>`,
      }),
      allowed_mentions: { parse: [] },
    });
  }
}

/**
 * An edited count is a way to rewrite history: post `5`, get the tick, then
 * edit it to `500`. `editprotection` says so in the channel rather than trying
 * to undo it, because the count itself was correct when it was made.
 */
async function guardEdits(event: {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  content: string;
}): Promise<void> {
  const held = await countingIn(event.channelId);
  if (!held?.flags.editprotection) return;

  const wanted = readNumber(event.content, held.flags.math);
  if (wanted === null || wanted === held.current) return;

  await sendMessage(event.channelId, {
    content: `<@${event.authorId}> edited a count. The count is still **${held.current}**.`,
    allowed_mentions: { parse: [] },
  });
}

export function watchCounting(): void {
  onMessage(play, "counting");
  onMessageEdit(guardEdits);
}
