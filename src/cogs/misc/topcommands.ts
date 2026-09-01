import { sql } from "../../core/db.js";
import { onCommandRan } from "../../core/hooks.js";
import { paginate } from "../../core/pager.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { card } from "./shared.js";
import { pagesOf } from "./pages.js";

// A command finishing is not the message path, but it is still hot enough that
// a write per invocation is wasteful. Same trade as the emote counter: buffer,
// then one statement every half minute.
const pending: { guild_id: string; command: string; user_id: string }[] = [];

const FLUSH_MS = 30_000;

const MOST_PENDING = 20_000;

async function flush(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  try {
    await sql`INSERT INTO command_uses ${sql(batch, "guild_id", "command", "user_id")}`;
  } catch {
    // Losing half a minute of counts beats growing the buffer while the
    // database is unhappy.
  }
}

async function topcommands(ctx: PrefixContext): Promise<void> {
  await flush();

  const rows = await sql<{ command: string; uses: string; people: string }[]>`
    SELECT command,
           count(*)::text AS uses,
           count(DISTINCT user_id)::text AS people
    FROM command_uses
    ${ctx.guildId ? sql`WHERE guild_id = ${ctx.guildId}` : sql``}
    GROUP BY command
    ORDER BY count(*) DESC, command
  `;

  if (rows.length === 0) {
    await card(ctx, [
      "### Most used commands",
      "-# Nothing counted yet.",
      "-# Counting starts from now.",
    ]);
    return;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.uses), 0);
  const lines = rows.map((row, at) => {
    const share = Math.round((Number(row.uses) / Math.max(1, total)) * 100);
    return (
      `\`${String(at + 1).padStart(2, " ")}.\` **${row.command}** — ${row.uses} uses · ` +
      `${row.people} ${Number(row.people) === 1 ? "person" : "people"}` +
      (share >= 1 ? ` · ${share}%` : "")
    );
  });

  await paginate(
    ctx,
    pagesOf("Most used commands", lines, 10, `${total} runs across ${rows.length} commands`),
    null,
  );
}

export function registerTopCommands(): void {
  register({ name: "topcommands", aliases: ["topcmds"], description: "View the most used commands", handler: topcommands });

  onCommandRan((guildId, command, who) => {
    if (!guildId || pending.length >= MOST_PENDING) return;
    pending.push({ guild_id: guildId, command, user_id: who });
  });

  setInterval(() => void flush().catch(() => {}), FLUSH_MS).unref?.();
}
