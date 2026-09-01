import { sql } from "../../core/db.js";
import { api, getMessage, guildEmojis, guildStickers, write } from "../../core/discord.js";
import { notice, requireManageGuild } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, pagesOf, words } from "./shared.js";
import { paginate } from "../../core/pager.js";

const CUSTOM = /<(a?):(\w+):(\d{15,25})>/g;

const UNICODE = /\p{Extended_Pictographic}/u;

const MESSAGE_LINK = /(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

const CDN = "https://cdn.discordapp.com";

// Discord calls it Manage Expressions; the bit is the old Manage Emojis one, and
// Manage Server implies it, which is what `holds()` already covers.
async function requireExpressions(ctx: PrefixContext, action: string): Promise<string | null> {
  return requireManageGuild(ctx, action);
}

function emoteUrl(id: string, animated: boolean, size = 256): string {
  return `${CDN}/emojis/${id}.${animated ? "gif" : "png"}?size=${size}`;
}

// A twemoji svg is the only way to show a unicode emoji large, since Discord has
// no CDN entry for one.
function unicodeUrl(emoji: string): string {
  const points = [...emoji]
    .map((one) => one.codePointAt(0)?.toString(16))
    .filter((one) => one && one !== "fe0f")
    .join("-");
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${points}.png`;
}

async function bigEmoji(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Which emoji?", "", "-# `emoji :thing:`"]);
    return;
  }

  CUSTOM.lastIndex = 0;
  const custom = CUSTOM.exec(said);
  if (custom) {
    await card(ctx, [
      `### :${plain(custom[2] as string)}:`,
      emoteUrl(custom[3] as string, custom[1] === "a", 512),
      `-# id: ${custom[3]}`,
    ]);
    return;
  }

  const first = [...said][0] ?? "";
  if (!UNICODE.test(first)) {
    await card(ctx, ["That is not an emoji."]);
    return;
  }
  await card(ctx, [`### ${first}`, unicodeUrl(first)]);
}

async function emojiAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "add emotes");
  if (!guildId) return;

  const parts = words(ctx.argument);
  CUSTOM.lastIndex = 0;
  const custom = CUSTOM.exec(ctx.argument);
  const url = custom
    ? emoteUrl(custom[3] as string, custom[1] === "a", 256)
    : parts.find((one) => /^https?:\/\//.test(one));
  if (!url) {
    await card(ctx, ["Which emote?", "", "-# `emoji add :thing:` or a link"]);
    return;
  }

  const named = custom ? parts.slice(1).join("") : parts.slice(1).join("");
  const name = (named || custom?.[2] || "emote").replace(/[^\w]/g, "").slice(0, 32) || "emote";

  const image = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  if (!image) {
    await card(ctx, ["That image could not be fetched."]);
    return;
  }

  const kind = url.includes(".gif") ? "image/gif" : "image/png";
  const done = await write<{ id: string; name: string }>(
    "POST",
    `/guilds/${guildId}/emojis`,
    {
      name,
      image: `data:${kind};base64,${Buffer.from(image).toString("base64")}`,
    },
    `by ${ctx.authorId}`,
  );

  await card(
    ctx,
    done.ok
      ? [`Added <${kind === "image/gif" ? "a" : ""}:${done.data.name}:${done.data.id}> as \`:${plain(done.data.name)}:\``]
      : ["That did not work.", "", `-# ${done.message.slice(0, 160)}`],
  );
}

