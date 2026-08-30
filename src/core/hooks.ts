/**
 * Extension points cogs plug into.
 *
 * The dispatcher in `src/index.ts` only knows about these registries, so core
 * never imports a cog. A feature that needs to see raw reactions, claim a
 * component id, or catch commands nobody else matched registers here instead.
 */

import type { PrefixContext, PrefixHandler } from "./prefix.js";

/* ------------------------------------------------------------------ */
/* Unmatched prefix commands                                           */
/* ------------------------------------------------------------------ */

/**
 * Called when no registered command matches. Return a handler to claim the
 * invocation, or null to ignore it. Used for user-defined command words.
 */
export type FallbackResolver = (
  name: string,
  ctx: Omit<PrefixContext, "argument">,
) => Promise<PrefixHandler | null>;

const fallbacks: FallbackResolver[] = [];

export function onUnmatchedCommand(resolver: FallbackResolver): void {
  fallbacks.push(resolver);
}

export async function resolveFallback(
  name: string,
  ctx: Omit<PrefixContext, "argument">,
): Promise<PrefixHandler | null> {
  for (const resolver of fallbacks) {
    const handler = await resolver(name, ctx);
    if (handler) return handler;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Component and modal interactions                                    */
/* ------------------------------------------------------------------ */

/**
 * Interactions are routed by custom-id prefix, so each cog owns its own
 * namespace and they cannot collide silently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InteractionHandler = (interaction: any) => Promise<void>;

interface Claim {
  prefix: string;
  handler: InteractionHandler;
}

const components: Claim[] = [];
const modals: Claim[] = [];

export function onComponent(prefix: string, handler: InteractionHandler): void {
  components.push({ prefix, handler });
}

export function onModal(prefix: string, handler: InteractionHandler): void {
  modals.push({ prefix, handler });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchComponent(customId: string, interaction: any): Promise<boolean> {
  return await dispatch(components, customId, interaction);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchModal(customId: string, interaction: any): Promise<boolean> {
  return await dispatch(modals, customId, interaction);
}

async function dispatch(
  claims: Claim[],
  customId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interaction: any,
): Promise<boolean> {
  for (const claim of claims) {
    if (customId.startsWith(claim.prefix)) {
      await claim.handler(interaction);
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

export interface ReactionEvent {
  messageId: string;
  channelId: string;
  guildId?: string;
  userId: string;
  emoji?: string;
}

export type ReactionHandler = (event: ReactionEvent) => Promise<void>;

const reactionAdds: ReactionHandler[] = [];
const reactionRemoves: ReactionHandler[] = [];

export function onReactionAdd(handler: ReactionHandler): void {
  reactionAdds.push(handler);
}

export function onReactionRemove(handler: ReactionHandler): void {
  reactionRemoves.push(handler);
}

export async function emitReactionAdd(event: ReactionEvent): Promise<void> {
  for (const handler of reactionAdds) await handler(event);
}

export async function emitReactionRemove(event: ReactionEvent): Promise<void> {
  for (const handler of reactionRemoves) await handler(event);
}
