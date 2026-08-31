import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = process.env.YTDLP_PATH ?? "/usr/local/bin/yt-dlp";

// Some sites hand a logged-out visitor nothing. Point this at a Netscape cookie
// file and private posts start working; without it they fall back to a rewrite
// host or are left alone.
const COOKIES = process.env.YTDLP_COOKIES ?? "";

const PROBE_MS = 30_000;

const FETCH_MS = 150_000;

const AT_ONCE = 2;

// Merging separate video and audio needs ffmpeg, which youtube now requires: it
// serves no combined format at all any more.
//
// The ladder is built around the server's upload limit so a small server gets a
// lower resolution rather than nothing. `<?` means "smaller than, or unknown",
// which matters because plenty of sites report no size at all.
function formatFor(maxBytes: number): string {
  return [
    `bv*[height<=720][filesize_approx<?${maxBytes}]+ba`,
    `bv*[height<=480][filesize_approx<?${maxBytes}]+ba`,
    `bv*[height<=360]+ba`,
    `b[filesize_approx<?${maxBytes}]`,
    "b",
  ].join("/");
}

// yt-dlp leaves its per-stream downloads next to the merged file as video.f251.webm
// and the like. Reading the directory blindly can hand back one of those, which is
// how an audio-only fragment ends up posted as a video when a merge fails.
const MERGED = /^video\.[^.]+$/;

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

// Impersonating a real browser is what makes tumblr answer at all, but it needs
// curl_cffi installed alongside yt-dlp. Asking for it when it is missing fails
// every download, so the answer is worked out once and reused.
let browser: Promise<string[]> | null = null;

async function impersonation(): Promise<string[]> {
  browser ??= (async () => {
    const got = await run(["--list-impersonate-targets"], 15_000);
    if (!got.ok) return [];
    const usable = got.out
      .split("\n")
      .some((line) => line.includes("curl_cffi") && !line.includes("unavailable"));
    return usable ? ["--impersonate", "chrome"] : [];
  })();
  return browser;
}

async function cookies(): Promise<string[]> {
  if (!COOKIES) return [];
  try {
    await access(COOKIES);
    return ["--cookies", COOKIES];
  } catch {
    return [];
  }
}

// --no-progress matters: a long download otherwise writes thousands of progress
// lines, and enough of them overruns the buffer and kills the process.
async function common(): Promise<string[]> {
  return [
    "--no-warnings",
    "--no-progress",
    "--no-playlist",
    ...(await impersonation()),
    ...(await cookies()),
  ];
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
    uploader: String(held.uploader ?? held.channel ?? held.creator ?? "").slice(0, 80),
    duration: number("duration"),
    views: number("view_count"),
    likes: number("like_count"),
    comments: number("comment_count"),
    shares: number("repost_count"),
    bytes: number("filesize") ?? number("filesize_approx"),
  };
}

export async function probe(url: string): Promise<Facts | null> {
  const got = await run([...(await common()), "--skip-download", "--dump-json", url], PROBE_MS);
  return got.ok ? facts(got.out) : null;
}

export interface Grabbed {
  body: Uint8Array<ArrayBuffer>;
  name: string;
}

// Downloads to a temp directory and reads the one file back, so a failure part
// way through leaves nothing behind. The format is not pinned to mp4: soundcloud
// has no video at all and would match nothing.
export async function grab(url: string, maxBytes: number): Promise<Grabbed | null> {
  if (running >= AT_ONCE) return null;
  running += 1;

  const dir = await mkdtemp(join(tmpdir(), "trap-repost-"));
  try {
    const got = await run(
      [
        ...(await common()),
        "--no-part",
        "--max-filesize",
        String(maxBytes),
        "-f",
        formatFor(maxBytes),
        "--merge-output-format",
        "mp4",
        "-o",
        join(dir, "video.%(ext)s"),
        url,
      ],
      FETCH_MS,
    );
    if (!got.ok) return null;

    const files = await readdir(dir);
    const name = files.find((one) => MERGED.test(one));
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