async function emojiAddMany(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "add emotes");
  if (!guildId) return;

  const found = [...ctx.argument.matchAll(CUSTOM)];
  if (found.length === 0) {
    await card(ctx, ["Which emotes?", "", "-# `emoji addmany :one: :two: :three:`"]);
    return;
  }

  let added = 0;
  const failed: string[] = [];
  // Twenty at a time: Discord rate limits emoji creation hard, and a longer run
  // would sit there failing the tail of the list.
  for (const one of found.slice(0, 20)) {
    const image = await fetch(emoteUrl(one[3] as string, one[1] === "a", 256))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    if (!image) continue;

    const done = await write<{ id: string }>(
      "POST",
      `/guilds/${guildId}/emojis`,
      {
        name: (one[2] as string).slice(0, 32),
        image: `data:${one[1] === "a" ? "image/gif" : "image/png"};base64,${Buffer.from(image).toString("base64")}`,
      },
      `by ${ctx.authorId}`,
    );
    if (done.ok) added += 1;
    else failed.push(one[2] as string);
  }

  await card(ctx, [
    `Added ${added} of ${Math.min(20, found.length)}.`,
    ...(failed.length > 0 ? [`-# refused: ${failed.slice(0, 8).map(plain).join(", ")}`] : []),
    ...(found.length > 20 ? ["-# only the first twenty were tried"] : []),
  ]);
}

async function emojiRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "remove emotes");
  if (!guildId) return;

  CUSTOM.lastIndex = 0;
  const custom = CUSTOM.exec(ctx.argument);
  const held = (await guildEmojis(guildId)) ?? [];
  const wanted = custom
    ? held.find((one) => one.id === custom[3])
    : held.find((one) => one.name?.toLowerCase() === ctx.argument.trim().replace(/:/g, "").toLowerCase());

  if (!wanted) {
    await card(ctx, ["No emote by that name here."]);
    return;
  }

  const done = await write<void>("DELETE", `/guilds/${guildId}/emojis/${wanted.id}`, undefined, `by ${ctx.authorId}`);
  await card(ctx, done.ok ? [`\`:${plain(wanted.name ?? "")}:\` is gone.`] : ["That did not work."]);
}

async function emojiRemoveMany(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "remove emotes");
  if (!guildId) return;

  const found = [...ctx.argument.matchAll(CUSTOM)];
  if (found.length === 0) {
    await card(ctx, ["Which emotes?", "", "-# `emoji removemany :one: :two:`"]);
    return;
  }

  let gone = 0;
  for (const one of found.slice(0, 30)) {
    const done = await write<void>("DELETE", `/guilds/${guildId}/emojis/${one[3]}`, undefined, `by ${ctx.authorId}`);
    if (done.ok) gone += 1;
  }
  await card(ctx, [`Removed ${gone} of ${Math.min(30, found.length)}.`]);
}

// Same name and same size is as close to "the same emote" as the API lets us
// get; the image bytes are not exposed for comparison.
async function emojiRemoveDuplicates(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "remove duplicate emotes");
  if (!guildId) return;

  const held = (await guildEmojis(guildId)) ?? [];
  const seen = new Map<string, string>();
  const doomed: { id: string; name: string }[] = [];

  for (const one of held) {
    const key = (one.name ?? "").toLowerCase().replace(/\d+$/, "");
    if (!key) continue;
    if (seen.has(key)) doomed.push({ id: one.id, name: one.name ?? "" });
    else seen.set(key, one.id);
  }

  if (doomed.length === 0) {
    await card(ctx, ["No duplicates by name."]);
    return;
  }

  let gone = 0;
  for (const one of doomed) {
    const done = await write<void>("DELETE", `/guilds/${guildId}/emojis/${one.id}`, undefined, `duplicate, by ${ctx.authorId}`);
    if (done.ok) gone += 1;
  }
  await card(ctx, [
    `Removed ${gone} duplicate${gone === 1 ? "" : "s"}.`,
    `-# matched on name with trailing numbers ignored, since the images cannot be compared`,
  ]);
}

