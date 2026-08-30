import { sql } from "../../../core/db.js";
import { canManageGuild, displayName, guildMemberIds } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { lookup, register, type PrefixContext } from "../../../core/prefix.js";
import { redis } from "../../../core/redis.js";
import { guard } from "../guard.js";
import { USER_ACCENT, buildPages, label, plural, simpleCard } from "../shared.js";

const CONCURRENCY = 5;

const LIST_LIMIT = 100;

const CACHE_CAP = 5000;

const MEMBER_LIST_CAP = 5000;

const CACHE_TTL = 60;

const WORD = /^[A-Za-z0-9_-]{2,20}$/;

const MEMBER = /^(?:<@!?(\d{15,25})>|(\d{15,25}))(?=\s|$)/;

const HEADING = "Custom command";

const cacheKey = (guildId: string) => `trap:lf:cc:${guildId}`;

interface CachedOwner {
  d: string;
  p: boolean;
}

type CommandMap = Record<string, CachedOwner | undefined>;

interface WordRow {
  discord_id: string;
  command: string;
  is_public: boolean;
}

async function loadMap(guildId: string): Promise<CommandMap> {
  const key = cacheKey(guildId);
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as CommandMap;
  } catch {}

  const rows = await sql<WordRow[]>`
    SELECT discord_id, command, is_public
    FROM lastfm_custom_commands
    WHERE guild_id = ${guildId}
    ORDER BY created_at ASC
    LIMIT ${CACHE_CAP}
  `;

  const map = Object.create(null) as CommandMap;
  for (const row of rows) {
    map[row.command.toLowerCase()] = { d: row.discord_id, p: row.is_public === true };
  }

  redis.set(key, JSON.stringify(map), "EX", CACHE_TTL).catch(() => {});
  return map;
}

async function invalidate(guildId: string): Promise<void> {
  await redis.del(cacheKey(guildId)).catch(() => {});
}

export async function listCustomCommands(
  guildId: string,
  viewerId: string,
): Promise<{ word: string; discordId: string; isPublic: boolean }[]> {
  const map = await loadMap(guildId);

  return Object.entries(map)
    .flatMap(([word, entry]) => {
      if (!entry || typeof entry.d !== "string") return [];
      const isPublic = entry.p === true;
      if (!isPublic && entry.d !== viewerId) return [];
      return [{ word, discordId: entry.d, isPublic }];
    })
    .sort((a, b) => a.word.localeCompare(b.word));
}

export async function findCustomCommand(
  guildId: string,
  word: string,
): Promise<{ discordId: string; isPublic: boolean } | null> {
  const key = word.trim().toLowerCase();
  if (!WORD.test(key)) return null;

  const map = await loadMap(guildId);
  const entry = map[key];
  if (!entry || typeof entry.d !== "string") return null;
  return { discordId: entry.d, isPublic: entry.p === true };
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  results.length = items.length;
  let cursor = 0;

  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];

        if (item === undefined) continue;
        results[index] = await worker(item);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

const memberName = (name: string) => label(name);

const code = (value: string) => value.slice(0, 40).replaceAll("`", "ˋ");

function when(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor(date.getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:R>` : null;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  return (err as { code?: unknown }).code === "23505";
}

async function requireGuild(ctx: PrefixContext): Promise<string | null> {
  if (ctx.guildId) return ctx.guildId;
  await paginate(
    ctx,
    simpleCard(HEADING, "This only works inside a server, not in DMs."),
    USER_ACCENT,
  );
  return null;
}

async function requireManager(
  ctx: PrefixContext,
  guildId: string,
  what: string,
): Promise<boolean> {
  if (await canManageGuild(guildId, ctx.authorId)) return true;
  await paginate(
    ctx,
    simpleCard(HEADING, `${what} needs the **Manage Server** permission.`),
    USER_ACCENT,
  );
  return false;
}

async function say(ctx: PrefixContext, body: string, heading = HEADING): Promise<void> {
  await paginate(ctx, simpleCard(heading, body), USER_ACCENT);
}

function memberIn(text: string): string | null {
  const match = MEMBER.exec(text.trim());
  return match?.[1] ?? match?.[2] ?? null;
}

const restOf = (argument: string) => argument.trim().replace(/^\S+\s*/, "").trim();

async function isBlacklisted(guildId: string, discordId: string): Promise<boolean> {
  const rows = await sql<{ discord_id: string }[]>`
    SELECT discord_id
    FROM lastfm_cc_blacklist
    WHERE guild_id = ${guildId} AND discord_id = ${discordId}
  `;
  return rows.length > 0;
}

async function setWord(ctx: PrefixContext, guildId: string, raw: string): Promise<void> {
  const word = raw.trim();

  if (!WORD.test(word)) {
    await say(
      ctx,
      [
        "A custom command is **2-20 characters**, and only letters, digits, `-` and `_`.",
        "",
        "-# Example: `,cc vibes`, then `,vibes` shows your now playing.",
      ].join("\n"),
    );
    return;
  }

  if (await isBlacklisted(guildId, ctx.authorId)) {
    await say(
      ctx,
      "You are blacklisted from custom commands in this server. A moderator can lift it with `,cc blacklist @you`.",
    );
    return;
  }

  if (lookup(word)) {
    await say(ctx, `\`${code(word)}\` is already one of my own commands. Pick another word.`);
    return;
  }

  const taken = await sql<{ discord_id: string }[]>`
    SELECT discord_id
    FROM lastfm_custom_commands
    WHERE guild_id = ${guildId} AND lower(command) = lower(${word})
  `;
  const owner = taken[0]?.discord_id;
  if (owner && owner !== ctx.authorId) {
    const name = memberName(await displayName(guildId, owner));
    await say(ctx, `\`${code(word)}\` is already taken by **${name}** in this server.`);
    return;
  }

  try {
    await sql`
      INSERT INTO lastfm_custom_commands (guild_id, discord_id, command)
      VALUES (${guildId}, ${ctx.authorId}, ${word})
      ON CONFLICT (guild_id, discord_id)
      DO UPDATE SET command = EXCLUDED.command
    `;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await say(ctx, `\`${code(word)}\` was just claimed by someone else. Pick another word.`);
    return;
  }

  await invalidate(guildId);
  await say(
    ctx,
    `Your custom command is now \`,${code(word)}\`. Running it here shows your now playing.\n-# \`,cc remove\` to drop it.`,
  );
}

