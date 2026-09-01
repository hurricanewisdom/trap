/**
 * The embed code these commands read and write.
 *
 *   {title: Hello}$v{description: World}$v{color: #1db954}
 *
 * Blocks are separated by `$v`, each is `{key: value}`, and a few keys take
 * several values separated by `&&`. It is the format the bots people are coming
 * from already use, so a code pasted from one of those works here.
 */

export interface Field {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; icon_url?: string; url?: string };
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: Field[];
}

export interface Built {
  content?: string;
  embeds: Embed[];
}

const NAMED: Record<string, number> = {
  red: 0xff0000,
  green: 0x00ff00,
  blue: 0x0000ff,
  black: 0x000001,
  white: 0xffffff,
  yellow: 0xffff00,
  orange: 0xffa500,
  purple: 0x800080,
  pink: 0xffc0cb,
  cyan: 0x00ffff,
  invisible: 0x2b2d31,
};

function colourOf(said: string): number | undefined {
  const tidy = said.trim().toLowerCase();
  const named = NAMED[tidy];
  if (named !== undefined) return named;

  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(tidy)?.[1];
  if (!hex) return undefined;
  return Number.parseInt(hex.length === 3 ? hex.replace(/./g, (one) => one + one) : hex, 16);
}

const BLOCK = /^\{\s*([a-z_]+)\s*:\s*([\s\S]*)\}$/i;

/**
 * Reads a code into something Discord will accept.
 *
 * Anything unrecognised is reported rather than dropped: somebody who typed
 * `{colour: red}` should be told the key is wrong, not silently handed a
 * colourless embed and left wondering.
 */
export function parse(code: string): { built: Built; unknown: string[] } {
  const built: Built = { embeds: [] };
  const unknown: string[] = [];
  let embed: Embed | null = null;

  const need = (): Embed => {
    if (!embed) {
      embed = {};
      built.embeds.push(embed);
    }
    return embed;
  };

  for (const raw of code.split("$v")) {
    const chunk = raw.trim();
    if (!chunk) continue;

    // `{embed}` on its own only says "an embed starts here", which matters when
    // a code is nothing but a colour.
    if (/^\{\s*embed\s*\}$/i.test(chunk)) {
      need();
      continue;
    }

    const found = BLOCK.exec(chunk);
    if (!found) {
      unknown.push(chunk.slice(0, 40));
      continue;
    }

    const key = (found[1] ?? "").toLowerCase();
    const value = (found[2] ?? "").trim();
    const parts = value.split("&&").map((one) => one.trim());

    switch (key) {
      case "content":
        built.content = value.slice(0, 2000);
        break;
      case "title":
        need().title = value.slice(0, 256);
        break;
      case "url":
        need().url = value;
        break;
      case "description":
      case "desc":
        need().description = value.slice(0, 4096);
        break;
      case "color":
      case "colour": {
        const colour = colourOf(value);
        if (colour === undefined) unknown.push(`color: ${value.slice(0, 20)}`);
        else need().color = colour;
        break;
      }
      case "timestamp":
        need().timestamp = new Date().toISOString();
        break;
      case "author":
        need().author = {
          name: (parts[0] ?? "").slice(0, 256),
          ...(parts[1] ? { icon_url: parts[1] } : {}),
          ...(parts[2] ? { url: parts[2] } : {}),
        };
        break;
      case "footer":
        need().footer = {
          text: (parts[0] ?? "").slice(0, 2048),
          ...(parts[1] ? { icon_url: parts[1] } : {}),
        };
        break;
      case "image":
        need().image = { url: parts[0] ?? "" };
        break;
      case "thumbnail":
      case "thumb":
        need().thumbnail = { url: parts[0] ?? "" };
        break;
      case "field": {
        const one = need();
        one.fields = one.fields ?? [];
        // Discord caps an embed at twenty-five fields and rejects the whole
        // message over that, so the extras are dropped here with a note.
        if (one.fields.length >= 25) {
          unknown.push("field: over the 25 Discord allows");
          break;
        }
        one.fields.push({
          name: (parts[0] ?? "​").slice(0, 256),
          value: (parts[1] ?? "​").slice(0, 1024),
          inline: /^(true|yes|inline)$/i.test(parts[2] ?? ""),
        });
        break;
      }
      default:
        unknown.push(`${key}: unknown key`);
    }
  }

  return { built, unknown };
}

/** True when there is actually something to post. */
export function isEmpty(built: Built): boolean {
  if (built.content?.trim()) return false;
  return !built.embeds.some(
    (one) =>
      one.title ||
      one.description ||
      one.author?.name ||
      one.footer?.text ||
      one.image?.url ||
      one.thumbnail?.url ||
      (one.fields?.length ?? 0) > 0,
  );
}

/**
 * Turns a posted message back into a code, so an embed somebody likes can be
 * copied and edited rather than rebuilt by hand.
 */
export function serialise(message: { content?: string; embeds?: Embed[] }): string {
  const blocks: string[] = [];
  if (message.content?.trim()) blocks.push(`{content: ${message.content.trim()}}`);

  for (const embed of message.embeds ?? []) {
    blocks.push("{embed}");
    if (embed.color !== undefined) {
      blocks.push(`{color: #${embed.color.toString(16).padStart(6, "0")}}`);
    }
    if (embed.author?.name) {
      blocks.push(
        `{author: ${[embed.author.name, embed.author.icon_url, embed.author.url]
          .filter(Boolean)
          .join(" && ")}}`,
      );
    }
    if (embed.title) blocks.push(`{title: ${embed.title}}`);
    if (embed.url) blocks.push(`{url: ${embed.url}}`);
    if (embed.description) blocks.push(`{description: ${embed.description}}`);
    for (const field of embed.fields ?? []) {
      blocks.push(`{field: ${field.name} && ${field.value}${field.inline ? " && true" : ""}}`);
    }
    if (embed.image?.url) blocks.push(`{image: ${embed.image.url}}`);
    if (embed.thumbnail?.url) blocks.push(`{thumbnail: ${embed.thumbnail.url}}`);
    if (embed.footer?.text) {
      blocks.push(`{footer: ${[embed.footer.text, embed.footer.icon_url].filter(Boolean).join(" && ")}}`);
    }
    if (embed.timestamp) blocks.push("{timestamp}");
  }

  return blocks.join("$v");
}

export const REFERENCE = [
  "-# `{content: ...}` text outside the embed",
  "-# `{title: ...}` · `{url: ...}` · `{description: ...}`",
  "-# `{color: #1db954}` or a name like `red`",
  "-# `{author: name && icon url && link}`",
  "-# `{footer: text && icon url}` · `{timestamp}`",
  "-# `{image: url}` · `{thumbnail: url}`",
  "-# `{field: name && value && true}` — `true` makes it inline",
  "-# Separate every block with `$v`.",
];
