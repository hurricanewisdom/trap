import { sql } from "../../core/db.js";
import { dmUser, getGuild, giveRole, memberOf, takeRole } from "../../core/discord.js";
import { onMessage } from "../../core/hooks.js";
import { requireManageChannels, requireManageRoles } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, channelId, findRole, pagesOf, stamp, userId, whoever, words } from "./shared.js";
import { paginate } from "../../core/pager.js";

const MOST_WORDS = 25;

// Every keyword in every server, kept in memory because this is asked on the
// message path and nothing there is allowed to hit the database.
let watching: Map<string, { userId: string; word: string }[]> = new Map();

let loaded = false;

async function refresh(): Promise<void> {
  const rows = await sql<{ guild_id: string; user_id: string; word: string }[]>`
    SELECT guild_id, user_id, word FROM highlights
  `;
  const next = new Map<string, { userId: string; word: string }[]>();
  for (const row of rows) {
    const held = next.get(row.guild_id) ?? [];
    held.push({ userId: row.user_id, word: row.word });
    next.set(row.guild_id, held);
  }
  watching = next;
  loaded = true;
}

async function ignoredBy(guildId: string, userId2: string): Promise<Set<string>> {
  const rows = await sql<{ target_id: string }[]>`
    SELECT target_id FROM highlight_ignores
    WHERE guild_id = ${guildId} AND user_id = ${userId2}
  `;
  return new Set(rows.map((row) => row.target_id));
}

// Word boundaries, so "cat" does not fire on "concatenate".
function saidIt(content: string, word: string): boolean {
  return new RegExp(`(?:^|\\W)${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\W|$)`, "i").test(
    content,
  );
}

export function watchHighlights(): void {
  onMessage(async (event) => {
    if (!loaded) await refresh().catch(() => {});
    const held = watching.get(event.guildId);
    if (!held || held.length === 0 || !event.content) return;

    const told = new Set<string>();
    for (const one of held) {
      if (one.userId === event.authorId || told.has(one.userId)) continue;
      if (!saidIt(event.content, one.word)) continue;

      // Somebody who cannot see the channel should not be told what was said in
      // it, so membership is checked before the notification goes out.
      const member = await memberOf(event.guildId, one.userId);
      if (!member) continue;

      const ignores = await ignoredBy(event.guildId, one.userId);
      if (ignores.has(event.authorId) || ignores.has(event.channelId)) continue;
      if ((member.roles ?? []).some((role) => ignores.has(role))) continue;

      told.add(one.userId);
      const guild = await getGuild(event.guildId);
      await dmUser(one.userId, {
        content:
          `**${plain(one.word)}** was said in **${plain(guild?.name ?? "a server")}**\n` +
          `-# <@${event.authorId}> in <#${event.channelId}>\n` +
          `> ${plain(event.content, 300)}\n` +
          `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`,
      });
    }
  }, "highlight");
}

async function highlightAdd(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const word = ctx.argument.trim().toLowerCase();
  if (!word || word.length < 2 || word.length > 40) {
    await card(ctx, ["Which word?", "", "-# `highlight add <two to forty letters>`"]);
    return;
  }

  const held = await sql<{ word: string }[]>`
    SELECT word FROM highlights WHERE guild_id = ${ctx.guildId} AND user_id = ${ctx.authorId}
  `;
  if (held.length >= MOST_WORDS) {
    await card(ctx, [`That is already ${MOST_WORDS} words, which is the limit.`]);
    return;
  }

  await sql`
    INSERT INTO highlights (guild_id, user_id, word) VALUES (${ctx.guildId}, ${ctx.authorId}, ${word})
    ON CONFLICT (guild_id, user_id, word) DO NOTHING
  `;
  await refresh();
  await card(ctx, [`You will be told when **${plain(word)}** is said here.`]);
}

