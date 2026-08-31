// Nothing here touches the database. This runs for every command in every
// channel, and the message path does no I/O.

// A person typing fast can manage a few commands in ten seconds; a script does
// hundreds. The limit is meant to sit above the first and well under the second.
const PER_USER = { allowed: 5, windowMs: 10_000 };

// One person hitting their own limit does not slow anyone else down. A raid of
// twenty accounts would, so the whole server has a ceiling too.
const PER_GUILD = { allowed: 30, windowMs: 10_000 };

// After somebody has been told once, they are dropped in silence for this long.
// Answering every spammed command turns the bot into the thing doing the
// spamming, which is worse than the spam it is refusing.
const QUIET_MS = 30_000;

const MOST_TRACKED = 5000;

export type Verdict = "ok" | "warn" | "drop";

interface Window {
  hits: number[];
  warnedAt: number;
  seenAt: number;
}

const people = new Map<string, Window>();

const servers = new Map<string, Window>();

function fresh(): Window {
  return { hits: [], warnedAt: 0, seenAt: 0 };
}

// Keeps the maps from growing without bound in a bot sitting in many servers.
// Anything untouched for longer than the window can never affect a verdict.
function prune(held: Map<string, Window>, now: number): void {
  if (held.size <= MOST_TRACKED) return;
  for (const [key, one] of held) {
    if (now - one.seenAt > Math.max(PER_USER.windowMs, QUIET_MS)) held.delete(key);
  }
}

function overLimit(
  held: Map<string, Window>,
  key: string,
  limit: { allowed: number; windowMs: number },
  now: number,
): { over: boolean; window: Window } {
  const one = held.get(key) ?? fresh();
  one.seenAt = now;
  one.hits = one.hits.filter((at) => now - at < limit.windowMs);

  if (one.hits.length >= limit.allowed) {
    held.set(key, one);
    return { over: true, window: one };
  }

  one.hits.push(now);
  held.set(key, one);
  prune(held, now);
  return { over: false, window: one };
}

// `now` is a parameter so this can be tested without sleeping through a window.
export function allow(guildId: string | undefined, userId: string, now = Date.now()): Verdict {
  const mine = overLimit(people, `${guildId ?? "dm"}:${userId}`, PER_USER, now);

  // Direct messages share no server, so a shared bucket would let one person
  // throttle strangers.
  const theirs = guildId
    ? overLimit(servers, guildId, PER_GUILD, now)
    : { over: false, window: fresh() };

  if (!mine.over && !theirs.over) return "ok";

  // The server ceiling is never explained to the person who happened to trip it,
  // because it is usually not about them.
  if (!mine.over) return "drop";

  if (now - mine.window.warnedAt < QUIET_MS) return "drop";

  mine.window.warnedAt = now;
  return "warn";
}

export function forget(): void {
  people.clear();
  servers.clear();
}

export const LIMITS = { PER_USER, PER_GUILD, QUIET_MS };
