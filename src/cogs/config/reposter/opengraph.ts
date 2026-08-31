import type { Facts } from "./download.js";

// The rewrite hosts exist to serve OpenGraph tags to Discord's crawler, and they
// put the engagement counts in there alongside the video. Reddit refuses this
// address outright, so those tags are the only place its numbers can come from.
const AS_DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

// Following a short link is a different job: the site answers that one itself,
// and answers a crawler differently from a browser.
const AS_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const READ_MS = 12_000;

// The tags are in the head; there is no reason to read a whole page for them.
const CAP = 512 * 1024;

// A photo post with more pages than this is somebody's slideshow, not a repost.
const MOST_PHOTOS = 30;

const META = /<meta\s[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decoded(raw: string): string {
  return raw.replace(/&(?:amp|quot|#39|apos|lt|gt|nbsp);/g, (hit) => ENTITIES[hit] ?? hit);
}

function attribute(tag: string, name: string): string | null {
  const found = tag.match(new RegExp(`${name}\s*=\s*"([^"]*)"`, "i"));
  return found?.[1] === undefined ? null : decoded(found[1]);
}

// A list rather than a map: og:image repeats once per photo, and a map would keep
// only the last one.
function pairsIn(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const [tag] of html.matchAll(META)) {
    const key = attribute(tag, "property") ?? attribute(tag, "name");
    const value = attribute(tag, "content");
    if (key && value) out.push([key.toLowerCase(), value]);
  }
  return out;
}

async function pageAt(url: string): Promise<string | null> {
  try {
    const answer = await fetch(url, {
      headers: { "user-agent": AS_DISCORD },
      signal: AbortSignal.timeout(READ_MS),
      redirect: "follow",
    });
    if (!answer.ok) return null;
    return (await answer.text()).slice(0, CAP);
  } catch {
    return null;
  }
}

// A short link says nothing about what it points at. Tiktok's /t/ links resolve to
// either a video or a photo post, and those need completely different handling, so
// the link has to be followed before anything can be decided.
export async function resolved(url: string): Promise<string> {
  try {
    const answer = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": AS_BROWSER },
      signal: AbortSignal.timeout(READ_MS),
      redirect: "follow",
    });
    return answer.url || url;
  } catch {
    return url;
  }
}

// The fixers write counts as plain numbers, or shortened once they get large.
function toNumber(raw: string): number | null {
  const found = raw.match(/^([\d.,]+)([KMB])?$/i);
  if (!found?.[1]) return null;

  const base = Number(found[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;

  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(found[2] ?? "").toLowerCase()] ?? 1;
  return Math.round(base * scale);
}

// Every fixer picks its own icons for the same four numbers, so they are matched
// as a set rather than one house style.
const MARKS: { field: "views" | "likes" | "comments" | "shares"; icons: string[] }[] = [
  { field: "views", icons: ["\u{1F441}", "▶"] },
  { field: "likes", icons: ["⬆", "\u{1F44D}", "❤", "♥"] },
  { field: "comments", icons: ["\u{1F4AC}", "\u{1F5E8}"] },
  { field: "shares", icons: ["\u{1F501}", "\u{1F500}", "♻"] },
];

// The icon is usually followed by a variation selector and a space before the
// number, and neither is guaranteed.
function counted(text: string, icons: string[]): number | null {
  for (const icon of icons) {
    const at = text.indexOf(icon);
    if (at === -1) continue;

    const after = text.slice(at + icon.length).match(/^[️\s]*([\d.,]+[KMB]?)/i);
    if (after?.[1]) return toNumber(after[1]);
  }
  return null;
}

// Reads what a rewrite host would show Discord. Returns the same shape as a
// yt-dlp probe, so the caller does not have to care which one answered.
export async function readCard(url: string): Promise<Facts | null> {
  const html = await pageAt(url);
  if (html === null) return null;

  const meta = new Map(pairsIn(html));
  const title = meta.get("og:title") ?? "";
  const site = meta.get("og:site_name") ?? "";

  // No title and nothing to play means this is not a post page at all: a holding
  // page would otherwise be reported as a perfectly good card.
  if (!title && !meta.get("og:video")) return null;

  const where = `${site} ${meta.get("og:description") ?? ""}`;
  const who = site.match(/^(u\/[\w-]+|@[\w.]+)/);

  return {
    title: title.slice(0, 200),
    uploader: (who?.[1] ?? "").slice(0, 80),
    duration: null,
    views: counted(where, MARKS[0]!.icons),
    likes: counted(where, MARKS[1]!.icons),
    comments: counted(where, MARKS[2]!.icons),
    shares: counted(where, MARKS[3]!.icons),
    bytes: null,
  };
}

export interface Album {
  title: string;
  uploader: string;
  images: string[];
}

// A photo post is not video, and yt-dlp answers "Unsupported URL" for one. The
// images are only reachable as the repeated og:image tags a fixer publishes, so
// this is the whole route rather than a fallback.
export async function readAlbum(url: string): Promise<Album | null> {
  const html = await pageAt(url);
  if (html === null) return null;

  const pairs = pairsIn(html);
  const images = pairs.filter(([key]) => key === "og:image").map(([, value]) => value);
  if (images.length === 0) return null;

  const meta = new Map(pairs);
  const named = meta.get("og:title") ?? "";
  const said = meta.get("og:description") ?? "";
  const who = named.match(/\((@[\w.]+)\)/);

  return {
    // The name goes in og:title and the post's own words in og:description, so
    // the description is the better caption when there is one.
    title: (said || named.replace(/\s*\(@[\w.]+\)\s*$/, "")).slice(0, 200),
    uploader: (who?.[1] ?? "").slice(0, 80),
    images: images.slice(0, MOST_PHOTOS),
  };
}
