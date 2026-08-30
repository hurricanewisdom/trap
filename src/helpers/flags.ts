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