async function removeWord(ctx: PrefixContext, guildId: string, rest: string): Promise<void> {
  const argument = rest.trim();
  const mentioned = memberIn(argument);

  if (argument && !mentioned) {
    await say(ctx, "Use `,cc remove` for your own, or `,cc remove @member` for someone else's.");
    return;
  }

  const targetId = mentioned ?? ctx.authorId;
  const explicit = targetId !== ctx.authorId;

  if (explicit && !(await requireManager(ctx, guildId, "Removing someone else's custom command"))) {
    return;
  }

  const removed = await sql<{ command: string }[]>`
    DELETE FROM lastfm_custom_commands
    WHERE guild_id = ${guildId} AND discord_id = ${targetId}
    RETURNING command
  `;

  if (removed.length === 0) {
    if (explicit) {
      const name = memberName(await displayName(guildId, targetId));
      await say(ctx, `**${name}** does not have a custom command in this server.`);
      return;
    }
    await say(ctx, "You do not have a custom command in this server. Set one with `,cc <word>`.");
    return;
  }

  await invalidate(guildId);
  const word = code(removed[0]?.command ?? "");

  if (explicit) {
    const name = memberName(await displayName(guildId, targetId));
    await say(ctx, `Removed **${name}**'s custom command \`,${word}\`.`);
    return;
  }
  await say(ctx, `Removed your custom command \`,${word}\`.`);
}

interface ListRow {
  discord_id: string;
  command: string;
  is_public: boolean;
  total: string;
}

async function listWords(ctx: PrefixContext, guildId: string): Promise<void> {
  if (!(await requireManager(ctx, guildId, "Listing this server's custom commands"))) return;

  const heading = "Custom commands";

  const rows = await sql<ListRow[]>`
    SELECT discord_id, command, is_public, COUNT(*) OVER () AS total
    FROM lastfm_custom_commands
    WHERE guild_id = ${guildId}
    ORDER BY lower(command) ASC
    LIMIT ${LIST_LIMIT}
  `;

  if (rows.length === 0) {
    await say(
      ctx,
      "Nobody has set a custom command in this server yet. Run `,cc <word>` to claim one.",
      heading,
    );
    return;
  }

  const names = await mapLimited(rows, CONCURRENCY, (row) => displayName(guildId, row.discord_id));

  const lines = rows.map((row, i) => {
    const name = memberName(names[i] ?? "unknown");
    const flag = row.is_public ? " · public" : "";
    return `\`${i + 1}\` **${name}** · \`,${code(row.command)}\`${flag}`;
  });

  const total = Number(rows[0]?.total ?? rows.length) || rows.length;

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: heading,
      noun: total === 1 ? "custom command" : "custom commands",
      total,
      ...(total > rows.length
        ? {
            footer: `first ${rows.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} custom commands`,
          }
        : {}),
    }),
    USER_ACCENT,
  );
}

async function reset(ctx: PrefixContext, guildId: string): Promise<void> {
  if (!(await requireManager(ctx, guildId, "Resetting this server's custom commands"))) return;

  const removed = await sql<{ discord_id: string }[]>`
    DELETE FROM lastfm_custom_commands
    WHERE guild_id = ${guildId}
    RETURNING discord_id
  `;

  await invalidate(guildId);

  if (removed.length === 0) {
    await say(ctx, "There were no custom commands in this server to remove.");
    return;
  }
  await say(ctx, `Removed ${plural(removed.length, "custom command")} from this server.`);
}

