import { sql } from "../../core/db.js";
import { onMessage } from "../../core/hooks.js";
import { sendMessage } from "../../core/discord.js";
import { paginate } from "../../core/pager.js";
import { groupUnder, lookupIn, register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, stamp } from "./shared.js";
import { pagesOf } from "./pages.js";

const MOST_STATUS = 200;

// Held in memory because this is read on the message path and nothing there is
// allowed to hit the database. One row per person who is away, which is a small
// set even on a large server.
let away = new Map<string, { status: string; since: number }>();

let loaded = false;

const key = (guildId: string, userId: string) => `${guildId}:${userId}`;

async function refresh(): Promise<void> {
  try {
    const rows = await sql<{ guild_id: string; user_id: string; status: string; since: Date }[]>`
      SELECT guild_id, user_id, status, since FROM afk
    `;
    away = new Map(
      rows.map((row) => [
        key(row.guild_id, row.user_id),
        { status: row.status, since: row.since.getTime() },
      ]),
    );
    loaded = true;
  } catch {
    // Leave whatever is cached; an empty map would silently switch the feature
    // off rather than degrade it.
  }
}

const MENTION = /<@!?(\d{15,25})>/g;

async function afk(ctx: PrefixContext): Promise<void> {
  const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const found = sub ? lookupIn("afk", sub) : undefined;
  if (found) {
    await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
    return;
  }

  if (!ctx.guildId) {
    await card(ctx, ["That one only works in a server."]);
    return;
  }

  const status = plain(ctx.argument.trim()).slice(0, MOST_STATUS) || "away";
  await sql`
    INSERT INTO afk (guild_id, user_id, status, since) VALUES (${ctx.guildId}, ${ctx.authorId}, ${status}, now())
    ON CONFLICT (guild_id, user_id) DO UPDATE SET status = ${status}, since = now()
  `;
  away.set(key(ctx.guildId, ctx.authorId), { status, since: Date.now() });

  await card(ctx, [`### You are afk`, `-# ${status}`]);
}

async function mentions(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const rows = await sql<
    { from_id: string; channel_id: string; message_id: string; at: Date }[]
  >`
    SELECT from_id, channel_id, message_id, at FROM afk_mentions
    WHERE guild_id = ${ctx.guildId} AND user_id = ${ctx.authorId}
    ORDER BY at DESC LIMIT 200
  `;

  const lines = rows.map(
    (row) =>
      `<@${row.from_id}> — ${stamp(row.at.toISOString())} · ` +
      `[jump](https://discord.com/channels/${ctx.guildId}/${row.channel_id}/${row.message_id})`,
  );

  await paginate(
    ctx,
    pagesOf(`${rows.length} mention${rows.length === 1 ? "" : "s"} while away`, lines, 10, "newest first"),
    null,
  );
}

// Coming back clears the status, and that has to happen before anything else so
// somebody typing "afk" again is setting a new one rather than being welcomed
// back from the one they just set.
async function backAgain(guildId: string, userId: string, channelId: string): Promise<void> {
  const held = away.get(key(guildId, userId));
  if (!held) return;

  away.delete(key(guildId, userId));
  await sql`DELETE FROM afk WHERE guild_id = ${guildId} AND user_id = ${userId}`.catch(() => {});

  const count = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM afk_mentions WHERE guild_id = ${guildId} AND user_id = ${userId}
  `.catch(() => [] as { n: string }[]);

  const missed = Number(count[0]?.n ?? 0);
  await sendMessage(channelId, {
    content:
      `<@${userId}> welcome back, you were away ${stamp(held.since)}` +
      (missed ? ` and were mentioned ${missed} time${missed === 1 ? "" : "s"}.` : "."),
    allowed_mentions: { users: [userId] },
  });
}

export function registerAfk(): void {
  register({ name: "afk", description: "Set an AFK status for when you are mentioned", handler: afk });

  groupUnder("afk", () => {
    register({ name: "mentions", description: "Show mentions received while AFK", handler: mentions });
  });

  onMessage(async (event) => {
    if (!event.guildId) return;
    if (!loaded) await refresh().catch(() => {});
    if (away.size === 0) return;

    // The sender coming back is checked first and separately from the mentions
    // in their message, so saying "back, and hi @someone-else-who-is-afk" both
    // clears theirs and answers for the other person.
    await backAgain(event.guildId, event.authorId, event.channelId).catch(() => {});

    if (!event.content.includes("<@")) return;
    const told = new Set<string>();
    for (const [, id] of event.content.matchAll(MENTION)) {
      const who = id as string;
      if (who === event.authorId || told.has(who)) continue;
      const held = away.get(key(event.guildId, who));
      if (!held) continue;
      told.add(who);

      await sendMessage(event.channelId, {
        content: `<@${who}> is away: ${held.status} — ${stamp(held.since)}`,
        allowed_mentions: { parse: [] },
      }).catch(() => {});

      await sql`
        INSERT INTO afk_mentions (guild_id, user_id, from_id, channel_id, message_id)
        VALUES (${event.guildId}, ${who}, ${event.authorId}, ${event.channelId}, ${event.messageId})
      `.catch(() => {});
    }
  });
}

export async function clearMentions(guildId: string, userId: string): Promise<void> {
  await sql`DELETE FROM afk_mentions WHERE guild_id = ${guildId} AND user_id = ${userId}`;
}
