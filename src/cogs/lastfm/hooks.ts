import { onReactionAdd, onReactionRemove, onUnmatchedCommand } from "../../core/hooks.js";
import { redis } from "../../core/redis.js";
import { recordVote, removeVote } from "./commands/board.js";
import { npOwnerKey, nowPlayingHandler } from "./commands/nowplaying.js";
import { findCustomCommand } from "./commands/customcommand.js";
import { resolveReactions } from "./settings.js";

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
  }, "reactions");

  onReactionRemove(async ({ messageId, userId, emoji, guildId }) => {
    if (!guildId) return;
    if ((await voteFor(messageId, emoji, guildId)) === 0) return;
    await removeVote(messageId, userId);
  }, "reactions");

  onUnmatchedCommand(async (name, ctx) => {
    if (!ctx.guildId) return null;

    const custom = await findCustomCommand(ctx.guildId, name);

    if (!custom || (!custom.isPublic && custom.discordId !== ctx.authorId)) return null;

    return async (invocation) =>
      await nowPlayingHandler({ ...invocation, argument: `<@${custom.discordId}>` });
  });
}
