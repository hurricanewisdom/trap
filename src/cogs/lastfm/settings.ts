import { sql } from "../../core/db.js";
import { canManageGuild } from "../../core/discord.js";
import { paginate } from "../../core/pager.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { redis } from "../../core/redis.js";
import { provideAccent } from "../../core/accent.js";
import { guard } from "./guard.js";
import { USER_ACCENT, simpleCard } from "./shared.js";

const MODES = [
  { name: "default", blurb: "the two-column Track/Artist embed" },
  { name: "compact", blurb: "a single line" },
  { name: "detailed", blurb: "adds album, plays and total scrobbles" },
  { name: "container", blurb: "the same card style as the rest of the bot" },
  { name: "custom", blurb: "your own layout, built with ,card" },
] as const;

export const NP_MODES: readonly string[] = MODES.map((mode) => mode.name);

const DEFAULT_NP_MODE = "default";

export const DEFAULT_UPVOTE = "\u{1F44D}";
export const DEFAULT_DOWNVOTE = "\u{1F44E}";

const SETTINGS_TTL = 60;

const RESET_WORDS = new Set(["default", "reset", "clear", "none", "off"]);

const userKey = (discordId: string) => `trap:lf:settings:user:${discordId}`;
const guildKey = (guildId: string) => `trap:lf:settings:guild:${guildId}`;

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
  color: number | string | null;
  upvote: string | null;
  downvote: string | null;
}

interface GuildRow {
  upvote: string | null;
  downvote: string | null;
}

function toColor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffff ? parsed : null;
}

async function readUserSettings(discordId: string): Promise<UserSettings> {
  try {
    const hit = await redis.get(userKey(discordId));

    if (hit) return JSON.parse(hit) as UserSettings;
  } catch {}

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
  } catch {}

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

async function invalidateUser(discordId: string): Promise<void> {
  await redis.del(userKey(discordId)).catch(() => {});
}

async function invalidateGuild(guildId: string): Promise<void> {
  await redis.del(guildKey(guildId)).catch(() => {});
}

export async function getNpMode(discordId: string): Promise<string> {
  const { npMode } = await readUserSettings(discordId);

  return npMode !== null && NP_MODES.includes(npMode) ? npMode : DEFAULT_NP_MODE;
}

export async function resolveColor(discordId: string): Promise<number | null> {
  const { color } = await readUserSettings(discordId);
  return color;
}

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

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/;

const STORED_CUSTOM = /^([A-Za-z0-9_]{2,32}):(\d{15,25})$/;

const EMOJI_TOKEN =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[#*0-9\u200d\ufe0f\ufe0e\u20e3\u{E0020}-\u{E007F}])+$/u;

const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;

const MAX_EMOJI_UNITS = 16;

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

function parseEmoji(input: string): string | null {
  const token = input.trim();

  const custom = CUSTOM_EMOJI.exec(token);
  if (custom) {
    const name = custom[2];
    const id = custom[3];
    return name && id ? `${name}:${id}` : null;
  }

  if (STORED_CUSTOM.test(token)) return token;

  if (EMOJI_TOKEN.test(token) && EMOJI_CORE.test(token) && looksLikeOneEmoji(token)) {
    return token;
  }
  return null;
}

function showEmoji(token: string): string {
  const stored = STORED_CUSTOM.exec(token);
  if (stored) return `<:${stored[1] ?? ""}:${stored[2] ?? ""}>`;
  if (EMOJI_TOKEN.test(token)) return token;

  return `\`${token.replaceAll("`", "'").replace(/[\r\n]+/g, " ").slice(0, 32)}\``;
}

function quoteInput(value: string): string {
  const cleaned = value.replace(/[`@<>\r\n]/g, "").trim().slice(0, 32);
  return cleaned ? `\`${cleaned}\`` : "that";
}





async function card(
  ctx: PrefixContext,
  heading: string,
  body: string,
  accent: number | null = USER_ACCENT,
): Promise<void> {
  await paginate(ctx, simpleCard(heading, body), accent);
}


async function requireGuild(ctx: PrefixContext, heading: string): Promise<string | null> {
  if (ctx.guildId) return ctx.guildId;
  await card(ctx, heading, "This only works inside a server, not in DMs.");
  return null;
}

const words = (argument: string): string[] => argument.trim().split(/\s+/).filter(Boolean);





async function writeNpMode(discordId: string, mode: string | null): Promise<void> {
  
  
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
    "Takes a hex colour like `#1db954` or `1db954`, `random` for a random one, or `default` to go back to no colour.";

  const raw = words(ctx.argument)[0] ?? "";

  if (!raw) {
    const { color } = await readUserSettings(ctx.authorId);
    await card(
      ctx,
      heading,
      color === null
        ? `Your cards have no colour, which is the default.\n\n-# ${usage}`
        : `Your colour is \`${hexOf(color)}\`.\n\n-# ${usage}`,
      color,
    );
    return;
  }

  const lowered = raw.toLowerCase();

  if (RESET_WORDS.has(lowered)) {
    await writeColor(ctx.authorId, null);
    await card(ctx, heading, "Cleared. Your cards go back to no colour.", null);
    return;
  }

  const value =
    lowered === "random"
      ? Math.floor(Math.random() * 0x1000000)
      : toColor(Number.parseInt(HEX.exec(raw)?.[1] ?? "", 16));

  if (value === null) {
    await card(ctx, heading, `${quoteInput(raw)} is not a colour I can read.\n\n${usage}`);
    return;
  }

  await writeColor(ctx.authorId, value);
  await card(
    ctx,
    heading,
    `Your cards are now \`${hexOf(value)}\`.\n-# This card is the preview.`,
    value,
  );
}





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

export function registerSettings(): void {
  provideAccent(resolveColor);

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
