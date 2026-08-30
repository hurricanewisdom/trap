/**
 * The help menu.
 *
 * The structure mirrors the bot's own: `/help` lists the loaded **cogs**, a cog
 * opens its sections, and a section lists its commands. Everything is derived
 * from the live command registry (the catalog only adds detail), so a command
 * cannot exist without appearing here.
 *
 * Every view is a Components V2 container holding a cog dropdown, a
 * context-sensitive second dropdown and a button row. The whole view state,
 * including who owns the menu, is encoded in the component custom ids, so the
 * menu keeps working after a restart and stores nothing.
 */

import { loadedCogs } from "../../core/cog.js";
import { allCommands, lookup, type PrefixCommand } from "../../core/prefix.js";
import { CATEGORIES, DOCS, type CategoryDoc, type CommandDoc } from "./catalog.js";
import { commandMention, pathFor } from "../../core/slash.js";

export const HELP_ACCENT = 0x2b2d31;

/** Commands listed per page inside a section. */
const PAGE_SIZE = 8;

/** A select menu holds at most 25 options. */
const SELECT_LIMIT = 25;

const ID = "help";

export type View =
  | { kind: "home" }
  | { kind: "cog"; cog: string; page: number }
  | { kind: "section"; slug: string; page: number }
  | { kind: "command"; name: string };

/* ------------------------------------------------------------------ */
/* Custom id encoding                                                  */
/* ------------------------------------------------------------------ */

export interface Decoded {
  view: View;
  ownerId: string;
  action: string;
}

