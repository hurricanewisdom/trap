// A command that has been restricted to a role can only be run by somebody
// holding it. The check lives in core so the dispatch path can ask, but the data
// belongs to the moderation cog, which provides it.
export type Restrictions = (
  guildId: string,
  userId: string,
  command: string,
) => Promise<boolean>;

let gate: Restrictions | null = null;

export function provideRestrictions(provided: Restrictions): void {
  gate = provided;
}

// Fails open: a database that cannot be reached should not lock a server out of
// its own bot.
export async function commandRestricted(
  guildId: string | undefined,
  userId: string,
  command: string,
): Promise<boolean> {
  if (!gate || !guildId) return false;
  try {
    return await gate(guildId, userId, command);
  } catch {
    return false;
  }
}
