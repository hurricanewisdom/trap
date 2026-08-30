/**
 * Per-user and per-server Last.fm preferences: the now-playing layout, the
 * card colour, and the up/down reactions a now-playing post is seeded with.
 *
 * `,np` reads all three on every single invocation, so each row is cached in
 * Redis for a minute and the key is deleted the moment a command writes. A
 * setting somebody just changed has to apply to their next command, not a
 * minute later. Misses are cached as well: most people never touch any of
 * this, so "no row" is the common read and it belongs in the cache too.
 *
 * Nothing in this file fans out over a member list; the only Discord API call
 * is the single permission check on `,react`.
 */

import { sql } from "../../core/db.js";
import { canManageGuild } from "../../core/discord.js";
import { paginate } from "../../core/pager.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { redis } from "../../core/redis.js";
import { guard } from "./guard.js";
import { EMBED_COLOR, simpleCard } from "./shared.js";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

/** The now-playing layouts, with the blurb each one is listed with. */
const MODES = [
  { name: "default", blurb: "the two-column Track/Artist embed" },
  { name: "compact", blurb: "a single line" },
  { name: "detailed", blurb: "adds album, plays and total scrobbles" },
  { name: "container", blurb: "the same card style as the rest of the bot" },
  { name: "custom", blurb: "your own layout, built with ,card" },
] as const;

/** Public list of valid `np_mode` values, in the order they are shown. */
export const NP_MODES: readonly string[] = MODES.map((mode) => mode.name);

/** What an unset (or retired) mode resolves to. */
const DEFAULT_NP_MODE = "default";

export const DEFAULT_UPVOTE = "\u{1F44D}";
export const DEFAULT_DOWNVOTE = "\u{1F44E}";

/** Long enough to absorb a burst of commands, short enough to feel live. */
const SETTINGS_TTL = 60;

/** Words that mean "put this back to how it shipped". */
const RESET_WORDS = new Set(["default", "reset", "clear", "none", "off"]);

const userKey = (discordId: string) => `trap:lf:settings:user:${discordId}`;
const guildKey = (guildId: string) => `trap:lf:settings:guild:${guildId}`;

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

/** Internal shapes: the module's exported surface is the four helpers below. */
interface UserSettings {
  npMode: string | null;
  color: number | null;
  upvote: string | null;
  downvote: string | null;
}

interface GuildSettings {
  upvote: string | null;
  downvote: string | null;
}

interface UserRow {
  np_mode: string | null;
  /** INTEGER, so the driver hands back a number, but tolerate a string. */
  color: number | string | null;
  upvote: string | null;
  downvote: string | null;
}

interface GuildRow {
  upvote: string | null;
  downvote: string | null;
}

/** Anything outside 24-bit RGB is not a colour Discord can paint. */
function toColor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffff ? parsed : null;
}

async function readUserSettings(discordId: string): Promise<UserSettings> {
  try {
    const hit = await redis.get(userKey(discordId));
    // The parse lives inside the try so a corrupt value falls through to
    // Postgres instead of throwing out of a read on the `,np` hot path.
    if (hit) return JSON.parse(hit) as UserSettings;
  } catch {
    /* cache down or unreadable, read through */
  }

  const rows = await sql<UserRow[]>`
    SELECT np_mode, color, upvote, downvote
    FROM lastfm_user_settings
    WHERE discord_id = ${discordId}
  `;
  const row = rows[0];
  const settings: UserSettings = {
    npMode: row?.np_mode ?? null,
    color: toColor(row?.color),
    upvote: row?.upvote ?? null,
    downvote: row?.downvote ?? null,
  };

  redis
    .set(userKey(discordId), JSON.stringify(settings), "EX", SETTINGS_TTL)
    .catch(() => {});
  return settings;
}

async function readGuildSettings(guildId: string): Promise<GuildSettings> {
  try {
    const hit = await redis.get(guildKey(guildId));
    if (hit) return JSON.parse(hit) as GuildSettings;
  } catch {
    /* cache down or unreadable, read through */
  }

  const rows = await sql<GuildRow[]>`
    SELECT upvote, downvote
    FROM lastfm_guild_settings
    WHERE guild_id = ${guildId}
  `;
  const row = rows[0];
  const settings: GuildSettings = {
    upvote: row?.upvote ?? null,
    downvote: row?.downvote ?? null,
  };

  redis.set(guildKey(guildId), JSON.stringify(settings), "EX", SETTINGS_TTL).catch(() => {});
  return settings;
}

