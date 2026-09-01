import { sql } from "./db.js";

/**
 * What the protective features did, and how long it took them.
 *
 * The antinuke tells the owner directly, but the filters delete a message and
 * say nothing at all — which is right in the channel and useless afterwards,
 * because there was no way to see whether they were working or how quickly. One
 * log covers both.
 */
export interface Protection {
  guildId: string;
  /** `antinuke:channel`, `filter:caps` — the feature, then which part of it. */
  source: string;
  /** Whoever did the thing, or the webhook that posted it. */
  actor: string;
  detail: string;
  outcome: string;
  tookMs: number;
}

// The filters fire on ordinary messages, so this is written the same way the
// emote counter is: buffered, then one statement, rather than a round trip per
// deleted message.
const pending: Protection[] = [];

const FLUSH_MS = 20_000;

// A raid is exactly when this matters and exactly when it would grow fastest,
// so it is bounded. Losing the tail of a flood costs a log line, not a defence.
const MOST_PENDING = 20_000;

export function recordProtection(one: Protection): void {
  if (pending.length >= MOST_PENDING) return;
  pending.push(one);
}

export async function flushProtection(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length).map((one) => ({
    guild_id: one.guildId,
    source: one.source,
    actor: one.actor,
    detail: one.detail,
    outcome: one.outcome,
    took_ms: Math.round(one.tookMs),
  }));

  try {
    await sql`
      INSERT INTO protection_events ${sql(batch, "guild_id", "source", "actor", "detail", "outcome", "took_ms")}
    `;
  } catch {
    // Losing twenty seconds of log lines beats growing the buffer while the
    // database is unhappy.
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startProtectionLog(): void {
  if (timer) return;
  timer = setInterval(() => void flushProtection().catch(() => {}), FLUSH_MS);
  timer.unref?.();
}

/** Milliseconds, said the way somebody reads them. */
export function took(from: number): string {
  const ms = Date.now() - from;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
