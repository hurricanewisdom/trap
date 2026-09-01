import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { paginate } from "../../core/pager.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { publicUrl } from "../../helpers/net.js";
import { card } from "./shared.js";
import { pagesOf } from "./pages.js";

const YTDLP = process.env.YTDLP_PATH ?? "/usr/local/bin/yt-dlp";

// Its own virtualenv, because faster-whisper and shazamio cannot be installed
// into Debian's python without fighting its packages, and 3.13 rather than 3.14
// because the audio wheels lag the newest release.
const PYTHON = process.env.TRAP_PYTHON ?? "/opt/trap-py/bin/python";

const HELPER = process.env.TRAP_AUDIO ?? "/root/trap/tools/audio.py";

const GRAB_MS = 180_000;

const WORK_MS = 600_000;

function exec(command: string, args: string[], ms: number): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: ms, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: String(stdout ?? ""), err: String(stderr ?? "").slice(-400) }),
    );
  });
}

/**
 * Pulls the audio out of whatever was linked.
 *
 * `seconds` clips it, which matters for song identification: Shazam wants a few
 * seconds and downloading an hour to use twelve of it is waste.
 */
async function grabAudio(
  url: string,
  dir: string,
  seconds?: number,
): Promise<{ path: string } | { error: string }> {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "-x",
    "--audio-format",
    "wav",
    "--max-filesize",
    "200M",
    ...(seconds ? ["--download-sections", `*0-${seconds}`] : []),
    "-o",
    join(dir, "audio.%(ext)s"),
    url,
  ];

  const done = await exec(YTDLP, args, GRAB_MS);
  const made = (await readdir(dir)).find((one) => one.endsWith(".wav"));
  if (!made) {
    return {
      error: done.err.split("\n").filter(Boolean).pop() ?? "no audio could be pulled from that",
    };
  }
  return { path: join(dir, made) };
}

async function transcribe(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Which video or audio?", "", "-# `transcribe <url>`"]);
    return;
  }

  const url = await publicUrl(said);
  if (!url) {
    await card(ctx, ["That is not a link this can fetch."]);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "trap-hear-"));
  try {
    await card(ctx, ["Listening…", "-# A long recording takes a while."]);

    const got = await grabAudio(url.toString(), dir);
    if ("error" in got) {
      await card(ctx, ["That could not be read.", "", `-# ${plain(got.error.slice(0, 160))}`]);
      return;
    }

    const size = (await stat(got.path)).size;
    const done = await exec(PYTHON, [HELPER, "transcribe", got.path], WORK_MS);
    const body = readJson(done.out);

    if (!body?.ok) {
      await card(ctx, [
        "That could not be transcribed.",
        "",
        `-# ${plain(String(body?.error ?? done.err.split("\n").pop() ?? "no answer").slice(0, 160))}`,
      ]);
      return;
    }

    const segments = (body.segments ?? []) as { at: number; text: string }[];
    if (segments.length === 0) {
      await card(ctx, ["### Nothing said", "-# No speech was found in that."]);
      return;
    }

    const lines = segments.map((one) => `\`${clock(one.at)}\` ${plain(one.text, 400)}`);
    await paginate(
      ctx,
      pagesOf(
        `Transcript · ${String(body.language ?? "?")}`,
        lines,
        12,
        `${Math.round(Number(body.seconds ?? 0))}s of audio · ${(size / 1024 / 1024).toFixed(1)}MB · confidence ${body.confidence ?? "?"}`,
      ),
      null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function readJson(said: string): Record<string, unknown> | null {
  // The helper prints one object, but a library underneath it may print a
  // warning first, so the last line is the one that matters.
  const line = said.trim().split("\n").filter(Boolean).pop();
  if (!line) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Twelve seconds is what Shazam wants; more does not help and costs the download.
const SNIPPET = 12;

async function shazam(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Which video or audio?", "", "-# `shazam <url>`"]);
    return;
  }

  const url = await publicUrl(said);
  if (!url) {
    await card(ctx, ["That is not a link this can fetch."]);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "trap-song-"));
  try {
    const got = await grabAudio(url.toString(), dir, SNIPPET);
    if ("error" in got) {
      await card(ctx, ["That could not be read.", "", `-# ${plain(got.error.slice(0, 160))}`]);
      return;
    }

    const done = await exec(PYTHON, [HELPER, "identify", got.path], WORK_MS);
    const body = readJson(done.out);

    if (!body?.ok) {
      await card(ctx, [
        "That could not be identified.",
        "",
        `-# ${plain(String(body?.error ?? "no answer").slice(0, 160))}`,
      ]);
      return;
    }
    if (!body.found) {
      await card(ctx, [
        "### No match",
        "-# Shazam did not recognise it. A clearer few seconds of the song,",
        "-# without talking over it, is what it wants.",
      ]);
      return;
    }

    const facts = (body.facts ?? {}) as Record<string, string>;
    await card(ctx, [
      `### ${plain(String(body.title ?? "unknown"))}`,
      ...(body.cover ? [String(body.cover)] : []),
      `-# by **${plain(String(body.artist ?? "unknown"))}**`,
      ...(body.genre ? [`-# ${plain(String(body.genre))}`] : []),
      ...Object.entries(facts)
        .slice(0, 4)
        .map(([key, value]) => `-# ${plain(key)}: ${plain(value)}`),
      ...(body.url ? [`-# ${String(body.url)}`] : []),
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerListen(): void {
  register({ name: "transcribe", description: "Transcribe text by providing video or audio", handler: transcribe });
  register({ name: "shazam", aliases: ["findsong"], description: "Find a song by providing video or audio", handler: shazam });
}