/** Dropped rather than rewritten: the next read repopulates from the row. */
async function invalidateUser(discordId: string): Promise<void> {
  await redis.del(userKey(discordId)).catch(() => {});
}

async function invalidateGuild(guildId: string): Promise<void> {
  await redis.del(guildKey(guildId)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Public reads: what the rest of the bot calls                       */
/* ------------------------------------------------------------------ */

export async function getNpMode(discordId: string): Promise<string> {
  const { npMode } = await readUserSettings(discordId);
  // Validated on the way out as well as on the way in, so retiring a mode
  // later cannot strand whoever had it selected.
  return npMode !== null && NP_MODES.includes(npMode) ? npMode : DEFAULT_NP_MODE;
}

export async function resolveColor(discordId: string): Promise<number> {
  const { color } = await readUserSettings(discordId);
  // 0x000000 is a legitimate choice, so this tests for null; `color ||` would
  // silently turn a deliberate black card back into the house grey.
  return color === null ? EMBED_COLOR : color;
}

/**
 * The reactions a now-playing post should carry: the poster's own pair wins,
 * then the server's, then the built-in ones. Each side falls back
 * independently, so setting only one of them still works.
 */
export async function resolveReactions(
  discordId: string,
  guildId?: string,
): Promise<{ upvote: string; downvote: string }> {
  const [user, guildPair] = await Promise.all([
    readUserSettings(discordId),
    guildId ? readGuildSettings(guildId) : Promise.resolve(null),
  ]);

  return {
    upvote: user.upvote ?? guildPair?.upvote ?? DEFAULT_UPVOTE,
    downvote: user.downvote ?? guildPair?.downvote ?? DEFAULT_DOWNVOTE,
  };
}

/* ------------------------------------------------------------------ */
/* Emoji parsing                                                      */
/* ------------------------------------------------------------------ */

/** `<:name:id>` / `<a:name:id>`, i.e. what a custom emoji looks like typed. */
const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/;
/** The stored form: exactly the `name:id` the reaction endpoint expects. */
const STORED_CUSTOM = /^([A-Za-z0-9_]{2,32}):(\d{15,25})$/;

/**
 * Every code point a unicode emoji token may be built from: the pictographs
 * themselves, skin-tone modifiers, regional indicators (flags), and the joining
 * scaffolding: ZWJ, both variation selectors, the keycap mark, and the tag
 * range a subdivision flag such as the Scottish one is spelled with. Written as
 * escapes on purpose: every one of these is invisible in an editor.
 */
const EMOJI_TOKEN =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[#*0-9\u200d\ufe0f\ufe0e\u20e3\u{E0020}-\u{E007F}])+$/u;
/** ...and at least one of these, so "1" or a lone variation selector is out. */
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;

/** A tag-sequence flag is the longest thing that legitimately gets here. */
const MAX_EMOJI_UNITS = 16;

/**
 * Rejects "two emoji crammed into one argument" without dragging in a grapheme
 * segmenter: each ZWJ-joined part may carry at most one pictograph, and only a
 * flag may be two regional indicators. A ZWJ family sequence, a skin-toned
 * thumb and a flag all pass; two unjoined pictographs do not.
 */
function looksLikeOneEmoji(token: string): boolean {
  if (token.length === 0 || token.length > MAX_EMOJI_UNITS) return false;

  let regionals = 0;
  for (const part of token.split("\u200d")) {
    let pictographs = 0;
    for (const char of part) {
      if (PICTOGRAPH.test(char)) pictographs++;
      else if (REGIONAL.test(char)) regionals++;
    }
    if (pictographs > 1) return false;
  }
  return regionals <= 2;
}

/**
 * Turns what somebody typed into the token stored in the database.
 *
 * A custom emoji is written `<:name:id>` in a message, but the reaction API
 * takes it as `name:id` (discordeno percent-encodes the string straight into
 * the `PUT /channels/../reactions/{emoji}/@me` path), so the angle brackets are
 * stripped once here rather than at every use. The `a:` animated flag has
 * nowhere to live in that form and is dropped: Discord resolves a reaction by
 * id, so an animated emoji still animates *as a reaction*; only the echo inside
 * these cards renders static.
 *
 * Returns null for anything it cannot read, which the callers turn into a
 * message rather than storing junk that would silently fail to react.
 */
function parseEmoji(input: string): string | null {
  const token = input.trim();

  const custom = CUSTOM_EMOJI.exec(token);
  if (custom) {
    const name = custom[2];
    const id = custom[3];
    return name && id ? `${name}:${id}` : null;
  }

  // Somebody pasting a stored value back in should not be told it is invalid.
  if (STORED_CUSTOM.test(token)) return token;

  if (EMOJI_TOKEN.test(token) && EMOJI_CORE.test(token) && looksLikeOneEmoji(token)) {
    return token;
  }
  return null;
}

/** Renders a stored token back into something a Discord client will draw. */
function showEmoji(token: string): string {
  const stored = STORED_CUSTOM.exec(token);
  if (stored) return `<:${stored[1] ?? ""}:${stored[2] ?? ""}>`;
  if (EMOJI_TOKEN.test(token)) return token;
  // A value that reached the table some other way is shown as inert text.
  return `\`${token.replaceAll("`", "'").replace(/[\r\n]+/g, " ").slice(0, 32)}\``;
}

/**
 * Echoes a rejected argument back safely. Backticks would escape the inline
 * code span and `@`/`<`/`>` are what every mention form is built from, so all
 * of them are removed rather than escaped.
 */
function quoteInput(value: string): string {
  const cleaned = value.replace(/[`@<>\r\n]/g, "").trim().slice(0, 32);
  return cleaned ? `\`${cleaned}\`` : "that";
}

/* ------------------------------------------------------------------ */
/* Card helpers                                                       */
/* ------------------------------------------------------------------ */

async function card(
  ctx: PrefixContext,
  heading: string,
  body: string,
  accent: number = EMBED_COLOR,
): Promise<void> {
  await paginate(ctx, simpleCard(heading, body), accent);
}

/** Guild-only guard: server settings do not exist in a DM. */
async function requireGuild(ctx: PrefixContext, heading: string): Promise<string | null> {
  if (ctx.guildId) return ctx.guildId;
  await card(ctx, heading, "This only works inside a server, not in DMs.");
  return null;
}

const words = (argument: string): string[] => argument.trim().split(/\s+/).filter(Boolean);

/* ------------------------------------------------------------------ */
/* ,lfmode                                                            */
/* ------------------------------------------------------------------ */

async function writeNpMode(discordId: string, mode: string | null): Promise<void> {
  // Only this column is listed, so a new row leaves colour and reactions NULL
  // and an existing row keeps whatever they were set to.
  await sql`
    INSERT INTO lastfm_user_settings (discord_id, np_mode)
    VALUES (${discordId}, ${mode}::text)
    ON CONFLICT (discord_id) DO UPDATE
      SET np_mode = EXCLUDED.np_mode, updated_at = now()
  `;
  await invalidateUser(discordId);
}

async function npMode(ctx: PrefixContext): Promise<void> {
  const heading = "Now playing style";
  const current = await getNpMode(ctx.authorId);
  const listing = MODES.map(
    (mode) => `\`${mode.name}\`: ${mode.blurb}${mode.name === current ? " (current)" : ""}`,
  ).join("\n");

  const wanted = (words(ctx.argument)[0] ?? "").toLowerCase();

  if (!wanted) {
    await card(
      ctx,
      heading,
      `Your style is **${current}**.\n\n${listing}\n\n-# \`,lfmode <style>\` to change it.`,
    );
    return;
  }

  // "reset" clears the row's value; "default" is also a real mode, so it is
  // stored literally by the branch below and means the same thing either way.
  if (wanted !== DEFAULT_NP_MODE && RESET_WORDS.has(wanted)) {
    await writeNpMode(ctx.authorId, null);
    await card(ctx, heading, `Back to **${DEFAULT_NP_MODE}**: ${MODES[0]?.blurb ?? ""}.`);
    return;
  }

  if (!NP_MODES.includes(wanted)) {
    await card(
      ctx,
      heading,
      `${quoteInput(wanted)} is not a style I know.\n\n${listing}`,
    );
    return;
  }

  await writeNpMode(ctx.authorId, wanted);
  const blurb = MODES.find((mode) => mode.name === wanted)?.blurb ?? "";
  await card(ctx, heading, `Your now playing style is **${wanted}**: ${blurb}.`);
}

/* ------------------------------------------------------------------ */
/* ,lfcolor                                                           */
/* ------------------------------------------------------------------ */

const HEX = /^#?([0-9a-fA-F]{6})$/;

const hexOf = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

async function writeColor(discordId: string, color: number | null): Promise<void> {
  await sql`
    INSERT INTO lastfm_user_settings (discord_id, color)
    VALUES (${discordId}, ${color}::int)
    ON CONFLICT (discord_id) DO UPDATE
      SET color = EXCLUDED.color, updated_at = now()
  `;
  await invalidateUser(discordId);
}

async function npColor(ctx: PrefixContext): Promise<void> {
  const heading = "Card colour";
  const usage =
    "Takes a hex colour like `#1db954` or `1db954`, `random` for a random one, or `default` to clear it.";

  const raw = words(ctx.argument)[0] ?? "";

  if (!raw) {
    const { color } = await readUserSettings(ctx.authorId);
    const shown = color === null ? EMBED_COLOR : color;
    await card(
      ctx,
      heading,
      color === null
        ? `You are on the default colour, \`${hexOf(EMBED_COLOR)}\`.\n\n-# ${usage}`
        : `Your colour is \`${hexOf(color)}\`.\n\n-# ${usage}`,
      shown,
    );
    return;
  }

  const lowered = raw.toLowerCase();

  if (RESET_WORDS.has(lowered)) {
    await writeColor(ctx.authorId, null);
    await card(
      ctx,
      heading,
      `Cleared. Your Last.fm cards use the default \`${hexOf(EMBED_COLOR)}\` again.`,
      EMBED_COLOR,
    );
    return;
  }

  // Cosmetic only, so a plain PRNG is the right tool here.
  const value =
    lowered === "random"
      ? Math.floor(Math.random() * 0x1000000)
      : toColor(Number.parseInt(HEX.exec(raw)?.[1] ?? "", 16));

  if (value === null) {
    await card(ctx, heading, `${quoteInput(raw)} is not a colour I can read.\n\n${usage}`);
    return;
  }

  await writeColor(ctx.authorId, value);
  // The preview is the card itself: it is drawn in the colour just saved.
  await card(
    ctx,
    heading,
    `Your Last.fm cards are now \`${hexOf(value)}\`.\n-# This card is the preview.`,
    value,
  );
}

/* ------------------------------------------------------------------ */
/* ,customreactions and ,react                                        */
/* ------------------------------------------------------------------ */

type Scope = { kind: "user"; id: string } | { kind: "guild"; id: string };

async function writePair(
  scope: Scope,
  upvote: string | null,
  downvote: string | null,
): Promise<void> {
  if (scope.kind === "user") {
    await sql`
      INSERT INTO lastfm_user_settings (discord_id, upvote, downvote)
      VALUES (${scope.id}, ${upvote}::text, ${downvote}::text)
      ON CONFLICT (discord_id) DO UPDATE
        SET upvote = EXCLUDED.upvote,
            downvote = EXCLUDED.downvote,
            updated_at = now()
    `;
    await invalidateUser(scope.id);
    return;
  }

  await sql`
    INSERT INTO lastfm_guild_settings (guild_id, upvote, downvote)
    VALUES (${scope.id}, ${upvote}::text, ${downvote}::text)
    ON CONFLICT (guild_id) DO UPDATE
      SET upvote = EXCLUDED.upvote,
          downvote = EXCLUDED.downvote,
          updated_at = now()
  `;
  await invalidateGuild(scope.id);
}

/** The shared write path for both reaction commands. `given` is non-empty. */
async function applyPair(
  ctx: PrefixContext,
  scope: Scope,
  heading: string,
  given: string[],
): Promise<void> {
  const fallback =
    scope.kind === "user"
      ? `this server's pair, or ${showEmoji(DEFAULT_UPVOTE)} ${showEmoji(DEFAULT_DOWNVOTE)}`
      : `${showEmoji(DEFAULT_UPVOTE)} ${showEmoji(DEFAULT_DOWNVOTE)}`;
  const command = scope.kind === "user" ? ",customreactions" : ",react";
  const usage = `-# \`${command} <up> <down>\` to set a pair · \`${command} reset\` to clear it.`;

  if (given.length === 1 && RESET_WORDS.has((given[0] ?? "").toLowerCase())) {
    await writePair(scope, null, null);
    await card(ctx, heading, `Cleared. Now playing posts fall back to ${fallback}.`);
    return;
  }

  if (given.length !== 2) {
    await card(
      ctx,
      heading,
      `I need exactly two emoji: one for up, one for down.\n\n${usage}`,
    );
    return;
  }

  const upRaw = given[0] ?? "";
  const downRaw = given[1] ?? "";
  const upvote = parseEmoji(upRaw);
  const downvote = parseEmoji(downRaw);

  if (!upvote || !downvote) {
    await card(
      ctx,
      heading,
      `I could not read ${quoteInput(upvote ? downRaw : upRaw)} as an emoji.\n` +
        "Use a normal emoji, or a custom one written as `<:name:id>`.\n\n" +
        usage,
    );
    return;
  }

  if (upvote === downvote) {
    // Discord keeps one reaction per emoji, so an identical pair would leave
    // every post with a single button and no way to vote the other way.
    await card(ctx, heading, "Up and down have to be different emoji.");
    return;
  }

  await writePair(scope, upvote, downvote);
  await card(
    ctx,
    heading,
    `Up ${showEmoji(upvote)} · Down ${showEmoji(downvote)}\n` +
      "-# A custom emoji only works if this bot is in the server that owns it.",
  );
}

async function customReactions(ctx: PrefixContext): Promise<void> {
  const heading = "Your reactions";
  const given = words(ctx.argument);

  if (given.length === 0) {
    // Mirrors resolveReactions so the card shows what a post would really get,
    // plus where each side of the pair is coming from.
    const user = await readUserSettings(ctx.authorId);
    const guildPair = ctx.guildId ? await readGuildSettings(ctx.guildId) : null;
    const upvote = user.upvote ?? guildPair?.upvote ?? DEFAULT_UPVOTE;
    const downvote = user.downvote ?? guildPair?.downvote ?? DEFAULT_DOWNVOTE;
    const source = (mine: string | null, theirs: string | null | undefined) =>
      mine ? "yours" : theirs ? "this server's" : "the default";

    await card(
      ctx,
      heading,
      `Up ${showEmoji(upvote)} (${source(user.upvote, guildPair?.upvote)})\n` +
        `Down ${showEmoji(downvote)} (${source(user.downvote, guildPair?.downvote)})\n\n` +
        "-# `,customreactions <up> <down>` to set your own · `,customreactions reset` to clear.",
    );
    return;
  }

  await applyPair(ctx, { kind: "user", id: ctx.authorId }, heading, given);
}

async function serverReactions(ctx: PrefixContext): Promise<void> {
  const heading = "Server reactions";
  const guildId = await requireGuild(ctx, heading);
  if (!guildId) return;

  const given = words(ctx.argument);

  if (given.length === 0) {
    // Reading is open to everyone: the pair is visible on every now-playing
    // post already, so hiding it behind a permission would only be noise.
    const pair = await readGuildSettings(guildId);
    const upvote = pair.upvote ?? DEFAULT_UPVOTE;
    const downvote = pair.downvote ?? DEFAULT_DOWNVOTE;
    const set = pair.upvote || pair.downvote ? "this server's" : "the default";

    await card(
      ctx,
      heading,
      `Up ${showEmoji(upvote)} · Down ${showEmoji(downvote)}, ${set} pair.\n` +
        "Members who set their own with `,customreactions` keep theirs.\n\n" +
        "-# `,react <up> <down>` to change it (Manage Server).",
    );
    return;
  }

  if (!(await canManageGuild(guildId, ctx.authorId))) {
    await card(
      ctx,
      heading,
      "Changing the server's reactions needs the **Manage Server** permission.\n" +
        "Setting your own with `,customreactions` needs no permission.",
    );
    return;
  }

  await applyPair(ctx, { kind: "guild", id: guildId }, heading, given);
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

export function registerSettings(): void {
  register({
    name: "lfmode",
    aliases: ["npmode", "mode"],
    description: "Choose how your now playing posts look",
    handler: guard(npMode),
  });
  register({
    name: "lfcolor",
    aliases: ["npcolor", "color"],
    description: "Set the colour of your Last.fm cards",
    handler: guard(npColor),
  });
  register({
    name: "customreactions",
    aliases: ["myreactions", "cr"],
    description: "Your own up and down reactions",
    handler: guard(customReactions),
  });
  register({
    name: "react",
    aliases: ["serverreactions", "setreactions"],
    description: "Server reactions (Manage Server)",
    handler: guard(serverReactions),
  });
}
