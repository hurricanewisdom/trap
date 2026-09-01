export interface PrefixContext {
  argument: string;
  authorId: string;
  channelId: string;
  guildId?: string;
  messageId: string;
  reply: (payload: ReplyPayload) => Promise<SentMessage>;
  react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  dm: (payload: ReplyPayload) => Promise<boolean>;
}

export interface SentMessage {
  id?: string | bigint;
  channelId?: string | bigint;
}

export interface ReplyPayload {
  content?: string;
  components?: unknown[];
  flags?: number;
  embeds?: unknown[];
  files?: { name: string; blob: Blob }[];
  // Absent means "ping nobody", which is the right default for a bot that
  // echoes user input. A command that genuinely wants somebody notified says so
  // here, and the send path respects it rather than overwriting it.
  allowed_mentions?: unknown;
}

export type PrefixHandler = (ctx: PrefixContext) => Promise<void>;

export interface PrefixCommand {
  name: string;
  aliases?: string[];
  description: string;
  handler: PrefixHandler;
  cog?: string;
  groupedUnder?: string;
  category?: string;
}

let attributing: string | null = null;

let grouping: string | null = null;

let categorising: string | null = null;

export function groupUnder(owner: string, register: () => void): void {
  const previous = grouping;
  grouping = owner;
  try {
    register();
  } finally {
    grouping = previous;
  }
}

export function inCategory(slug: string, register: () => void): void {
  const previous = categorising;
  categorising = slug;
  try {
    register();
  } finally {
    categorising = previous;
  }
}

export function beginCogAttribution(name: string): void {
  attributing = name;
}

export function endCogAttribution(): void {
  attributing = null;
}

const registry = new Map<string, PrefixCommand>();

const groups = new Map<string, Map<string, PrefixCommand>>();

function namespaceFor(group: string | null | undefined): Map<string, PrefixCommand> {
  if (!group) return registry;
  const existing = groups.get(group);
  if (existing) return existing;
  const created = new Map<string, PrefixCommand>();
  groups.set(group, created);
  return created;
}

export function register(command: PrefixCommand): void {
  if (attributing && !command.cog) command.cog = attributing;
  if (grouping && !command.groupedUnder) command.groupedUnder = grouping;
  if (categorising && !command.category) command.category = categorising;

  const scope = namespaceFor(command.groupedUnder);
  const where = command.groupedUnder ? `,${command.groupedUnder} ` : "";

  const claim = (key: string, kind: string): void => {
    const taken = scope.get(key);
    if (taken && taken.name !== command.name) {
      console.warn(
        `prefix: ${kind} "${where}${key}" is already taken by ${taken.name}` +
          `${taken.cog ? ` (${taken.cog})` : ""}, ignoring it for ${command.name}` +
          `${command.cog ? ` (${command.cog})` : ""}`,
      );
      return;
    }
    scope.set(key, command);
  };

  claim(command.name.toLowerCase(), "command");
  for (const alias of command.aliases ?? []) claim(alias.toLowerCase(), "alias");
}

export function lookupIn(group: string, name: string): PrefixCommand | undefined {
  return groups.get(group)?.get(name.toLowerCase());
}

export function lookupPath(path: string): PrefixCommand | undefined {
  const parts = path.split(/\s+/).filter(Boolean);
  const leaf = parts.pop();
  if (!leaf) return undefined;

  const owner = parts.join(" ");
  return owner ? lookupIn(owner, leaf) : registry.get(leaf.toLowerCase());
}

export function lookup(name: string): PrefixCommand | undefined {
  const key = name.toLowerCase();
  const top = registry.get(key);
  if (top) return top;
  for (const scope of groups.values()) {
    const hit = scope.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export function allCommands(): PrefixCommand[] {
  const seen = new Set(registry.values());
  for (const scope of groups.values()) for (const command of scope.values()) seen.add(command);
  return [...seen];
}

export function split(body: string): { name: string; argument: string } {
  const trimmed = body.trim();
  const match = trimmed.match(/^(\S+)\s*([\s\S]*)$/);
  return { name: match?.[1] ?? "", argument: (match?.[2] ?? "").trim() };
}
