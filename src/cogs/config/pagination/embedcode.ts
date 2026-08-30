const BLOCK = /\{([a-z]+)\s*:\s*([\s\S]*?)\}/gi;

const MAX_TITLE = 256;

const MAX_DESCRIPTION = 4000;

const MAX_FOOTER = 2048;

const MAX_AUTHOR = 256;

export const FIELDS = [
  ["{title: text}", "the heading"],
  ["{description: text}", "the body, markdown allowed"],
  ["{color: #1db954}", "the stripe down the side"],
  ["{footer: text}", "small text underneath"],
  ["{author: text}", "a line above the title"],
  ["{image: url}", "a large image"],
  ["{thumbnail: url}", "a small image in the corner"],
  ["{url: link}", "makes the title a link"],
] as const;

const KNOWN = new Set(FIELDS.map(([block]) => block.slice(1, block.indexOf(":"))));

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  footer?: { text: string };
  author?: { name: string };
  image?: { url: string };
  thumbnail?: { url: string };
}

function colour(value: string): number | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return Number.parseInt(hex, 16);
}

function link(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

export function parseEmbed(source: string): { embed: Embed | null; problems: string[] } {
  const problems: string[] = [];
  const embed: Embed = {};
  let found = 0;

  for (const match of source.matchAll(BLOCK)) {
    const key = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").trim();

    if (!KNOWN.has(key)) {
      problems.push(`\`{${key}}\` is not a field`);
      continue;
    }
    if (!value) {
      problems.push(`\`{${key}}\` is empty`);
      continue;
    }

    found += 1;
    switch (key) {
      case "title":
        embed.title = value.slice(0, MAX_TITLE);
        break;
      case "description":
        embed.description = value.slice(0, MAX_DESCRIPTION);
        break;
      case "footer":
        embed.footer = { text: value.slice(0, MAX_FOOTER) };
        break;
      case "author":
        embed.author = { name: value.slice(0, MAX_AUTHOR) };
        break;
      case "color": {
        const parsed = colour(value);
        if (parsed === null) problems.push("`{color}` wants a hex like `#1db954`");
        else embed.color = parsed;
        break;
      }
      case "url": {
        const parsed = link(value);
        if (!parsed) problems.push("`{url}` wants an http link");
        else embed.url = parsed;
        break;
      }
      case "image": {
        const parsed = link(value);
        if (!parsed) problems.push("`{image}` wants an http link");
        else embed.image = { url: parsed };
        break;
      }
      case "thumbnail": {
        const parsed = link(value);
        if (!parsed) problems.push("`{thumbnail}` wants an http link");
        else embed.thumbnail = { url: parsed };
        break;
      }
    }
  }

  if (found === 0) {
    problems.push("Nothing to show. A page needs at least a `{title}` or `{description}`.");
    return { embed: null, problems };
  }
  if (!embed.title && !embed.description && !embed.image) {
    problems.push("A page needs a `{title}`, `{description}` or `{image}`.");
    return { embed: null, problems };
  }

  return { embed, problems };
}

export function describe(embed: Embed): string {
  const bits = [
    embed.title ? `**${embed.title.slice(0, 60)}**` : null,
    embed.description ? embed.description.replace(/\n/g, " ").slice(0, 70) : null,
    embed.image ? "image" : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "*empty*";
}
