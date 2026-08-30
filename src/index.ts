/**
 * Entry point.
 *
 * Creates the bot, translates gateway events into the core hooks, loads the
 * cogs and connects. Feature logic lives in `src/cogs`; this file only wires
 * things together.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { createBot, Intents, InteractionTypes } from "discordeno";

import { loadCogs } from "./core/cog.js";
import { closeDb, migrate } from "./core/db.js";
import {
  dispatchComponent,
  dispatchModal,
  emitReactionAdd,
  emitReactionRemove,
} from "./core/hooks.js";
import { registerPagerInteractions } from "./core/pager.js";
import { type PrefixContext, type ReplyPayload, type SentMessage } from "./core/prefix.js";
import {
  argumentFrom,
  argumentOverride,
  buildAllSlashCommands,
  focusedOption,
  resolveInvocation,
  resolveSlash,
  suggestionsFor,
  type ReceivedOption,
} from "./core/slash.js";
import { closeRedis } from "./core/redis.js";
import { cogs } from "./cogs/index.js";
import { router, startWebServer } from "./web/server.js";
import { slashifyPayload } from "./helpers/slashtext.js";
import { provideRunner } from "./core/runner.js";
import { rememberCommandIds } from "./core/slash.js";

const require = createRequire(import.meta.url);
const botVersion: string = require("../package.json").version;

/** The package's exports map may hide package.json, so walk up from the entry point. */
function packageVersion(name: string): string {
  let dir = path.dirname(require.resolve(name));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.name === name) return pkg.version;
    } catch {
      // keep walking up
    }
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

/**
 * Discordeno derives the bot id from the token's first segment at createBot()
 * time and throws an opaque error on junk, so the shape is checked first.
 */
function looksLikeBotToken(t: string): boolean {
  const first = t.split(".")[0] ?? "";
  return /^\d+$/.test(Buffer.from(first, "base64").toString("utf8"));
}

/** Prefix for text commands, e.g. ",lf link". */
/**
 * Kept only so the help text can name it. Nothing dispatches on it any more:
 * the bot is slash-only.
 */
const PREFIX = process.env.PREFIX ?? ",";

