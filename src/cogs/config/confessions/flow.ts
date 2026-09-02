import { memberOf, sendMessage } from "../../../core/discord.js";
import { onComponent, onModal } from "../../../core/hooks.js";
import {
  attachMessage,
  confessionById,
  drop,
  lastSubmission,
  listOf,
  record,
  settings,
  type Settings,
} from "./store.js";

export const SUBMIT = "cfs:submit";

export const SUBMIT_MODAL = "cfsm:";

export const REPLY = "cfs:reply:";

export const REPLY_MODAL = "cfsrm:";

export const REVIEW = "cfs:review:";

const LINK = /https?:\/\/\S+|discord\.gg\/\S+|www\.\S+\.\S+/i;

/**
 * An image can only ever reach a confession as a link.
 *
 * A Discord modal has text inputs and nothing else -- there is no attachment
 * field to allow or refuse -- so `confessions images` governs this instead. It
 * is checked separately from the link setting, which makes "links yes, images
 * no" a combination that means something.
 */
const IMAGE_LINK = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|avif|heic)(?:\?\S*)?/i;

/** Discord's own ceiling for a modal paragraph. */
export const CONFESSION_LIMIT = 1000;

export function submitRow(one: Settings): unknown[] {
  if (!one.buttonLabel) return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: one.buttonStyle, custom_id: SUBMIT, label: one.buttonLabel },
      ],
    },
  ];
}

function replyRow(one: Settings, id: string): unknown[] {
  if (!one.replyButtonLabel) return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: one.replyButtonStyle, custom_id: `${REPLY}${id}`, label: one.replyButtonLabel },
      ],
    },
  ];
}

function modal(customId: string, title: string, label: string): unknown {
  return {
    title,
    custom_id: customId,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "body",
            label,
            style: 2,
            min_length: 1,
            max_length: CONFESSION_LIMIT,
            required: true,
          },
        ],
      },
    ],
  };
}

function typed(interaction: any): string {
  const rows = (interaction.data?.components ?? []) as any[];
  return String(rows[0]?.components?.[0]?.value ?? "").trim();
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (whole, name: string) => {
    const held = values[String(name).toLowerCase()];
    return held === undefined ? whole : String(held);
  });
}

/**
 * Everything that can stop a confession, in the order it is cheapest to check.
 *
 * Returns the reason to show the member, or null to let it through. Each answer
 * says what is wrong without saying anything about anybody else's confession.
 */
async function refuse(
  guildId: string,
  userId: string,
  content: string,
  one: Settings,
): Promise<string | null> {
  const member = await memberOf(guildId, userId);

  const blacklist = await listOf(guildId, "blacklist");
  if (blacklist.includes(userId) || (member?.roles ?? []).some((id) => blacklist.includes(id))) {
    return "You are not allowed to submit confessions here.";
  }

  if (one.minAccountAgeMs !== null) {
    // The account's age comes out of its own snowflake, so no extra call.
    const made = Number(BigInt(userId) >> 22n) + 1420070400000;
    if (Date.now() - made < one.minAccountAgeMs) {
      return "Your account is too new to submit a confession here.";
    }
  }

  if (one.cooldownMs !== null) {
    const last = await lastSubmission(guildId, userId);
    if (last && Date.now() - last.getTime() < one.cooldownMs) {
      const left = Math.ceil((one.cooldownMs - (Date.now() - last.getTime())) / 1000);
      return `You are on cooldown. Try again in ${left > 60 ? `${Math.ceil(left / 60)} minutes` : `${left} seconds`}.`;
    }
  }

  if (!one.allowImages && IMAGE_LINK.test(content)) {
    return "Confessions here cannot contain images.";
  }

  if (!one.allowLinks && LINK.test(content)) return "Confessions here cannot contain links.";

  if (one.filterOn) {
    const words = await listOf(guildId, "word");
    const haystack = content.toLowerCase();
    const hit = words.find((word) => haystack.includes(word.toLowerCase()));
    if (hit) return "Your confession contains a word this server filters.";
  }

  return null;
}

async function post(guildId: string, one: Settings, id: string): Promise<void> {
  const held = await confessionById(id);
  if (!held || !one.channelId) return;

  const pings = await listOf(guildId, "ping");
  const body = fill(one.template, { number: held.number, content: held.content });

  const sent = await sendMessage(one.channelId, {
    content: [pings.map((role) => `<@&${role}>`).join(" "), body].filter(Boolean).join("\n"),
    allowed_mentions: { roles: pings },
    components: replyRow(one, held.id),
  });

  if (sent.ok) await attachMessage(id, sent.data.id);

  if (one.logChannelId) {
    // The log is the only place the author is named, which is the point of it.
    await sendMessage(one.logChannelId, {
      content: `Confession **#${held.number}** by <@${held.userId}> (${held.userId})\n>>> ${held.content.slice(0, 1500)}`,
      allowed_mentions: { parse: [] },
    });
  }
}

