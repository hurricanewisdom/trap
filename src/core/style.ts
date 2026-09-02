import { AsyncLocalStorage } from "node:async_hooks";

/** The four kinds of card a command can send. */
export type Kind = "approve" | "default" | "loading" | "warn";

export const KINDS: Kind[] = ["approve", "default", "loading", "warn"];

export interface Style {
  emoji: Partial<Record<Kind, string>>;
  color: Partial<Record<Kind, number>>;
  /** Whether the bot's own replies are allowed to ping anybody. */
  ping: boolean;
  /** Whether a card's last line gets a full stop. */
  punctuation: boolean;
  /** A softer warning: the emoji, without the red. */
  warnSoft: boolean;
}

export const PLAIN: Style = {
  emoji: {},
  color: {},
  ping: false,
  punctuation: true,
  warnSoft: false,
};

export type StyleProvider = (guildId: string) => Promise<Style>;

const storage = new AsyncLocalStorage<Style>();

let provider: StyleProvider | null = null;

export function provideStyle(next: StyleProvider): void {
  provider = next;
}

/**
 * The style for a guild, or the plain one.
 *
 * Failing to the plain style rather than throwing matters: this is read on the
 * way to every reply the bot sends, so a database blip has to mean "no
 * decoration", not "no answer".
 */
export async function styleFor(guildId: string | undefined): Promise<Style> {
  if (!guildId || !provider) return PLAIN;
  try {
    return await provider(guildId);
  } catch {
    return PLAIN;
  }
}

export function withStyle<T>(style: Style, run: () => T): T {
  return storage.run(style, run);
}

export function currentStyle(): Style {
  return storage.getStore() ?? PLAIN;
}

/**
 * Puts the kind's emoji in front of the card and its full stop at the end.
 *
 * The emoji goes after a leading `### ` if there is one, so a heading keeps
 * being a heading; putting it before would turn the whole line into body text.
 */
export function decorate(body: string, kind: Kind): string {
  const style = currentStyle();
  const emoji = style.emoji[kind];

  let text = body;
  if (emoji) {
    const heading = /^(#{1,3}\s+)/.exec(text);
    text = heading ? `${heading[1]}${emoji} ${text.slice(heading[1]?.length)}` : `${emoji} ${text}`;
  }

  const lines = text.split("\n");
  // No findLastIndex: the tsconfig target predates it.
  let at = -1;
  for (let scan = lines.length - 1; scan >= 0; scan -= 1) {
    if ((lines[scan] ?? "").trim() !== "") {
      at = scan;
      break;
    }
  }
  const last = lines[at];

  // Only a plain sentence is punctuated. A line that already ends in something,
  // or is a heading, a code fence or one of the small `-#` notes, is left alone.
  if (
    last !== undefined &&
    !last.startsWith("#") &&
    !last.startsWith("-#") &&
    !last.startsWith("```") &&
    /[a-z0-9)\]]$/i.test(last.trim())
  ) {
    lines[at] = style.punctuation ? `${last}.` : last;
  } else if (last !== undefined && !style.punctuation && last.trim().endsWith(".")) {
    lines[at] = last.replace(/\.\s*$/, "");
  }

  return lines.join("\n");
}

/** The accent a card of this kind should carry, if any. */
export function colorFor(kind: Kind): number | null {
  const style = currentStyle();
  if (kind === "warn" && style.warnSoft) return style.color.default ?? null;
  return style.color[kind] ?? style.color.default ?? null;
}
