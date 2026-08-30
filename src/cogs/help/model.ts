import { loadedCogs } from "../../core/cog.js";
import { allCommands, lookup, lookupPath, type PrefixCommand } from "../../core/prefix.js";
import { CATEGORIES, DOCS, type CategoryDoc, type CommandDoc } from "./catalog.js";

const HIDDEN_COGS = new Set(["help"]);

export interface Entry {
  command: PrefixCommand;
  doc?: CommandDoc;
  section: string;
  cog: string;
  haystack: string;
}

export interface CogSummary {
  name: string;
  label: string;
  description: string;
  count: number;
}

interface Index {
  size: number;
  all: Entry[];
  byName: Map<string, Entry>;
  byCog: Map<string, Entry[]>;
  bySection: Map<string, Entry[]>;
  byGroup: Map<string, Entry[]>;
  byPath: Map<string, Entry>;
  cogs: CogSummary[];
}

let index: Index | null = null;

function documented(commands: PrefixCommand[]): Map<PrefixCommand, CommandDoc> {
  const claims = new Map<string, PrefixCommand[]>();
  for (const command of commands) {
    const rivals = claims.get(command.name);
    if (rivals) rivals.push(command);
    else claims.set(command.name, [command]);
  }

  const owners = new Map<PrefixCommand, CommandDoc>();
  for (const doc of DOCS) {
    const rivals = claims.get(doc.name) ?? [];
    const owner =
      rivals.length === 1
        ? rivals[0]
        : (rivals.find((command) => command.category === doc.category) ??
          rivals.find((command) => !command.groupedUnder));
    if (owner) owners.set(owner, doc);
  }
  return owners;
}

function build(): Index {
  const commands = allCommands();
  const docs = documented(commands);

  const all = commands
    .map((command) => {
      const doc = docs.get(command);
      const summary = doc?.summary ?? command.description;
      return {
        command,
        doc,
        section: doc?.category ?? command.category ?? "general",
        cog: command.cog ?? "general",
        haystack: [command.name, ...(command.aliases ?? []), summary].join(" ").toLowerCase(),
      };
    })
    .sort((a, b) => a.command.name.localeCompare(b.command.name));

  const byName = new Map<string, Entry>();
  const byCog = new Map<string, Entry[]>();
  const bySection = new Map<string, Entry[]>();
  const byGroup = new Map<string, Entry[]>();
  const byPath = new Map<string, Entry>();

  for (const entry of all) {
    byPath.set(pathOf(entry), entry);
    const owner = entry.command.groupedUnder;
    if (owner) {
      const siblings = byGroup.get(owner);
      if (siblings) siblings.push(entry);
      else byGroup.set(owner, [entry]);
    }

    byName.set(entry.command.name, entry);
    const cog = byCog.get(entry.cog);
    if (cog) cog.push(entry);
    else byCog.set(entry.cog, [entry]);

    const section = bySection.get(entry.section);
    if (section) section.push(entry);
    else bySection.set(entry.section, [entry]);
  }

  const cogs = loadedCogs()
    .filter((cog) => !HIDDEN_COGS.has(cog.name))
    .map((cog) => ({
      name: cog.name,
      label: cog.label ?? cog.name,
      description: cog.description,
      count: byCog.get(cog.name)?.length ?? 0,
    }))
    .filter((summary) => summary.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { size: commands.length, all, byName, byCog, bySection, byGroup, byPath, cogs };
}

function current(): Index {
  const size = allCommands().length;
  if (!index || index.size !== size) index = build();
  return index;
}

export function entries(): Entry[] {
  return current().all;
}

export function cogSummaries(): CogSummary[] {
  return current().cogs;
}

export function inCog(name: string): Entry[] {
  return current().byCog.get(name) ?? [];
}

export function inSection(slug: string): Entry[] {
  return current().bySection.get(slug) ?? [];
}

export function pathOf(entry: Entry): string {
  const owner = entry.command.groupedUnder;
  return owner ? `${owner} ${entry.command.name}` : entry.command.name;
}

export function subcommandsOf(owner: string): Entry[] {
  return current().byGroup.get(owner) ?? [];
}

export function hasSubcommands(entry: Entry): boolean {
  return (current().byGroup.get(pathOf(entry))?.length ?? 0) > 0;
}

export function ownerEntry(path: string): Entry | null {
  return current().byPath.get(path) ?? null;
}

export function topLevelIn(cogName: string): Entry[] {
  return inCog(cogName).filter((entry) => !entry.command.groupedUnder);
}

export function cogOf(name: string): CogSummary | null {
  return current().cogs.find((summary) => summary.name === name) ?? null;
}

export function categoryOf(slug: string): CategoryDoc | null {
  return CATEGORIES.find((category) => category.slug === slug) ?? null;
}

export function sectionsOf(cogName: string): { category: CategoryDoc; count: number }[] {
  const list = inCog(cogName);
  const counts = new Map<string, number>();
  for (const entry of list) counts.set(entry.section, (counts.get(entry.section) ?? 0) + 1);

  return CATEGORIES.filter((category) => counts.has(category.slug)).map((category) => ({
    category,
    count: counts.get(category.slug) ?? 0,
  }));
}

export function lettersOf(cogName: string): { letter: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of inCog(cogName)) {
    const letter = (entry.command.name[0] ?? "#").toUpperCase();
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([letter, count]) => ({ letter, count }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}

export function startingWith(cogName: string, letter: string): Entry[] {
  const wanted = letter.toUpperCase();
  return inCog(cogName).filter(
    (entry) => (entry.command.name[0] ?? "#").toUpperCase() === wanted,
  );
}

export function entryFor(key: string): Entry | null {
  const index = current();
  return index.byPath.get(key) ?? index.byName.get(key) ?? null;
}

export function findCommand(query: string): Entry | null {
  const typed = query.trim().replace(/^,/, "");
  const direct = current().byPath.get(typed.toLowerCase());
  if (direct) return direct;

  const command = lookupPath(typed) ?? lookup(typed);
  if (!command) return null;

  const path = command.groupedUnder ? `${command.groupedUnder} ${command.name}` : command.name;
  return current().byPath.get(path) ?? null;
}

export function findCog(query: string): CogSummary | null {
  const needle = query.trim().toLowerCase();
  return (
    current().cogs.find(
      (summary) => summary.name === needle || summary.label.toLowerCase() === needle,
    ) ?? null
  );
}

export function findSection(query: string): CategoryDoc | null {
  const needle = query.trim().toLowerCase();
  return (
    CATEGORIES.find(
      (category) => category.slug === needle || category.label.toLowerCase() === needle,
    ) ?? null
  );
}

export function summaryOf(entry: Entry): string {
  return entry.doc?.summary ?? entry.command.description;
}