async function highlightRemove(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const word = ctx.argument.trim().toLowerCase();
  const gone = await sql<{ word: string }[]>`
    DELETE FROM highlights
    WHERE guild_id = ${ctx.guildId} AND user_id = ${ctx.authorId} AND word = ${word}
    RETURNING word
  `;
  await refresh();
  await card(ctx, [gone.length > 0 ? `**${plain(word)}** removed.` : "You are not watching that."]);
}

async function highlightList(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const held = await sql<{ word: string }[]>`
    SELECT word FROM highlights
    WHERE guild_id = ${ctx.guildId} AND user_id = ${ctx.authorId} ORDER BY word
  `;
  await card(ctx, [
    held.length === 0
      ? "You are watching nothing here."
      : `### ${held.length} keyword${held.length === 1 ? "" : "s"}`,
    ...(held.length === 0 ? [] : [held.map((row) => `\`${plain(row.word)}\``).join(" ")]),
  ]);
}

async function highlightReset(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const gone = await sql<{ word: string }[]>`
    DELETE FROM highlights WHERE guild_id = ${ctx.guildId} AND user_id = ${ctx.authorId}
    RETURNING word
  `;
  await refresh();
  await card(ctx, [gone.length === 0 ? "You had none." : `Cleared ${gone.length}.`]);
}

async function highlightIgnore(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const said = ctx.argument.trim();
  const target =
    userId(said) ?? channelId(said) ?? (await findRole(ctx.guildId, said))?.id ?? null;
  if (!target) {
    await card(ctx, ["Who or what?", "", "-# `highlight ignore @member`, a channel, or a role"]);
    return;
  }

  const gone = await sql<{ target_id: string }[]>`
    DELETE FROM highlight_ignores
    WHERE guild_id = ${ctx.guildId} AND user_id = ${ctx.authorId} AND target_id = ${target}
    RETURNING target_id
  `;
  if (gone.length > 0) {
    await card(ctx, ["No longer ignored."]);
    return;
  }

  await sql`
    INSERT INTO highlight_ignores (guild_id, user_id, target_id)
    VALUES (${ctx.guildId}, ${ctx.authorId}, ${target})
    ON CONFLICT (guild_id, user_id, target_id) DO NOTHING
  `;
  await card(ctx, ["Ignored. Naming it again undoes that."]);
}

async function highlightIgnoreList(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const held = [...(await ignoredBy(ctx.guildId, ctx.authorId))];
  await card(ctx, [
    held.length === 0 ? "You are ignoring nothing." : `### ${held.length} ignored`,
    ...(held.length === 0 ? [] : [held.map((id) => `<@${id}> <#${id}> <@&${id}>`.split(" ")[0] as string).join(" ")]),
    ...(held.length === 0 ? [] : ["-# members, channels and roles all look alike as ids here"]),
  ]);
}

async function seen(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const who = await whoever(ctx);
  const rows = await sql<{ at: Date; channel_id: string }[]>`
    SELECT at, channel_id FROM last_seen
    WHERE guild_id = ${ctx.guildId} AND user_id = ${who}
  `;
  const one = rows[0];
  await card(ctx, [
    one
      ? `<@${who}> was last seen ${stamp(one.at.getTime())} in <#${one.channel_id}>.`
      : `Nothing recorded for <@${who}>.`,
    ...(one ? [] : ["-# Counting starts when the bot first sees somebody speak."]),
  ]);
}

export function watchSeen(): void {
  onMessage(async (event) => {
    // One row per person, overwritten. No history is kept, because the question
    // is only ever "when was the last time".
    await sql`
      INSERT INTO last_seen (guild_id, user_id, channel_id, at)
      VALUES (${event.guildId}, ${event.authorId}, ${event.channelId}, now())
      ON CONFLICT (guild_id, user_id) DO UPDATE
        SET channel_id = EXCLUDED.channel_id, at = now()
    `.catch(() => {});
  }, "seen");
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function readDate(said: string): { month: number; day: number } | null {
  const cleaned = said.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)/g, "$1");
  const slash = cleaned.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
    return null;
  }

  const named = cleaned.match(/^([a-z]+)\s+(\d{1,2})$|^(\d{1,2})\s+([a-z]+)$/);
  if (!named) return null;
  const word = (named[1] ?? named[4] ?? "").slice(0, 3);
  const day = Number(named[2] ?? named[3]);
  const month = MONTHS.findIndex((one) => one.startsWith(word)) + 1;
  return month > 0 && day >= 1 && day <= 31 ? { month, day } : null;
}

