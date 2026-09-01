import { deleteMessage, deleteWebhook, dmUser, getGuild } from "../../../core/discord.js";
import { onMessage, type MessageEvent } from "../../../core/hooks.js";
import { recordProtection, took } from "../../../core/protection.js";
import { settingsFor } from "./store.js";

/**
 * Mass-mention spam sent through a webhook.
 *
 * This is the one antinuke module with nobody to punish. A webhook has no
 * member behind it — its token is a bearer credential, and the person who made
 * it is usually the victim of the leak rather than the one using it. So the
 * webhook is destroyed and the message removed, and no user is touched.
 */

// An @everyone from a webhook is the classic payload, so it weighs as much as a
// whole threshold on its own: at the default of five, one is enough.
function weightOf(event: MessageEvent, threshold: number): number {
  return (event.mentions ?? 0) + (event.mentionsEveryone ? threshold : 0);
}

// Offences per webhook, so a webhook that is deleted mid-burst does not have
// every remaining message counted separately in the log.
const handled = new Set<string>();

async function police(event: MessageEvent): Promise<void> {
  // Cheapest possible check first: this runs on every message in every server.
  if (!event.webhookId || !event.guildId) return;

  const began = Date.now();

  const settings = await settingsFor(event.guildId);
  const watch = settings.modules.webhookspam;
  if (!watch.on) return;

  // An announcement channel is the one place a webhook mass-mention is somebody
  // doing their job, so it is checked before anything is deleted.
  if (settings.spamExempt.has(event.channelId)) return;

  const weight = weightOf(event, watch.threshold);
  if (weight < watch.threshold) return;

  // The message goes whether or not the webhook can be removed: the mentions
  // have already fired, but leaving the post up keeps the damage on screen.
  await deleteMessage(event.channelId, event.messageId).catch(() => undefined);

  if (handled.has(event.webhookId)) return;
  handled.add(event.webhookId);
  // Long enough that a burst through one webhook is logged once, short enough
  // that the set cannot grow without bound.
  setTimeout(() => handled.delete(event.webhookId as string), 60_000).unref?.();

  const gone = await deleteWebhook(
    event.webhookId,
    "antinuke: mass-mention spam through this webhook",
  );

  const counted = event.mentions ?? 0;
  const detail =
    [
      event.mentionsEveryone ? "@everyone" : null,
      counted ? `${counted} mention${counted === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" and ") + " through a webhook";
  const outcome = gone.ok
    ? "webhook deleted"
    : `could not delete the webhook (${gone.message.slice(0, 60)})`;

  const spent = took(began);
  const guild = await getGuild(event.guildId);
  if (guild?.owner_id) {
    await dmUser(guild.owner_id, {
      flags: 1 << 15,
      components: [
        {
          type: 17,
          components: [
            {
              type: 10,
              content: [
                "### Antinuke tripped",
                `-# webhook \`${event.webhookId}\` in **${guild.name ?? event.guildId}**`,
                `-# ${detail} in <#${event.channelId}>`,
                `-# ${outcome} — **acted in ${spent}**`,
                "-# No member was punished: a webhook has none behind it.",
              ].join("\n"),
            },
          ],
        },
      ],
    }).catch(() => undefined);
  }

  recordProtection({
    guildId: event.guildId,
    source: "antinuke:webhookspam",
    actor: event.webhookId,
    detail,
    outcome,
    tookMs: Date.now() - began,
  });
}

export function registerSpam(): void {
  onMessage(police);
}

export { weightOf };
