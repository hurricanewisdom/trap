const DISCORD_EPOCH = 1420070400000;

const RECENT_PER_CHANNEL = 60;

const SNIPE_DEPTH = 15;

const HISTORY_PER_MESSAGE = 60;

const CHANNELS = 600;

const HISTORY_MESSAGES = 800;

export interface Seen {
  messageId: string;
  authorId: string;
  content: string;
  files: string[];
}

export interface Deleted extends Seen {
  at: number;
}

export interface Edited extends Seen {
  before: string;
  at: number;
}

export interface Removed {
  messageId: string;
  userId: string;
  emoji: string;
  at: number;
}

export interface Logged {
  userId: string;
  emoji: string;
  added: boolean;
  at: number;
}

interface Bucket<T> {
  guildId: string;
  list: T[];
}

const recent = new Map<string, Bucket<Seen>>();

const deleted = new Map<string, Bucket<Deleted>>();

const edited = new Map<string, Bucket<Edited>>();

const removed = new Map<string, Bucket<Removed>>();

const history = new Map<string, { guildId: string; channelId: string; list: Logged[] }>();

const suppressed = new Set<string>();

const SUPPRESSED = 4000;

export function stamp(messageId: string): number {
  try {
    return Number(BigInt(messageId) >> 22n) + DISCORD_EPOCH;
  } catch {
    return Date.now();
  }
}

function touch<T>(map: Map<string, T>, key: string, value: T, cap: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function push<T>(
  map: Map<string, Bucket<T>>,
  channelId: string,
  guildId: string,
  entry: T,
  depth: number,
): void {
  const held = map.get(channelId);
  const list = held?.guildId === guildId ? held.list : [];
  list.unshift(entry);
  list.length = Math.min(list.length, depth);
  touch(map, channelId, { guildId, list }, CHANNELS);
}

export function remember(guildId: string, channelId: string, message: Seen): void {
  if (suppressed.has(message.messageId)) return;
  push(recent, channelId, guildId, message, RECENT_PER_CHANNEL);
}

export function recall(channelId: string, messageId: string): Seen | null {
  return recent.get(channelId)?.list.find((seen) => seen.messageId === messageId) ?? null;
}

export function forget(channelId: string, messageId: string): void {
  suppressed.add(messageId);
  while (suppressed.size > SUPPRESSED) {
    const oldest = suppressed.values().next();
    if (oldest.done) break;
    suppressed.delete(oldest.value);
  }

  const held = recent.get(channelId);
  if (!held) return;
  held.list = held.list.filter((seen) => seen.messageId !== messageId);
}

export function noteDeleted(guildId: string, channelId: string, seen: Seen): void {
  push(deleted, channelId, guildId, { ...seen, at: stamp(seen.messageId) }, SNIPE_DEPTH);
}

export function noteEdited(
  guildId: string,
  channelId: string,
  seen: Seen,
  before: string,
): void {
  push(edited, channelId, guildId, { ...seen, before, at: Date.now() }, SNIPE_DEPTH);
}

export function noteRemoved(guildId: string, channelId: string, entry: Removed): void {
  push(removed, channelId, guildId, entry, SNIPE_DEPTH);
}

export function noteReaction(
  guildId: string,
  channelId: string,
  messageId: string,
  entry: Logged,
): void {
  const held = history.get(messageId);
  const list = held?.list ?? [];
  list.push(entry);
  if (list.length > HISTORY_PER_MESSAGE) list.splice(0, list.length - HISTORY_PER_MESSAGE);
  touch(history, messageId, { guildId, channelId, list }, HISTORY_MESSAGES);
}

export function reactionsOn(messageId: string): { guildId: string; list: Logged[] } | null {
  const held = history.get(messageId);
  return held ? { guildId: held.guildId, list: held.list } : null;
}

export function deletedIn(channelId: string): Deleted[] {
  return deleted.get(channelId)?.list ?? [];
}

export function editedIn(channelId: string): Edited[] {
  return edited.get(channelId)?.list ?? [];
}

export function removedIn(channelId: string): Removed[] {
  return removed.get(channelId)?.list ?? [];
}

export function clear(guildId: string, channelId?: string): number {
  let gone = 0;

  for (const map of [deleted, edited, removed, recent] as Map<string, Bucket<unknown>>[]) {
    for (const [key, bucket] of [...map]) {
      if (bucket.guildId !== guildId) continue;
      if (channelId && key !== channelId) continue;
      if (map !== recent) gone += bucket.list.length;
      map.delete(key);
    }
  }

  for (const [key, held] of [...history]) {
    if (held.guildId !== guildId) continue;
    if (channelId && held.channelId !== channelId) continue;
    gone += held.list.length;
    history.delete(key);
  }

  return gone;
}
