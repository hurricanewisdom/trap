import { sql } from "../../../core/db.js";
import { channelExists, deleteMessage, sendMessage } from "../../../core/discord.js";
import { onMessage } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";

const HEADING = "Sticky messages";

const MESSAGE_LIMIT = 1800;

const SETTLE_MS = 2500;

const CHANNEL = /^<#(\d{15,25})>$/;

interface Row {
  channel_id: string;
  message: string;
  posted_id: string | null;
}

const waiting = new Map<string, NodeJS.Timeout>();

const CACHE_MS = 60_000;

const channels = new Map<string, { ids: Set<string>; at: number }>();

function forget(guildId: string): void {
  channels.delete(guildId);
}

async function stickyChannels(guildId: string): Promise<Set<string>> {
  const hit = channels.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;

  let ids = new Set<string>();
  try {
    const rows = await sql<{ channel_id: string }[]>`
      SELECT channel_id FROM sticky_messages WHERE guild_id = ${guildId}
    `;
    ids = new Set(rows.map((row) => row.channel_id));
  } catch {
    return hit?.ids ?? new Set();
  }

  channels.set(guildId, { ids, at: Date.now() });
  return ids;
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

function channelId(token: string): string | null {
  const mention = CHANNEL.exec(token);
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token) ? token : null;
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

async function stickies(guildId: string): Promise<Row[]> {
  return sql<Row[]>`
    SELECT channel_id, message, posted_id FROM sticky_messages
    WHERE guild_id = ${guildId} ORDER BY updated_at
  `;
}

async function stickyIn(guildId: string, channel: string): Promise<Row | null> {
  const rows = await sql<Row[]>`
    SELECT channel_id, message, posted_id FROM sticky_messages
    WHERE guild_id = ${guildId} AND channel_id = ${channel}
  `;
  return rows[0] ?? null;
}

async function repost(guildId: string, channel: string): Promise<void> {
  const sticky = await stickyIn(guildId, channel);
  if (!sticky) return;

  if (sticky.posted_id) await deleteMessage(channel, sticky.posted_id);

  const sent = await sendMessage(channel, {
    content: sticky.message.slice(0, 2000),
    allowed_mentions: { parse: [] },
  });

  await sql`
    UPDATE sticky_messages SET posted_id = ${sent.ok ? sent.data.id : null}
    WHERE guild_id = ${guildId} AND channel_id = ${channel}
  `;
}

function settle(guildId: string, channel: string): void {
  const pending = waiting.get(channel);
  if (pending) clearTimeout(pending);

  const timer = setTimeout(() => {
    waiting.delete(channel);
    void repost(guildId, channel).catch((err) => console.error("sticky repost failed:", err));
  }, SETTLE_MS);

  timer.unref();
  waiting.set(channel, timer);
}

async function usage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set up sticky messages");
  if (!guildId) return;

  const rows = await stickies(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.length
        ? `Sticking in ${rows.map((row) => `<#${row.channel_id}>`).join(" · ")}.`
        : "No sticky message is set up yet.",
      "",
      "`stickymessage add <channel> <message>` pins one to the bottom",
      "`stickymessage view <channel>` shows what a channel keeps",
      "`stickymessage remove <channel>` stops it",
      "`stickymessage list` shows every channel",
      "",
      `-# ${rows.length} channel${rows.length === 1 ? "" : "s"} · reposted a couple of seconds after the chat settles.`,
    ].join("\n"),
  );
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "add a sticky message");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const channel = channelId(parts[0] ?? "");
  const message = ctx.argument.replace(/^\S+\s*/, "").trim();

  if (!channel || !message) {
    await card(ctx, [`### ${HEADING}`, "Use `stickymessage add <channel> <message>`."].join("\n"));
    return;
  }

  if (!(await channelExists(guildId, channel))) {
    await card(ctx, [`### ${HEADING}`, "That channel is not in this server."].join("\n"));
    return;
  }

  if (message.length > MESSAGE_LIMIT) {
    await card(
      ctx,
      [`### ${HEADING}`, `Keep the message under ${MESSAGE_LIMIT} characters.`].join("\n"),
    );
    return;
  }

  const existing = await stickyIn(guildId, channel);
  if (existing?.posted_id) await deleteMessage(channel, existing.posted_id);

  await sql`
    INSERT INTO sticky_messages (guild_id, channel_id, message, posted_id, created_by, updated_at)
    VALUES (${guildId}, ${channel}, ${message}, NULL, ${ctx.authorId}, now())
    ON CONFLICT (guild_id, channel_id) DO UPDATE
      SET message = EXCLUDED.message, posted_id = NULL,
          created_by = EXCLUDED.created_by, updated_at = now()
  `;

  forget(guildId);

  await repost(guildId, channel);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${channel}> will keep this at the bottom:`,
      "",
      message.slice(0, 900),
      "",
      "-# It reposts a couple of seconds after the channel goes quiet.",
    ].join("\n"),
  );
}

async function view(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "view a sticky message");
  if (!guildId) return;

  const channel = channelId(words(ctx.argument)[0] ?? "");
  if (!channel) {
    await card(ctx, [`### ${HEADING}`, "Use `stickymessage view <channel>`."].join("\n"));
    return;
  }

  const sticky = await stickyIn(guildId, channel);
  if (!sticky) {
    await card(ctx, [`### ${HEADING}`, `<#${channel}> has no sticky message.`].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<#${channel}> keeps:`,
      "",
      sticky.message.slice(0, 900),
      "",
      `-# ${sticky.posted_id ? "Currently posted." : "Not posted yet; it appears after the next message."}`,
    ].join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove a sticky message");
  if (!guildId) return;

  const channel = channelId(words(ctx.argument)[0] ?? "");
  if (!channel) {
    await card(ctx, [`### ${HEADING}`, "Use `stickymessage remove <channel>`."].join("\n"));
    return;
  }

  const rows = await sql<{ posted_id: string | null }[]>`
    DELETE FROM sticky_messages WHERE guild_id = ${guildId} AND channel_id = ${channel}
    RETURNING posted_id
  `;

  forget(guildId);

  if (rows.length === 0) {
    await card(ctx, [`### ${HEADING}`, `<#${channel}> had no sticky message.`].join("\n"));
    return;
  }

  const pending = waiting.get(channel);
  if (pending) {
    clearTimeout(pending);
    waiting.delete(channel);
  }
  if (rows[0]?.posted_id) await deleteMessage(channel, rows[0].posted_id as string);

  await card(ctx, [`### ${HEADING}`, `<#${channel}> is no longer sticky.`].join("\n"));
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the sticky messages");
  if (!guildId) return;

  const rows = await stickies(guildId);
  if (rows.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No sticky message is set up."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows
        .map((row) => `<#${row.channel_id}>\n-# ${row.message.replace(/\s+/g, " ").slice(0, 80)}`)
        .join("\n"),
      "",
      `-# ${rows.length} channel${rows.length === 1 ? "" : "s"}`,
    ].join("\n"),
  );
}

function dispatcher(fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const command = sub ? lookupIn("stickymessage", sub) : undefined;

    if (command) {
      await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerSticky(): void {
  onMessage(async (event) => {
    if (!(await stickyChannels(event.guildId)).has(event.channelId)) return;
    settle(event.guildId, event.channelId);
  });

  register({
    name: "stickymessage",
    aliases: ["sticky", "stickymsg"],
    description: "Keep a message at the bottom of a channel",
    handler: dispatcher(usage),
  });

  groupUnder("stickymessage", () => {
    register({
      name: "add",
      aliases: ["set"],
      description: "Keep a message at the bottom of a channel",
      handler: add,
    });

    register({
      name: "view",
      description: "Show what a channel keeps stuck",
      handler: view,
    });

    register({
      name: "remove",
      aliases: ["delete", "rm"],
      description: "Stop a channel keeping a message",
      handler: remove,
    });

    register({
      name: "list",
      description: "Every channel with a sticky message",
      handler: list,
    });
  });
}