async function cleanup(ctx: PrefixContext, guildId: string): Promise<void> {
  if (!(await requireManager(ctx, guildId, "Cleaning up this server's custom commands"))) return;

  const note =
    "-# This is normally an Administrator action; **Manage Server** is the closest permission I can check, so that is what I used.";

  const members = await guildMemberIds(guildId);

  if (members.size === 0) {
    await say(
      ctx,
      `I could not read this server's member list, so I will not delete anything.\n${note}`,
    );
    return;
  }

  if (members.size >= MEMBER_LIST_CAP) {
    await say(
      ctx,
      [
        `I can only read the first ${MEMBER_LIST_CAP.toLocaleString("en-US")} members of a server, and this one is at that limit.`,
        "Cleanup would delete commands owned by members I never saw, so I stopped.",
        "",
        "-# Use `,cc remove @member` for individual commands.",
      ].join("\n"),
    );
    return;
  }

  const rows = await sql<{ discord_id: string }[]>`
    SELECT discord_id
    FROM lastfm_custom_commands
    WHERE guild_id = ${guildId}
    LIMIT ${CACHE_CAP}
  `;

  const stale = rows.map((row) => row.discord_id).filter((id) => !members.has(id));

  if (stale.length === 0) {
    await say(ctx, `Every custom command here belongs to a current member.\n${note}`);
    return;
  }

  const removed = await sql<{ discord_id: string }[]>`
    DELETE FROM lastfm_custom_commands
    WHERE guild_id = ${guildId} AND discord_id = ANY(${stale}::text[])
    RETURNING discord_id
  `;

  await invalidate(guildId);
  await say(
    ctx,
    `Removed ${plural(removed.length, "custom command")} whose owner has left the server.\n${note}`,
  );
}

interface PublicRow {
  discord_id: string;
  command: string;
  is_public: boolean;
}

async function togglePublic(ctx: PrefixContext, guildId: string, rest: string): Promise<void> {
  if (!(await requireManager(ctx, guildId, "Changing who may run a custom command"))) return;

  const argument = rest.trim();
  const mentioned = memberIn(argument);
  const token = argument.split(/\s+/)[0] ?? "";

  let rows: PublicRow[];

  if (!argument) {
    rows = await sql<PublicRow[]>`
      UPDATE lastfm_custom_commands
      SET is_public = NOT is_public
      WHERE guild_id = ${guildId} AND discord_id = ${ctx.authorId}
      RETURNING discord_id, command, is_public
    `;
    if (rows.length === 0) {
      await say(ctx, "You do not have a custom command in this server to make public.");
      return;
    }
  } else if (mentioned) {
    rows = await sql<PublicRow[]>`
      UPDATE lastfm_custom_commands
      SET is_public = NOT is_public
      WHERE guild_id = ${guildId} AND discord_id = ${mentioned}
      RETURNING discord_id, command, is_public
    `;
    if (rows.length === 0) {
      const name = memberName(await displayName(guildId, mentioned));
      await say(ctx, `**${name}** does not have a custom command in this server.`);
      return;
    }
  } else if (WORD.test(token)) {
    rows = await sql<PublicRow[]>`
      UPDATE lastfm_custom_commands
      SET is_public = NOT is_public
      WHERE guild_id = ${guildId} AND lower(command) = lower(${token})
      RETURNING discord_id, command, is_public
    `;
    if (rows.length === 0) {
      await say(ctx, `No custom command in this server uses the word \`${code(token)}\`.`);
      return;
    }
  } else {
    await say(ctx, "Use `,cc public`, `,cc public <word>`, or `,cc public @member`.");
    return;
  }

  await invalidate(guildId);

  const row = rows[0];
  if (!row) {
    await say(ctx, "Nothing changed.");
    return;
  }

  const name = memberName(await displayName(guildId, row.discord_id));
  const word = code(row.command);

  await say(
    ctx,
    row.is_public
      ? `\`,${word}\` is now **public**. Anyone here can run it to see **${name}**'s now playing.`
      : `\`,${word}\` is now **private**. Only **${name}** can run it.`,
  );
}

interface BlacklistRow {
  discord_id: string;
  blocked_at: Date | string | null;
}