/** Ids look like `help|cog|lastfm|0|<ownerId>`, well under Discord's 100 chars. */
export function decode(customId: string): Decoded | null {
  const parts = customId.split("|");
  if (parts[0] !== ID) return null;
  const [, action = "", value = "", pageRaw = "0", ownerId = ""] = parts;
  const page = Number.parseInt(pageRaw, 10) || 0;

  switch (action) {
    case "cog":
    case "cogselect":
    case "cogprev":
    case "cognext":
      return { view: { kind: "cog", cog: value, page }, ownerId, action };
    case "section":
    case "sectionselect":
    case "secprev":
    case "secnext":
      return { view: { kind: "section", slug: value, page }, ownerId, action };
    case "cmd":
    case "cmdselect":
      return { view: { kind: "command", name: value }, ownerId, action };
    case "home":
    case "close":
      return { view: { kind: "home" }, ownerId, action };
    // Both of these carry what they need elsewhere — the run dropdown in its
    // selected value, the find button in the modal it opens — so the view is
    // unused here. Every new verb must be listed: decode returns null for an
    // unknown one, and the control silently does nothing.
    case "run":
    case "find":
      return { view: { kind: "home" }, ownerId, action };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const docByName = new Map(DOCS.map((doc) => [doc.name, doc]));

export interface Entry {
  command: PrefixCommand;
  doc?: CommandDoc;
  /** Catalog section, e.g. "charts". */
  section: string;
  /** The cog that registered it. */
  cog: string;
}

export function entries(): Entry[] {
  return allCommands().map((command) => {
    const doc = docByName.get(command.name);
    // An undocumented or unattributed command still appears rather than
    // silently vanishing from help.
    return {
      command,
      doc,
      section: doc?.category ?? "general",
      cog: command.cog ?? "general",
    };
  });
}

export interface CogSummary {
  name: string;
  description: string;
  count: number;
}

/**
 * Cogs the menu offers to browse.
 *
 * `help` is left out: it is the menu itself, and listing a one-command cog
 * whose only command is the thing you are already looking at is noise.
 * `/help help` still works, since that resolves as a command.
 */
const HIDDEN_COGS = new Set(["help"]);

export function cogSummaries(): CogSummary[] {
  const all = entries();
  return loadedCogs()
    .filter((cog) => !HIDDEN_COGS.has(cog.name))
    .map((cog) => ({
      name: cog.name,
      description: cog.description,
      count: all.filter((entry) => entry.cog === cog.name).length,
    }))
    .filter((summary) => summary.count > 0);
}

export function inCog(name: string): Entry[] {
  return entries()
    .filter((entry) => entry.cog === name)
    .sort((a, b) => a.command.name.localeCompare(b.command.name));
}

export function inSection(slug: string): Entry[] {
  return entries()
    .filter((entry) => entry.section === slug)
    .sort((a, b) => a.command.name.localeCompare(b.command.name));
}

/** The catalog sections a cog actually uses, in catalog order. */
export function sectionsOf(cogName: string): { category: CategoryDoc; count: number }[] {
  const list = inCog(cogName);
  return CATEGORIES.map((category) => ({
    category,
    count: list.filter((entry) => entry.section === category.slug).length,
  })).filter((row) => row.count > 0);
}

export function findCommand(query: string): Entry | null {
  const command = lookup(query.trim().replace(/^,/, ""));
  if (!command) return null;
  const doc = docByName.get(command.name);
  return {
    command,
    doc,
    section: doc?.category ?? "general",
    cog: command.cog ?? "general",
  };
}

export function findCog(query: string): CogSummary | null {
  const needle = query.trim().toLowerCase();
  return cogSummaries().find((summary) => summary.name === needle) ?? null;
}

export function findSection(query: string): CategoryDoc | null {
  const needle = query.trim().toLowerCase();
  return (
    CATEGORIES.find(
      (category) => category.slug === needle || category.label.toLowerCase() === needle,
    ) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/**
 * How a command is actually typed.
 *
 * Everything runs through one parent command with the name in a field, so the
 * real invocation is `/lastfm command:x`. The terse `/x` used in listings is
 * shorthand for scanning; this is the form that works.
 */
function invocation(name: string): string {
  if (name === "nowplaying") return "/fm";
  const path = pathFor(name);
  return path ? `/${path}` : `/${name}`;
}

/** The same thing, but with the command itself as a clickable mention. */
function usageOf(name: string): string {
  return chip(name);
}

/** Prompts for a command name, so any of them can be reached by typing. */
export function findModal(ownerId: string): unknown {
  return {
    title: "Find a command",
    custom_id: `${ID}find:${ownerId}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "name",
            label: "Command, cog or category",
            style: 1,
            min_length: 1,
            max_length: 40,
            required: true,
            placeholder: "toptracks",
          },
        ],
      },
    ],
  };
}

export const FIND_MODAL_PREFIX = `${ID}find:`;

const text = (content: string) => ({ type: 10, content });
const separator = (divider = true, spacing = 1) => ({ type: 14, divider, spacing });

function cogSelect(current: string | null, ownerId: string): unknown {
  const options = cogSummaries()
    .slice(0, SELECT_LIMIT)
    .map((summary) => ({
      label: summary.name,
      value: summary.name,
      description: `${summary.count} command${summary.count === 1 ? "" : "s"} · ${summary.description}`.slice(0, 100),
      default: summary.name === current,
    }));

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `${ID}|cogselect||0|${ownerId}`,
        placeholder: "Browse a cog",
        options,
      },
    ],
  };
}

function pageOf(list: Entry[], page: number): Entry[] {
  return list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).slice(0, SELECT_LIMIT);
}

/**
 * The dropdown that actually runs something.
 *
 * A command mention renders as a blue chip but only *inserts* the command into
 * the message box — Discord gives no way to pre-fill an option, so a mention
 * cannot carry `command:toptracks`. A select can, because picking one is an
 * interaction the bot answers itself, so this is the control that turns a
 * click into a result.
 */
function runSelect(view: View, ownerId: string): unknown | null {
  // Narrowed per branch so the page number is only read where a view has one.
  let slice: Entry[] = [];
  if (view.kind === "cog") slice = pageOf(inCog(view.cog), view.page);
  else if (view.kind === "section") slice = pageOf(inSection(view.slug), view.page);
  else if (view.kind === "command") {
    const entry = findCommand(view.name);
    slice = entry ? [entry] : [];
  }
  if (slice.length === 0) return null;

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `${ID}|run||0|${ownerId}`,
        placeholder: slice.length === 1 ? `Run /${slice[0]?.command.name}` : "Run a command",
        options: slice.map(({ command, doc }) => ({
          label: `/${command.name}`,
          value: command.name,
          description: (doc?.summary ?? command.description).slice(0, 100),
        })),
      },
    ],
  };
}

function buttons(view: View, ownerId: string, pageCount: number): unknown {
  const row: unknown[] = [
    {
      type: 2,
      style: 2,
      custom_id: `${ID}|home||0|${ownerId}`,
      label: "Home",
      disabled: view.kind === "home",
    },
  ];

  // Paging controls only appear where there is somewhere to page to. Cog and
  // section paging use distinct actions so the target is unambiguous.
  if ((view.kind === "cog" || view.kind === "section") && pageCount > 1) {
    const isCog = view.kind === "cog";
    const value = isCog ? view.cog : view.slug;
    row.push(
      {
        type: 2,
        style: 2,
        custom_id: `${ID}|${isCog ? "cogprev" : "secprev"}|${value}|${view.page}|${ownerId}`,
        label: "Back",
      },
      {
        type: 2,
        style: 2,
        custom_id: `${ID}|${isCog ? "cognext" : "secnext"}|${value}|${view.page}|${ownerId}`,
        label: "Next",
      },
    );
  }

  // A dropdown holds 25 options and a page shows 8, so neither could ever
  // reach all 116 commands. Typing a name can.
  row.push({ type: 2, style: 2, custom_id: `${ID}|find||0|${ownerId}`, label: "Find" });
  row.push({ type: 2, style: 2, custom_id: `${ID}|close||0|${ownerId}`, label: "Close" });
  return { type: 1, components: row };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function homeBody(_prefix: string): string {
  const rows = cogSummaries().map(
    (summary) =>
      `**${summary.name}** \`${summary.count}\`
-# ${summary.description}`,
  );

  return [
    "### Trap help",
    // The mention is a real clickable chip; the placeholder after it shows
    // what to fill in.
    `${entries().length} commands. ${commandMention("help")} \`[command]\` for detail on one.`,
    "",
    ...rows,
    "",
    "-# Pick a cog below, then use the run menu to fire a command from here.",
  ].join("\n");
}

/**
 * How a command is shown in a listing.
 *
 * Tested 2026-08-29 and it does not work as a mention: `</lastfm albuminfo:id>`
 * renders as unstyled plain text, because Discord resolves the path against
 * the command's real structure and `albuminfo` is a *value* of the `command`
 * field, not a subcommand. Only `/fm`, `/help`, `/ping` and `/botinfo` are
 * real commands and can be chips. A code span is used instead: it is the
 * closest highlighted style that is guaranteed to render.
 */
function chip(name: string): string {
  if (name === "nowplaying") return commandMention("fm");
  if (name === "help" || name === "ping" || name === "botinfo") return commandMention(name);

  // A mention is only drawn when its path matches the real command tree, which
  // is exactly why these are subcommands. The parent carries the id.
  const path = pathFor(name);
  return path ? commandMention(path.split(" ")[0] ?? "lastfm", path) : `\`/${name}\``;
}

function commandLine(entry: Entry): string {
  const usage = chip(entry.command.name);
  const flags = [
    entry.doc?.guildOnly ? "server only" : null,
    entry.doc?.permission ?? null,
  ].filter(Boolean);
  const tail = flags.length ? ` · *${flags.join(" · ")}*` : "";
  // Not wrapped in backticks: a mention inside code renders as literal text.
  return `${usage}\n-# ${entry.doc?.summary ?? entry.command.description}${tail}`;
}

function cogBody(summary: CogSummary, page: number, prefix: string): string {
  const list = inCog(summary.name);
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const slice = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // A cog may share its name with one of its commands; say so, since the cog
  // view is what ",help <name>" resolves to.
  const sameName = list.some((entry) => entry.command.name === summary.name);

  return [
    `### ${summary.name}`,
    summary.description,
    ...(sameName ? [`-# \`/${summary.name}\` is also a command; it is listed below.`] : []),
    "",
    slice.map((entry) => commandLine(entry)).join("\n"),
    "",
    `-# ${list.length} command${list.length === 1 ? "" : "s"}` +
      (pageCount > 1 ? ` · Page ${safePage + 1} of ${pageCount}` : ""),
  ].join("\n");
}

function sectionBody(category: CategoryDoc, page: number, prefix: string): string {
  const list = inSection(category.slug);
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const slice = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const cog = list[0]?.cog;

  return [
    `### ${category.label}`,
    category.blurb + (cog ? ` (${cog})` : ""),
    "",
    slice.map((entry) => commandLine(entry)).join("\n"),
    "",
    `-# ${list.length} command${list.length === 1 ? "" : "s"}` +
      (pageCount > 1 ? ` · Page ${safePage + 1} of ${pageCount}` : ""),
  ].join("\n");
}

function commandBody(entry: Entry, prefix: string): string {
  const { command, doc } = entry;
  const section = CATEGORIES.find((c) => c.slug === entry.section);
  const lines: string[] = [`### /${command.name}`];

  lines.push(doc?.summary ?? command.description);
  lines.push("");
  // The mention is the clickable half; the fields beside it are what to fill
  // in. Together they are exactly what you would type.
  lines.push(`**Usage** ${usageOf(command.name)}`);

  if (command.aliases?.length) {
    lines.push(`**Aliases** ${command.aliases.map((a) => `\`/${a}\``).join(" ")}`);
  }
  lines.push(`**Cog** \`${entry.cog}\`${section ? ` / ${section.label}` : ""}`);

  const flags = [
    doc?.guildOnly ? "Server only" : null,
    doc?.permission ? `Requires **${doc.permission}**` : null,
  ].filter(Boolean);
  if (flags.length) lines.push(flags.join(" · "));

  if (doc?.details) {
    lines.push("");
    lines.push(doc.details);
  }

  if (doc?.subcommands?.length) {
    lines.push("");
    lines.push("**Subcommands**");
    for (const sub of doc.subcommands) {
      lines.push(`\`${sub.usage}\`\n-# ${sub.summary}${sub.permission ? ` · *${sub.permission}*` : ""}`);
    }
  }

  if (doc?.examples?.length) {
    lines.push("");
    lines.push("**Examples**");
    lines.push(doc.examples.map((example) => `\`${example}\``).join("\n"));
  }

  return lines.join("\n");
}

/** Builds the full message payload for a view. */
export function renderView(
  view: View,
  ownerId: string,
  prefix: string,
): { flags: number; components: unknown[] } {
  const inner: unknown[] = [];
  let pageCount = 1;
  let currentCog: string | null = null;

  if (view.kind === "home") {
    inner.push(text(homeBody(prefix)));
  } else if (view.kind === "cog") {
    const summary = cogSummaries().find((s) => s.name === view.cog);
    if (!summary) {
      inner.push(text(homeBody(prefix)));
    } else {
      currentCog = summary.name;
      pageCount = pageCountForCog(summary.name);
      inner.push(text(cogBody(summary, view.page, prefix)));
    }
  } else if (view.kind === "section") {
    const category = CATEGORIES.find((c) => c.slug === view.slug);
    if (!category) {
      inner.push(text(homeBody(prefix)));
    } else {
      currentCog = inSection(category.slug)[0]?.cog ?? null;
      pageCount = Math.max(1, Math.ceil(inSection(category.slug).length / PAGE_SIZE));
      inner.push(text(sectionBody(category, view.page, prefix)));
    }
  } else {
    const entry = findCommand(view.name);
    inner.push(
      entry
        ? text(commandBody(entry, prefix))
        : text(`### Unknown command\nNothing here is called \`/${view.name}\`.`),
    );
    currentCog = entry?.cog ?? null;
  }

  const components: unknown[] = [...inner, separator(true), cogSelect(currentCog, ownerId)];

  // Five action rows is the ceiling, and the two selects plus the button row
  // use three of them.
  const run = runSelect(view, ownerId);
  if (run) components.push(run);

  components.push(buttons(view, ownerId, pageCount));

  return {
    flags: 1 << 15,
    components: [{ type: 17, accent_color: HELP_ACCENT, components }],
  };
}

export function pageCountForCog(name: string): number {
  return Math.max(1, Math.ceil(inCog(name).length / PAGE_SIZE));
}

export function pageCountForSection(slug: string): number {
  return Math.max(1, Math.ceil(inSection(slug).length / PAGE_SIZE));
}