async function birthdaySet(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const date = readDate(ctx.argument);
  if (!date) {
    await card(ctx, ["When?", "", "-# `birthday set 14 March` or `birthday set 3/14`"]);
    return;
  }

  await sql`
    INSERT INTO birthdays (guild_id, user_id, month, day)
    VALUES (${ctx.guildId}, ${ctx.authorId}, ${date.month}, ${date.day})
    ON CONFLICT (guild_id, user_id) DO UPDATE SET month = EXCLUDED.month, day = EXCLUDED.day
  `;
  await card(ctx, [
    `Noted: **${MONTHS[date.month - 1]?.replace(/^./, (c) => c.toUpperCase())} ${date.day}**.`,
    "-# Only the day and month are kept, never a year.",
  ]);
}

async function birthdayShow(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const who = await whoever(ctx);
  const rows = await sql<{ month: number; day: number }[]>`
    SELECT month, day FROM birthdays WHERE guild_id = ${ctx.guildId} AND user_id = ${who}
  `;
  const one = rows[0];
  await card(ctx, [
    one
      ? `<@${who}> — **${MONTHS[one.month - 1]?.replace(/^./, (c) => c.toUpperCase())} ${one.day}**`
      : `<@${who}> has not set one.`,
    ...(one ? [] : ["-# `birthday set 14 March`"]),
  ]);
}

async function birthdayList(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const rows = await sql<{ user_id: string; month: number; day: number }[]>`
    SELECT user_id, month, day FROM birthdays WHERE guild_id = ${ctx.guildId}
    ORDER BY month, day
  `;

  // Ordered by how soon it is rather than by calendar month, because a list of
  // birthdays is read to find the next one, not to browse January.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const soon = rows
    .map((row) => {
      let next = Date.UTC(today.getUTCFullYear(), row.month - 1, row.day);
      if (next < today.getTime()) next = Date.UTC(today.getUTCFullYear() + 1, row.month - 1, row.day);
      return { ...row, days: Math.round((next - today.getTime()) / 86_400_000) };
    })
    .sort((a, b) => a.days - b.days);

  const lines = soon.map((row) => {
    const month = (MONTHS[row.month - 1] ?? "").slice(0, 3).replace(/^./, (c) => c.toUpperCase());
    const away =
      row.days === 0 ? "**today**" : row.days === 1 ? "tomorrow" : `in ${row.days} days`;
    return `<@${row.user_id}> — ${month} ${row.day} · ${away}`;
  });

  await paginate(
    ctx,
    pagesOf(`${rows.length} birthdays`, lines, 12, "soonest first", ),
    null,
  );
}

