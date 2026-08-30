export interface SnipeStore {
  clear: (guildId: string, channelId?: string) => number;
  forget: (channelId: string, messageId: string) => void;
}

export type SnipeGate = (guildId: string, channelId: string) => Promise<boolean>;

let store: SnipeStore | null = null;

let gate: SnipeGate | null = null;

export function provideSnipes(provided: SnipeStore): void {
  store = provided;
}

export function provideSnipeGate(provided: SnipeGate): void {
  gate = provided;
}

export function forgetSnipe(channelId: string, messageId: string): void {
  store?.forget(channelId, messageId);
}

export function clearSnipes(guildId: string, channelId?: string): number {
  return store?.clear(guildId, channelId) ?? 0;
}

export async function snipeable(guildId: string, channelId: string): Promise<boolean> {
  if (!gate) return true;
  try {
    return await gate(guildId, channelId);
  } catch {
    return true;
  }
}
