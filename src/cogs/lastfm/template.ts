/**
 * A small markup for building your own now-playing card.
 *
 * Users write one block per line and the parser turns it into Components V2.
 * Nothing here trusts the input: only known blocks are built, text is escaped,
 * URLs are checked, and every Discord limit is enforced before the card is
 * ever sent. A bad line is reported rather than silently dropped.
 *
 *   {title: {user} is listening}
 *   {text: **{track}** by {artist}}
 *   {separator}
 *   {footer: {plays} plays · {scrobbles} scrobbles}
 *   {button: Open|{trackurl}}
 *   {image: {art}}
 */

import { label, plain } from "./shared.js";

/** Discord caps a message at 40 components and 5 action rows. */
const MAX_BLOCKS = 20;
const MAX_BUTTONS = 5;
const MAX_TEXT = 1000;

export interface Variables {
  user: string;
  track: string;
  artist: string;
  album: string;
  plays: string;
  scrobbles: string;
  art: string;
  trackurl: string;
  artisturl: string;
  status: string;
  loved: string;
  when: string;
}

/** Every placeholder a template may use, for the helper card. */
export const VARIABLE_NAMES: (keyof Variables)[] = [
  "user",
  "track",
  "artist",
  "album",
  "plays",
  "scrobbles",
  "art",
  "trackurl",
  "artisturl",
  "status",
  "loved",
  "when",
];

export const BLOCKS = [
  ["{title: text}", "A heading line"],
  ["{text: text}", "A line of markdown"],
  ["{footer: text}", "Small subtext"],
  ["{separator}", "A divider"],
  ["{space}", "A gap with no line"],
  ["{image: url}", "A large image, usually {art}"],
  ["{thumbnail: url}", "A small image beside the previous text"],
  ["{button: label|url}", "A link button, up to 5"],
  ["{color: #1db954}", "The accent stripe down the card"],
] as const;

export const EXAMPLE = [
  "{color: #1db954}",
  "{title: {user} is listening}",
  "{text: **{track}**}",
  "{text: by {artist} · {album}}",
  "{separator}",
  "{footer: {plays} plays · {scrobbles} scrobbles}",
  "{button: Open on Last.fm|{trackurl}}",
].join("\n");

export interface ParseResult {
  components: unknown[];
  accent: number | null;
  errors: string[];
}

/** Substitutes placeholders, escaping each value for where it lands. */
function fill(text: string, vars: Variables, forLink: boolean): string {
  return text.replace(/\{([a-z]+)\}/gi, (whole, name: string) => {
    const key = name.toLowerCase() as keyof Variables;
    if (!VARIABLE_NAMES.includes(key)) return whole;
    const value = vars[key] ?? "";
    // A track called "*x" would otherwise open italics and bleed into the
    // rest of the card, so values are escaped for the context they land in.
    return forLink ? label(value) : plain(value);
  });
}

function safeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (raw.length > 400) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Parses a template into container children.
 * Errors are collected rather than thrown so the editor can show all of them.
 */
export function parseTemplate(source: string, vars: Variables): ParseResult {
  const components: unknown[] = [];
  const errors: string[] = [];
  let accent: number | null = null;
  let buttons: { type: number; style: number; label: string; url: string }[] = [];

  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > MAX_BLOCKS) {
    errors.push(`Too many lines: ${lines.length}. The limit is ${MAX_BLOCKS}.`);
    return { components, accent, errors };
  }

  for (const [index, line] of lines.entries()) {
    const at = `line ${index + 1}`;
    const match = /^\{([a-z]+)\s*(?::\s*([\s\S]*))?\}$/i.exec(line);
    if (!match) {
      errors.push(`${at}: not a block. Every line looks like {name} or {name: value}.`);
      continue;
    }

    const kind = (match[1] ?? "").toLowerCase();
    const raw = (match[2] ?? "").trim();

    switch (kind) {
      case "title":
      case "text":
      case "footer": {
        if (!raw) {
          errors.push(`${at}: {${kind}} needs some text.`);
          break;
        }
        const body = fill(raw, vars, false).slice(0, MAX_TEXT);
        const prefixed = kind === "title" ? `### ${body}` : kind === "footer" ? `-# ${body}` : body;
        components.push({ type: 10, content: prefixed });
        break;
      }

      case "separator":
        components.push({ type: 14, divider: true, spacing: 1 });
        break;

      case "space":
        components.push({ type: 14, divider: false, spacing: 1 });
        break;

      case "image":
      case "thumbnail": {
        const url = safeUrl(fill(raw, vars, true));
        if (!url) {
          errors.push(`${at}: {${kind}} needs an http or https image link.`);
          break;
        }
        if (kind === "image") {
          components.push({ type: 12, items: [{ media: { url } }] });
        } else {
          // A thumbnail is an accessory, so it needs a text line to sit beside.
          const previous = components[components.length - 1] as { type?: number } | undefined;
          if (!previous || previous.type !== 10) {
            errors.push(`${at}: {thumbnail} has to follow a {text} or {title} line.`);
            break;
          }
          components[components.length - 1] = {
            type: 9,
            components: [previous],
            accessory: { type: 11, media: { url } },
          };
        }
        break;
      }

      case "button": {
        const [labelPart, urlPart] = raw.split("|");
        const url = safeUrl(fill(urlPart ?? "", vars, true));
        const text = fill(labelPart ?? "", vars, true).slice(0, 80);
        if (!text || !url) {
          errors.push(`${at}: {button} looks like {button: label|https://...}.`);
          break;
        }
        if (buttons.length >= MAX_BUTTONS) {
          errors.push(`${at}: more than ${MAX_BUTTONS} buttons.`);
          break;
        }
        buttons.push({ type: 2, style: 5, label: text, url });
        break;
      }

      case "color":
      case "colour": {
        const hex = raw.replace(/^#/, "");
        if (!/^[0-9a-f]{6}$/i.test(hex)) {
          errors.push(`${at}: {color} needs a hex value such as #1db954.`);
          break;
        }
        accent = Number.parseInt(hex, 16);
        break;
      }

      default:
        errors.push(`${at}: unknown block {${kind}}.`);
    }
  }

  if (buttons.length > 0) components.push({ type: 1, components: buttons });

  if (components.length === 0 && errors.length === 0) {
    errors.push("The template produced nothing to show.");
  }

  return { components, accent, errors };
}

/** True when a template can be rendered at all. */
export function validateTemplate(source: string): string[] {
  const sample: Variables = {
    user: "you",
    track: "Track",
    artist: "Artist",
    album: "Album",
    plays: "12",
    scrobbles: "3,456",
    art: "https://example.com/art.png",
    trackurl: "https://www.last.fm/music/Artist/_/Track",
    artisturl: "https://www.last.fm/music/Artist",
    status: "Now playing",
    loved: "loved",
    when: "just now",
  };
  return parseTemplate(source, sample).errors;
}