function birthdayConfig(
  what: "role" | "channel" | "lock" | "unlock" | "config" | "celebrate" | "celebratelist",
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId =
      what === "channel"
        ? await requireManageChannels(ctx, "set the birthday channel")
        : await requireManageRoles(ctx, "change the birthday settings");
    if (!guildId) return;

    const held = await sql<{ role_id: string | null; channel_id: string | null; locked: boolean }[]>`
      SELECT role_id, channel_id, locked FROM birthday_config WHERE guild_id = ${guildId}
    `;
    const now = held[0] ?? { role_id: null, channel_id: null, locked: false };

    const save = async (patch: Record<string, unknown>): Promise<void> => {
      const next = { ...now, ...patch };
      await sql`
        INSERT INTO birthday_config (guild_id, role_id, channel_id, locked)
        VALUES (${guildId}, ${next.role_id as string | null}, ${next.channel_id as string | null}, ${next.locked as boolean})
        ON CONFLICT (guild_id) DO UPDATE
          SET role_id = EXCLUDED.role_id, channel_id = EXCLUDED.channel_id, locked = EXCLUDED.locked
      `;
    };

    if (what === "config") {
      const roles = await sql<{ role_id: string }[]>`
        SELECT role_id FROM birthday_roles WHERE guild_id = ${guildId}
      `;
      await card(ctx, [
        "### Birthdays",
        now.locked ? "Locked." : "Open.",
        `-# role given: ${now.role_id ? `<@&${now.role_id}>` : "none"}`,
        `-# announced in: ${now.channel_id ? `<#${now.channel_id}>` : "nowhere"}`,
        `-# limited to: ${roles.length === 0 ? "everybody" : roles.map((r) => `<@&${r.role_id}>`).join(" ")}`,
      ]);
      return;
    }

    if (what === "lock" || what === "unlock") {
      await save({ locked: what === "lock" });
      await card(ctx, [what === "lock" ? "Birthdays are locked." : "Birthdays are open."]);
      return;
    }

    if (what === "role" || what === "channel") {
      const said = ctx.argument.trim();
      if (what === "channel") {
        const wanted = channelId(said);
        if (!wanted) {
          await card(ctx, ["Which channel?", "", "-# `birthday channel #channel`"]);
          return;
        }
        await save({ channel_id: wanted });
        await card(ctx, [`Birthdays are announced in <#${wanted}>.`]);
        return;
      }

      const role = said ? await findRole(guildId, said) : null;
      if (!role) {
        await card(ctx, ["Which role?", "", "-# `birthday role @role`"]);
        return;
      }
      await save({ role_id: role.id });
      await card(ctx, [`<@&${role.id}> is given on somebody's birthday.`]);
      return;
    }

    if (what === "celebratelist") {
      const roles = await sql<{ role_id: string }[]>`
        SELECT role_id FROM birthday_roles WHERE guild_id = ${guildId}
      `;
      await card(ctx, [
        roles.length === 0
          ? "Everybody is celebrated."
          : `${roles.length} celebrated: ${roles.map((r) => `<@&${r.role_id}>`).join(" ")}`,
      ]);
      return;
    }

    const role = ctx.argument.trim() ? await findRole(guildId, ctx.argument.trim()) : null;
    if (!role) {
      await card(ctx, ["Which role?", "", "-# `birthday celebrate @role`"]);
      return;
    }

    const gone = await sql<{ role_id: string }[]>`
      DELETE FROM birthday_roles WHERE guild_id = ${guildId} AND role_id = ${role.id}
      RETURNING role_id
    `;
    if (gone.length > 0) {
      await card(ctx, [`<@&${role.id}> is no longer required.`]);
      return;
    }
    await sql`
      INSERT INTO birthday_roles (guild_id, role_id) VALUES (${guildId}, ${role.id})
      ON CONFLICT (guild_id, role_id) DO NOTHING
    `;
    await card(ctx, [`Only members with <@&${role.id}> are celebrated.`]);
  };
}

const ZONES = new Map<string, string>();

async function timezoneSet(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Where?", "", "-# `timezone set Europe/London`"]);
    return;
  }

  // Node knows every zone name, so no service is needed to check one.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: said }).format(new Date());
  } catch {
    await card(ctx, [
      `**${plain(said)}** is not a timezone.`,
      "",
      "-# They look like `Europe/London` or `America/New_York`.",
    ]);
    return;
  }

  await sql`
    INSERT INTO timezones (user_id, zone) VALUES (${ctx.authorId}, ${said})
    ON CONFLICT (user_id) DO UPDATE SET zone = EXCLUDED.zone
  `;
  ZONES.set(ctx.authorId, said);
  await card(ctx, [`Your timezone is **${plain(said)}**.`]);
}

