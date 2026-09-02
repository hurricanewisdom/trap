import { botId, editMessage, getMessage } from "../../../core/discord.js";
import { buttonsOn, type ResponseButton } from "./store.js";

/** Every response button's custom id starts with this. */
export const PREFIX = "rb:";

interface Row {
  type: number;
  components?: { custom_id?: string; customId?: string }[];
}

/**
 * Whether an action row belongs to the feature that owns `prefix`.
 *
 * Only a row made entirely of that feature's own buttons counts. A row written
 * by anything else is left exactly where it was, which is what stops one
 * feature's re-render eating another's controls -- response buttons and button
 * roles live on the same messages and each treats the other as foreign.
 */
function ours(component: Row, prefix: string): boolean {
  if (component.type !== 1) return false;
  const inside = component.components ?? [];
  return (
    inside.length > 0 &&
    inside.every((one) => String(one.custom_id ?? one.customId ?? "").startsWith(prefix))
  );
}

/** A custom emoji goes as id, a standard one as name. */
export function emojiFor(raw: string): { id?: string; name?: string; animated?: boolean } {
  const custom = /^<(a?):([\w~]+):(\d{15,25})>$/.exec(raw.trim());
  if (custom) return { id: custom[3] as string, name: custom[2] as string, animated: custom[1] === "a" };
  return { name: raw.trim() };
}

export interface Face {
  id: string;
  style: number;
  emoji: string | null;
  label: string | null;
}

/** Five to a row, which is Discord's limit for an action row. */
export function rowsFor(faces: Face[], prefix: string): unknown[] {
  const rows: unknown[] = [];
  for (let at = 0; at < faces.length; at += 5) {
    rows.push({
      type: 1,
      components: faces.slice(at, at + 5).map((one) => ({
        type: 2,
        style: one.style,
        custom_id: `${prefix}${one.id}`,
        ...(one.label ? { label: one.label } : {}),
        ...(one.emoji ? { emoji: emojiFor(one.emoji) } : {}),
      })),
    });
  }
  return rows;
}

export type RenderResult =
  | { ok: true; count: number }
  | { ok: false; why: string };

/**
 * Puts one feature's components back on a message.
 *
 * ⚠️ The components array is rewritten, and on a Components V2 message that
 * array *is* the message: replacing it wholesale would delete the text. So the
 * existing components are read back, everything that is not ours is kept, and
 * our rows go back where ours used to be rather than on the end -- otherwise
 * two features rendering in turn would swap places with each other every time.
 */
export async function applyComponents(
  channelId: string,
  messageId: string,
  prefix: string,
  mine: unknown[],
): Promise<RenderResult> {
  const message = await getMessage(channelId, messageId);
  if (!message) return { ok: false, why: "I cannot see that message any more." };

  if (message.author?.id && String(message.author.id) !== botId()) {
    return { ok: false, why: "Buttons can only go on a message I posted myself." };
  }

  const existing = (message.components ?? []) as Row[];
  const at = existing.findIndex((component) => ours(component, prefix));
  const kept = existing.filter((component) => !ours(component, prefix));
  const spot = at < 0 ? kept.length : Math.min(at, kept.length);

  if (kept.length + mine.length > 5) {
    return { ok: false, why: "That message has no room left; Discord allows five rows in total." };
  }

  const next = [...kept.slice(0, spot), ...mine, ...kept.slice(spot)];
  const written = await editMessage(channelId, messageId, {
    components: next,
    // A V2 message must keep its flag or Discord rejects the edit.
    ...(typeof message.flags === "number" ? { flags: message.flags } : {}),
  });

  if (!written.ok) return { ok: false, why: written.message || "Discord refused the edit." };
  return { ok: true, count: mine.length };
}

/** The button-shaped convenience: build the rows, then apply them. */
export async function applyRows(
  channelId: string,
  messageId: string,
  prefix: string,
  faces: Face[],
): Promise<RenderResult> {
  const done = await applyComponents(channelId, messageId, prefix, rowsFor(faces, prefix));
  return done.ok ? { ok: true, count: faces.length } : done;
}

export async function render(channelId: string, messageId: string): Promise<RenderResult> {
  const buttons: ResponseButton[] = await buttonsOn(messageId);
  return applyRows(channelId, messageId, PREFIX, buttons);
}
