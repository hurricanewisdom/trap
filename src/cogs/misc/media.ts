import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sendFile } from "../../core/discord.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { publicUrl } from "../../helpers/net.js";
import { card } from "./shared.js";

const YTDLP = process.env.YTDLP_PATH ?? "/usr/local/bin/yt-dlp";

const RUN_MS = 180_000;

// Discord's own limit for a server with no boosts. A bigger file is refused
// before the upload rather than after it.
const MOST_BYTES = 10 * 1024 * 1024;

function run(args: string[], ms: number): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    execFile(YTDLP, args, { timeout: ms, maxBuffer: 8 * 1024 * 1024 }, (error, _out, stderr) =>
      resolve({ ok: !error, err: String(stderr ?? "").slice(-300) }),
    );
  });
}

async function makemp3(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Which video?", "", "-# `makemp3 <url>`"]);
    return;
  }

  const url = await publicUrl(said);
  if (!url) {
    await card(ctx, ["That is not a link this can fetch."]);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "trap-mp3-"));
  try {
    await card(ctx, ["Working on it…"]);

    const done = await run(
      [
        "--no-playlist",
        "--no-warnings",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        // Not a hard guarantee: the cap is per stream and the extracted audio is
        // measured afterwards. It still stops the worst downloads early.
        "--max-filesize",
        "60M",
        "-o",
        join(dir, "audio.%(ext)s"),
        url.toString(),
      ],
      RUN_MS,
    );

    const made = (await readdir(dir)).find((one) => one.endsWith(".mp3"));
    if (!done.ok || !made) {
      await card(ctx, [
        "That could not be converted.",
        "",
        `-# ${plain(done.err.split("\n").filter(Boolean).pop() ?? "no audio was produced")}`,
      ]);
      return;
    }

    const from = join(dir, made);
    const size = (await stat(from)).size;
    if (size > MOST_BYTES) {
      await card(ctx, [
        `That comes to ${(size / 1024 / 1024).toFixed(1)}MB, over the ${MOST_BYTES / 1024 / 1024}MB upload limit.`,
      ]);
      return;
    }

    const bytes = await readFile(from);
    const body = new Uint8Array(new ArrayBuffer(bytes.length));
    body.set(bytes);

    const sent = await sendFile(
      ctx.channelId,
      { allowed_mentions: { parse: [] } },
      { name: "audio.mp3", body },
    );
    if (!sent.ok) await card(ctx, ["That could not be posted."]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerMedia(): void {
  register({ name: "makemp3", aliases: ["mp3"], description: "Convert a video to an audio file", handler: makemp3 });
}
