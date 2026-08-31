export const ALWAYS_ANSWERS = new Set(["ignore"]);

export type Ignores = (guildId: string, channelId: string, userId: string) => Promise<boolean>;

let gate: Ignores | null = null;

export function provideIgnores(provided: Ignores): void {
  gate = provided;
}

export async function isIgnored(
  guildId: string | undefined,
  channelId: string,
  userId: string,
): Promise<boolean> {
  if (!gate || !guildId) return false;
  try {
    return await gate(guildId, channelId, userId);
  } catch {
    return false;
  }
}
