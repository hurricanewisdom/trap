import { onComponent, onModal } from "./hooks.js";
import { resolveAccent } from "./accent.js";
import { keepAlive } from "./expiry.js";
import { redis } from "./redis.js";
import type { PrefixContext } from "./prefix.js";
import { accented } from "../helpers/components.js";

const TTL = 900;

const key = (messageId: string) => `trap:pager:${messageId}`;

export interface PagerState {
  pages: unknown[][];
  ownerId: string;
  channelId: string;
  accent: number | null;
  index: number;
}

export const BUTTON = {
  prev: "pg:prev",
  close: "pg:close",
  next: "pg:next",
  jump: "pg:jump",
} as const;

const withOwner = (action: string, ownerId: string) => `${action}:${ownerId}`;

function ownerOf(customId: string): string {
  return customId.split(":")[2] ?? "";
}

function actionOf(customId: string): string {
  const parts = customId.split(":");
  return `${parts[0]}:${parts[1]}`;
}

export function controls(pageCount: number, ownerId: string): unknown {
  const close = {
    type: 2,
    style: 2,
    custom_id: withOwner(BUTTON.close, ownerId),
    label: "Close",
  };
  if (pageCount <= 1) return { type: 1, components: [close] };
  return {
    type: 1,
    components: [
      { type: 2, style: 2, custom_id: withOwner(BUTTON.prev, ownerId), label: "Back" },
      { type: 2, style: 2, custom_id: withOwner(BUTTON.next, ownerId), label: "Next" },
      { type: 2, style: 2, custom_id: withOwner(BUTTON.jump, ownerId), label: "Page" },
      close,
    ],
  };
}

export const IS_COMPONENTS_V2 = 1 << 15;

export function renderPage(
  pages: unknown[][],
  index: number,
  accent: number | null,
  ownerId: string,
): { flags: number; components: unknown[] } {
  const body = [...(pages[index] ?? []), controls(pages.length, ownerId)];
  return {
    flags: IS_COMPONENTS_V2,
    components: [accented({ type: 17, components: body }, accent)],
  };
}

// Snowflakes arrive as a bigint from the library and as a string from the REST
// helpers, and both have to be accepted or one of the two callers will not fit.
export type PagerSend = (body: {
  flags: number;
  components: unknown[];
}) => Promise<{ id?: string | number | bigint } | null | undefined>;

// Not everything that pages is a reply to a command. The reposter pages a photo
// post nobody asked for by name, so the send is passed in rather than taken from
// a command context. Returns the message id, or null if nothing was posted.
export async function paginateWith(
  send: PagerSend,
  channelId: string,
  ownerId: string,
  pages: unknown[][],
  accent: number | null,
): Promise<string | null> {
  if (pages.length === 0) return null;

  const settled = resolveAccent(accent);
  const page = renderPage(pages, 0, settled, ownerId);
  const sent = await send(page);
  const messageId = sent?.id ? String(sent.id) : null;
  if (!messageId) return null;

  keepAlive(channelId, messageId, page.components as unknown[]);
  if (pages.length <= 1) return messageId;

  const state: PagerState = { pages, ownerId, channelId, accent: settled, index: 0 };
  await redis.set(key(messageId), JSON.stringify(state), "EX", TTL).catch(() => {});
  return messageId;
}

export async function paginate(
  ctx: PrefixContext,
  pages: unknown[][],
  accent: number | null,
): Promise<void> {
  await paginateWith((body) => ctx.reply(body), ctx.channelId, ctx.authorId, pages, accent);
}

export async function loadState(messageId: string): Promise<PagerState | null> {
  try {
    const raw = await redis.get(key(messageId));
    return raw ? (JSON.parse(raw) as PagerState) : null;
  } catch {
    return null;
  }
}

export async function saveState(messageId: string, state: PagerState): Promise<void> {
  await redis.set(key(messageId), JSON.stringify(state), "EX", TTL).catch(() => {});
}

export async function dropState(messageId: string): Promise<void> {
  await redis.del(key(messageId)).catch(() => {});
}

export function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export const jumpModalId = (messageId: string) => `pgjump:${messageId}`;

export function parseJumpModalId(customId: string): string | null {
  const [prefix, messageId] = customId.split(":");
  return prefix === "pgjump" && messageId ? messageId : null;
}

export function jumpModal(messageId: string, pageCount: number): unknown {
  return {
    title: "Jump to page",
    custom_id: jumpModalId(messageId),
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "page",
            label: `Page number (1-${pageCount})`,
            style: 1,
            min_length: 1,
            max_length: 4,
            required: true,
            placeholder: String(pageCount),
          },
        ],
      },
    ],
  };
}

export interface PagerDeps {
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
}

export function registerPagerInteractions(deps: PagerDeps): void {
  onComponent("pg:", (interaction) => handleButton(interaction, deps));
  onModal("pgjump:", (interaction) => handleJump(interaction));
}

async function denyStranger(interaction: any, ownerId: string): Promise<boolean> {
  if (String(interaction.user?.id ?? "") === ownerId) return false;
  await interaction.respond(
    { content: "That menu belongs to someone else." },
    { isPrivate: true },
  );
  return true;
}

async function handleButton(interaction: any, deps: PagerDeps): Promise<void> {
  const customId = String(interaction.data?.customId ?? "");
  const action = actionOf(customId);
  const owner = ownerOf(customId);
  const messageId = interaction.message?.id ? String(interaction.message.id) : null;
  if (!messageId) return;

  if (action === BUTTON.close) {
    if (owner && String(interaction.user?.id ?? "") !== owner) {
      await interaction.respond(({ content: "That menu belongs to someone else." }), { isPrivate: true });
      return;
    }
    await dropState(messageId);
    await interaction.deferEdit();
    await deps.deleteMessage(String(interaction.channelId), messageId);
    return;
  }

  const state = await loadState(messageId);
  if (!state) {
    await interaction.respond(({ content: "That menu has expired." }), { isPrivate: true });
    return;
  }
  if (await denyStranger(interaction, state.ownerId)) return;

  if (action === BUTTON.jump) {
    await interaction.respond(jumpModal(messageId, state.pages.length));
    return;
  }

  state.index = wrap(state.index + (action === BUTTON.next ? 1 : -1), state.pages.length);
  await saveState(messageId, state);
  const rendered = renderPage(state.pages, state.index, state.accent, state.ownerId);
  await interaction.edit(rendered);
  keepAlive(state.channelId, messageId, rendered.components as unknown[]);
}

async function handleJump(interaction: any): Promise<void> {
  const messageId = parseJumpModalId(String(interaction.data?.customId ?? ""));
  if (!messageId) return;

  const state = await loadState(messageId);
  if (!state) {
    await interaction.respond(({ content: "That menu has expired." }), { isPrivate: true });
    return;
  }
  if (await denyStranger(interaction, state.ownerId)) return;

  const rows = (interaction.data?.components ?? []) as any[];
  const requested = Number.parseInt(String(rows[0]?.components?.[0]?.value ?? "").trim(), 10);

  if (!Number.isInteger(requested) || requested < 1 || requested > state.pages.length) {
    await interaction.respond(
      { content: `Pick a page between 1 and ${state.pages.length}.` },
      { isPrivate: true },
    );
    return;
  }

  state.index = requested - 1;
  await saveState(messageId, state);
  const rendered = renderPage(state.pages, state.index, state.accent, state.ownerId);
  await interaction.edit(rendered);
  keepAlive(state.channelId, messageId, rendered.components as unknown[]);
}
