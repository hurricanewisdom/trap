/**
 * Making somebody else's text safe to put in a Discord message.
 *
 * Every name the bot renders comes from a stranger's music library, and a
 * track really can be called "*67, im gone". Two different escapes are needed
 * because Discord treats the inside of a link label differently from ordinary
 * text, and using the wrong one is silent: the card just comes out mangled,
 * or with visible backslashes in it.
 */

const MARKDOWN_SPECIAL = new Set(["\\", "`", "*", "_", "~", "|", "[", "]"]);

/** Longest a rendered name may be before it is cut. */
const MAX_LENGTH = 180;

/**
 * Escapes markdown in text that sits OUTSIDE a link.
 *
 * Backslash escapes do work in ordinary message text, and they are needed: an
 * unclosed asterisk opens italics and the formatting then bleeds through
 * every following line of the card. Built character by character because a
 * regex replacement loses its own backslash too easily and fails silently.
 */
export function plain(value: string): string {
  let out = "";
  for (const ch of value.slice(0, MAX_LENGTH)) {
    if (MARKDOWN_SPECIAL.has(ch)) out += "\\";
    out += ch;
  }
  return out;
}

/**
 * Neutralises a masked-link label.
 *
 * Only `]` can break out of `[label](url)`, and Discord does NOT process
 * backslash escapes inside a label — they render literally, which is how
 * visible backslashes end up in a card. The brackets are swapped for
 * fullwidth lookalikes instead.
 */
export function label(value: string): string {
  return value.slice(0, MAX_LENGTH).replaceAll("[", "［").replaceAll("]", "］");
}

/**
 * Validates a URL for use as a link target, falling back when it is unusable.
 *
 * Parentheses are percent-encoded because an unescaped one closes the
 * markdown link early and spills the rest of the URL into the message.
 */
export function url(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
    return parsed.toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return fallback;
  }
}

/** A link if the target is usable, otherwise just the escaped text. */
export function maybeLink(text: string, target: string | undefined | null): string {
  const safe = url(target, "");
  return safe ? `[${label(text)}](${safe})` : plain(text);
}

/**
 * "1 play" / "1,234 plays".
 *
 * Takes the singular and adds "es" after a sibilant, so "match" pluralises to
 * "matches" rather than "matchs".
 */
export const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : /(ch|sh|s|x|z)$/i.test(word) ? "es" : "s"}`;

/**
 * Reduces a word to its singular stem so `plural` can re-form it.
 *
 * Call sites label their lists inconsistently — some pass "albums", some pass
 * "album" — which produced both "1 crowns total" and "5 album total". Rather
 * than editing twenty call sites and hoping the next one remembers, whatever
 * arrives is normalised here.
 *
 * Only the regular English rules are covered, which is all these labels use.
 * A word already singular is returned unchanged, so "album" stays "album" and
 * a genuine "ss" ending like "progress" is not mangled.
 */
export function singular(word: string): string {
  if (/(ch|sh|s|x|z)es$/i.test(word)) return word.slice(0, -2);
  if (/[^s]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** "1 crown" / "12 crowns", whichever form the caller happened to pass in. */
export const counted = (n: number, word: string) => plural(n, singular(word));

/** Large counts as "1.2M" / "16.9M", for places where the exact figure is noise. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

/** Milliseconds as m:ss, or null when there is no meaningful duration. */
export function duration(ms: number | undefined | null): string | null {
  if (!ms || ms < 1000) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** A YYYY-MM-DD or YYYY release date as just the year. */
export function releaseYear(date: string | undefined | null): string | null {
  const year = date?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? year : null;
}
