/**
 * Paginated Components V2 cards.
 *
 * The control row lives *inside* the container, so the buttons render as part
 * of the card rather than floating beneath it. Page state is kept in Redis
 * keyed by message id, so pagination survives a restart and expires on its own
 * instead of growing a map in memory.
 */

import { onComponent, onModal } from "./hooks.js";
import { slashifyPayload } from "../helpers/slashtext.js";
import { redis } from "./redis.js";
import type { PrefixContext } from "./prefix.js";

const TTL = 900; // 15 idle minutes per paginated message

const key = (messageId: string) => `trap:pager:${messageId}`;

/** A page is the list of components that go *inside* the container. */
export interface PagerState {
  pages: unknown[][];
  ownerId: string;
  channelId: string;
  accent: number;
  index: number;
}

export const BUTTON = {
  prev: "pg:prev",
  close: "pg:close",
  next: "pg:next",
  jump: "pg:jump",
} as const;

/**
 * Controls carry the owner id, so Close can verify and act with no stored
 * state. Only paging needs the pages themselves, and only a multi-page card
 * stores them.
 */
const withOwner = (action: string, ownerId: string) => `${action}:${ownerId}`;

function ownerOf(customId: string): string {
  return customId.split(":")[2] ?? "";
}

function actionOf(customId: string): string {
  const parts = customId.split(":");
  return `${parts[0]}:${parts[1]}`;
}

/**
 * The control row. A single-page card gets only Close, since three dead
 * controls are just noise.
 */
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

/** Wraps one page's inner components in the container plus its control row. */
export function renderPage(
  pages: unknown[][],
  index: number,
  accent: number,
  ownerId: string,
): { flags: number; components: unknown[] } {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17,
        accent_color: accent,
        components: [...(pages[index] ?? []), controls(pages.length, ownerId)],
      },
    ],
  };
}

/** Sends page one and remembers the rest. */
export async function paginate(
  ctx: PrefixContext,
  pages: unknown[][],
  accent: number,
): Promise<void> {
  if (pages.length === 0) return;

  const sent = await ctx.reply(renderPage(pages, 0, accent, ctx.authorId));
  const messageId = sent?.id ? String(sent.id) : null;
  if (!messageId || pages.length <= 1) return;

  const state: PagerState = {
    pages,
    ownerId: ctx.authorId,
    channelId: ctx.channelId,
    accent,
    index: 0,
  };
  await redis.set(key(messageId), JSON.stringify(state), "EX", TTL).catch(() => {});
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

/** Paging past either end rolls around. */
export function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export const jumpModalId = (messageId: string) => `pgjump:${messageId}`;

export function parseJumpModalId(customId: string): string | null {
  const [prefix, messageId] = customId.split(":");
  return prefix === "pgjump" && messageId ? messageId : null;
}

/** The "go to page" modal opened by the number button. */
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

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */

export interface PagerDeps {
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
}

/**
 * Claims the `pg:` component namespace and the jump modal.
 * Called once at startup, before any cog registers its own handlers.
 */
export function registerPagerInteractions(deps: PagerDeps): void {
  onComponent("pg:", (interaction) => handleButton(interaction, deps));
  onModal("pgjump:", (interaction) => handleJump(interaction));
}

/** Only the person who ran the command may drive its pages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function denyStranger(interaction: any, ownerId: string): Promise<boolean> {
  if (String(interaction.user?.id ?? "") === ownerId) return false;
  await interaction.respond(
    { content: "That menu belongs to someone else." },
    { isPrivate: true },
  );
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleButton(interaction: any, deps: PagerDeps): Promise<void> {
  const customId = String(interaction.data?.customId ?? "");
  const action = actionOf(customId);
  const owner = ownerOf(customId);
  const messageId = interaction.message?.id ? String(interaction.message.id) : null;
  if (!messageId) return;

  // Close needs nothing but the owner, so it keeps working on a single-page
  // card, which never stores state, and after the state has expired.
  if (action === BUTTON.close) {
    if (owner && String(interaction.user?.id ?? "") !== owner) {
      await interaction.respond({ content: "That menu belongs to someone else." }, { isPrivate: true });
      return;
    }
    await dropState(messageId);
    await interaction.deferEdit();
    await deps.deleteMessage(String(interaction.channelId), messageId);
    return;
  }

  const state = await loadState(messageId);
  if (!state) {
    await interaction.respond({ content: "That menu has expired." }, { isPrivate: true });
    return;
  }
  if (await denyStranger(interaction, state.ownerId)) return;

  if (action === BUTTON.jump) {
    await interaction.respond(jumpModal(messageId, state.pages.length));
    return;
  }

  state.index = wrap(state.index + (action === BUTTON.next ? 1 : -1), state.pages.length);
  await saveState(messageId, state);
  await interaction.edit(slashifyPayload(renderPage(state.pages, state.index, state.accent, state.ownerId)));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleJump(interaction: any): Promise<void> {
  const messageId = parseJumpModalId(String(interaction.data?.customId ?? ""));
  if (!messageId) return;

  const state = await loadState(messageId);
  if (!state) {
    await interaction.respond({ content: "That menu has expired." }, { isPrivate: true });
    return;
  }
  if (await denyStranger(interaction, state.ownerId)) return;

  // The typed value sits one level down, inside the modal's action row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  await interaction.edit(slashifyPayload(renderPage(state.pages, state.index, state.accent, state.ownerId)));
}
