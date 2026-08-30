/**
 * Slash commands, built from the same registry the handlers already use.
 *
 * Every handler takes a `PrefixContext` with one free-text `argument`. Rather
 * than rewrite 115 of them, the typed options a user fills in are assembled
 * back into that string — a mention first, then the operand, then the period —
 * which is exactly the shape the existing parsers were written against.
 *
 * Discord's shape constrains the layout more than taste does:
 *
 *   - a command may hold at most 25 options, and a subcommand group at most
 *     25 subcommands
 *   - nesting stops at command > group > subcommand
 *
 * 115 subcommands therefore cannot sit directly under `/lastfm`; they are
 * spread across groups, giving `/lastfm <group> <name>`. The one command
 * people run constantly, now playing, is lifted out to a bare `/fm`.
 */

import type { PrefixCommand } from "./prefix.js";

/** Discord's ApplicationCommandOptionType values, for the kinds used here. */
const OPTION_TYPE = {
  subCommand: 1,
  subCommandGroup: 2,
  string: 3,
  integer: 4,
  user: 6,
} as const;

/** What a command will accept as a typed field. */
export type SlashOptionKind = "user" | "period" | "text" | "number";

export interface SlashOption {
  kind: SlashOptionKind;
  name: string;
  description: string;
}

/** The periods `extractPeriod` understands, as a dropdown. */
const PERIOD_CHOICES = [
  { name: "Overall", value: "overall" },
  { name: "7 days", value: "weekly" },
  { name: "30 days", value: "monthly" },
  { name: "90 days", value: "quarterly" },
  { name: "180 days", value: "halfyearly" },
  { name: "1 year", value: "yearly" },
];

/** Discord rejects a name that is not lowercase and 1-32 of [-_a-z0-9]. */
export function isValidName(name: string): boolean {
  return /^[-_a-z0-9]{1,32}$/.test(name);
}

/** A description is required and capped at 100 characters. */
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
      };
  }
}

/** One subcommand of a group. */
export interface SlashLeaf {
  /** The registry name this maps to. */
  command: string;
  /** What it is called under the group; usually the same as `command`. */
  name: string;
  description: string;
  options: SlashOption[];
}

export interface SlashGroup {
  name: string;
  description: string;
  leaves: SlashLeaf[];
}

/** A command that sits at the top level rather than under a group. */
export interface SlashTopLevel {
  name: string;
  command: string;
  description: string;
  options: SlashOption[];
}

export const MAX_SUBCOMMANDS = 25;
export const MAX_GROUPS = 25;

/**
 * Builds the payload for one parent command holding subcommand groups.
 *
 * Throws rather than truncating when a limit is exceeded: Discord rejects an
 * over-full payload wholesale, and a command silently missing from the tree is
 * far harder to notice than a failed boot.
 */
export function buildGroupedCommand(
  name: string,
  description: string,
  groups: SlashGroup[],
  /**
   * Subcommands that sit directly under the parent rather than in a group.
   *
   * Discord allows both shapes in one command's option list, which is what
   * spares a command from repeating its group's name: `/lfmusic crowns`
   * rather than `/lfmusic crowns crowns`.
   */
  direct: SlashLeaf[] = [],
): Record<string, unknown> {
  // Groups and bare subcommands share the parent's single option list.
  if (groups.length + direct.length > MAX_GROUPS) {
    throw new Error(
      `/${name}: ${groups.length} groups plus ${direct.length} subcommands, ` +
        `Discord allows ${MAX_GROUPS} options in total`,
    );
  }
  for (const leaf of direct) {
    if (!isValidName(leaf.name)) throw new Error(`/${name}: invalid subcommand name "${leaf.name}"`);
  }
  for (const group of groups) {
    if (group.leaves.length > MAX_SUBCOMMANDS) {
      throw new Error(
        `/${name} ${group.name}: ${group.leaves.length} subcommands, Discord allows ${MAX_SUBCOMMANDS}`,
      );
    }
    if (!isValidName(group.name)) throw new Error(`/${name}: invalid group name "${group.name}"`);
    for (const leaf of group.leaves) {
      if (!isValidName(leaf.name)) {
        throw new Error(`/${name} ${group.name}: invalid subcommand name "${leaf.name}"`);
      }
    }
  }

  return {
    name,
    description: describe(description),
    options: [
      // Bare subcommands first, so the headline command of an area is the
      // first thing offered under the parent.
      ...direct.map((leaf) => ({
        type: OPTION_TYPE.subCommand,
        name: leaf.name,
        description: describe(leaf.description),
        options: leaf.options.map(optionPayload),
      })),
      ...groups.map((group) => ({
      type: OPTION_TYPE.subCommandGroup,
      name: group.name,
      description: describe(group.description),
      options: group.leaves.map((leaf) => ({
        type: OPTION_TYPE.subCommand,
        name: leaf.name,
        description: describe(leaf.description),
        options: leaf.options.map(optionPayload),
      })),
      })),
    ],
  };
}

export function buildTopLevelCommand(entry: SlashTopLevel): Record<string, unknown> {
  if (!isValidName(entry.name)) throw new Error(`invalid command name "${entry.name}"`);
  return {
    name: entry.name,
    description: describe(entry.description),
    options: entry.options.map(optionPayload),
  };
}

/* ------------------------------------------------------------------ */
/* Turning an invocation back into an argument string                  */
/* ------------------------------------------------------------------ */

/** One option as Discord sends it back. */
export interface ReceivedOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: ReceivedOption[];
}

/**
 * Rebuilds the text a prefix command would have received.
 *
 * Order matters and is not cosmetic: `resolveTarget` only accepts a mention as
 * the *first* word, so the user field leads. The operand follows, and the
 * period goes last because `extractPeriod` pulls it from anywhere.
 */
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

