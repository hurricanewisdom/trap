import { guildEmojis, guildStickers } from "../../../core/discord.js";
import { notice, requireAdministrator } from "../../../core/permissions.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { USER_AGENT } from "../../../helpers/http.js";
import { safeName, zip, type Entry } from "./zip.js";

const HEADING = "Extract";

const MAX_TOTAL = 24 * 1024 * 1024;

const MAX_ONE = 8 * 1024 * 1024;

const AT_ONCE = 6;

const FETCH_MS = 15_000;

const STICKER_EXTENSION: Record<number, string> = { 1: "png", 2: "png", 3: "json", 4: "gif" };

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

interface Wanted {
  name: string;
  url: string;
}

async function grab(one: Wanted): Promise<Entry | null> {
  try {
    const res = await fetch(one.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) return null;

    const body = new Uint8Array(await res.arrayBuffer());
    if (body.length === 0 || body.length > MAX_ONE) return null;
    return { name: one.name, body };
  } catch {
    return null;
  }
}

async function collect(wanted: Wanted[]): Promise<{ entries: Entry[]; failed: number; skipped: number }> {
  const entries: Entry[] = [];
  let failed = 0;
  let skipped = 0;
  let total = 0;
  let at = 0;

  while (at < wanted.length) {
    if (total >= MAX_TOTAL) {
      skipped += wanted.length - at;
      break;
    }

    const batch = wanted.slice(at, at + AT_ONCE);
    at += batch.length;

    for (const got of await Promise.all(batch.map(grab))) {
      if (!got) {
        failed += 1;
        continue;
      }
      if (total + got.body.length > MAX_TOTAL) {
        skipped += 1;
        continue;
      }
      entries.push(got);
      total += got.body.length;
    }
  }

  return { entries, failed, skipped };
}

function tally(kind: string, entries: Entry[], failed: number, skipped: number, bytes: number): string {
  return [
    `### ${HEADING}`,
    `${entries.length} ${kind}${entries.length === 1 ? "" : "s"}, ${Math.round(bytes / 1024)}KB zipped.`,
    failed ? `-# ${failed} could not be downloaded.` : "",
    skipped ? `-# ${skipped} left out to stay under ${MAX_TOTAL / 1024 / 1024}MB.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function emotes(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "extract the emojis");
  if (!guildId) return;

  const held = await guildEmojis(guildId);
  if (!held) {
    await card(ctx, [`### ${HEADING}`, "I could not read this server's emojis."].join("\n"));
    return;
  }
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "This server has no emojis."].join("\n"));
    return;
  }

  const seen = new Map<string, number>();
  const wanted: Wanted[] = held.map((emoji) => {
    const extension = emoji.animated ? "gif" : "png";
    const base = safeName(emoji.name ?? "", emoji.id);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      name: `${base}${count > 1 ? `-${count}` : ""}.${extension}`,
      url: `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}`,
    };
  });

  const { entries, failed, skipped } = await collect(wanted);
  if (entries.length === 0) {
    await card(ctx, [`### ${HEADING}`, "None of them would download."].join("\n"));
    return;
  }

  const archive = zip(entries);
  await ctx.reply({
    ...notice(tally("emoji", entries, failed, skipped, archive.length)),
    files: [{ name: "emojis.zip", blob: new Blob([archive], { type: "application/zip" }) }],
  });
}

async function stickers(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "extract the stickers");
  if (!guildId) return;

  const held = await guildStickers(guildId);
  if (!held) {
    await card(ctx, [`### ${HEADING}`, "I could not read this server's stickers."].join("\n"));
    return;
  }
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "This server has no stickers."].join("\n"));
    return;
  }

  const seen = new Map<string, number>();
  const wanted: Wanted[] = held.map((sticker) => {
    const extension = STICKER_EXTENSION[sticker.format_type ?? 1] ?? "png";
    const base = safeName(sticker.name ?? "", sticker.id);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      name: `${base}${count > 1 ? `-${count}` : ""}.${extension}`,
      url: `https://cdn.discordapp.com/stickers/${sticker.id}.${extension}`,
    };
  });

  const { entries, failed, skipped } = await collect(wanted);
  if (entries.length === 0) {
    await card(ctx, [`### ${HEADING}`, "None of them would download."].join("\n"));
    return;
  }

  const archive = zip(entries);
  await ctx.reply({
    ...notice(tally("sticker", entries, failed, skipped, archive.length)),
    files: [{ name: "stickers.zip", blob: new Blob([archive], { type: "application/zip" }) }],
  });
}

export function registerExtract(): void {
  register({
    name: "extractemotes",
    aliases: ["extractemojis"],
    description: "Send every emoji in this server as a zip",
    handler: emotes,
  });

  register({
    name: "extractstickers",
    description: "Send every sticker in this server as a zip",
    handler: stickers,
  });
}
