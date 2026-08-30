const MARKDOWN_SPECIAL = new Set(["\\", "`", "*", "_", "~", "|", "[", "]"]);

const MAX_LENGTH = 180;

export function plain(value: string): string {
  let out = "";
  for (const ch of value.slice(0, MAX_LENGTH)) {
    if (MARKDOWN_SPECIAL.has(ch)) out += "\\";
    out += ch;
  }
  return out;
}

export function label(value: string): string {
  return value.slice(0, MAX_LENGTH).replaceAll("[", "［").replaceAll("]", "］");
}

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

export function maybeLink(text: string, target: string | undefined | null): string {
  const safe = url(target, "");
  return safe ? `[${label(text)}](${safe})` : plain(text);
}

export const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : /(ch|sh|s|x|z)$/i.test(word) ? "es" : "s"}`;

export function singular(word: string): string {
  if (/(ch|sh|s|x|z)es$/i.test(word)) return word.slice(0, -2);
  if (/[^s]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

export const counted = (n: number, word: string) => plural(n, singular(word));

export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function duration(ms: number | undefined | null): string | null {
  if (!ms || ms < 1000) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function releaseYear(date: string | undefined | null): string | null {
  const year = date?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? year : null;
}
