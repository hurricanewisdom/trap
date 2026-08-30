import { AsyncLocalStorage } from "node:async_hooks";

export type AccentProvider = (discordId: string) => Promise<number | null>;

const storage = new AsyncLocalStorage<number | null>();

let provider: AccentProvider | null = null;

export function provideAccent(next: AccentProvider): void {
  provider = next;
}

export async function accentFor(discordId: string): Promise<number | null> {
  if (!provider) return null;
  try {
    return await provider(discordId);
  } catch {
    return null;
  }
}

export function withAccent<T>(accent: number | null, run: () => T): T {
  return storage.run(accent, run);
}

export function currentAccent(): number | null {
  return storage.getStore() ?? null;
}

export function resolveAccent(explicit: number | null): number | null {
  return explicit ?? currentAccent();
}