async function blacklistList(ctx: PrefixContext, guildId: string): Promise<void> {
  const heading = "Custom command blacklist";

  const rows = await sql<BlacklistRow[]>`
    SELECT discord_id, blocked_at
    FROM lastfm_cc_blacklist
    WHERE guild_id = ${guildId}
    ORDER BY blocked_at DESC
    LIMIT ${LIST_LIMIT}
  `;

  if (rows.length === 0) {
    await say(ctx, "Nobody is blacklisted from custom commands in this server.", heading);
    return;
  }

  const names = await mapLimited(rows, CONCURRENCY, (row) => displayName(guildId, row.discord_id));

  const lines = rows.map((row, i) => {
    const name = memberName(names[i] ?? "unknown");
    const stamp = when(row.blocked_at);
    return `\`${i + 1}\` **${name}**${stamp ? ` · blacklisted ${stamp}` : ""}`;
  });

  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: heading,
      noun: "blacklisted members",
      total: rows.length,
      footer:
        rows.length === LIST_LIMIT
          ? `first ${LIST_LIMIT} blacklisted members • \`,cc blacklist @member\` to lift one`
          : `${plural(rows.length, "blacklisted member")} • \`,cc blacklist @member\` to lift one`,
    }),
    USER_ACCENT,
  );
}

async function blacklist(ctx: PrefixContext, guildId: string, rest: string): Promise<void> {
  if (!(await requireManager(ctx, guildId, "Managing the custom command blacklist"))) return;

  const argument = rest.trim();

  if (/^list(\s|$)/i.test(argument)) {
    await blacklistList(ctx, guildId);
    return;
  }

  const targetId = memberIn(argument);
  if (!targetId) {
    await say(
      ctx,
      "Mention who to blacklist: `,cc blacklist @member`.\n-# `,cc blacklist list` shows who is already blacklisted.",
    );
    return;
  }

  const name = memberName(await displayName(guildId, targetId));

  const lifted = await sql<{ discord_id: string }[]>`
    DELETE FROM lastfm_cc_blacklist
    WHERE guild_id = ${guildId} AND discord_id = ${targetId}
    RETURNING discord_id
  `;

  if (lifted.length > 0) {
    await say(ctx, `**${name}** may set a custom command again.`);
    return;
  }

  await sql`
    INSERT INTO lastfm_cc_blacklist (guild_id, discord_id, blocked_by)
    VALUES (${guildId}, ${targetId}, ${ctx.authorId})
    ON CONFLICT (guild_id, discord_id) DO NOTHING
  `;

  const dropped = await sql<{ command: string }[]>`
    DELETE FROM lastfm_custom_commands
    WHERE guild_id = ${guildId} AND discord_id = ${targetId}
    RETURNING command
  `;

  if (dropped.length > 0) await invalidate(guildId);

  const removedWord = dropped[0]?.command;
  const detail = removedWord
    ? ` Their custom command \`,${code(removedWord)}\` was removed.`
    : "";

  await say(
    ctx,
    `**${name}** is blacklisted from custom commands here.${detail}\n-# Run \`,cc blacklist @member\` on them again to undo it.`,
  );
}

async function help(ctx: PrefixContext): Promise<void> {
  await say(
    ctx,
    [
      "Claim a word that shows your now playing in this server.",
      "",
      "`,cc <word>` · set yours, e.g. `,cc vibes` then `,vibes`",
      "`,cc remove [@member]` · remove yours (someone else's needs Manage Server)",
      "`,cc list` · every custom command here **(Manage Server)**",
      "`,cc reset` · delete them all **(Manage Server)**",
      "`,cc cleanup` · delete the ones whose owner left **(Manage Server)**",
      "`,cc public [word]` · toggle who may run one **(Manage Server)**",
      "`,cc blacklist @member` · block a member **(Manage Server)**",
      "`,cc blacklist list` · who is blocked **(Manage Server)**",
      "",
      "-# Words are 2-20 characters of letters, digits, `-` and `_`.",
      "-# The subcommands above are reserved and cannot be claimed as words.",
    ].join("\n"),
  );
}

async function handle(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx);
  if (!guildId) return;

  const argument = ctx.argument.trim();

  const first = argument.split(/\s+/)[0] ?? "";
  const rest = restOf(argument);

  switch (first.toLowerCase()) {
    case "":
      await help(ctx);
      return;
    case "remove":
    case "delete":
    case "unset":
      await removeWord(ctx, guildId, rest);
      return;
    case "list":
      await listWords(ctx, guildId);
      return;
    case "reset":
    case "clear":
      await reset(ctx, guildId);
      return;
    case "cleanup":
      await cleanup(ctx, guildId);
      return;

    case "public":
      await togglePublic(ctx, guildId, rest);
      return;
    case "blacklist":
      await blacklist(ctx, guildId, rest);
      return;
    case "help":
      await help(ctx);
      return;
    default:

      await setWord(ctx, guildId, first);
  }
}

export function registerCustomCommands(): void {
  register({
    name: "customcommand",
    aliases: ["cc"],
    description: "Claim a word for your now playing",
    handler: guard(handle),
  });
}
