import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { createBot, Intents, InteractionResponseTypes, InteractionTypes } from "discordeno";

import { loadCogs } from "./core/cog.js";
import { closeDb, migrate, sql } from "./core/db.js";
import {
  dispatchComponent,
  emitBoost,
  emitMemberJoin,
  emitMemberLeave,
  emitMessage,
  emitChannelPins,
  emitMessageDelete,
  emitMessageEdit,
  dispatchModal,
  resolveFallback,
  emitReactionAdd,
  emitReactionRemove,
} from "./core/hooks.js";
import { registerPagerInteractions } from "./core/pager.js";
import { lookup, split, type PrefixContext, type ReplyPayload, type SentMessage } from "./core/prefix.js";
import { commandBlocked, eventBlocked } from "./core/availability.js";
import { editedInto, forgetMessage, noteMessage } from "./core/edits.js";
import { ALWAYS_ANSWERS, isIgnored } from "./core/ignores.js";
import {
  argumentFrom,
  buildAllSlashCommands,
  resolveInvocation,
  resolveSlash,
  type ReceivedOption,
} from "./core/slash.js";
import { closeRedis, redis } from "./core/redis.js";
import { cogs } from "./cogs/index.js";
import { router, startWebServer } from "./web/server.js";
import { provideRunner } from "./core/runner.js";
import { accentFor, withAccent } from "./core/accent.js";

const LASTFM_COG = "lastfm";
import { provideMessageEditor } from "./core/expiry.js";
import { completeSlash, rememberCommandIds } from "./core/slash.js";
import { matchPrefix } from "./core/prefixes.js";

const BOOST_MESSAGES = new Set([8, 9, 10, 11]);

const JOIN_MESSAGE = 7;

const WANT_MEMBERS = process.env.GUILD_MEMBERS_INTENT === "1";

const BOOST_SEEN_TTL = 300;

async function announceBoost(guildId: string, channelId: string, userId: string): Promise<void> {
  if (!guildId || !userId) return;

  const key = `trap:boost:seen:${guildId}:${userId}`;
  try {
    const fresh = await redis.set(key, "1", "EX", BOOST_SEEN_TTL, "NX");
    if (fresh !== "OK") return;
  } catch {}

  await emitBoost({ guildId, channelId, userId });
}

async function notedBoost(guildId: string, userId: string, since: string | null): Promise<boolean> {
  const rows = await sql<{ premium_since: Date | null }[]>`
    SELECT premium_since FROM booster_state WHERE guild_id = ${guildId} AND user_id = ${userId}
  `;

  await sql`
    INSERT INTO booster_state (guild_id, user_id, premium_since, seen_at)
    VALUES (${guildId}, ${userId}, ${since}, now())
    ON CONFLICT (guild_id, user_id) DO UPDATE
      SET premium_since = EXCLUDED.premium_since, seen_at = now()
  `;

  if (rows.length === 0) return false;
  return rows[0]?.premium_since === null && since !== null;
}

const require = createRequire(import.meta.url);
const botVersion: string = require("../package.json").version;

function packageVersion(name: string): string {
  let dir = path.dirname(require.resolve(name));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.name === name) return pkg.version;
    } catch {}
    dir = path.dirname(dir);
  }
  return "unknown";
}
const libVersion = packageVersion("discordeno");

const token = process.env.DISCORD_TOKEN ?? "";
if (!token || token === "PASTE_YOUR_BOT_TOKEN_HERE" || !looksLikeBotToken(token)) {
  console.error("DISCORD_TOKEN is missing or malformed. Put a real bot token in .env and restart.");
  process.exit(78);
}

function looksLikeBotToken(t: string): boolean {
  const first = t.split(".")[0] ?? "";
  return /^\d+$/.test(Buffer.from(first, "base64").toString("utf8"));
}

const PREFIX = process.env.PREFIX ?? ",";