/** Walks the option tree to find which subcommand was invoked. */
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

/** Convenience for callers assembling a leaf from a registered command. */
export function leafFor(
  command: PrefixCommand,
  options: SlashOption[],
  name = command.name,
): SlashLeaf {
  return { command: command.name, name, description: command.description, options };
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/**
 * What a cog contributes: one top-level command definition, and a way to work
 * out which of its handlers an invocation of that command refers to.
 *
 * Kept as a callback rather than a table so a cog can lay its own tree out
 * however suits it — grouped, flat, or something else later — without core
 * knowing the shape.
 */
export interface SlashProvider {
  /** The command definitions to register with Discord. */
  build: () => Record<string, unknown>[];
  /**
   * Resolves one invocation, or undefined if this provider does not own it.
   *
   * `received` is the raw option list, needed by a provider that picks its
   * handler from a field rather than from a subcommand name.
   */
  resolve: (
    command: string,
    group: string | null,
    sub: string | null,
    received?: ReceivedOption[],
  ) => { handler: PrefixCommand; options: SlashOption[] } | undefined;
  /**
   * Optional. Builds the argument string itself, for a field whose value has
   * to be looked up rather than simply written out — a custom command word,
   * for instance, which stands for whoever claimed it.
   */
  argument?: (
    command: string,
    group: string | null,
    sub: string | null,
    received: ReceivedOption[] | undefined,
    context: CompleterContext,
  ) => Promise<string | null>;
}

const providers: SlashProvider[] = [];

/** Called from a cog's setup. */
export function provideSlash(provider: SlashProvider): void {
  providers.push(provider);
}

/** Every command definition to register, across all cogs. */
export function buildAllSlashCommands(): Record<string, unknown>[] {
  return providers.flatMap((provider) => provider.build());
}

/** A provider's own argument, if it wants to build one. */
export async function argumentOverride(
  command: string,
  group: string | null,
  sub: string | null,
  received: ReceivedOption[] | undefined,
  context: CompleterContext,
): Promise<string | null> {
  for (const provider of providers) {
    if (!provider.argument) continue;
    const built = await provider.argument(command, group, sub, received, context);
    if (built !== null) return built;
  }
  return null;
}

/** Finds the handler for an invocation, whichever cog owns it. */
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

/**
 * A provider for a cog whose commands sit at the top level, one each.
 *
 * Used by the small cogs; anything with more than a handful of commands needs
 * the grouped shape instead, because Discord allows only 100 top-level
 * commands per application.
 */
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

/* ------------------------------------------------------------------ */
/* Autocomplete                                                        */
/* ------------------------------------------------------------------ */

/** One suggestion. `name` is shown (100 char cap); `value` is what is sent. */
export interface Suggestion {
  name: string;
  value: string;
}

/** Discord shows at most 25 suggestions. */
export const MAX_SUGGESTIONS = 25;

/** Where an autocomplete request came from, so suggestions can be scoped. */
export interface CompleterContext {
  guildId?: string;
  userId: string;
}

type Completer = (
  option: string,
  typed: string,
  context: CompleterContext,
) => Suggestion[] | Promise<Suggestion[]>;

const completers = new Map<string, Completer>();

/** Registers the suggestion source for one command's autocompleting fields. */
export function provideAutocomplete(command: string, completer: Completer): void {
  completers.set(command, completer);
}

export async function suggestionsFor(
  command: string,
  option: string,
  typed: string,
  context: CompleterContext,
): Promise<Suggestion[]> {
  const completer = completers.get(command);
  if (!completer) return [];
  const choices = await completer(option, typed, context);
  return choices.slice(0, MAX_SUGGESTIONS).map((choice) => ({
    name: choice.name.slice(0, 100),
    value: choice.value.slice(0, 100),
  }));
}

/** Finds the option the user is currently typing into. */
export function focusedOption(
  options: ReceivedOption[] | undefined,
): { name: string; value: string } | null {
  for (const option of options ?? []) {
    const focused = (option as ReceivedOption & { focused?: boolean }).focused;
    if (focused) return { name: option.name, value: String(option.value ?? "") };
    const nested = focusedOption(option.options);
    if (nested) return nested;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Command mentions                                                    */
/* ------------------------------------------------------------------ */

/**
 * Registered command ids, learned from Discord's reply to the upsert.
 *
 * They are needed for a command mention — `</lastfm:123>` — which Discord
 * renders as the same blue, clickable chip as a channel mention. Clicking it
 * puts the command in the message box; it cannot pre-fill an option, so a
 * mention is for pointing at a command, not for running one.
 */
const commandIds = new Map<string, string>();

export function rememberCommandIds(registered: { name?: string; id?: string | bigint }[]): void {
  commandIds.clear();
  for (const command of registered) {
    if (command.name && command.id) commandIds.set(command.name, String(command.id));
  }
}

/**
 * A clickable mention for a command, or plain code text when the id is not
 * known yet — a mention with a wrong id renders as raw text, which looks
 * broken, so the fallback is deliberate.
 */
export function commandMention(name: string, path = name): string {
  const id = commandIds.get(name);
  return id ? `</${path}:${id}>` : `\`/${path}\``;
}

export function knowsCommandIds(): boolean {
  return commandIds.size > 0;
}

/* ------------------------------------------------------------------ */
/* Invocation paths                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where each command sits in the slash tree, e.g. "lastfm charts toptracks".
 *
 * Published here rather than read from the cog that owns the layout, so the
 * help menu can render a command's path and mention without importing a
 * sibling cog.
 */
const paths = new Map<string, string>();

export function registerCommandPath(command: string, path: string): void {
  paths.set(command, path);
}

export function pathFor(command: string): string | null {
  return paths.get(command) ?? null;
}
