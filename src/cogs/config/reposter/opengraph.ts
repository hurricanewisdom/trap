import type { Facts } from "./download.js";

// The rewrite hosts exist to serve OpenGraph tags to Discord's crawler, and they
// put the engagement counts in there alongside the video. Reddit refuses this
// address outright, so those tags are the only place its numbers can come from.
const AS_DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

const READ_MS = 12_000;

// The tags are in the head; there is no reason to read a whole page for them.
const CAP = 512 * 1024;

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

function tagsIn(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [tag] of html.matchAll(META)) {
    const key = attribute(tag, "property") ?? attribute(tag, "name");
    const value = attribute(tag, "content");
    if (key && value) out.set(key.toLowerCase(), value);
  }
  return out;
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
  let html: string;
  try {
    const answer = await fetch(url, {
      headers: { "user-agent": AS_DISCORD },
      signal: AbortSignal.timeout(READ_MS),
      redirect: "follow",
    });
    if (!answer.ok) return null;
    html = (await answer.text()).slice(0, CAP);
  } catch {
    return null;
  }

  const meta = tagsIn(html);
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
