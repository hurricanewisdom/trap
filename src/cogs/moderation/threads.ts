import { sql } from "../../core/db.js";
import { editChannel, getChannel, write } from "../../core/discord.js";
import { requireManageChannels, requireManageThreads } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, channelId, shownReason, userId, words } from "./shared.js";

const THREAD_TYPES = new Set([10, 11, 12]);

async function threadFrom(
  ctx: PrefixContext,
  token: string | undefined,
): Promise<{ id: string; name: string } | null> {
  const wanted = channelId(token) ?? ctx.channelId;
  const channel = await getChannel(wanted);
  if (!channel || !THREAD_TYPES.has(channel.type ?? -1)) {
    await card(ctx, [
      "That is not a thread.",
      "",
      "-# Run it inside the thread, or name one: `thread lock #thread`",
    ]);
    return null;
  }
  return { id: channel.id, name: channel.name ?? "thread" };
}

function threadLock(locking: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageThreads(ctx, "lock threads");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const found = await threadFrom(ctx, parts[0]);
    if (!found) return;

    const reason = shownReason(channelId(parts[0]) ? parts.slice(1).join(" ") : ctx.argument);
    const done = await editChannel(found.id, { locked: locking }, `${reason} (by ${ctx.authorId})`);
    await card(ctx, [
      done.ok
        ? `**${plain(found.name)}** is ${locking ? "locked" : "unlocked"}.`
        : `That did not work. ${done.message.slice(0, 120)}`,
      ...(done.ok ? [`-# ${reason}`] : []),
    ]);
  };
}

async function threadRename(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageThreads(ctx, "rename threads");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const named = channelId(parts[0]);
  const found = await threadFrom(ctx, parts[0]);
  if (!found) return;

  const name = (named ? parts.slice(1).join(" ") : ctx.argument).trim();
  if (!name) {
    await card(ctx, ["What should it be called?", "", "-# `thread rename <new name>`"]);
    return;
  }

  const done = await editChannel(found.id, { name: name.slice(0, 100) }, `by ${ctx.authorId}`);
  await card(ctx, [
    done.ok
      ? `Renamed to **${plain(name.slice(0, 60))}**.`
      : `That did not work. ${done.message.slice(0, 120)}`,
  ]);
}

function membership(adding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageThreads(ctx, "change thread membership");
    if (!guildId) return;

    const parts = words(ctx.argument);
    const named = channelId(parts[0]);
    const found = await threadFrom(ctx, parts[0]);
    if (!found) return;

    const who = userId(named ? parts[1] : parts[0]);
    if (!who) {
      await card(ctx, ["Which member?", "", `-# \`thread ${adding ? "add" : "remove"} @member\``]);
      return;
    }

    const done = await write<void>(
      adding ? "PUT" : "DELETE",
      `/channels/${found.id}/thread-members/${who}`,
    );
    await card(ctx, [
      done.ok
        ? `<@${who}> was ${adding ? "added to" : "removed from"} **${plain(found.name)}**.`
        : `That did not work. ${done.message.slice(0, 120)}`,
    ]);
  };
}

// Watching is only a note that this thread matters; Discord archives it on its
// own schedule and nothing here can stop that.
async function threadWatch(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "watch threads");
  if (!guildId) return;

  const found = await threadFrom(ctx, words(ctx.argument)[0]);
  if (!found) return;

  const gone = await sql<{ thread_id: string }[]>`
    DELETE FROM mod_watched_threads
    WHERE guild_id = ${guildId} AND thread_id = ${found.id}
    RETURNING thread_id
  `;
  if (gone.length > 0) {
    await card(ctx, [`**${plain(found.name)}** is no longer watched.`]);
    return;
  }

  await sql`
    INSERT INTO mod_watched_threads (guild_id, thread_id) VALUES (${guildId}, ${found.id})
    ON CONFLICT (guild_id, thread_id) DO NOTHING
  `;
  await card(ctx, [
    `**${plain(found.name)}** is watched.`,
    "-# It is unarchived again whenever Discord archives it.",
  ]);
}

async function threadWatchList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "see watched threads");
  if (!guildId) return;

  const rows = await sql<{ thread_id: string }[]>`
    SELECT thread_id FROM mod_watched_threads WHERE guild_id = ${guildId}
  `;
  await card(
    ctx,
    rows.length === 0
      ? ["No threads are watched."]
      : [`${rows.length} watched:`, rows.map((row) => `<#${row.thread_id}>`).join(" ")],
  );
}

async function threadOverview(ctx: PrefixContext): Promise<void> {
  await card(ctx, [
    "Commands to manage threads and forum posts.",
    "",
    "-# `thread rename` · `thread lock` · `thread unlock`",
    "-# `thread add @member` · `thread remove @member`",
    "-# `thread watch` · `thread watch list`",
  ]);
}

// Anything watched is pulled back out of the archive. Cheap enough to run on the
// same tick as everything else with a clock.
export async function unarchiveWatched(): Promise<void> {
  const rows = await sql<{ guild_id: string; thread_id: string }[]>`
    SELECT guild_id, thread_id FROM mod_watched_threads LIMIT 200
  `;
  for (const row of rows) {
    const channel = await getChannel(row.thread_id);
    if (!channel) {
      await sql`
        DELETE FROM mod_watched_threads
        WHERE guild_id = ${row.guild_id} AND thread_id = ${row.thread_id}
      `;
      continue;
    }
    const archived = (channel as unknown as { thread_metadata?: { archived?: boolean } })
      .thread_metadata?.archived;
    if (archived) await editChannel(row.thread_id, { archived: false }, "watched thread");
  }
}

export function registerThreads(): void {
  register({
    name: "thread",
    description: "Commands to manage threads and forum posts",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("thread", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await threadOverview(ctx);
    },
  });

  groupUnder("thread", () => {
    register({ name: "rename", description: "Rename a thread", handler: threadRename });
    register({ name: "lock", description: "Lock a thread or forum post", handler: threadLock(true) });
    register({
      name: "unlock",
      description: "Unlock a thread or forum post",
      handler: threadLock(false),
    });
    register({ name: "add", description: "Add a member to the thread", handler: membership(true) });
    register({
      name: "remove",
      description: "Remove a member from the thread",
      handler: membership(false),
    });
    register({
      name: "watch",
      description: "Toggle a thread being watched for archival",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("thread watch", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await threadWatch(ctx);
      },
    });
    groupUnder("thread watch", () => {
      register({
        name: "list",
        description: "View all threads in the server being watched",
        handler: threadWatchList,
      });
    });
  });
}
