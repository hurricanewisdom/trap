/**
 * Runtime hooks this cog needs beyond plain commands:
 *
 *  - reactions on a now-playing post become scoreboard votes
 *  - a member's own command word resolves to their now playing
 */

import { onReactionAdd, onReactionRemove, onUnmatchedCommand } from "../../core/hooks.js";
import { redis } from "../../core/redis.js";
import { recordVote, removeVote } from "./commands/board.js";
import { npOwnerKey, nowPlayingHandler } from "./commands/nowplaying.js";
import { findCustomCommand } from "./commands/customcommand.js";
import { resolveReactions } from "./settings.js";

/**
 * Maps a reaction to a vote; 0 means "not a vote".
 *
 * The up/down emoji are configurable per user and per server, so the pair is
 * resolved from whoever posted the card. The Redis marker written by ,np keeps
 * the common case — a reaction on any other message — off the database.
 */
async function voteFor(
  messageId: string,
  emojiName: string | undefined,
  guildId: string,
): Promise<number> {
  if (!emojiName) return 0;
  const owner = await redis.get(npOwnerKey(messageId)).catch(() => null);
  if (!owner) return 0;

  const { upvote, downvote } = await resolveReactions(owner, guildId);
  if (emojiName === upvote) return 1;
  if (emojiName === downvote) return -1;
  return 0;
}

export function registerLastfmHooks(): void {
  onReactionAdd(async ({ messageId, userId, emoji, guildId }) => {
    if (!guildId) return;
    const vote = await voteFor(messageId, emoji, guildId);
    if (vote === 0) return;
    await recordVote(messageId, userId, vote);
  });

  onReactionRemove(async ({ messageId, userId, emoji, guildId }) => {
    if (!guildId) return;
    if ((await voteFor(messageId, emoji, guildId)) === 0) return;
    await removeVote(messageId, userId);
  });

  onUnmatchedCommand(async (name, ctx) => {
    if (!ctx.guildId) return null;

    const custom = await findCustomCommand(ctx.guildId, name);
    // A private alias only works for its owner.
    if (!custom || (!custom.isPublic && custom.discordId !== ctx.authorId)) return null;

    // The alias always shows its owner's listening, whoever ran it.
    return async (invocation) =>
      await nowPlayingHandler({ ...invocation, argument: `<@${custom.discordId}>` });
  });
}
