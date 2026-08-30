export const IDLE_MS = 60_000;

export type MessageEditor = (
  channelId: string,
  messageId: string,
  payload: { components: unknown[] },
) => Promise<void>;

let edit: MessageEditor | null = null;

export function provideMessageEditor(editor: MessageEditor): void {
  edit = editor;
}

interface Pending {
  timer: NodeJS.Timeout;
  channelId: string;
  components: unknown[];
}

const pending = new Map<string, Pending>();

export function disableControls(components: unknown[]): unknown[] {
  const LINK_STYLE = 5;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;

    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = { ...source };
    if (Array.isArray(source.components)) out.components = source.components.map(walk);

    const isButton = source.type === 2 && source.style !== LINK_STYLE;
    const isSelect = typeof source.type === "number" && source.type >= 3 && source.type <= 8;
    if (isButton || isSelect) out.disabled = true;

    return out;
  };

  return components.map(walk);
}

export function keepAlive(channelId: string, messageId: string, components: unknown[]): void {
  if (!edit || !messageId) return;
  cancel(messageId);

  const timer = setTimeout(() => {
    pending.delete(messageId);
    const disabled = disableControls(components);

    void edit?.(channelId, messageId, { components: disabled }).catch(() => {});
  }, IDLE_MS);

  timer.unref?.();
  pending.set(messageId, { timer, channelId, components });
}

export function cancel(messageId: string): void {
  const existing = pending.get(messageId);
  if (!existing) return;
  clearTimeout(existing.timer);
  pending.delete(messageId);
}
