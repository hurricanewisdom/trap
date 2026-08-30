import { counted, label, plural } from "./markdown.js";

export const USER_ACCENT: number | null = null;

export const PAGE_SIZE = 10;

export interface CardOptions {
  heading: string;
  username: string;
  icon?: string | null;
  noun: string;
  total: number;
  footer?: string;
}

export function header(heading: string, _icon?: string | null): unknown {
  return { type: 10, content: `### ${heading}` };
}

export const separator = (divider = true, spacing = 1) => ({
  type: 14,
  divider,
  spacing,
});

export const paragraph = (content: string) => ({ type: 10, content });

export const subtext = (content: string) => paragraph(`-# ${content}`);

export function linkRow(buttons: { label: string; url: string }[]): unknown {
  return {
    type: 1,
    components: buttons.slice(0, 5).map((button) => ({
      type: 2,
      style: 5,
      label: button.label.slice(0, 80),
      url: button.url,
    })),
  };
}

export const image = (url: string) => ({ type: 12, items: [{ media: { url } }] });

export function buildPages(lines: string[], options: CardOptions): unknown[][] {
  if (lines.length === 0) return [];
  const pageCount = Math.ceil(lines.length / PAGE_SIZE);

  return Array.from({ length: pageCount }, (_, page) => {
    const slice = lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const summary = options.footer ?? `${counted(options.total, options.noun)} total`;
    const footer = `-# ${summary}` + (pageCount > 1 ? ` • Page ${page + 1} of ${pageCount}` : "");

    return [
      header(options.heading, options.icon),
      separator(true),
      paragraph(slice.join("\n")),
      separator(false),
      paragraph(footer),
    ];
  });
}

export function simpleCard(heading: string, body: string, icon?: string | null): unknown[][] {
  return [[header(heading, icon), separator(true), paragraph(body)]];
}

export function chartLine(
  index: number,
  name: string,
  link: string,
  count: number,
  noun = "play",
  badge?: string,
): string {
  const rank = badge ?? `\`${index}\``;
  return `${rank} **[${label(name)}](${link})** · **${plural(count, noun)}**`;
}

export function bar(value: number, max: number, width = 12): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
