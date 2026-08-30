/**
 * Prefix command router.
 *
 * Commands are registered with a name and any aliases, and dispatch is a plain
 * map lookup so adding groups costs nothing at runtime. Subcommands are left
 * to each handler, which keeps groups such as `,lf link` self-contained.
 */

export interface PrefixContext {
  /** Raw text after the command name, e.g. "link" for ",lf link". */
  argument: string;
  authorId: string;
  channelId: string;
  guildId?: string;
  messageId: string;
  /** Replies in the invoking channel; resolves to the created message. */
  reply: (payload: ReplyPayload) => Promise<SentMessage>;
  /** Adds a reaction, ignoring missing permissions. */
  react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  /** Sends a direct message; resolves false when the user has DMs closed. */
  dm: (payload: ReplyPayload) => Promise<boolean>;
}

/** Just enough of the created message to react to it. */
export interface SentMessage {
  id?: string | bigint;
  channelId?: string | bigint;
}

export interface ReplyPayload {
  content?: string;
  // Components V2 payloads are raw Discord objects; see ../components.ts.
  components?: unknown[];
  flags?: number;
  embeds?: unknown[];
  files?: { name: string; blob: Blob }[];
}

export type PrefixHandler = (ctx: PrefixContext) => Promise<void>;

export interface PrefixCommand {
  name: string;
  aliases?: string[];
  description: string;
  handler: PrefixHandler;
  /** The cog that registered this command; filled in automatically. */
  cog?: string;
}

/**
 * Set while a cog's setup() runs, so registrations are attributed without
 * every command having to name its own cog. loadCogs() runs setups
 * sequentially, which is what makes this safe.
 */
let attributing: string | null = null;

export function beginCogAttribution(name: string): void {
  attributing = name;
}

export function endCogAttribution(): void {
  attributing = null;
}

const registry = new Map<string, PrefixCommand>();

/**
 * Adds a command and its aliases to the registry.
 *
 * A name claimed twice used to overwrite in silence, so whichever cog happened
 * to load last won and the other command became unreachable with nothing to
 * show for it. Collisions are now reported at startup; the first claim keeps
 * the name, since the later one is the accident.
 */
export function register(command: PrefixCommand): void {
  if (attributing && !command.cog) command.cog = attributing;

  const claim = (key: string, kind: string): void => {
    const taken = registry.get(key);
    if (taken && taken.name !== command.name) {
      console.warn(
        `prefix: ${kind} "${key}" is already taken by ${taken.name}` +
          `${taken.cog ? ` (${taken.cog})` : ""}, ignoring it for ${command.name}` +
          `${command.cog ? ` (${command.cog})` : ""}`,
      );
      return;
    }
    registry.set(key, command);
  };

  claim(command.name.toLowerCase(), "command");
  for (const alias of command.aliases ?? []) claim(alias.toLowerCase(), "alias");
}

export function lookup(name: string): PrefixCommand | undefined {
  return registry.get(name.toLowerCase());
}

export function allCommands(): PrefixCommand[] {
  return [...new Set(registry.values())];
}

/** Splits "lf link foo" into the command name and the remaining argument. */
export function split(body: string): { name: string; argument: string } {
  const trimmed = body.trim();
  const match = trimmed.match(/^(\S+)\s*([\s\S]*)$/);
  return { name: match?.[1] ?? "", argument: (match?.[2] ?? "").trim() };
}
