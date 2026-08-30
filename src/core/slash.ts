import type { PrefixCommand } from "./prefix.js";

const OPTION_TYPE = {
  subCommand: 1,
  subCommandGroup: 2,
  string: 3,
  integer: 4,
  user: 6,
} as const;

export type SlashOptionKind = "user" | "period" | "text" | "number";

export interface SlashOption {
  kind: SlashOptionKind;
  name: string;
  description: string;
  autocomplete?: boolean;
}

export interface Choice {
  name: string;
  value: string;
}

export type Completer = (query: string, option: string) => Choice[];

const completers = new Map<string, Completer>();

export function provideAutocomplete(command: string, complete: Completer): void {
  completers.set(command, complete);
}

export function completeSlash(command: string, query: string, option: string): Choice[] {
  return completers.get(command)?.(query, option).slice(0, 25) ?? [];
}

const PERIOD_CHOICES = [
  { name: "Overall", value: "overall" },
  { name: "7 days", value: "weekly" },
  { name: "30 days", value: "monthly" },
  { name: "90 days", value: "quarterly" },
  { name: "180 days", value: "halfyearly" },
  { name: "1 year", value: "yearly" },
];

export function isValidName(name: string): boolean {
  return /^[-_a-z0-9]{1,32}$/.test(name);
}

function describe(text: string): string {
  const trimmed = text.trim() || "No description";
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed;
}

function optionPayload(option: SlashOption): Record<string, unknown> {
  switch (option.kind) {
    case "user":
      return {
        type: OPTION_TYPE.user,
        name: option.name,
        description: describe(option.description),
        required: false,
      };
    case "period":
      return {
        type: OPTION_TYPE.string,
        name: option.name,
        description: describe(option.description),
        required: false,
        choices: PERIOD_CHOICES,
      };
    case "number":
      return {
        type: OPTION_TYPE.integer,
        name: option.name,
        description: describe(option.description),
        required: false,
        min_value: 1,
      };
    default:
      return {
        type: OPTION_TYPE.string,
        name: option.name,
        description: describe(option.description),
        required: false,
        ...(option.autocomplete ? { autocomplete: true } : {}),
      };
  }
}

export interface SlashTopLevel {
  name: string;
  command: string;
  description: string;
  options: SlashOption[];
}

export function buildTopLevelCommand(entry: SlashTopLevel): Record<string, unknown> {
  if (!isValidName(entry.name)) throw new Error(`invalid command name "${entry.name}"`);
  return {
    name: entry.name,
    description: describe(entry.description),
    options: entry.options.map(optionPayload),
  };
}

export interface ReceivedOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: ReceivedOption[];
}

export function argumentFrom(options: ReceivedOption[] | undefined, spec: SlashOption[]): string {
  const byName = new Map((options ?? []).map((option) => [option.name, option]));
  const parts: string[] = [];

  const take = (kind: SlashOptionKind): string[] =>
    spec
      .filter((option) => option.kind === kind)
      .map((option) => {
        const received = byName.get(option.name);
        if (received?.value === undefined || received.value === "") return "";
        return kind === "user" ? `<@${String(received.value)}>` : String(received.value);
      })
      .filter(Boolean);

  parts.push(...take("user"));
  parts.push(...take("text"));
  parts.push(...take("number"));
  parts.push(...take("period"));

  return parts.join(" ").trim();
}

export function resolveInvocation(options: ReceivedOption[] | undefined): {
  group: string | null;
  sub: string | null;
  options: ReceivedOption[] | undefined;
} {
  const first = options?.[0];
  if (!first) return { group: null, sub: null, options: undefined };

  if (first.type === OPTION_TYPE.subCommandGroup) {
    const sub = first.options?.[0];
    return { group: first.name, sub: sub?.name ?? null, options: sub?.options };
  }
  if (first.type === OPTION_TYPE.subCommand) {
    return { group: null, sub: first.name, options: first.options };
  }
  return { group: null, sub: null, options };
}

export interface SlashProvider {
  build: () => Record<string, unknown>[];

  resolve: (
    command: string,
    group: string | null,
    sub: string | null,
    received?: ReceivedOption[],
  ) => { handler: PrefixCommand; options: SlashOption[] } | undefined;
}

const providers: SlashProvider[] = [];

export function provideSlash(provider: SlashProvider): void {
  providers.push(provider);
}

export function buildAllSlashCommands(): Record<string, unknown>[] {
  return providers.flatMap((provider) => provider.build());
}

export function resolveSlash(
  command: string,
  group: string | null,
  sub: string | null,
  received?: ReceivedOption[],
): { handler: PrefixCommand; options: SlashOption[] } | undefined {
  for (const provider of providers) {
    const found = provider.resolve(command, group, sub, received);
    if (found) return found;
  }
  return undefined;
}

export function flatProvider(
  entries: { name: string; command: PrefixCommand; options?: SlashOption[] }[],
): SlashProvider {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    build: () =>
      entries.map((entry) =>
        buildTopLevelCommand({
          name: entry.name,
          command: entry.command.name,
          description: entry.command.description,
          options: entry.options ?? [],
        }),
      ),
    resolve: (command) => {
      const entry = byName.get(command);
      return entry ? { handler: entry.command, options: entry.options ?? [] } : undefined;
    },
  };
}

const commandIds = new Map<string, string>();

export function rememberCommandIds(registered: { name?: string; id?: string | bigint }[]): void {
  commandIds.clear();
  for (const command of registered) {
    if (command.name && command.id) commandIds.set(command.name, String(command.id));
  }
}

export function commandMention(name: string, path = name): string {
  const id = commandIds.get(name);
  return id ? `</${path}:${id}>` : `\`/${path}\``;
}

export function knowsCommandIds(): boolean {
  return commandIds.size > 0;
}
