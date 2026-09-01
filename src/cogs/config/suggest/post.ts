import {
  addReaction,
  editMessage,
  sendMessage,
  startThread,
} from "../../../core/discord.js";
import { resolveAccent } from "../../../core/accent.js";
import { IS_COMPONENTS_V2, accented } from "../../../helpers/components.js";
import { plain } from "../../../helpers/markdown.js";
import { setPosted, type Config, type Status, type Suggestion } from "./store.js";

export const LABEL: Record<Status, string> = {
  pending: "Pending",
  considering: "In Consideration",
  progress: "In Progress",
  approved: "Approved",
  denied: "Denied",
};

export function body(one: Suggestion): string {
  const lines = [
    `### Suggestion #${one.id} · ${LABEL[one.status]}`,
    plain(one.body, 1800),
    `-# from <@${one.authorId}>`,
  ];
  if (one.reply) {
    lines.push("", `> ${plain(one.reply, 500)}`, `-# reply from <@${one.repliedBy}>`);
  }
  return lines.join("\n");
}

function payload(one: Suggestion): { flags: number; components: unknown[] } {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      accented(
        { type: 17, components: [{ type: 10, content: body(one) }] },
        resolveAccent(null),
      ),
    ],
  };
}

// Reactions are added one at a time and the order matters: they appear in the
// order they were first added, so upvote has to land before downvote.
async function vote(channelId: string, messageId: string, held: Config): Promise<void> {
  await addReaction(channelId, messageId, held.upvote);
  await addReaction(channelId, messageId, held.downvote);
}

export interface Posted {
  channelId: string;
  messageId: string;
}

// Publishes to whichever channel this suggestion belongs in — the review channel
// while it is waiting for approval, the public one once it is not.
export async function publish(
  guildId: string,
  one: Suggestion,
  held: Config,
  channelId: string,
  withExtras: boolean,
): Promise<Posted | null> {
  const sent = await sendMessage(channelId, {
    ...payload(one),
    allowed_mentions: { parse: [] },
  });
  if (!sent.ok) return null;

  const messageId = String(sent.data.id);
  let threadId: string | null = null;

  if (withExtras) {
    await vote(channelId, messageId, held);
    if (held.threads) {
      const thread = await startThread(
        channelId,
        messageId,
        `Suggestion #${one.id}`,
      );
      if (thread.ok) threadId = String(thread.data.id);
    }
  }

  await setPosted(guildId, one.id, channelId, messageId, threadId);
  return { channelId, messageId };
}

// The message is edited in place rather than reposted, so a status change keeps
// the votes and the thread that are already attached to it.
export async function refresh(one: Suggestion): Promise<boolean> {
  if (!one.channelId || !one.messageId) return false;

  const done = await editMessage(one.channelId, one.messageId, payload(one));
  return done.ok;
}
