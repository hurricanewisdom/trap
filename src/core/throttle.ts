// Nothing here touches the database. This runs for every command in every
// channel; the settings arrive already cached from the cog that owns them.

export interface Limits {
  perUser: number;
  perGuild: number;
  windowMs: number;
  on: boolean;
}

// A person typing fast can manage a few commands in ten seconds; a script does
// hundreds. The default sits above the first and well under the second.
export const DEFAULTS: Limits = { perUser: 5, perGuild: 30, windowMs: 10_000, on: true };

// After somebody has been told once, they are dropped in silence for this long.
// Answering every spammed command turns the bot into the thing doing the
// spamming, which is worse than the spam it is refusing.
export const QUIET_MS = 30_000;

const MOST_TRACKED = 5000;

export type LimitsFor = (guildId: string) => Promise<Limits>;

let source: LimitsFor | null = null;

export function provideLimits(provided: LimitsFor): void {
  source = provided;
}

// Falls back to the defaults rather than to no limit: a database that cannot be
// reached is a reason to keep the guard, not to drop it.
export async function limitsFor(guildId: string | undefined): Promise<Limits> {
  if (!source || !guildId) return DEFAULTS;
  try {
    return await source(guildId);
  } catch {
    return DEFAULTS;
  }
}

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
function prune(held: Map<string, Window>, windowMs: number, now: number): void {
  if (held.size <= MOST_TRACKED) return;
  for (const [key, one] of held) {
    if (now - one.seenAt > Math.max(windowMs, QUIET_MS)) held.delete(key);
  }
}

function overLimit(
  held: Map<string, Window>,
  key: string,
  allowed: number,
  windowMs: number,
  now: number,
): { over: boolean; window: Window } {
  const one = held.get(key) ?? fresh();
  one.seenAt = now;
  one.hits = one.hits.filter((at) => now - at < windowMs);

  if (one.hits.length >= allowed) {
    held.set(key, one);
    return { over: true, window: one };
  }

  one.hits.push(now);
  held.set(key, one);
  prune(held, windowMs, now);
  return { over: false, window: one };
}

// Pure and synchronous on purpose: the settings are fetched by the caller, which
// is already awaiting other things, and a minute of behaviour can be tested here
// without sleeping through it.
export function allow(
  guildId: string | undefined,
  userId: string,
  limits: Limits = DEFAULTS,
  now = Date.now(),
): Verdict {
  if (!limits.on) return "ok";

  const mine = overLimit(
    people,
    `${guildId ?? "dm"}:${userId}`,
    limits.perUser,
    limits.windowMs,
    now,
  );

  // Direct messages share no server, so a shared bucket would let one person
  // throttle strangers.
  const theirs = guildId
    ? overLimit(servers, guildId, limits.perGuild, limits.windowMs, now)
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