const bot = createBot({
  token,
  intents:
    Intents.Guilds |
    Intents.GuildMessages |
    // Privileged, and already enabled for this application: prefix commands
    // cannot read message text without it.
    Intents.MessageContent |
    // Needed to tally the votes on now-playing posts.
    Intents.GuildMessageReactions,
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
    },
    user: {
      id: true,
      username: true,
      toggles: true,
    },
    // getDmChannel returns a channel and we need its id to send there.
    channel: { id: true },
    // Reaction events run every emoji through the transformer.
    emoji: { id: true, name: true },
  },
  events: {
    ready({ shardId }) {
      console.log(`Trap is ready (shard ${shardId}).`);
    },

    /** TRAP_TRACE=1 logs every dispatch name; the fastest way to tell
     *  "the event never arrived" from "the handler threw". */
    raw(data, shardId) {
      if (process.env.TRAP_TRACE === "1" && data.t) {
        console.log(`[trace] shard ${shardId} <- ${data.t}`);
      }
    },

    async reactionAdd({ messageId, channelId, userId, emoji, guildId }) {
      // Cards seed their own reactions, and Discord dispatches those back as
      // ordinary events, so the bot must never react to itself.
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

    async interactionCreate(interaction) {
      try {
        if (interaction.type === InteractionTypes.ApplicationCommand) {
          await dispatchSlash(interaction);
          return;
        }
        if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) {
          await answerAutocomplete(interaction);
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

/* ------------------------------------------------------------------ */
/* Command context                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Slash commands                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one slash invocation against the handler registered for it.
 *
 * The response is deferred first. Discord discards an interaction that is not
 * acknowledged within three seconds, and plenty of these commands are slower
 * than that on purpose — a server-wide who-knows makes one Last.fm request per
 * member, and a collage fetches and composites twenty-five covers.
 *
 * After deferring, the first reply edits that placeholder (so it reads as the
 * command's answer rather than a second message) and any further reply is a
 * followup. Both return a real message, which is what the pager needs to
 * attach its state to.
 */
/**
 * Answers the search box on an autocompleting field.
 *
 * Discord expects a reply within three seconds and shows nothing if it is
 * late, so this stays synchronous: the suggestions come from an in-memory
 * list, never from the network.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function answerAutocomplete(interaction: any): Promise<void> {
  const name = String(interaction.data?.name ?? "");
  const focused = focusedOption(interaction.data?.options as ReceivedOption[] | undefined);
  const context = {
    guildId: interaction.guildId ? String(interaction.guildId) : undefined,
    userId: String(interaction.user?.id ?? interaction.member?.user?.id ?? ""),
  };
  const choices = focused ? await suggestionsFor(name, focused.name, focused.value, context) : [];

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    // Type 8: autocomplete result.
    type: 8,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { choices } as any,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // A field whose value stands for something else — a custom command word for
  // the member who claimed it — is resolved by the cog that owns it.
  const context = {
    guildId: interaction.guildId ? String(interaction.guildId) : undefined,
    userId: String(interaction.user?.id ?? interaction.member?.user?.id ?? ""),
  };
  const override = await argumentOverride(name, group, sub, options, context);
  const argument = override ?? argumentFrom(options, found.options);

  await runInteraction(interaction, found.handler, argument, `/${name}`);
}

/**
 * Runs one handler against an interaction, deferring first.
 *
 * Shared by slash invocations and by the help menu's run dropdown, so a
 * command behaves identically whether it was typed or clicked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runInteraction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interaction: any,
  command: { handler: (ctx: PrefixContext) => Promise<void> },
  argument: string,
  label: string,
): Promise<void> {
  const userId = String(interaction.user?.id ?? interaction.member?.user?.id ?? "");
  const channelId = String(interaction.channelId ?? "");
  if (!userId || !channelId) return;

  // Type 5 is "thinking", as a NEW message. A component click must not use
  // type 6, which would replace the card that was clicked.
  await bot.helpers
    .sendInteractionResponse(interaction.id, interaction.token, { type: 5 })
    .catch(() => {});

  let answered = false;
  const reply = async (payload: ReplyPayload): Promise<SentMessage> => {
    const body = { ...slashifyPayload(payload), allowed_mentions: { parse: [] } };
    if (!answered) {
      answered = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await bot.helpers.editOriginalInteractionResponse(interaction.token, body as any)) as SentMessage;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await bot.helpers.sendFollowupMessage(interaction.token, body as any)) as SentMessage;
  };

  const context: PrefixContext = {
    argument,
    authorId: userId,
    channelId,
    guildId: interaction.guildId ? String(interaction.guildId) : undefined,
    // There is no invoking message; reactions attach to the answer instead.
    messageId: "",
    reply,
    react: async (target, targetMessage, emoji) => {
      try {
        await bot.helpers.addReaction(target, targetMessage, emoji);
      } catch {
        /* ignore */
      }
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

  // A handler that returned without replying would leave the placeholder
  // spinning until it times out, which reads as the bot being broken.
  if (!answered) {
    await reply({ content: "That command produced no output." }).catch(() => {});
  }
}

/** Sends a message, optionally as a reply, never mentioning anyone. */
async function send(
  channelId: string,
  payload: ReplyPayload,
  replyTo?: string,
): Promise<SentMessage> {
  return await bot.helpers.sendMessage(
    channelId,
    // Components V2 bodies are raw Discord shapes, which this version of
    // discordeno has no types for; the REST layer posts them verbatim.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {
      ...slashifyPayload(payload),
      allowed_mentions: { parse: [] },
      ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
    } as any,
  );
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

process.on("unhandledRejection", (err) => {
  console.error("unhandled rejection:", err);
});

/** Without this a stop never closes the gateway socket cleanly. */
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

  /**
   * Register the slash commands the cogs contributed.
   *
   * Exactly one scope is live and the other is actively cleared, or a client
   * shows both copies of every command. Guild scope applies instantly, which
   * is what you want while iterating; global takes up to an hour to propagate
   * but reaches servers the bot has not been invited to individually.
   */
  const guildIds = (process.env.GUILD_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const commands = buildAllSlashCommands();
  const scope = (process.env.COMMAND_SCOPE ?? "").toLowerCase() === "guild" ? "guild" : "global";

  if (scope === "guild" && guildIds.length > 0) {
    await bot.rest.upsertGlobalApplicationCommands([]);
    for (const guildId of guildIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registered = await bot.rest.upsertGuildApplicationCommands(guildId, commands as any);
      rememberCommandIds(registered as { name?: string; id?: string | bigint }[]);
    }
    console.log(`slash: registered ${commands.length} commands in ${guildIds.length} guild(s)`);
  } else {
    for (const guildId of guildIds) {
      await bot.rest.upsertGuildApplicationCommands(guildId, []);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = await bot.rest.upsertGlobalApplicationCommands(commands as any);
    rememberCommandIds(registered as { name?: string; id?: string | bigint }[]);
    console.log(`slash: registered ${commands.length} commands globally`);
  }

  // The help menu runs a chosen command through the same path a slash
  // invocation takes; only this module can reply to an interaction.
  provideRunner(async (interaction, command, argument) => {
    await runInteraction(interaction, command, argument, `/${command.name}`);
  });

  await bot.start();
} catch (err) {
  console.error("Failed to start:", err instanceof Error ? err.message : err);
  process.exit(78);
}
