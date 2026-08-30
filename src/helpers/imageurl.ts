/**
 * Deciding whether a URL somebody typed is safe to show to everybody else.
 *
 * This is a security boundary, not a formatting concern. A URL that gets
 * through here is embedded as media in messages sent to other members, so it
 * has to be a real image, on a host that is actually reachable from the wider
 * internet, with nothing in it designed to read as one host to a person and
 * another to a browser.
 *
 * It refuses by default and explains why, because a rejection the user cannot
 * understand just becomes a support question.
 */

/** A URL is rendered inside other people's cards; anything longer is not an image. */
export const MAX_URL = 400;

/** Extensions Discord will actually render as an image. */
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i;

/**
 * Hosts whose image URLs carry no file extension. Matched on the host itself
 * or any subdomain, so "is1-ssl.mzstatic.com" is covered by "mzstatic.com".
 */
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

/**
 * True for a host that could plausibly serve an image to everyone else.
 *
 * The point is to refuse anything that resolves somewhere private: loopback,
 * link-local, RFC1918 and intranet names would either fail for every other
 * viewer or, worse, make the bot fetch something on its own network.
 */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  // new URL() keeps the brackets on an IPv6 literal.
  if (host.startsWith("[")) return false;
  // "localhost", "nas", and other single-label intranet names.
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

/** True for a host known to serve images without a file extension. */
export function isKnownImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return IMAGE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** Accepts a URL only if it is plainly an image on a public host. */
export function checkImageUrl(raw: string): UrlCheck {
  // People paste <url> to stop Discord unfurling it; take that off first.
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

  // "https://images.example.com@evil.test/x.png" reads as the wrong host to a
  // human and the right one to a browser, so userinfo is refused outright.
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

  // Store the canonical form so a unique index sees one row per real image.
  const href = parsed.toString();
  if (href.length > MAX_URL) {
    return { ok: false, reason: `That URL is longer than ${MAX_URL} characters.` };
  }

  return { ok: true, href };
}

/**
 * A stored URL, but only if it is still safe to hand to Discord as media.
 *
 * Submissions are checked on the way in, yet this is the check that matters
 * on the way *out*: Discord answers an unparseable or non-http(s) media URL
 * with a 400, which would break the card for everyone playing that album
 * until the row is removed by hand. Rows written before this validation
 * existed therefore read as "no submission" rather than being trusted.
 *
 * The original string is returned rather than a re-serialised one, so it
 * still compares equal to the row it came from.
 */
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

/** The host, for a link label that tells the reader where the image lives. */
export function hostOf(value: string): string {
  try {
    return new URL(value).host || "image";
  } catch {
    return "image";
  }
}
