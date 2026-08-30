import { sql } from "../../../core/db.js";
import { canManageGuild, channelExists, deleteMessage } from "../../../core/discord.js";
import { onMessage, type MessageEvent } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";

const HEADING = "Gallery channels";

const CHANNEL = /^<#(\d{15,25})>$/;

const IMAGE_LINK = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|heic|avif)(?:\?\S*)?(?:\s|$)/i;

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|bmp|heic|avif)$/i;

const CACHE_MS = 60_000;

const cache = new Map<string, { ids: Set<string>; at: number }>();

function forget(guildId: string): void {
  cache.delete(guildId);
}

async function galleryChannels(guildId: string): Promise<Set<string>> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;

  let ids = new Set<string>();
  try {
    const rows = await sql<{ channel_id: string }[]>`
      SELECT channel_id FROM gallery_channels WHERE guild_id = ${guildId}
    `;
    ids = new Set(rows.map((row) => row.channel_id));
  } catch {
    return hit?.ids ?? new Set();
  }

  cache.set(guildId, { ids, at: Date.now() });
  return ids;
}

export function carriesImage(event: MessageEvent): boolean {
  const attached = event.attachments.some(
    (file) =>
      (file.contentType ?? "").startsWith("image/") || IMAGE_FILE.test(file.filename ?? ""),
  );
  return attached || IMAGE_LINK.test(`${event.content} `);
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

async function listed(guildId: string): Promise<string[]> {
  const rows = await sql<{ channel_id: string }[]>`
    SELECT channel_id FROM gallery_channels WHERE guild_id = ${guildId} ORDER BY created_at
  `;
  return rows.map((row) => row.channel_id);
}

async function usage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set up gallery channels");
  if (!guildId) return;

  const rows = await listed(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.length
        ? `Images only in ${rows.map((id) => `<#${id}>`).join(" · ")}.`
        : "No gallery channel is set up yet.",
      "",
      "`imgonly add <channel>` makes a channel images only",
      "`imgonly remove <channel>` lets it take anything again",
      "`imgonly list` shows every gallery channel",
      "",
      `-# ${rows.length} channel${rows.length === 1 ? "" : "s"} · a post needs an image, and any caption rides along with it.`,
    ].join("\n"),
  );
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "add a gallery channel");
  if (!guildId) return;

  const channel = channelId(words(ctx.argument)[0] ?? "");
  if (!channel) {
    await card(ctx, [`### ${HEADING}`, "Use `imgonly add <channel>`."].join("\n"));
    return;
  }

  if (!(await channelExists(guildId, channel))) {
    await card(ctx, [`### ${HEADING}`, "That channel is not in this server."].join("\n"));
    return;
  }

  const rows = await sql`
    INSERT INTO gallery_channels (guild_id, channel_id, added_by)
    VALUES (${guildId}, ${channel}, ${ctx.authorId})
    ON CONFLICT (guild_id, channel_id) DO NOTHING
    RETURNING channel_id
  `;
  forget(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.length
        ? `<#${channel}> now takes images only.`
        : `<#${channel}> was already images only.`,
      "-# Anything posted without an image is deleted. Members with Manage Server are exempt.",
    ].join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove a gallery channel");
  if (!guildId) return;

  const channel = channelId(words(ctx.argument)[0] ?? "");
  if (!channel) {
    await card(ctx, [`### ${HEADING}`, "Use `imgonly remove <channel>`."].join("\n"));
    return;
  }

  const rows = await sql`
    DELETE FROM gallery_channels WHERE guild_id = ${guildId} AND channel_id = ${channel}
    RETURNING channel_id
  `;
  forget(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.length
        ? `<#${channel}> takes anything again.`
        : `<#${channel}> was not a gallery channel.`,
    ].join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the gallery channels");
  if (!guildId) return;

  const rows = await listed(guildId);
  if (rows.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No gallery channel is set up."].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.map((id) => `<#${id}>`).join(" · "),
      "",
      `-# ${rows.length} channel${rows.length === 1 ? "" : "s"}`,
    ].join("\n"),
  );
}

function dispatcher(fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const command = sub ? lookupIn("imgonly", sub) : undefined;

    if (command) {
      await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerGallery(): void {
  onMessage(async (event) => {
    if (!(await galleryChannels(event.guildId)).has(event.channelId)) return;
    if (carriesImage(event)) return;
    if (await canManageGuild(event.guildId, event.authorId)) return;

    await deleteMessage(event.channelId, event.messageId);
  });

  register({
    name: "imgonly",
    aliases: ["gallery", "imageonly"],
    description: "Make a channel take images only",
    handler: dispatcher(usage),
  });

  groupUnder("imgonly", () => {
    register({
      name: "add",
      aliases: ["set"],
      description: "Make a channel take images only",
      handler: add,
    });

    register({
      name: "remove",
      aliases: ["delete", "rm"],
      description: "Let a channel take anything again",
      handler: remove,
    });

    register({
      name: "list",
      description: "Every gallery channel in this server",
      handler: list,
    });
  });
}
