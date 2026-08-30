import { eventBlocked } from "./availability.js";
import type { PrefixContext, PrefixHandler } from "./prefix.js";

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

export interface MessageEvent {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  content: string;
  attachments: { contentType?: string; filename?: string }[];
}

export type MessageHandler = (event: MessageEvent) => Promise<void>;

interface Named<T> {
  handler: T;
  event?: string;
}

const messages: Named<MessageHandler>[] = [];

export function onMessage(handler: MessageHandler, event?: string): void {
  messages.push({ handler, event });
}

export async function emitMessage(event: MessageEvent): Promise<void> {
  for (const held of messages) {
    try {
      if (held.event && (await eventBlocked(event.guildId, event.channelId, held.event))) continue;
      await held.handler(event);
    } catch (err) {
      console.error("message handler failed:", err);
    }
  }
}

export interface DeletedMessageEvent {
  guildId: string;
  channelId: string;
  messageId: string;
}

export interface EditedMessageEvent {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  content: string;
}

export type DeletedMessageHandler = (event: DeletedMessageEvent) => Promise<void>;

export type EditedMessageHandler = (event: EditedMessageEvent) => Promise<void>;

const deletions: DeletedMessageHandler[] = [];

const edits: EditedMessageHandler[] = [];

export function onMessageDelete(handler: DeletedMessageHandler): void {
  deletions.push(handler);
}

export function onMessageEdit(handler: EditedMessageHandler): void {
  edits.push(handler);
}

export async function emitMessageDelete(event: DeletedMessageEvent): Promise<void> {
  if (!event.guildId || !event.messageId) return;
  for (const handler of deletions) {
    try {
      await handler(event);
    } catch (err) {
      console.error("delete handler failed:", err);
    }
  }
}

export async function emitMessageEdit(event: EditedMessageEvent): Promise<void> {
  if (!event.guildId || !event.messageId) return;
  for (const handler of edits) {
    try {
      await handler(event);
    } catch (err) {
      console.error("edit handler failed:", err);
    }
  }
}

export interface MemberEvent {
  guildId: string;
  userId: string;
}

export type MemberHandler = (event: MemberEvent) => Promise<void>;

const joins: MemberHandler[] = [];

const leaves: MemberHandler[] = [];

export function onMemberJoin(handler: MemberHandler): void {
  joins.push(handler);
}

export function onMemberLeave(handler: MemberHandler): void {
  leaves.push(handler);
}

async function fire(handlers: MemberHandler[], event: MemberEvent): Promise<void> {
  if (!event.guildId || !event.userId) return;
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (err) {
      console.error("member handler failed:", err);
    }
  }
}

export function emitMemberJoin(event: MemberEvent): Promise<void> {
  return fire(joins, event);
}

export function emitMemberLeave(event: MemberEvent): Promise<void> {
  return fire(leaves, event);
}

export interface BoostEvent {
  guildId: string;
  channelId: string;
  userId: string;
}

export type BoostHandler = (event: BoostEvent) => Promise<void>;

const boosts: BoostHandler[] = [];

export function onBoost(handler: BoostHandler): void {
  boosts.push(handler);
}

export async function emitBoost(event: BoostEvent): Promise<void> {
  if (!event.guildId || !event.userId) return;
  for (const handler of boosts) {
    try {
      await handler(event);
    } catch (err) {
      console.error("boost handler failed:", err);
    }
  }
}

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

export async function dispatchComponent(customId: string, interaction: any): Promise<boolean> {
  return await dispatch(components, customId, interaction);
}

export async function dispatchModal(customId: string, interaction: any): Promise<boolean> {
  return await dispatch(modals, customId, interaction);
}

async function dispatch(
  claims: Claim[],
  customId: string,
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

export interface ReactionEvent {
  messageId: string;
  channelId: string;
  guildId?: string;
  userId: string;
  emoji?: string;
}

export type ReactionHandler = (event: ReactionEvent) => Promise<void>;

const reactionAdds: Named<ReactionHandler>[] = [];
const reactionRemoves: Named<ReactionHandler>[] = [];

export function onReactionAdd(handler: ReactionHandler, event?: string): void {
  reactionAdds.push({ handler, event });
}

export function onReactionRemove(handler: ReactionHandler, event?: string): void {
  reactionRemoves.push({ handler, event });
}

async function fireReaction(held: Named<ReactionHandler>[], event: ReactionEvent): Promise<void> {
  for (const one of held) {
    if (one.event && (await eventBlocked(event.guildId, event.channelId, one.event))) continue;
    await one.handler(event);
  }
}

export async function emitReactionAdd(event: ReactionEvent): Promise<void> {
  await fireReaction(reactionAdds, event);
}

export async function emitReactionRemove(event: ReactionEvent): Promise<void> {
  await fireReaction(reactionRemoves, event);
}