const bot = createBot({
  token,
  intents:
    Intents.Guilds |
    Intents.GuildMessages |

    Intents.MessageContent |

    Intents.GuildMessageReactions |
    (WANT_MEMBERS ? Intents.GuildMembers : 0),
  desiredProperties: {
    interaction: {
      id: true,
      type: true,
      token: true,
      data: true,
      guildId: true,
      channelId: true,
      user: true,
      message: true,
    },
    message: {
      id: true,
      content: true,
      author: true,
      channelId: true,
      guildId: true,
      type: true,
      attachments: true,
      embeds: true,
    },
    user: {
      id: true,
      username: true,
      toggles: true,
    },
    member: {
      id: true,
      guildId: true,
      user: true,
      roles: true,
      premiumSince: true,
    },
    channel: { id: true },
    emoji: { id: true, name: true },
  },
  events: {
    ready({ shardId }) {
      console.log(`Trap is ready (shard ${shardId}).`);
    },
    raw(data, shardId) {
      if (process.env.TRAP_TRACE === "1" && data.t) {
        console.log(`[trace] shard ${shardId} <- ${data.t}`);
      }
    },
    async reactionAdd({ messageId, channelId, userId, emoji, guildId }) {
      if (userId === bot.id) return;
      await emitReactionAdd({
        messageId: String(messageId),
        channelId: String(channelId),
        guildId: guildId ? String(guildId) : undefined,
        userId: String(userId),
        emoji: emoji?.name,
      });
    },
    async reactionRemove({ messageId, channelId, userId, emoji, guildId }) {
      if (userId === bot.id) return;
      await emitReactionRemove({
        messageId: String(messageId),
        channelId: String(channelId),
        guildId: guildId ? String(guildId) : undefined,
        userId: String(userId),
        emoji: emoji?.name,
      });
    },
    async channelPinsUpdate({ channelId, guildId }) {
      await emitChannelPins({
        guildId: guildId ? String(guildId) : "",
        channelId: String(channelId),
      });
    },
    async messageDelete({ id, channelId, guildId }) {
      forgetMessage(String(id));
      await emitMessageDelete({
        guildId: guildId ? String(guildId) : "",
        channelId: String(channelId),
        messageId: String(id),
      });
    },
    async messageUpdate(message) {
      if (!message.guildId || message.author?.bot) return;

      const messageId = String(message.id ?? "");
      const channelId = String(message.channelId ?? "");
      const content = message.content ?? "";

      await emitMessageEdit({
        guildId: String(message.guildId),
        channelId,
        messageId,
        authorId: String(message.author?.id ?? ""),
        content,
      });

      if (!editedInto(messageId, content)) return;
      if (await eventBlocked(String(message.guildId), channelId, "editrerun")) return;

      try {
        await runPrefixCommand(message);
      } catch (err) {
        console.error("edited command failed:", err);
      }
    },
    async guildMemberAdd(member: any) {
      await emitMemberJoin({
        guildId: String(member?.guildId ?? ""),
        userId: String(member?.id ?? member?.user?.id ?? ""),
      });
    },
    async guildMemberUpdate(member: any) {
      const guildId = String(member?.guildId ?? "");
      const userId = String(member?.id ?? member?.user?.id ?? "");
      if (!guildId || !userId) return;

      const since = member?.premiumSince ? new Date(Number(member.premiumSince)).toISOString() : null;
      if (await notedBoost(guildId, userId, since)) {
        await announceBoost(guildId, "", userId);
      }
    },
    async guildMemberRemove(user: any, guildId: any) {
      await emitMemberLeave({
        guildId: String(guildId ?? ""),
        userId: String(user?.id ?? ""),
      });
    },
    async messageCreate(message) {
      try {
        if (Number(message.type) === JOIN_MESSAGE) {
          await emitMemberJoin({
            guildId: String(message.guildId ?? ""),
            userId: String(message.author?.id ?? ""),
          });
          return;
        }

        if (BOOST_MESSAGES.has(Number(message.type))) {
          await announceBoost(
            String(message.guildId ?? ""),
            String(message.channelId ?? ""),
            String(message.author?.id ?? ""),
          );
          return;
        }

        if (message.author?.bot) return;

        const muted = await isIgnored(
          message.guildId ? String(message.guildId) : undefined,
          String(message.channelId ?? ""),
          String(message.author?.id ?? ""),
        );

        if (message.guildId && !muted) {
          await emitMessage({
            guildId: String(message.guildId),
            channelId: String(message.channelId ?? ""),
            messageId: String(message.id ?? ""),
            authorId: String(message.author?.id ?? ""),
            content: message.content ?? "",
            attachments: [...((message as any).attachments ?? [])].map((file: any) => ({
              contentType: file?.contentType ?? file?.content_type,
              filename: file?.filename,
            })),
          });
        }

        noteMessage(String(message.id ?? ""), message.content ?? "");
        await runPrefixCommand(message, muted);
      } catch (err) {
        console.error("prefix command failed:", err);
      }
    },
    async interactionCreate(interaction) {
      try {
        if (interaction.type === InteractionTypes.ApplicationCommand) {
          await dispatchSlash(interaction);
          return;
        }

        if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) {
          await dispatchAutocomplete(interaction);
          return;
        }

        const customId = String(interaction.data?.customId ?? "");
        if (interaction.type === InteractionTypes.ModalSubmit) {
          await dispatchModal(customId, interaction);
          return;
        }

        if (interaction.type !== InteractionTypes.MessageComponent) return;
        await dispatchComponent(customId, interaction);
      } catch (err) {
        console.error("interaction failed:", err);
      }
    },
  },
});

