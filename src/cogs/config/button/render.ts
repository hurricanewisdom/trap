import { botId, editMessage, getMessage } from "../../../core/discord.js";
import { buttonsOn, type ResponseButton } from "./store.js";

/** Every response button's custom id starts with this. */
export const PREFIX = "rb:";

interface Row {
  type: number;
  components?: { custom_id?: string; customId?: string }[];
}

/**
 * Whether an action row belongs to this feature.
 *
 * Only a row made entirely of our own buttons counts. A row we did not write is
 * left exactly where it was, which is what stops a re-render eating a
 * pagination control or anything else living on the same message.
 */
function ours(component: Row): boolean {
  if (component.type !== 1) return false;
  const inside = component.components ?? [];
  return (
    inside.length > 0 &&
    inside.every((one) => String(one.custom_id ?? one.customId ?? "").startsWith(PREFIX))
  );
}

function rowsFor(buttons: ResponseButton[]): unknown[] {
  const rows: unknown[] = [];
  for (let at = 0; at < buttons.length; at += 5) {
    rows.push({
      type: 1,
      components: buttons.slice(at, at + 5).map((one) => ({
        type: 2,
        style: one.style,
        custom_id: `${PREFIX}${one.id}`,
        ...(one.label ? { label: one.label } : {}),
        ...(one.emoji ? { emoji: emojiFor(one.emoji) } : {}),
      })),
    });
  }
  return rows;
}

/** A custom emoji goes as id, a standard one as name. */
export function emojiFor(raw: string): { id?: string; name?: string; animated?: boolean } {
  const custom = /^<(a?):([\w~]+):(\d{15,25})>$/.exec(raw.trim());
  if (custom) return { id: custom[3] as string, name: custom[2] as string, animated: custom[1] === "a" };
  return { name: raw.trim() };
}

export type RenderResult =
  | { ok: true; count: number }
  | { ok: false; why: string };

/**
 * Puts the message's buttons back on it.
 *
 * ⚠️ The components array is rewritten, and on a Components V2 message that
 * array *is* the message: replacing it wholesale would delete the text. So the
 * existing components are read back and everything that is not ours is kept in
 * place, with our rows appended after.
 */
export async function render(channelId: string, messageId: string): Promise<RenderResult> {
  const message = await getMessage(channelId, messageId);
  if (!message) return { ok: false, why: "I cannot see that message any more." };

  if (message.author?.id && String(message.author.id) !== botId()) {
    return { ok: false, why: "Buttons can only go on a message I posted myself." };
  }

  const buttons = await buttonsOn(messageId);
  const existing = (message.components ?? []) as Row[];
  const foreign = existing.filter((component) => !ours(component));

  if (foreign.length + Math.ceil(buttons.length / 5) > 5) {
    return {
      ok: false,
      why: "That message has no room left; Discord allows five rows in total.",
    };
  }

  const written = await editMessage(channelId, messageId, {
    components: [...foreign, ...rowsFor(buttons)],
    // A V2 message must keep its flag or Discord rejects the edit.
    ...(typeof message.flags === "number" ? { flags: message.flags } : {}),
  });

  if (!written.ok) return { ok: false, why: written.message || "Discord refused the edit." };
  return { ok: true, count: buttons.length };
}
