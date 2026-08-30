/**
 * Registering the Last.fm cog as slash commands.
 *
 * Every command is a real subcommand, reached as `/<parent> <group> <name>`:
 *
 *     /lastfm charts toptracks user:@dylan period:30d
 *
 * There are two parents rather than one because Discord caps a single command
 * at **8000 characters** across its entire tree — every name, description and
 * choice — and these 115 subcommands come to 13,248. One parent only fits if
 * descriptions are cut to about 22 characters, which is shorter than most of
 * them and is the text Discord shows in its own picker. Two parents give two
 * budgets, so nothing has to be truncated.
 *
 * Being real subcommands is also what makes `</lastfm charts toptracks:id>`
 * render as a clickable mention. A single command with the name in an option
 * cannot do that: Discord resolves a mention's path against the real command
 * structure and prints anything else as plain text.
 */

import { allCommands, lookup, type PrefixCommand } from "../../core/prefix.js";
import {
  MAX_SUBCOMMANDS,
  buildGroupedCommand,
  buildTopLevelCommand,
  provideAutocomplete,
  provideSlash,
  registerCommandPath,
  type SlashGroup,
  type SlashLeaf,
  type SlashOption,
} from "../../core/slash.js";
import { CUSTOM_OPTION, GROUPS, TOP_LEVEL, type Parent } from "./slash.js";
import { findCustomCommand, listCustomCommands } from "./commands/customcommand.js";

/** Discord's per-command ceiling, counted over the whole option tree. */
const MAX_COMMAND_CHARS = 8000;

const PARENT_DESCRIPTIONS: Record<Parent, string> = {
  lastfm: "Your Last.fm account, charts and listening stats",
  lfmusic: "Music, tags, discovery and who else listens",
};

/** Where a command sits, for building its mention and its usage line. */
export interface Placement {
  parent: Parent;
  /** Null when the command sits directly under the parent. */
  group: string | null;
  name: string;
  options: SlashOption[];
}

const placements = new Map<string, Placement>();

/** parent -> group -> subcommand -> registry name */
const routes = new Map<string, Map<string, Map<string, string>>>();

export function placementOf(command: string): Placement | undefined {
  return placements.get(command);
}

/** The full invocation path, e.g. "lastfm charts toptracks". */
export function pathOf(command: string): string | null {
  const at = placements.get(command);
  if (!at) return null;
  return at.group === null ? `${at.parent} ${at.name}` : `${at.parent} ${at.group} ${at.name}`;
}

/**
 * Discord's own size rule: the sum of every name, description, choice name and
 * choice value in the tree. Worth checking before registering, because the API
 * rejects an over-large command wholesale with a message that does not say
 * which one.
 */
export function commandSize(payload: Record<string, unknown>): number {
  const node = payload as {
    name?: string;
    description?: string;
    choices?: { name?: string; value?: unknown }[];
    options?: Record<string, unknown>[];
  };
  let total = (node.name ?? "").length + (node.description ?? "").length;
  for (const choice of node.choices ?? []) {
    total += String(choice.name ?? "").length + String(choice.value ?? "").length;
  }
  for (const option of node.options ?? []) total += commandSize(option);
  return total;
}

