/**
 * Building the Components V2 cards every cog replies with.
 *
 * A "page" here is the list of components that goes *inside* a container; the
 * pager in `core/pager.ts` wraps it and adds the control row. Keeping that
 * split means a command never has to know whether its output will end up
 * paginated.
 */

import { counted, label, plural } from "./markdown.js";

/** Discord's own dark background, so a card reads as part of the client. */
export const EMBED_COLOR = 0x2b2d31;

/** Rows per page. Ten keeps a card under a screen on mobile. */
export const PAGE_SIZE = 10;

export interface CardOptions {
  heading: string;
  /** Whose data this is; shown by callers that want it in the heading. */
  username: string;
  icon?: string | null;
  /** e.g. "artists" — used in the "N artists total" footer line. */
  noun: string;
  total: number;
  /** Replaces the "N nouns total" text entirely; page numbers are still appended. */
  footer?: string;
}

/**
 * The heading row.
 *
 * Deliberately plain text rather than a Section with a thumbnail: the
 * accessory renders large enough to dominate the card, and a missing image
 * shows as a grey placeholder, so it costs a lot of space for nothing.
 */
export function header(heading: string, _icon?: string | null): unknown {
  return { type: 10, content: `### ${heading}` };
}

export const separator = (divider = true, spacing = 1) => ({
  type: 14,
  divider,
  spacing,
});

export const paragraph = (content: string) => ({ type: 10, content });

/** Small grey subtext, used for footers and asides. */
export const subtext = (content: string) => paragraph(`-# ${content}`);

/** A row of link buttons. Discord allows five per row and five rows. */
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

/** A full-width image. */
export const image = (url: string) => ({ type: 12, items: [{ media: { url } }] });

/** Splits rendered lines into pages of container components. */
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

/** A single-page card for commands that are not charts. */
export function simpleCard(heading: string, body: string, icon?: string | null): unknown[][] {
  return [[header(heading, icon), separator(true), paragraph(body)]];
}

/**
 * `1` Name - 14 plays, matching the reference layout.
 *
 * `badge` replaces the rank number for a row that has earned a marker, such
 * as the crown holder in a who-knows listing. It is used verbatim, so a
 * caller that wants the monospace look has to include the backticks.
 */
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

/**
 * A proportional bar, for anything scored out of a known maximum.
 *
 * Uses block characters rather than emoji so it lines up in Discord's
 * proportional font and costs one character per cell.
 */
export function bar(value: number, max: number, width = 12): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
