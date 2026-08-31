import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = process.env.YTDLP_PATH ?? "/usr/local/bin/yt-dlp";

const PROBE_MS = 25_000;

const FETCH_MS = 120_000;

const AT_ONCE = 2;

let running = 0;

export interface Facts {
  title: string;
  uploader: string;
  duration: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  bytes: number | null;
}

function run(args: string[], ms: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      TOOL,
      args,
      { timeout: ms, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout) => resolve({ ok: !error, out: stdout ?? "" }),
    );
  });
}

function facts(raw: string): Facts | null {
  const line = raw.split("\n").find((one) => one.trim().startsWith("{"));
  if (!line) return null;

  let held: Record<string, unknown>;
  try {
    held = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const number = (key: string): number | null => {
    const value = held[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  return {
    title: String(held.title ?? "").slice(0, 200),
    uploader: String(held.uploader ?? held.channel ?? "").slice(0, 80),
    duration: number("duration"),
    views: number("view_count"),
    likes: number("like_count"),
    comments: number("comment_count"),
    shares: number("repost_count"),
    bytes: number("filesize") ?? number("filesize_approx"),
  };
}

export async function probe(url: string): Promise<Facts | null> {
  const got = await run(
    ["--no-warnings", "--no-playlist", "--skip-download", "--dump-json", url],
    PROBE_MS,
  );
  return got.ok ? facts(got.out) : null;
}

export interface Grabbed {
  body: Uint8Array<ArrayBuffer>;
  name: string;
}

// Downloads to a temp directory and reads the one file back, so a failure part
// way through leaves nothing behind. No ffmpeg on the box, so only pre-muxed
// formats are asked for: yt-dlp would otherwise pick separate video and audio
// and have nothing to join them with.
export async function grab(url: string, maxBytes: number): Promise<Grabbed | null> {
  if (running >= AT_ONCE) return null;
  running += 1;

  const dir = await mkdtemp(join(tmpdir(), "trap-repost-"));
  try {
    const got = await run(
      [
        "--no-warnings",
        "--no-playlist",
        "--no-part",
        "--max-filesize",
        String(maxBytes),
        "-f",
        "b[ext=mp4]/b",
        "-o",
        join(dir, "video.%(ext)s"),
        url,
      ],
      FETCH_MS,
    );
    if (!got.ok) return null;

    const files = await readdir(dir);
    const name = files[0];
    if (!name) return null;

    const raw = await readFile(join(dir, name));
    // over an explicit ArrayBuffer so the type is exact for FormData
    const body = new Uint8Array(new ArrayBuffer(raw.length));
    body.set(raw);
    if (body.length === 0 || body.length > maxBytes) return null;

    return { body, name };
  } catch {
    return null;
  } finally {
    running -= 1;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function available(): Promise<boolean> {
  return (await run(["--version"], 8000)).ok;
}