/** Builds both parents, checking the layout against the live registry. */
function build(): Record<string, unknown>[] {
  placements.clear();
  routes.clear();

  const problems: string[] = [];
  const claimed = new Set<string>();
  const byParent = new Map<Parent, SlashGroup[]>();
  // A group's headline command is promoted to sit directly under the parent,
  // so it reads as `/lfmusic crowns` rather than `/lfmusic crowns crowns`.
  const directByParent = new Map<Parent, SlashLeaf[]>();

  for (const spec of GROUPS) {
    const leaves = [];
    const subs = new Map<string, string>();

    for (const [command, options] of Object.entries(spec.commands)) {
      const registered = lookup(command);
      if (!registered || registered.name !== command) {
        problems.push(`${spec.name}/${command}: not a registered command`);
        continue;
      }
      if (claimed.has(command)) {
        problems.push(`${command}: listed in more than one group`);
        continue;
      }
      claimed.add(command);

      const leaf = { command, name: command, description: registered.description, options };
      const promoted = spec.promote === command;

      if (promoted) {
        const direct = directByParent.get(spec.parent) ?? [];
        direct.push(leaf);
        directByParent.set(spec.parent, direct);
      } else {
        leaves.push(leaf);
        subs.set(command, command);
      }

      placements.set(command, {
        parent: spec.parent,
        group: promoted ? null : spec.name,
        name: command,
        options,
      });
      registerCommandPath(
        command,
        promoted ? `${spec.parent} ${command}` : `${spec.parent} ${spec.name} ${command}`,
      );
    }

    const groups = byParent.get(spec.parent) ?? [];
    // Promoting the only command in a group would leave it empty, which
    // Discord rejects; such a group simply does not appear.
    if (leaves.length > 0) {
      groups.push({ name: spec.name, description: spec.description, leaves });
      byParent.set(spec.parent, groups);
    }

    const parentRoutes = routes.get(spec.parent) ?? new Map();
    parentRoutes.set(spec.name, subs);
    routes.set(spec.parent, parentRoutes);
  }

  const bare = lookup(TOP_LEVEL.command);
  if (bare) registerCommandPath(bare.name, TOP_LEVEL.name);
  if (!bare) problems.push(`${TOP_LEVEL.command}: not registered, cannot build /${TOP_LEVEL.name}`);
  else claimed.add(bare.name);

  // A command missing from the layout would be unreachable: there is no prefix
  // any more, so this is the only route to it.
  const missing = allCommands()
    .filter((command) => command.cog === "lastfm" && !claimed.has(command.name))
    .map((command) => command.name);
  if (missing.length > 0) problems.push(`not in any group: ${missing.join(", ")}`);

  if (problems.length > 0) {
    throw new Error(`slash layout does not match the registry:\n  - ${problems.join("\n  - ")}`);
  }

  const payloads: Record<string, unknown>[] = [];
  for (const [parent, groups] of byParent) {
    const direct = directByParent.get(parent) ?? [];
    const payload = buildGroupedCommand(parent, PARENT_DESCRIPTIONS[parent], groups, direct);
    const size = commandSize(payload);
    if (size > MAX_COMMAND_CHARS) {
      throw new Error(
        `/${parent} is ${size} characters, Discord allows ${MAX_COMMAND_CHARS}. ` +
          `Move a group to the other parent, or shorten some descriptions.`,
      );
    }
    const subcommands = groups.reduce((n, group) => n + group.leaves.length, 0) + direct.length;
    console.log(
      `slash: /${parent} ${groups.length} groups + ${direct.length} direct, ` +
        `${subcommands} commands, ${size}/${MAX_COMMAND_CHARS} chars`,
    );
    payloads.push(payload);
  }

  payloads.push(buildTopLevelCommand(TOP_LEVEL));
  return payloads;
}

export function registerLastfmSlash(): void {
  const payloads = build();

  // The custom word field is a search box over what this server has claimed.
  const fm = payloads.find((payload) => payload.name === TOP_LEVEL.name);
  const fmOptions = (fm?.options ?? []) as Record<string, unknown>[];
  const customField = fmOptions.find((option) => option.name === CUSTOM_OPTION);
  if (customField) customField.autocomplete = true;

  provideAutocomplete(TOP_LEVEL.name, async (option, typed, context) => {
    if (option !== CUSTOM_OPTION || !context.guildId) return [];
    const needle = typed.trim().toLowerCase();
    const words = await listCustomCommands(context.guildId, context.userId);
    return words
      .filter((entry) => !needle || entry.word.includes(needle))
      .map((entry) => ({
        name: entry.isPublic ? entry.word : `${entry.word} (private)`,
        value: entry.word,
      }));
  });

  provideSlash({
    build: () => payloads,
    resolve: (command, group, sub) => {
      if (command === TOP_LEVEL.name) {
        const handler = lookup(TOP_LEVEL.command);
        return handler ? { handler, options: TOP_LEVEL.options } : undefined;
      }
      if (!sub) return undefined;

      // A promoted command arrives with no group: its subcommand name is the
      // registry name, and only if it really was promoted.
      const name =
        group === null
          ? (placements.get(sub)?.group === null ? sub : undefined)
          : routes.get(command)?.get(group)?.get(sub);
      if (!name) return undefined;

      const handler: PrefixCommand | undefined = lookup(name);
      if (!handler) return undefined;
      return { handler, options: placements.get(name)?.options ?? [] };
    },

    /**
     * Turns `/fm custom:<word>` into the owner of that word.
     *
     * A custom command always shows its owner's listening, whoever ran it, so
     * the word resolves to a mention. A private word only answers to the
     * member who claimed it; for anyone else it is treated as not existing,
     * which is also why it never appears in their autocomplete.
     */
    argument: async (command, _group, _sub, received, context) => {
      if (command !== TOP_LEVEL.name || !context.guildId) return null;

      const word = String(
        received?.find((option) => option.name === CUSTOM_OPTION)?.value ?? "",
      ).trim();
      if (!word) return null;

      const custom = await findCustomCommand(context.guildId, word);
      if (!custom || (!custom.isPublic && custom.discordId !== context.userId)) return null;

      return `<@${custom.discordId}>`;
    },
  });
}

export { MAX_SUBCOMMANDS };
