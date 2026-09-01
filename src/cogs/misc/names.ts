import { sql } from "../../core/db.js";
import { api, getGuild, memberOf } from "../../core/discord.js";
import { onMemberUpdate } from "../../core/hooks.js";
import { paginate } from "../../core/pager.js";
import { requireManageGuild } from "../../core/permissions.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, stamp, userId, words } from "./shared.js";
import { pagesOf } from "./pages.js";

const KEEP = 50;

type Kind = "username" | "nickname" | "display";

async function remember(
  guildId: string | null,
  who: string,
  kind: Kind,
  name: string | null,
): Promise<void> {
  if (!name) return;

  // Only a change is worth a row. Discord fires a member update for things that
  // have nothing to do with names — a role, a timeout, a boost — so without this
  // the table would fill with the same name over and over.
  const last = await sql<{ name: string }[]>`
    SELECT name FROM name_history
    WHERE user_id = ${who} AND kind = ${kind}
      AND guild_id IS NOT DISTINCT FROM ${guildId}
    ORDER BY at DESC LIMIT 1
  `;
  if (last[0]?.name === name) return;

  await sql`
    INSERT INTO name_history (user_id, guild_id, kind, name) VALUES (${who}, ${guildId}, ${kind}, ${name})
  `;
}

async function names(ctx: PrefixContext): Promise<void> {
  const who = userId(words(ctx.argument)[0]) ?? ctx.authorId;

  const rows = await sql<{ kind: string; name: string; at: Date; guild_id: string | null }[]>`
    SELECT kind, name, at, guild_id FROM name_history
    WHERE user_id = ${who}
      AND (guild_id IS NULL OR guild_id = ${ctx.guildId ?? null})
    ORDER BY at DESC LIMIT ${KEEP}
  `;

  const lines = rows.map(
    (row) => `**${plain(row.name)}** — ${row.kind} · ${stamp(row.at.toISOString())}`,
  );

  await paginate(
    ctx,
    pagesOf(
      `Names for ${who === ctx.authorId ? "you" : "them"}`,
      lines,
      10,
      rows.length ? "newest first" : "nothing recorded yet — this starts counting now",
    ),
    null,
  );
}

async function clearnames(ctx: PrefixContext): Promise<void> {
  const gone = await sql<{ n: string }[]>`
    WITH removed AS (DELETE FROM name_history WHERE user_id = ${ctx.authorId} RETURNING 1)
    SELECT count(*)::text AS n FROM removed
  `;
  await card(ctx, [
    `### Cleared`,
    `-# ${gone[0]?.n ?? 0} of your recorded names are gone, everywhere.`,
  ]);
}

async function gnames(ctx: PrefixContext): Promise<void> {
  const said = words(ctx.argument)[0];
  const guildId = /^\d{15,25}$/.test(said ?? "") ? (said as string) : ctx.guildId;
  if (!guildId) {
    await card(ctx, ["Which server?", "", "-# `gnames` here, or `gnames <server id>`"]);
    return;
  }

  const rows = await sql<{ name: string; at: Date }[]>`
    SELECT name, at FROM guild_name_history WHERE guild_id = ${guildId}
    ORDER BY at DESC LIMIT ${KEEP}
  `;

  const guild = guildId === ctx.guildId ? await getGuild(guildId) : null;
  const lines = rows.map((row) => `**${plain(row.name)}** — ${stamp(row.at.toISOString())}`);

  await paginate(
    ctx,
    pagesOf(
      guild?.name ? `Names for ${plain(guild.name)}` : "Server names",
      lines,
      10,
      rows.length ? "newest first" : "nothing recorded yet — this starts counting now",
    ),
    null,
  );
}

async function cleargnames(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "clear the server's name history");
  if (!guildId) return;

  const gone = await sql<{ n: string }[]>`
    WITH removed AS (DELETE FROM guild_name_history WHERE guild_id = ${guildId} RETURNING 1)
    SELECT count(*)::text AS n FROM removed
  `;
  await card(ctx, [`### Cleared`, `-# ${gone[0]?.n ?? 0} recorded server names are gone.`]);
}

/** Called from the guild-update event, which is the only place a rename shows. */
export async function notedGuildName(guildId: string, name: string): Promise<void> {
  if (!guildId || !name) return;
  const last = await sql<{ name: string }[]>`
    SELECT name FROM guild_name_history WHERE guild_id = ${guildId} ORDER BY at DESC LIMIT 1
  `.catch(() => [] as { name: string }[]);
  if (last[0]?.name === name) return;

  await sql`INSERT INTO guild_name_history (guild_id, name) VALUES (${guildId}, ${name})`.catch(
    () => {},
  );
}

export function registerNames(): void {
  register({ name: "names", aliases: ["namehistory"], description: "View username and nickname history", handler: names });
  register({ name: "clearnames", description: "Reset your name history", handler: clearnames });
  register({ name: "gnames", description: "View guild name changes", handler: gnames });
  register({ name: "cleargnames", description: "Reset your guild's name history", handler: cleargnames });

  onMemberUpdate(async ({ guildId, userId: who }) => {
    // The event says who changed, never what to. Both the member and the user
    // have to be read back and compared with what was last recorded.
    const member = await memberOf(guildId, who).catch(() => null);
    if (!member) return;

    await remember(guildId, who, "nickname", member.nick ?? null).catch(() => {});

    const user = await api<{ username?: string; global_name?: string | null }>(`/users/${who}`).catch(
      () => null,
    );
    if (!user) return;
    await remember(null, who, "username", user.username ?? null).catch(() => {});
    await remember(null, who, "display", user.global_name ?? null).catch(() => {});
  });
}
