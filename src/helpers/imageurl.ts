export const MAX_URL = 400;

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i;

const IMAGE_HOSTS = [
  "imgur.com",
  "i.redd.it",
  "redditmedia.com",
  "discordapp.com",
  "discordapp.net",
  "discord.com",
  "lastfm.freetls.fastly.net",
  "last.fm",
  "scdn.co",
  "mzstatic.com",
  "coverartarchive.org",
  "archive.org",
  "wikimedia.org",
  "ibb.co",
  "bcbits.com",
  "dzcdn.net",
  "githubusercontent.com",
  "pbs.twimg.com",
] as const;

export type UrlCheck = { ok: true; href: string } | { ok: false; reason: string };

export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host.startsWith("[")) return false;

  if (!host.includes(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return false;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1] ?? -1);
    const b = Number(v4[2] ?? -1);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a >= 224) return false;
  }

  return true;
}

export function isKnownImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return IMAGE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export function checkImageUrl(raw: string): UrlCheck {
  const trimmed = /^<(.+)>$/.exec(raw.trim())?.[1] ?? raw.trim();

  if (!trimmed) return { ok: false, reason: "Give me the image URL first." };
  if (trimmed.length > MAX_URL) {
    return { ok: false, reason: `That URL is longer than ${MAX_URL} characters.` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That is not a URL I can parse." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only `http` and `https` links are accepted." };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "That URL carries a username or password in it." };
  }

  if (!isPublicHost(parsed.hostname)) {
    return { ok: false, reason: "That host is not reachable from everyone else's Discord." };
  }

  if (!IMAGE_EXTENSION.test(parsed.pathname) && !isKnownImageHost(parsed.hostname)) {
    return {
      ok: false,
      reason:
        "That does not look like an image. End the link in `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`, or use a known image host such as imgur.",
    };
  }

  const href = parsed.toString();
  if (href.length > MAX_URL) {
    return { ok: false, reason: `That URL is longer than ${MAX_URL} characters.` };
  }

  return { ok: true, href };
}

export function renderableUrl(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_URL) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return value;
}

export function hostOf(value: string): string {
  try {
    return new URL(value).host || "image";
  } catch {
    return "image";
  }
}
