/**
 * A flag a command accepts, declared once and used twice: the help card renders
 * it and the command reads its value through it.
 *
 * Declaring it in one place is the point. A flag documented in prose and parsed
 * by a separate list of names drifts the moment one of them is renamed, and the
 * failure is silent -- the help keeps advertising a flag that no longer does
 * anything.
 */
export interface CommandFlag {
  /** What the help card shows, and the name the parser looks for first. */
  name: string;
  description: string;
  /** Other spellings accepted, never shown. */
  aliases?: string[];
  /** What it takes, for the help card. Omit for a flag that is just present. */
  takes?: string;
}

export interface Parsed {
  rest: string;
  flags: Map<string, string>;
}

const FLAG = /^--?([a-z][a-z0-9-]*)$/i;

const TRUE = new Set(["on", "yes", "true", "enable", "enabled"]);

const FALSE = new Set(["off", "no", "false", "disable", "disabled"]);

export function parseFlags(argument: string, valueless: string[] = []): Parsed {
  const bare = new Set(valueless.map((name) => name.toLowerCase()));
  const words = argument.split(/\s+/).filter(Boolean);
  const flags = new Map<string, string>();
  const rest: string[] = [];

  for (let at = 0; at < words.length; at += 1) {
    const match = FLAG.exec(words[at] as string);
    if (!match) {
      rest.push(words[at] as string);
      continue;
    }

    const name = (match[1] as string).toLowerCase();
    const next = words[at + 1];

    if (bare.has(name) || next === undefined || FLAG.test(next)) {
      flags.set(name, "true");
      continue;
    }

    flags.set(name, next);
    at += 1;
  }

  return { rest: rest.join(" "), flags };
}

export function flagText(flags: Map<string, string>, ...names: string[]): string | null {
  for (const name of names) {
    const value = flags.get(name.toLowerCase());
    if (value !== undefined) return value;
  }
  return null;
}

export function flagNumber(flags: Map<string, string>, ...names: string[]): number | null {
  const raw = flagText(flags, ...names);
  if (raw === null) return null;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

export function flagOn(flags: Map<string, string>, ...names: string[]): boolean | null {
  const raw = flagText(flags, ...names);
  if (raw === null) return null;

  const lowered = raw.toLowerCase();
  if (TRUE.has(lowered)) return true;
  if (FALSE.has(lowered)) return false;
  return null;
}

export function switchWord(word: string): boolean | null {
  const lowered = word.toLowerCase();
  if (TRUE.has(lowered)) return true;
  if (FALSE.has(lowered)) return false;
  return null;
}

/** Every spelling of a flag, primary first. */
function namesOf(flag: CommandFlag): string[] {
  return [flag.name, ...(flag.aliases ?? [])];
}

/**
 * The value of a declared flag, as a whole number.
 *
 * Reading through the declaration rather than through a list of strings is what
 * keeps the help card honest: renaming the flag renames what is parsed, and the
 * two cannot drift apart.
 */
export function numberFor(parsed: Parsed, flag: CommandFlag): number | null {
  return flagNumber(parsed.flags, ...namesOf(flag));
}

export function textFor(parsed: Parsed, flag: CommandFlag): string | null {
  return flagText(parsed.flags, ...namesOf(flag));
}

export function onFor(parsed: Parsed, flag: CommandFlag): boolean | null {
  return flagOn(parsed.flags, ...namesOf(flag));
}

/** Flags that were typed but not declared, so a typo can be reported. */
export function unknownFlags(parsed: Parsed, declared: CommandFlag[]): string[] {
  const known = new Set(declared.flatMap((one) => namesOf(one).map((n) => n.toLowerCase())));
  return [...parsed.flags.keys()].filter((one) => !known.has(one));
}