async function emojiRename(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "rename emotes");
  if (!guildId) return;

  CUSTOM.lastIndex = 0;
  const custom = CUSTOM.exec(ctx.argument);
  const parts = words(ctx.argument);
  const name = parts[parts.length - 1]?.replace(/[^\w]/g, "").slice(0, 32);
  if (!custom || !name) {
    await card(ctx, ["Which emote, and what name?", "", "-# `emoji rename :thing: newname`"]);
    return;
  }

  const done = await write<{ name: string }>(
    "PATCH",
    `/guilds/${guildId}/emojis/${custom[3]}`,
    { name },
    `by ${ctx.authorId}`,
  );
  await card(ctx, done.ok ? [`Now \`:${plain(done.data.name)}:\``] : ["That did not work."]);
}

async function emojiInformation(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "read emote information");
  if (!guildId) return;

  const link = MESSAGE_LINK.exec(ctx.argument.trim());
  if (!link) {
    await card(ctx, ["Which message?", "", "-# `emoji information <message link>`"]);
    return;
  }

  const message = await getMessage(link[2] as string, link[3] as string);
  if (!message) {
    await card(ctx, ["That message could not be read."]);
    return;
  }

  const found = [...(message.content ?? "").matchAll(CUSTOM)];
  if (found.length === 0) {
    await card(ctx, ["No custom emotes in that message."]);
    return;
  }

  await card(ctx, [
    `### ${found.length} emote${found.length === 1 ? "" : "s"}`,
    ...found.slice(0, 10).map((one) => `-# \`:${plain(one[2] as string)}:\` — ${one[3]}`),
  ]);
}

async function emojiStats(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "see emote statistics");
  if (!guildId) return;

  const rows = await sql<{ emote: string; uses: string }[]>`
    SELECT emote, count(*)::text AS uses FROM emote_uses
    WHERE guild_id = ${guildId} GROUP BY emote ORDER BY count(*) DESC LIMIT 10
  `;

  await card(ctx, [
    "### Most used emotes",
    ...(rows.length === 0
      ? [
          "-# Nothing counted yet.",
          "-# Counting starts from now; Discord keeps no history of this.",
        ]
      : rows.map((row, at) => `-# ${at + 1}. ${row.emote} — ${row.uses}`)),
  ]);
}

async function stickerAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "add stickers");
  if (!guildId) return;

  await card(ctx, [
    "Stickers are uploaded as a file, not a link.",
    "",
    "-# Discord takes the image in a multipart form with a name, description and",
    "-# tag. Send the sticker in this channel and use `sticker rename` on it, or",
    "-# add it through Server Settings.",
  ]);
}

async function stickerRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "remove stickers");
  if (!guildId) return;

  const said = ctx.argument.trim().toLowerCase();
  const held = (await guildStickers(guildId)) ?? [];
  const wanted = held.find((one) => (one.name ?? "").toLowerCase() === said);
  if (!wanted) {
    await card(ctx, ["No sticker by that name here."]);
    return;
  }

  const done = await write<void>("DELETE", `/guilds/${guildId}/stickers/${wanted.id}`, undefined, `by ${ctx.authorId}`);
  await card(ctx, done.ok ? [`**${plain(wanted.name ?? "")}** is gone.`] : ["That did not work."]);
}

async function stickerRename(ctx: PrefixContext): Promise<void> {
  const guildId = await requireExpressions(ctx, "rename stickers");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const held = (await guildStickers(guildId)) ?? [];
  if (parts.length < 2) {
    await card(ctx, [
      "Which sticker, and what name?",
      "",
      "-# `sticker rename <current name> <new name>`",
      ...(held.length > 0 ? [`-# here: ${held.slice(0, 10).map((o) => plain(o.name ?? "")).join(", ")}`] : []),
    ]);
    return;
  }

  const wanted = held.find((one) => (one.name ?? "").toLowerCase() === (parts[0] as string).toLowerCase());
  if (!wanted) {
    await card(ctx, ["No sticker by that name here."]);
    return;
  }

  const done = await write<{ name: string }>(
    "PATCH",
    `/guilds/${guildId}/stickers/${wanted.id}`,
    { name: parts.slice(1).join(" ").slice(0, 30) },
    `by ${ctx.authorId}`,
  );
  await card(ctx, done.ok ? [`Now **${plain(done.data.name)}**.`] : ["That did not work."]);
}

