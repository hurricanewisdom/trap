import { addReaction, botId, sendMessage, startThread } from "../../../core/discord.js";
import { onMessage, type MessageEvent } from "../../../core/hooks.js";
import { render } from "../greetings/variables.js";
import { allThreads } from "./store.js";

/**
 * A thread already exists on that message.
 *
 * Discord answers 400 with this code rather than handing back the thread, and
 * it is the ordinary outcome of a restart replaying nothing, a double event, or
 * somebody having threaded the message by hand. It is not worth logging.
 */
const ALREADY_THREADED = "THREAD_ALREADY_CREATED";

async function make(event: MessageEvent): Promise<void> {
  const held = await allThreads(event.guildId);
  if (held.size === 0) return;

  const config = held.get(event.channelId);
  if (!config) return;

  // The bot's own messages are skipped, so a script posted into a thread and
  // every command reply in the channel stay unthreaded.
  if (event.authorId === botId()) return;

  const name = await render(config.name, {
    guildId: event.guildId,
    channelId: event.channelId,
    userId: event.authorId,
  });

  const made = await startThread(event.channelId, event.messageId, name.trim() || "Thread", {
    autoArchiveMinutes: config.archiveMinutes,
    slowmodeSeconds: config.slowmodeSeconds,
  });

  if (!made.ok) {
    if (!(made.message ?? "").includes(ALREADY_THREADED)) {
      console.error(`autothread: ${event.channelId} -> ${made.status} ${made.message ?? ""}`);
    }
    return;
  }

  // Reactions go on the message that was threaded, not inside the thread: the
  // point is to mark the original as having one.
  for (const emoji of config.reactions) {
    await addReaction(event.channelId, event.messageId, emoji);
  }

  if (config.script) {
    const body = await render(config.script, {
      guildId: event.guildId,
      channelId: event.channelId,
      userId: event.authorId,
    });
    if (body.trim()) await sendMessage(made.data.id, { content: body.slice(0, 2000) });
  }
}

export function watchForThreads(): void {
  // Named, so `,disableevent #channel autothread` can switch it off in one
  // channel without unconfiguring it.
  onMessage(make, "autothread");
}
