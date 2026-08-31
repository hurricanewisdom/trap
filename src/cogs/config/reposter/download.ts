import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = process.env.YTDLP_PATH ?? "/usr/local/bin/yt-dlp";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

// Some sites hand a logged-out visitor nothing. Point this at a Netscape cookie
// file and private posts start working; without it they fall back to a rewrite
// host or are left alone.
const COOKIES = process.env.YTDLP_COOKIES ?? "";

const PROBE_MS = 30_000;

const FETCH_MS = 150_000;

const AT_ONCE = 2;

const SHRINK_MS = 180_000;

// Past this, re-encoding costs more than the repost is worth, and the bitrate it
// would need looks like a slideshow anyway.
const MOST_SECONDS_TO_SHRINK = 600;

const AUDIO_KBPS = 96;

const LEAST_KBPS = 150;

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

function runTool(
  bin: string,
  args: string[],
  ms: number,
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: ms, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout) => resolve({ ok: !error, out: stdout ?? "" }),
    );
  });
}

function run(args: string[], ms: number): Promise<{ ok: boolean; out: string }> {
  return runTool(TOOL, args, ms);
}

// What ffprobe can say about a file already on disk, which beats trusting the
// site's own numbers.
async function inspect(file: string): Promise<{ seconds: number; hasVideo: boolean } | null> {
  const got = await runTool(
    FFPROBE,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file],
    20_000,
  );
  if (!got.ok) return null;

  try {
    const held = JSON.parse(got.out) as {
      format?: { duration?: string };
      streams?: { codec_type?: string }[];
    };
    const seconds = Number(held.format?.duration ?? 0);
    return {
      seconds: Number.isFinite(seconds) ? seconds : 0,
      hasVideo: (held.streams ?? []).some((one) => one.codec_type === "video"),
    };
  } catch {
    return null;
  }
}

// Re-encodes to land under the limit. A file two percent over the ceiling used to
// be thrown away and replaced with a link, and on a server that is not boosted
// that is most of them.
async function shrink(from: string, to: string, maxBytes: number): Promise<boolean> {
  const facts = await inspect(from);
  if (!facts || !facts.hasVideo || facts.seconds <= 0) return false;
  if (facts.seconds > MOST_SECONDS_TO_SHRINK) return false;

  // Ninety percent of the ceiling leaves room for the container's own overhead,
  // and the audio track is taken out of the budget before video gets the rest.
  const total = Math.floor((maxBytes * 8 * 0.9) / facts.seconds / 1000);
  const video = total - AUDIO_KBPS;
  if (video < LEAST_KBPS) return false;

  // Bounded threads: this box runs other things, and a repost is not worth
  // taking the machine for.
  const done = await runTool(
    FFMPEG,
    [
      "-y", "-loglevel", "error", "-threads", "2",
      "-i", from,
      "-c:v", "libx264", "-preset", "veryfast",
      "-b:v", `${video}k`, "-maxrate", `${video}k`, "-bufsize", `${video * 2}k`,
      "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`,
      "-movflags", "+faststart",
      to,
    ],
    SHRINK_MS,
  );
  if (!done.ok) return false;

  try {
    return (await stat(to)).size <= maxBytes;
  } catch {
    return false;
  }
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

// One download attempt into the temp directory, returning the merged file's name.
async function fetchInto(dir: string, url: string, ceiling: number): Promise<string | null> {
  const got = await run(
    [
      ...(await common()),
      "--no-part",
      "--max-filesize",
      String(ceiling),
      "-f",
      formatFor(ceiling),
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
  return files.find((one) => MERGED.test(one)) ?? null;
}

// Downloads to a temp directory and reads the one file back, so a failure part
// way through leaves nothing behind. The format is not pinned to mp4: soundcloud
// has no video at all and would match nothing.
//
// `--max-filesize` is checked per stream and not on the merged result, and the
// `filesize_approx<?` predicate admits formats whose size is unknown. Between
// them, an attempt that asked for nine megabytes can hand back twenty-one. So the
// file that arrives is measured rather than trusted, whichever attempt produced
// it, and squeezed down if it is over.
export async function grab(url: string, maxBytes: number): Promise<Grabbed | null> {
  if (running >= AT_ONCE) return null;
  running += 1;

  const dir = await mkdtemp(join(tmpdir(), "trap-repost-"));
  try {
    // Ask for something that already fits, which costs nothing extra when the
    // site offers a small enough rendition.
    let name = await fetchInto(dir, url, maxBytes);

    if (!name) {
      // Nothing fit, and the site said so up front. Take a larger copy and
      // squeeze it: a file a few percent over is the common case on a server
      // with no boosts, and a link is a poor substitute for a video.
      name = await fetchInto(dir, url, Math.min(maxBytes * 5, 150 * 1024 * 1024));
      if (!name) return null;
    }

    const from = join(dir, name);
    if ((await stat(from)).size > maxBytes) {
      const to = join(dir, "fitted.mp4");
      if (!(await shrink(from, to, maxBytes))) return null;
      name = "fitted.mp4";
    }

    const raw = await readFile(join(dir, name));
    // over an explicit ArrayBuffer so the type is exact for FormData
    const body = new Uint8Array(new ArrayBuffer(raw.length));
    body.set(raw);
    if (body.length === 0 || body.length > maxBytes) return null;

    return { body, name: name === "fitted.mp4" ? "video.mp4" : name };
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