async function runPrefixCommand(message: any, muted?: boolean): Promise<void> {
  const content = message.content ?? "";
  if (!content) return;

  const authorId = String(message.author?.id ?? "");
  if (!authorId) return;

  const guildId = message.guildId ? String(message.guildId) : undefined;
  const used = mentionPrefix(content) ?? (await matchPrefix(content, guildId));
  if (used === null) return;

  const { name, argument } = split(content.slice(used.length));
  const context = buildContext(message, authorId);

  const ignored =
    muted ?? (await isIgnored(guildId, String(message.channelId ?? ""), authorId));

  const command = lookup(name);
  if (command) {
    if (ignored && !ALWAYS_ANSWERS.has(command.name)) return;
    if (
      await commandBlocked(
        guildId,
        String(message.channelId ?? ""),
        authorId,
        command.name,
        command.cog ?? "",
      )
    ) {
      return;
    }
    if (command.groupedUnder) {
      await context.reply({
        content: `That is \`${used}${command.groupedUnder} ${command.name}\`.`,
      });
      return;
    }
    const accent = command.cog === LASTFM_COG ? await accentFor(authorId) : null;
    await withAccent(accent, () => command.handler({ ...context, argument }));
    return;
  }

  if (ignored) return;

  const fallback = await resolveFallback(name, context);
  if (!fallback) return;

  const accent = await accentFor(authorId);
  await withAccent(accent, () => fallback({ ...context, argument }));
}

function mentionPrefix(content: string): string | null {
  const match = /^<@!?(\d{15,25})>\s*/.exec(content);
  if (!match) return null;
  return match[1] === String(bot.id ?? "") ? match[0] : null;
}