async function timezoneShow(ctx: PrefixContext): Promise<void> {
  const who = await whoever(ctx);
  const rows = await sql<{ zone: string }[]>`SELECT zone FROM timezones WHERE user_id = ${who}`;
  const zone = rows[0]?.zone;
  if (!zone) {
    await card(ctx, [`<@${who}> has not set one.`, "", "-# `timezone set Europe/London`"]);
    return;
  }

  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
  await card(ctx, [`<@${who}> — **${now}**`, `-# ${plain(zone)}`]);
}

async function timezoneList(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;

  const rows = await sql<{ user_id: string; zone: string }[]>`
    SELECT t.user_id, t.zone FROM timezones t
  `;

  // Sorted by what time it is where they are, so the people awake sit together.
  const shown = rows
    .map((row) => {
      let at = "??:??";
      let offset = "";
      try {
        at = new Intl.DateTimeFormat("en-GB", {
          timeZone: row.zone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date());
        offset =
          new Intl.DateTimeFormat("en-GB", { timeZone: row.zone, timeZoneName: "shortOffset" })
            .formatToParts(new Date())
            .find((part) => part.type === "timeZoneName")?.value ?? "";
      } catch {
        // A zone that stops being valid should not take the whole list with it.
      }
      return { ...row, at, offset };
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const lines = shown.map(
    (row) => `<@${row.user_id}> — **${row.at}** · ${plain(row.zone)}${row.offset ? ` (${row.offset})` : ""}`,
  );

  await paginate(ctx, pagesOf(`${rows.length} timezones`, lines, 12, "by local time"), null);
}

function under(owner: string, fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn(owner, sub) : undefined;
    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerPersonal(): void {
  watchHighlights();
  watchSeen();

  register({
    name: "highlight",
    aliases: ["hl"],
    description: "Set notifications for when a keyword is said",
    handler: under("highlight", highlightList),
  });
  groupUnder("highlight", () => {
    register({ name: "add", description: "Add a highlighted keyword", handler: highlightAdd });
    register({ name: "remove", description: "Remove a highlighted keyword", handler: highlightRemove });
    register({ name: "list", description: "List all keywords set in a server", handler: highlightList });
    register({ name: "reset", description: "Reset your highlighted keywords", handler: highlightReset });
    register({
      name: "ignore",
      description: "Ignore notifications from a member, channel or role",
      handler: under("highlight ignore", highlightIgnore),
    });
    groupUnder("highlight ignore", () => {
      register({ name: "list", description: "List all ignored members, channels and roles", handler: highlightIgnoreList });
    });
  });

  register({ name: "seen", description: "When a member was last seen", handler: seen });

  register({
    name: "birthday",
    aliases: ["bday"],
    description: "View your birthday or somebody else's",
    handler: under("birthday", birthdayShow),
  });
  groupUnder("birthday", () => {
    register({ name: "set", description: "Set your birthday", handler: birthdaySet });
    register({ name: "list", description: "View every member's birthday", handler: birthdayList });
    register({ name: "config", description: "View the birthday config", handler: birthdayConfig("config") });
    register({ name: "role", description: "Set the birthday role", handler: birthdayConfig("role") });
    register({ name: "channel", description: "Set the birthday channel", handler: birthdayConfig("channel") });
    register({ name: "lock", description: "Lock the birthday system", handler: birthdayConfig("lock") });
    register({ name: "unlock", description: "Unlock the birthday system", handler: birthdayConfig("unlock") });
    register({
      name: "celebrate",
      description: "Limit celebration to certain roles",
      handler: under("birthday celebrate", birthdayConfig("celebrate")),
    });
    groupUnder("birthday celebrate", () => {
      register({ name: "list", description: "List celebrated roles", handler: birthdayConfig("celebratelist") });
    });
  });

  register({
    name: "timezone",
    aliases: ["tz"],
    description: "View your current time or somebody else's",
    handler: under("timezone", timezoneShow),
  });
  groupUnder("timezone", () => {
    register({ name: "set", description: "Set your timezone", handler: timezoneSet });
    register({ name: "list", description: "View every member's timezone", handler: timezoneList });
  });
}

export { giveRole, takeRole };