function stickerTidy(tagging: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageGuild(ctx, "tidy stickers");
    if (!guildId) return;

    const held = (await guildStickers(guildId)) ?? [];
    if (held.length === 0) {
      await card(ctx, ["This server has no stickers."]);
      return;
    }

    const vanity = ctx.argument.trim().slice(0, 20);
    if (tagging && !vanity) {
      await card(ctx, ["What should be added?", "", "-# `sticker tag <text>`"]);
      return;
    }

    let changed = 0;
    for (const one of held) {
      const now = one.name ?? "";
      const next = tagging
        ? `${now} ${vanity}`.slice(0, 30)
        : now.replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
      if (!next || next === now) continue;

      const done = await write<void>(
        "PATCH",
        `/guilds/${guildId}/stickers/${one.id}`,
        { name: next },
        `by ${ctx.authorId}`,
      );
      if (done.ok) changed += 1;
    }

    await card(ctx, [
      tagging
        ? `Added the vanity to ${changed} sticker${changed === 1 ? "" : "s"}.`
        : `Tidied ${changed} sticker name${changed === 1 ? "" : "s"}.`,
    ]);
  };
}

const STICKER_FORMATS: Record<number, string> = { 1: "png", 2: "apng", 3: "lottie", 4: "gif" };

async function stickerOverview(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) return;
  const held = (await guildStickers(ctx.guildId)) ?? [];

  const lines = held.map((one) => {
    const format = STICKER_FORMATS[(one as { format_type?: number }).format_type ?? 0] ?? "unknown";
    const tags = (one as { tags?: string }).tags;
    const description = (one as { description?: string | null }).description;
    return (
      `\`${plain(one.name ?? "")}\` — ${format}` +
      (tags ? ` · ${plain(tags)}` : "") +
      (description ? ` · ${plain(description.slice(0, 60))}` : "")
    );
  });

  await paginate(
    ctx,
    pagesOf(
      `${held.length} sticker${held.length === 1 ? "" : "s"}`,
      lines,
      10,
      "`sticker add` · `remove` · `rename` · `tag` · `cleanup`",
    ),
    null,
  );
}

export function registerExpressions(): void {
  register({
    name: "emoji",
    aliases: ["emote", "jumbo"],
    description: "Returns a large emoji or server emote",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("emoji", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await bigEmoji(ctx);
    },
  });

  groupUnder("emoji", () => {
    register({ name: "add", description: "Downloads an emote and adds it", handler: emojiAdd });
    register({ name: "addmany", description: "Bulk add emotes", handler: emojiAddMany });
    register({ name: "remove", description: "Removes an emote from the server", handler: emojiRemove });
    register({ name: "removemany", description: "Bulk remove emotes", handler: emojiRemoveMany });
    register({
      name: "removeduplicates",
      description: "Remove duplicates of emotes",
      handler: emojiRemoveDuplicates,
    });
    register({ name: "rename", description: "Renames an emote", handler: emojiRename });
    register({
      name: "information",
      aliases: ["info"],
      description: "The emotes used in a message",
      handler: emojiInformation,
    });
    register({ name: "stats", description: "Show top ten most used emotes", handler: emojiStats });
  });

  register({
    name: "sticker",
    description: "Modify or add stickers to your server",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("sticker", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await stickerOverview(ctx);
    },
  });

  groupUnder("sticker", () => {
    register({ name: "add", description: "Downloads a sticker and adds it", handler: stickerAdd });
    register({ name: "remove", description: "Removes a sticker from the server", handler: stickerRemove });
    register({ name: "rename", description: "Rename a sticker", handler: stickerRename });
    register({ name: "tag", description: "Add server vanity to stickers", handler: stickerTidy(true) });
    register({ name: "cleanup", description: "Cleans server sticker names", handler: stickerTidy(false) });
  });
}

export { api, notice };