function buildContext(message: any, authorId: string): Omit<PrefixContext, "argument"> {
  const channelId = String(message.channelId);
  return {
    authorId,
    channelId,
    guildId: message.guildId ? String(message.guildId) : undefined,
    messageId: String(message.id),
    reply: (payload) => send(channelId, payload, String(message.id)),
    react: async (target, targetMessage, emoji) => {
      try {
        await bot.helpers.addReaction(target, targetMessage, emoji);
      } catch {}
    },
    dm: async (payload) => {
      try {
        const channel = await bot.helpers.getDmChannel(authorId);
        await send(String(channel.id), payload);
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function dispatchAutocomplete(interaction: any): Promise<void> {
  const name = String(interaction.data?.name ?? "");
  const options = (interaction.data?.options ?? []) as {
    name?: string;
    value?: unknown;
    focused?: boolean;
  }[];
  const focused = options.find((option) => option.focused) ?? options[0];

  const choices = completeSlash(
    name,
    String(focused?.value ?? ""),
    String(focused?.name ?? ""),
  );

  await bot.helpers
    .sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ApplicationCommandAutocompleteResult,
      data: { choices },
    } as any)
    .catch(() => {});
}

async function dispatchSlash(interaction: any): Promise<void> {
  const name = String(interaction.data?.name ?? "");
  const raw = interaction.data?.options as ReceivedOption[] | undefined;
  const { group, sub, options } = resolveInvocation(raw);

  const found = resolveSlash(name, group, sub, options);
  if (!found) {
    console.error(`slash: nothing registered for /${name} ${group ?? ""} ${sub ?? ""}`.trim());
    return;
  }

  const userId = String(interaction.user?.id ?? interaction.member?.user?.id ?? "");
  const channelId = String(interaction.channelId ?? "");
  if (!userId || !channelId) return;

  await runInteraction(interaction, found.handler, argumentFrom(options, found.options), `/${name}`);
}

async function runInteraction(
  interaction: any,
  command: { handler: (ctx: PrefixContext) => Promise<void> },
  argument: string,
  label: string,
): Promise<void> {
  const userId = String(interaction.user?.id ?? interaction.member?.user?.id ?? "");
  const channelId = String(interaction.channelId ?? "");
  if (!userId || !channelId) return;

  await bot.helpers
    .sendInteractionResponse(interaction.id, interaction.token, { type: 5 })
    .catch(() => {});

  let answered = false;
  const reply = async (payload: ReplyPayload): Promise<SentMessage> => {
    const body = { ...payload, allowed_mentions: { parse: [] } };
    if (!answered) {
      answered = true;

      return (await bot.helpers.editOriginalInteractionResponse(interaction.token, body as any)) as SentMessage;
    }

    return (await bot.helpers.sendFollowupMessage(interaction.token, body as any)) as SentMessage;
  };

  const context: PrefixContext = {
    argument,
    authorId: userId,
    channelId,
    guildId: interaction.guildId ? String(interaction.guildId) : undefined,
    messageId: "",
    reply,
    react: async (target, targetMessage, emoji) => {
      try {
        await bot.helpers.addReaction(target, targetMessage, emoji);
      } catch {}
    },
    dm: async (payload) => {
      try {
        const channel = await bot.helpers.getDmChannel(userId);
        await send(String(channel.id), payload);
        return true;
      } catch {
        return false;
      }
    },
  };

  try {
    await command.handler(context);
  } catch (err) {
    console.error(`${label} failed:`, err);
  }

  if (!answered) {
    await reply({ content: "That command produced no output." }).catch(() => {});
  }
}

async function send(
  channelId: string,
  payload: ReplyPayload,
  replyTo?: string,
): Promise<SentMessage> {
  return await bot.helpers.sendMessage(
    channelId,
    {
      ...payload,
      allowed_mentions: { parse: [] },
      ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
    } as any,
  );
}

process.on("unhandledRejection", (err) => {
  console.error("unhandled rejection:", err);
});

const shutdown = async () => {
  console.log("Shutting down…");
  try {
    await bot.shutdown();
    await Promise.allSettled([closeDb(), closeRedis()]);
  } finally {
    process.exit(0);
  }
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

const gatewayLatency = (): string => {
  const rtts = [...bot.gateway.shards.values()]
    .map((shard) => shard.heart.rtt)
    .filter((rtt): rtt is number => typeof rtt === "number" && rtt > 0);
  if (rtts.length === 0) return "measuring…";
  return `${Math.round(rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length)} ms`;
};

console.log(`Trap v${botVersion} starting, discordeno v${libVersion}, Node ${process.version}`);

try {
  await migrate();
  startWebServer();

  registerPagerInteractions({
    deleteMessage: async (channelId, messageId) => {
      await bot.helpers.deleteMessage(channelId, messageId).catch(() => {});
    },
  });

  await loadCogs(cogs, {
    prefix: PREFIX,
    version: { bot: botVersion, library: libVersion },
    gateway: { latency: gatewayLatency, shards: () => bot.gateway.shards.size },
    web: router,
    messages: {
      delete: async (channelId, messageId) => {
        await bot.helpers.deleteMessage(channelId, messageId).catch(() => {});
      },
    },
  });

  const guildIds = (process.env.GUILD_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const commands = buildAllSlashCommands();
  const scope = (process.env.COMMAND_SCOPE ?? "").toLowerCase() === "guild" ? "guild" : "global";

  if (scope === "guild" && guildIds.length > 0) {
    await bot.rest.upsertGlobalApplicationCommands([]);
    for (const guildId of guildIds) {
      const registered = await bot.rest.upsertGuildApplicationCommands(guildId, commands as any);
      rememberCommandIds(registered as { name?: string; id?: string | bigint }[]);
    }
    console.log(`slash: registered ${commands.length} commands in ${guildIds.length} guild(s)`);
  } else {
    for (const guildId of guildIds) {
      await bot.rest.upsertGuildApplicationCommands(guildId, []);
    }

    const registered = await bot.rest.upsertGlobalApplicationCommands(commands as any);
    rememberCommandIds(registered as { name?: string; id?: string | bigint }[]);
    console.log(`slash: registered ${commands.length} commands globally`);
  }

  provideMessageEditor(async (channelId, messageId, payload) => {
    await bot.helpers.editMessage(channelId, messageId, payload as any);
  });

  provideRunner(async (interaction, command, argument) => {
    await runInteraction(interaction, command, argument, `/${command.name}`);
  });

  await bot.start();
} catch (err) {
  console.error("Failed to start:", err instanceof Error ? err.message : err);
  process.exit(78);
}
