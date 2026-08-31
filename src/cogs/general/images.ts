import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";

import { memberOf, sendFile } from "../../core/discord.js";
import { register, type PrefixContext, type PrefixHandler } from "../../core/prefix.js";
import { assetUrl, card, userId, words, CDN } from "./shared.js";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

const MOST_BYTES = 8 * 1024 * 1024;

const FETCH_MS = 15_000;

const RUN_MS = 30_000;

const KINDS = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

// The same guard the customize commands use: this box runs a database and a web
// server on private addresses, and these commands fetch whatever they are given.
async function reachesPrivate(host: string): Promise<boolean> {
  let found: { address: string }[];
  try {
    found = await dnsLookup(host, { all: true });
  } catch {
    return true;
  }
  return found.some(({ address }) => {
    if (address.includes(":")) {
      const low = address.toLowerCase();
      return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
    }
    const parts = address.split(".").map(Number);
    const [a, b] = parts as [number, number];
    return (
      a === 127 || a === 0 || a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  });
}

export type Fetched = { bytes: Uint8Array; kind: string } | { error: string };

async function fetchImage(link: string): Promise<Fetched> {
  let parsed: URL;
  try {
    parsed = new URL(link.trim());
  } catch {
    return { error: "That is not a link." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http and https links work." };
  }
  if (await reachesPrivate(parsed.hostname)) {
    return { error: "That address is not reachable from here." };
  }

  try {
    const answer = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: "error",
      headers: { "user-agent": "Mozilla/5.0 (compatible; Trap/1.0)" },
    });
    if (!answer.ok) return { error: `That link answered ${answer.status}.` };

    const kind = (answer.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!KINDS.has(kind)) return { error: `That is ${kind || "not an image"}.` };

    const bytes = new Uint8Array(await answer.arrayBuffer());
    if (bytes.length === 0) return { error: "That image is empty." };
    if (bytes.length > MOST_BYTES) return { error: "That image is over 8MB." };
    return { bytes, kind };
  } catch {
    return { error: "That link could not be fetched." };
  }
}

function run(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(FFMPEG, args, { timeout: RUN_MS, maxBuffer: 4 * 1024 * 1024 }, (error) =>
      resolve(!error),
    );
  });
}

// A link, an attachment, or a member's avatar. Falling back to the invoker's own
// avatar is what makes `hex` useful with no arguments at all.
async function subject(ctx: PrefixContext, said: string): Promise<string | null> {
  const link = said.match(/https?:\/\/\S+/)?.[0];
  if (link) return link;

  const who = userId(said.trim().split(/\s+/)[0]) ?? (said.trim() ? null : ctx.authorId);
  if (!who) return null;

  if (ctx.guildId) {
    const member = await memberOf(ctx.guildId, who);
    if (member?.avatar) return assetUrl(`guilds/${ctx.guildId}/users/${who}/avatars`, member.avatar);
  }
  const user = await (await import("../../core/discord.js")).api<{ avatar?: string | null }>(
    `/users/${who}`,
  );
  return user?.avatar
    ? assetUrl(`avatars/${who}`, user.avatar)
    : `${CDN}/embed/avatars/${Number(BigInt(who) >> 22n) % 6}.png`;
}

function filterCommand(
  name: "rotate" | "invert" | "compress",
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const parts = words(ctx.argument);
    const leading = name === "rotate" || name === "compress" ? parts[0] : undefined;
    const rest = name === "invert" ? ctx.argument : parts.slice(leading && /^\d+$/.test(leading) ? 1 : 0).join(" ");

    const target = await subject(ctx, rest);
    if (!target) {
      await card(ctx, [
        `What should be ${name === "rotate" ? "rotated" : name === "invert" ? "inverted" : "compressed"}?`,
        "",
        `-# \`${name} ${name === "rotate" ? "<degrees> " : name === "compress" ? "<1-100> " : ""}<link or @member>\``,
      ]);
      return;
    }

    const got = await fetchImage(target);
    if ("error" in got) {
      await card(ctx, [got.error]);
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "trap-image-"));
    try {
      const from = join(dir, "in");
      const to = join(dir, name === "compress" ? "out.jpg" : "out.png");
      await writeFile(from, got.bytes);

      let args: string[];
      if (name === "rotate") {
        const degrees = Number(leading && /^\d{1,3}$/.test(leading) ? leading : 90) % 360;
        args = ["-y", "-loglevel", "error", "-i", from, "-vf", `rotate=${degrees}*PI/180:fillcolor=none`, to];
      } else if (name === "invert") {
        args = ["-y", "-loglevel", "error", "-i", from, "-vf", "negate", to];
      } else {
        // Ratio is quality, so a higher number is a better picture; ffmpeg's
        // scale runs the other way, which is why it is turned around here.
        const ratio = Math.max(1, Math.min(100, Number(leading && /^\d{1,3}$/.test(leading) ? leading : 50)));
        args = ["-y", "-loglevel", "error", "-i", from, "-q:v", String(Math.round(31 - (ratio / 100) * 29)), to];
      }

      if (!(await run(args))) {
        await card(ctx, ["That image could not be processed."]);
        return;
      }

      const bytes = await readFile(to);
      const body = new Uint8Array(new ArrayBuffer(bytes.length));
      body.set(bytes);

      const sent = await sendFile(
        ctx.channelId,
        { allowed_mentions: { parse: [] } },
        { name: name === "compress" ? "compressed.jpg" : `${name}.png`, body },
      );
      if (!sent.ok) await card(ctx, ["That could not be posted."]);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

async function hex(ctx: PrefixContext): Promise<void> {
  const target = await subject(ctx, ctx.argument);
  if (!target) {
    await card(ctx, ["Which image?", "", "-# `hex <link or @member>`"]);
    return;
  }

  const got = await fetchImage(target);
  if ("error" in got) {
    await card(ctx, [got.error]);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "trap-hex-"));
  try {
    const from = join(dir, "in");
    const to = join(dir, "one.rgb");
    await writeFile(from, got.bytes);

    // Downscaling to a single pixel is the average, which is what people mean by
    // the dominant colour of a picture.
    if (!(await run(["-y", "-loglevel", "error", "-i", from, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", to]))) {
      await card(ctx, ["That image could not be read."]);
      return;
    }

    const raw = await readFile(to);
    const hexed = [...raw.subarray(0, 3)].map((one) => one.toString(16).padStart(2, "0")).join("");
    await card(ctx, [
      `### #${hexed}`,
      `https://singlecolorimage.com/get/${hexed}/200x80`,
      `-# rgb(${raw[0]}, ${raw[1]}, ${raw[2]})`,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerImages(): void {
  register({ name: "rotate", description: "Rotate an image by a provided degree", handler: filterCommand("rotate") });
  register({ name: "invert", description: "Invert an image's colours", handler: filterCommand("invert") });
  register({ name: "compress", description: "Compress an image to lower quality", handler: filterCommand("compress") });
  register({ name: "hex", aliases: ["dominant"], description: "Grab the most dominant colour from an image", handler: hex });
}
