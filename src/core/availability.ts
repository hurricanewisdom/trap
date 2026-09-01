export interface EventKind {
  name: string;
  describes: string;
  channel: boolean;
}

export const EVENTS: EventKind[] = [
  { name: "autoresponder", describes: "automatic replies to a trigger", channel: true },
  { name: "filter", describes: "the chat filters the bot enforces itself", channel: true },
  { name: "gallery", describes: "deleting a post with no image", channel: true },
  { name: "snipe", describes: "recording what was deleted or edited", channel: true },
  { name: "sticky", describes: "reposting a stuck message", channel: true },
  { name: "reactions", describes: "the vote reactions on a now playing post", channel: true },
  { name: "editrerun", describes: "running a command again when its message is edited", channel: true },
  { name: "welcome", describes: "the message posted when somebody joins", channel: false },
  { name: "goodbye", describes: "the message posted when somebody leaves", channel: false },
  { name: "boost", describes: "the message and role given when somebody boosts", channel: false },
];

export const PROTECTED = new Set([
  "enablecommand",
  "disablecommand",
  "enableevent",
  "disableevent",
  "enablemodule",
  "disablemodule",
  "copydisabled",
  "help",
]);

export interface Availability {
  command: (guildId: string, channelId: string, userId: string, name: string, cog: string) => Promise<boolean>;
  event: (guildId: string, channelId: string, name: string) => Promise<boolean>;
}

let gate: Availability | null = null;

export function provideAvailability(provided: Availability): void {
  gate = provided;
}

export function eventNames(): string[] {
  return EVENTS.map((event) => event.name);
}

export async function commandBlocked(
  guildId: string | undefined,
  channelId: string,
  userId: string,
  name: string,
  cog: string,
): Promise<boolean> {
  if (!gate || !guildId || PROTECTED.has(name)) return false;
  try {
    return await gate.command(guildId, channelId, userId, name, cog);
  } catch {
    return false;
  }
}

export async function eventBlocked(
  guildId: string | undefined,
  channelId: string,
  name: string,
): Promise<boolean> {
  if (!gate || !guildId) return false;
  try {
    return await gate.event(guildId, channelId, name);
  } catch {
    return false;
  }
}
