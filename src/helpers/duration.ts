// "10m", "2h30m", "7d", "1w". Returns milliseconds, or null when it is not a
// duration at all — which is how a command tells a duration from a reason.
const PART = /(\d+)\s*(mo|[smhdwy])/gi;

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
  y: 31_536_000_000,
};

export function parseDuration(said: string): number | null {
  const text = said.trim().toLowerCase();
  if (!text) return null;

  let total = 0;
  let matched = 0;
  let hit: RegExpExecArray | null;

  PART.lastIndex = 0;
  while ((hit = PART.exec(text)) !== null) {
    const size = UNITS[hit[2] as string];
    if (!size) continue;
    total += Number(hit[1]) * size;
    matched += hit[0].length;
  }

  // Every character has to be part of the duration, or "5m spamming" would be
  // read as five minutes and the reason would vanish.
  const bare = text.replace(/\s+/g, "");
  if (matched === 0 || matched !== bare.length) return null;
  return total > 0 ? total : null;
}

// Splits "10m being rude" into its duration and the rest. A leading word that is
// not a duration means the whole thing is the reason.
export function splitDuration(said: string): { ms: number | null; rest: string } {
  const words = said.trim().split(/\s+/);
  for (let take = words.length; take > 0; take--) {
    const ms = parseDuration(words.slice(0, take).join(" "));
    if (ms !== null) return { ms, rest: words.slice(take).join(" ").trim() };
  }
  return { ms: null, rest: said.trim() };
}

const NAMES: [number, string][] = [
  [31_536_000_000, "year"],
  [2_592_000_000, "month"],
  [604_800_000, "week"],
  [86_400_000, "day"],
  [3_600_000, "hour"],
  [60_000, "minute"],
  [1000, "second"],
];

export function humanDuration(ms: number): string {
  if (ms <= 0) return "no time";

  const parts: string[] = [];
  let left = ms;
  for (const [size, name] of NAMES) {
    const many = Math.floor(left / size);
    if (many <= 0) continue;
    parts.push(`${many} ${name}${many === 1 ? "" : "s"}`);
    left -= many * size;
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "under a second";
}