export function watchConfessions(): void {
  onComponent(SUBMIT, async (interaction: any) => {
    await interaction.respond(modal(`${SUBMIT_MODAL}x`, "Submit a confession", "Your confession"));
  });

  onModal(SUBMIT_MODAL, async (interaction: any) => {
    const guildId = String(interaction.guildId ?? "");
    const userId = String(interaction.user?.id ?? interaction.member?.id ?? "");
    const content = typed(interaction);
    if (!guildId || !userId || !content) return;

    const one = await settings(guildId);
    if (!one.channelId) {
      await interaction.respond(
        { content: "Confessions are not set up here yet." },
        { isPrivate: true },
      );
      return;
    }

    const no = await refuse(guildId, userId, content, one);
    if (no) {
      await interaction.respond({ content: no }, { isPrivate: true });
      return;
    }

    const held = await record(guildId, userId, content);

    if (one.reviewChannelId) {
      const pings = await listOf(guildId, "review_ping");
      await sendMessage(one.reviewChannelId, {
        content: [
          pings.map((role) => `<@&${role}>`).join(" "),
          `**Confession #${held.number}** awaiting review`,
          // `anonymous` decides whether the reviewers see who wrote it. The log
          // channel still records it either way.
          one.anonymous ? "-# Submitted anonymously." : `-# From <@${held.userId}>.`,
          `>>> ${held.content}`,
        ]
          .filter(Boolean)
          .join("\n"),
        allowed_mentions: { roles: pings },
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 3, custom_id: `${REVIEW}ok:${held.id}`, label: "Approve" },
              { type: 2, style: 4, custom_id: `${REVIEW}no:${held.id}`, label: "Deny" },
            ],
          },
        ],
      });

      await interaction.respond(
        { content: `Sent for review as **#${held.number}**.` },
        { isPrivate: true },
      );
      return;
    }

    await post(guildId, one, held.id);
    await interaction.respond(
      { content: `Posted as confession **#${held.number}**.` },
      { isPrivate: true },
    );
  });

  onComponent(REVIEW, async (interaction: any) => {
    const raw = String(interaction.data?.customId ?? "").slice(REVIEW.length);
    const [verdict, id] = raw.split(":");
    const guildId = String(interaction.guildId ?? "");
    if (!id || !guildId) return;

    const held = await confessionById(id);
    if (!held) {
      await interaction.respond({ content: "That confession is gone." }, { isPrivate: true });
      return;
    }

    if (verdict === "no") {
      await drop(id);
      await interaction.edit({
        content: `**Confession #${held.number}** was denied by <@${interaction.user?.id}>.`,
        components: [],
      });
      return;
    }

    await post(guildId, await settings(guildId), id);
    await interaction.edit({
      content: `**Confession #${held.number}** was approved by <@${interaction.user?.id}>.`,
      components: [],
    });
  });

  onComponent(REPLY, async (interaction: any) => {
    const id = String(interaction.data?.customId ?? "").slice(REPLY.length);
    await interaction.respond(modal(`${REPLY_MODAL}${id}`, "Reply", "Your reply"));
  });

  onModal(REPLY_MODAL, async (interaction: any) => {
    const id = String(interaction.data?.customId ?? "").slice(REPLY_MODAL.length);
    const guildId = String(interaction.guildId ?? "");
    const userId = String(interaction.user?.id ?? interaction.member?.id ?? "");
    const content = typed(interaction);
    if (!guildId || !id || !content) return;

    const one = await settings(guildId);
    const held = await confessionById(id);
    if (!held || !one.channelId) {
      await interaction.respond({ content: "That confession is gone." }, { isPrivate: true });
      return;
    }

    // A reply goes through the same gauntlet as a confession. Without that the
    // reply button is a way around every check on the submit button.
    const no = await refuse(guildId, userId, content, one);
    if (no) {
      await interaction.respond({ content: no }, { isPrivate: true });
      return;
    }

    const sent = await sendMessage(one.channelId, {
      content: fill(one.replyTemplate, { number: held.number, content }),
      allowed_mentions: { parse: [] },
      ...(held.messageId ? { message_reference: { message_id: held.messageId, fail_if_not_exists: false } } : {}),
    });

    if (one.logChannelId) {
      await sendMessage(one.logChannelId, {
        content: `Reply to **#${held.number}** by <@${userId}> (${userId})\n>>> ${content.slice(0, 1500)}`,
        allowed_mentions: { parse: [] },
      });
    }

    await interaction.respond(
      { content: sent.ok ? "Your reply was posted." : "That could not be posted." },
      { isPrivate: true },
    );
  });
}
