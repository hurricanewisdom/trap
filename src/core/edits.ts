const DISCORD_EPOCH = 1420070400000;

const WINDOW_MS = 900_000;

const COOLDOWN_MS = 1200;

const CAP = 4000;

const seen = new Map<string, string>();

const reran = new Map<string, number>();

function sentAt(messageId: string): number {
  try {
    return Number(BigInt(messageId) >> 22n) + DISCORD_EPOCH;
  } catch {
    return Date.now();
  }
}

function trim(): void {
  while (seen.size > CAP) {
    const oldest = seen.keys().next();
    if (oldest.done) break;
    seen.delete(oldest.value);
    reran.delete(oldest.value);
  }
}

export function noteMessage(messageId: string, content: string): void {
  if (!messageId) return;
  seen.delete(messageId);
  seen.set(messageId, content);
  trim();
}

export function forgetMessage(messageId: string): void {
  seen.delete(messageId);
  reran.delete(messageId);
}

export function editedInto(messageId: string, content: string): boolean {
  const before = seen.get(messageId);
  if (before === undefined) return false;
  if (before === content) return false;

  noteMessage(messageId, content);

  if (Date.now() - sentAt(messageId) > WINDOW_MS) return false;

  const last = reran.get(messageId) ?? 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS) return false;

  reran.set(messageId, now);
  return true;
}
