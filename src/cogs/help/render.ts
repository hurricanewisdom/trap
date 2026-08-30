import { lookup } from "../../core/prefix.js";
import { CATEGORIES, type CategoryDoc } from "./catalog.js";
import { commandMention } from "../../core/slash.js";
import { accented } from "../../helpers/components.js";
import {
  cogOf,
  cogSummaries,
  categoryOf,
  entries,
  entryFor,
  hasSubcommands,
  inCog,
  inSection,
  lettersOf,
  sectionsOf,
  ownerEntry,
  pathOf,
  startingWith,
  subcommandsOf,
  summaryOf,
  topLevelIn,
  type CogSummary,
  type Entry,
} from "./model.js";
import { search, searchCount } from "./search.js";

const PAGE_SIZE = 8;

const COGS_PER_PAGE = 30;

const SELECT_LIMIT = 25;

const HOME_BUDGET = 1500;

const HOME_COGS = 24;

const GROUPS_ABOVE = PAGE_SIZE;

const QUERY_LIMIT = 32;

const ID = "help";

export const JUMP_PREFIX = `${ID}jump:`;

export const FIND_MODAL_PREFIX = `${ID}find:`;

export type Menu = { kind: "menu"; id: string };

export type View =
  | { kind: "home" }
  | { kind: "cogs"; page: number }
  | { kind: "cog"; cog: string; page: number }
  | { kind: "all"; cog: string; page: number }
  | { kind: "section"; slug: string; page: number }
  | { kind: "alpha"; cog: string; letter: string; page: number }
  | { kind: "group"; owner: string; page: number }
  | { kind: "search"; query: string; page: number }
  | { kind: "command"; name: string };

export const HOME: View = { kind: "home" };

const SELECT = {
  cog: { kind: "menu", id: "cog" },
  group: { kind: "menu", id: "group" },
  letter: { kind: "menu", id: "letter" },
  open: { kind: "menu", id: "open" },
  run: { kind: "menu", id: "run" },
} as const;

function cleanQuery(value: string): string {
  return value.replace(/[|~]/g, " ").trim().slice(0, QUERY_LIMIT);
}

export function encodeKey(view: View | Menu): string {
  if ("id" in view) return `menu-${view.id}`;
  switch (view.kind) {
    case "home":
      return "home";
    case "cogs":
      return "cogs";
    case "cog":
      return `cog~${view.cog}`;
    case "all":
      return `all~${view.cog}`;
    case "section":
      return `sec~${view.slug}`;
    case "alpha":
      return `alpha~${view.cog}~${view.letter}`;
    case "group":
      return `grp~${view.owner}`;
    case "search":
      return `q~${cleanQuery(view.query)}`;
    default:
      return `cmd~${view.name}`;
  }
}

export function decodeKey(key: string, page = 0): View {
  const [kind = "home", a = "", b = ""] = key.split("~");
  switch (kind) {
    case "cogs":
      return { kind: "cogs", page };
    case "cog":
      return { kind: "cog", cog: a, page };
    case "all":
      return { kind: "all", cog: a, page };
    case "sec":
      return { kind: "section", slug: a, page };
    case "alpha":
      return { kind: "alpha", cog: a, letter: b, page };
    case "grp":
      return { kind: "group", owner: a, page };
    case "q":
      return { kind: "search", query: a, page };
    case "cmd":
      return { kind: "command", name: a };
    default:
      return HOME;
  }
}

export interface Decoded {
  action: string;
  view: View;
  page: number;
  ownerId: string;
}

export function decode(customId: string): Decoded | null {
  const parts = customId.split("|");
  if (parts[0] !== ID) return null;
  const [, action = "", key = "home", pageRaw = "0", ownerId = ""] = parts;
  const page = Number.parseInt(pageRaw, 10) || 0;
  return { action, view: decodeKey(key, page), page, ownerId };
}

function customId(action: string, view: View | Menu, page: number, ownerId: string): string {
  return `${ID}|${action}|${encodeKey(view)}|${page}|${ownerId}`;
}

export function listFor(view: View): Entry[] | null {
  switch (view.kind) {
    case "all":
      return inCog(view.cog);
    case "cog":
      return showsGroups(view.cog) ? null : topLevelIn(view.cog);
    case "group":
      return subcommandsOf(view.owner);
    case "section":
      return inSection(view.slug);
    case "alpha":
      return startingWith(view.cog, view.letter);
    case "search":
      return search(view.query, SELECT_LIMIT * 4);
    default:
      return null;
  }
}

export function pageCount(view: View): number {
  if (view.kind === "cogs") {
    return Math.max(1, Math.ceil(cogSummaries().length / COGS_PER_PAGE));
  }
  const list = listFor(view);
  if (!list) return 1;
  return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
}

export function clampPage(view: View, page: number): number {
  const count = pageCount(view);
  return Math.min(Math.max(page, 0), count - 1);
}

function showsGroups(cogName: string): boolean {
  return inCog(cogName).length > GROUPS_ABOVE && sectionsOf(cogName).length > 1;
}

function groupWord(owner: string): string {
  const [head = owner, ...rest] = owner.split(" ");
  const host = lookup(head);
  const short = host
    ? [host.name, ...(host.aliases ?? [])].reduce((a, b) => (b.length < a.length ? b : a))
    : head;
  return [short, ...rest].join(" ");
}

function invocation(name: string, prefix: string): string {
  if (name === "help") return commandMention("help");
  const command = lookup(name);
  return command?.groupedUnder
    ? `${prefix}${groupWord(command.groupedUnder)} ${name}`
    : `${prefix}${name}`;
}

function retarget(sample: string, prefix: string): string {
  return sample.replace(/^,(\S+)/, (whole, word: string) => {
    const command = lookup(word);
    return command?.groupedUnder
      ? `${prefix}${groupWord(command.groupedUnder)} ${word}`
      : `${prefix}${word}`;
  });
}

function invocationOf(entry: Entry, prefix: string): string {
  const owner = entry.command.groupedUnder;
  return owner
    ? `${prefix}${groupWord(owner)} ${entry.command.name}`
    : `${prefix}${entry.command.name}`;
}

function chip(entry: Entry, prefix: string): string {
  return entry.command.name === "help"
    ? commandMention("help")
    : `\`${invocationOf(entry, prefix)}\``;
}

const text = (content: string) => ({ type: 10, content });

const separator = (divider = true, spacing = 1) => ({ type: 14, divider, spacing });

const button = (
  id: string,
  label: string,
  options: { disabled?: boolean; style?: number } = {},
) => ({
  type: 2,
  style: options.style ?? 2,
  custom_id: id,
  label,
  ...(options.disabled ? { disabled: true } : {}),
});

function commandLine(entry: Entry, prefix: string): string {
  const flags = [entry.doc?.guildOnly ? "server only" : null, entry.doc?.permission ?? null].filter(
    Boolean,
  );
  const tail = flags.length ? ` · *${flags.join(" · ")}*` : "";
  const star = hasSubcommands(entry) ? "\\*" : "";
  return `${chip(entry, prefix)}${star}\n-# ${summaryOf(entry)}${tail}`;
}

const STAR_NOTE = "-# \\* has subcommands, open one to see them";

function anyStarred(list: Entry[]): boolean {
  return list.some((entry) => hasSubcommands(entry));
}

function footer(list: Entry[], page: number, noun: string): string {
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(list.length, (page + 1) * PAGE_SIZE);
  const range = list.length > PAGE_SIZE ? ` · showing ${from}-${to}` : "";
  return `-# ${list.length} ${noun}${list.length === 1 ? "" : "s"}${range}`;
}

function slice(list: Entry[], page: number): Entry[] {
  return list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
}

const FENCE = "```";

interface Tally {
  label: string;
  count: number;
}

function columnBlock(items: Tally[], width = 18): string {
  if (items.length === 0) return "";

  const columns = items.length > 6 ? 2 : 1;
  const rows = Math.ceil(items.length / columns);
  const cells = Array.from({ length: columns }, (_, c) =>
    items.slice(c * rows, c * rows + rows).map((item) => ({
      label: item.label.slice(0, width),
      count: String(item.count),
    })),
  );

  const labelWidth = cells.map((column) =>
    column.reduce((widest, cell) => Math.max(widest, cell.label.length), 0),
  );
  const countWidth = cells.map((column) =>
    column.reduce((widest, cell) => Math.max(widest, cell.count.length), 0),
  );

  const printed: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const parts: string[] = [];
    for (let column = 0; column < columns; column += 1) {
      const cell = cells[column]?.[row];
      if (!cell) continue;
      parts.push(
        cell.label.padEnd(labelWidth[column] ?? 0) + "  " + cell.count.padStart(countWidth[column] ?? 0),
      );
    }
    printed.push(parts.join("   ").trimEnd());
  }

  return [FENCE, printed.join("\n"), FENCE].join("\n");
}

function homeBody(prefix: string): string {
  const cogs = cogSummaries();
  const head = [
    `${entries().length} commands. Prefix \`${prefix}\``,
    `${commandMention("help")} \`[command]\` for detail on one, or **Search** below.`,
    "",
  ];

  const shown: Tally[] = [];
  let used = head.join("\n").length;

  for (const summary of cogs) {
    const cost = summary.label.length + 8;
    if (shown.length >= HOME_COGS || used + cost > HOME_BUDGET) break;
    shown.push({ label: summary.label, count: summary.count });
    used += cost;
  }

  const rest = cogs.length - shown.length;
  const body = [columnBlock(shown)];
  if (rest > 0) body.push(`-# +${rest} more · press **All cogs**`);

  return [...head, ...body].join("\n");
}

function cogsBody(page: number): string {
  const cogs = cogSummaries();
  const total = Math.max(1, Math.ceil(cogs.length / COGS_PER_PAGE));
  const safe = Math.min(Math.max(page, 0), total - 1);
  const shown = cogs.slice(safe * COGS_PER_PAGE, safe * COGS_PER_PAGE + COGS_PER_PAGE);

  return [
    `### All cogs`,
    `${cogs.length} cog${cogs.length === 1 ? "" : "s"}, ${entries().length} commands`,
    "",
    columnBlock(shown.map((summary) => ({ label: summary.label, count: summary.count }))),
  ].join("\n");
}

function groupsBody(summary: CogSummary, prefix: string): string {
  const groups = sectionsOf(summary.name);
  const host = lookup(summary.name);
  const sameName = Boolean(host && !host.groupedUnder);

  return [
    `### ${summary.label}`,
    `${summary.count} commands${sameName ? ` · \`${prefix}${summary.name}\`` : ""}`,
    "",
    columnBlock(groups.map((row) => ({ label: row.category.label, count: row.count }))),
    "-# Pick a group below, or press **All** for the full list.",
  ].join("\n");
}

function listBody(
  heading: string,
  blurb: string,
  list: Entry[],
  page: number,
  prefix: string,
  noun: string,
  extra = "",
): string {
  const rows = slice(list, page);
  return [
    `### ${heading}`,
    ...(blurb ? [blurb] : []),
    "",
    rows.length ? rows.map((entry) => commandLine(entry, prefix)).join("\n") : "-# Nothing here.",
    "",
    footer(list, page, noun) + extra + (anyStarred(rows) ? "\n" + STAR_NOTE : ""),
  ].join("\n");
}

function searchBody(query: string, list: Entry[], page: number, prefix: string): string {
  const total = searchCount(query);
  const capped = total > list.length ? ` (best ${list.length})` : "";

  if (list.length === 0) {
    return [
      `### No matches for \`${query}\``,
      "Nothing matched that name, alias or description.",
      "",
      "-# Try a shorter word, or press **Home** to browse by cog.",
    ].join("\n");
  }

  return [
    `### Results for \`${query}\``,
    `${total} match${total === 1 ? "" : "es"}${capped}`,
    "",
    slice(list, page)
      .map((entry) => `${commandLine(entry, prefix)}`)
      .join("\n"),
    "",
    footer(list, page, "result"),
  ].join("\n");
}

function groupBody(owner: string, list: Entry[], page: number, prefix: string): string {
  const entry = ownerEntry(owner);
  const title = `${prefix}${groupWord(owner)}`;
  const rows = slice(list, page);

  const head = [
    `### ${title}\\*`,
    entry ? summaryOf(entry) : "",
    "",
  ];

  const body = rows.map((sub) => {
    const usage = `${title} ${sub.command.name}`;
    const aliases = sub.command.aliases?.length
      ? ` · also ${sub.command.aliases.join(", ")}`
      : "";
    return `\`${usage}\`\n-# ${summaryOf(sub)}${aliases}`;
  });

  return [
    ...head,
    body.length ? body.join("\n") : "-# No subcommands.",
    "",
    footer(list, page, "subcommand"),
  ].join("\n");
}

function commandBody(entry: Entry, prefix: string): string {
  const { command, doc } = entry;
  const section = CATEGORIES.find((category) => category.slug === entry.section);
  const cog = cogOf(entry.cog);
  const lines: string[] = [`### ${invocationOf(entry, prefix)}`, summaryOf(entry), ""];

  lines.push(
    `**Usage** \`${doc?.usage ? retarget(doc.usage, prefix) : invocationOf(entry, prefix)}\``,
  );
  if (command.aliases?.length) {
    lines.push(`**Aliases** ${command.aliases.map((alias) => `\`${prefix}${alias}\``).join(" ")}`);
  }
  lines.push(`**Cog** \`${cog?.label ?? entry.cog}\`${section ? ` / ${section.label}` : ""}`);

  const flags = [
    doc?.guildOnly ? "Server only" : null,
    doc?.permission ? `Requires **${doc.permission}**` : null,
  ].filter(Boolean);
  if (flags.length) lines.push(flags.join(" · "));

  if (doc?.details) lines.push("", doc.details);

  if (doc?.subcommands?.length) {
    lines.push("", "**Subcommands**");
    for (const sub of doc.subcommands) {
      lines.push(
        `\`${retarget(sub.usage, prefix)}\`\n-# ${sub.summary}${sub.permission ? ` · *${sub.permission}*` : ""}`,
      );
    }
  }

  if (doc?.examples?.length) {
    lines.push("", "**Examples**", doc.examples.map((example) => `\`${retarget(example, prefix)}\``).join("\n"));
  }

  return lines.join("\n");
}

function cogFor(view: View): string | null {
  switch (view.kind) {
    case "cog":
    case "all":
    case "alpha":
      return view.cog;
    case "section":
      return inSection(view.slug)[0]?.cog ?? null;
    case "command":
      return entryFor(view.name)?.cog ?? null;
    case "group":
      return ownerEntry(view.owner)?.cog ?? null;
    default:
      return null;
  }
}

function cogSelect(current: string | null, ownerId: string): unknown {
  const all = cogSummaries();
  const overflow = all.length > SELECT_LIMIT;
  const room = overflow ? SELECT_LIMIT - 1 : SELECT_LIMIT;

  const shown = all.slice(0, room);
  if (current && !shown.some((summary) => summary.name === current)) {
    const active = all.find((summary) => summary.name === current);
    if (active) shown.splice(room - 1, 1, active);
  }

  const options = shown.map((summary) => ({
    label: summary.label.slice(0, 100),
    value: `cog~${summary.name}`,
    description: `${summary.count} command${summary.count === 1 ? "" : "s"} · ${summary.description}`.slice(0, 100),
    default: summary.name === current,
  }));

  if (overflow) {
    options.push({
      label: `All ${all.length} cogs`,
      value: "cogs",
      description: `Browse the remaining ${all.length - shown.length} cogs`.slice(0, 100),
      default: false,
    });
  }

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId("goto", SELECT.cog, 0, ownerId),
        placeholder: "Jump to a cog",
        options,
      },
    ],
  };
}

function groupSelect(cogName: string, ownerId: string): unknown | null {
  const groups = sectionsOf(cogName).slice(0, SELECT_LIMIT);
  if (groups.length === 0) return null;

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId("goto", SELECT.group, 0, ownerId),
        placeholder: "Open a group",
        options: groups.map((row) => ({
          label: row.category.label.slice(0, 100),
          value: `sec~${row.category.slug}`,
          description: `${row.count} command${row.count === 1 ? "" : "s"} · ${row.category.blurb}`.slice(0, 100),
        })),
      },
    ],
  };
}

function letterSelect(cogName: string, current: string | null, ownerId: string): unknown | null {
  const letters = lettersOf(cogName).slice(0, SELECT_LIMIT);
  if (letters.length === 0) return null;

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId("goto", SELECT.letter, 0, ownerId),
        placeholder: "Jump to a letter",
        options: letters.map((row) => ({
          label: row.letter,
          value: `alpha~${cogName}~${row.letter}`,
          description: `${row.count} command${row.count === 1 ? "" : "s"}`,
          default: row.letter === current,
        })),
      },
    ],
  };
}

function openSelect(list: Entry[], page: number, ownerId: string, prefix: string): unknown | null {
  const rows = slice(list, page);
  if (rows.length === 0) return null;

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId("goto", SELECT.open, 0, ownerId),
        placeholder: rows.length === 1 ? "Open this command" : "Open a command",
        options: rows.map((entry) => ({
          label: invocationOf(entry, prefix).slice(0, 100),
          value: `${hasSubcommands(entry) ? "grp" : "cmd"}~${pathOf(entry)}`,
          description: summaryOf(entry).slice(0, 100),
        })),
      },
    ],
  };
}

function runSelect(list: Entry[], page: number, ownerId: string, prefix: string): unknown | null {
  const rows = slice(list, page);
  if (rows.length === 0) return null;

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId("run", SELECT.run, 0, ownerId),
        placeholder: rows.length === 1 ? "Run this command" : "Run a command",
        options: rows.map((entry) => ({
          label: invocationOf(entry, prefix).slice(0, 100),
          value: pathOf(entry),
          description: summaryOf(entry).slice(0, 100),
        })),
      },
    ],
  };
}

function navRow(view: View, page: number, ownerId: string): unknown | null {
  const count = pageCount(view);
  if (count <= 1) return null;

  const first = page <= 0;
  const last = page >= count - 1;

  return {
    type: 1,
    components: [
      button(customId("first", view, page, ownerId), "«", { disabled: first }),
      button(customId("prev", view, page, ownerId), "Back", { disabled: first }),
      button(customId("jump", view, page, ownerId), `${page + 1} / ${count}`),
      button(customId("next", view, page, ownerId), "Next", { disabled: last }),
      button(customId("last", view, page, ownerId), "»", { disabled: last }),
    ],
  };
}

function actionRow(view: View, ownerId: string): unknown {
  const row: unknown[] = [];
  const cog = cogFor(view);

  if (view.kind !== "home") row.push(button(customId("goto", HOME, 0, ownerId), "Home"));

  if (view.kind === "cog" && cog && showsGroups(cog)) {
    row.push(button(customId("goto", { kind: "all", cog, page: 0 }, 0, ownerId), "All"));
  } else if ((view.kind === "all" || view.kind === "alpha") && cog && showsGroups(cog)) {
    row.push(button(customId("goto", { kind: "cog", cog, page: 0 }, 0, ownerId), "Groups"));
  } else if ((view.kind === "section" || view.kind === "command" || view.kind === "group") && cog) {
    row.push(
      button(customId("goto", { kind: "cog", cog, page: 0 }, 0, ownerId), cogOf(cog)?.label ?? cog),
    );
  }

  if (view.kind === "group") {
    row.push(
      button(customId("goto", { kind: "command", name: view.owner }, 0, ownerId), "Details"),
    );
  } else if (view.kind === "command" && entryFor(view.name) && hasSubcommands(entryFor(view.name) as Entry)) {
    row.push(
      button(
        customId(
          "goto",
          { kind: "group", owner: pathOf(entryFor(view.name) as Entry), page: 0 },
          0,
          ownerId,
        ),
        "Subcommands",
      ),
    );
    row.push(button(customId("run", view, 0, ownerId), "Run", { style: 1 }));
  } else if (view.kind === "command") {
    row.push(button(customId("run", view, 0, ownerId), "Run", { style: 1 }));
  } else if (
    cog &&
    view.kind !== "alpha" &&
    inCog(cog).length > PAGE_SIZE * 2 &&
    lettersOf(cog).length > 1 &&
    row.length < 4
  ) {
    row.push(button(customId("goto", { kind: "alpha", cog, letter: lettersOf(cog)[0]?.letter ?? "A", page: 0 }, 0, ownerId), "A-Z"));
  }

  if (view.kind === "home" && cogSummaries().length > 1) {
    row.push(button(customId("goto", { kind: "cogs", page: 0 }, 0, ownerId), "All cogs"));
  }

  row.push(button(customId("find", view, 0, ownerId), "Search", { style: 1 }));
  row.push(button(customId("close", view, 0, ownerId), "Close"));

  return { type: 1, components: row.slice(0, 5) };
}

export function findModal(ownerId: string, query = ""): unknown {
  return {
    title: "Search commands",
    custom_id: `${FIND_MODAL_PREFIX}${ownerId}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "name",
            label: "Name, alias or anything in the description",
            style: 1,
            min_length: 1,
            max_length: QUERY_LIMIT,
            required: true,
            value: query || undefined,
            placeholder: "top tracks",
          },
        ],
      },
    ],
  };
}

export function jumpModal(view: View, ownerId: string, count: number): unknown {
  return {
    title: "Jump to page",
    custom_id: `${JUMP_PREFIX}${encodeKey(view)}:${ownerId}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "page",
            label: `Page number (1-${count})`,
            style: 1,
            min_length: 1,
            max_length: 4,
            required: true,
            placeholder: "1",
          },
        ],
      },
    ],
  };
}

export function renderView(
  view: View,
  ownerId: string,
  prefix: string,
): { flags: number; components: unknown[] } {
  const page = clampPage(view, "page" in view ? view.page : 0);
  const cog = cogFor(view);
  const components: unknown[] = [];

  let list: Entry[] | null = null;

  if (view.kind === "home") {
    components.push(text(homeBody(prefix)));
  } else if (view.kind === "cogs") {
    components.push(text(cogsBody(page)));
  } else if (view.kind === "command") {
    const entry = entryFor(view.name);
    components.push(
      text(
        entry
          ? commandBody(entry, prefix)
          : `### Unknown command\nNothing here is called \`${view.name.slice(0, 40)}\`.`,
      ),
    );
  } else if (view.kind === "search") {
    list = listFor(view) ?? [];
    components.push(text(searchBody(view.query, list, page, prefix)));
  } else if (view.kind === "group") {
    list = listFor(view) ?? [];
    components.push(text(groupBody(view.owner, list, page, prefix)));
  } else if (view.kind === "cog" && cog && showsGroups(cog)) {
    const summary = cogOf(cog);
    components.push(text(summary ? groupsBody(summary, prefix) : homeBody(prefix)));
  } else if (view.kind === "section") {
    const category = categoryOf(view.slug);
    list = listFor(view) ?? [];
    components.push(
      text(
        category
          ? listBody(category.label, "", list, page, prefix, "command")
          : homeBody(prefix),
      ),
    );
  } else if (view.kind === "alpha" && cog) {
    list = listFor(view) ?? [];
    const summary = cogOf(cog);
    components.push(
      text(
        listBody(
          `${summary?.label ?? cog} · ${view.letter}`,
          "",
          list,
          page,
          prefix,
          "command",
        ),
      ),
    );
  } else if (cog) {
    list = listFor(view) ?? [];
    const summary = cogOf(cog);
    const whole = inCog(cog).length;
    const extra =
      view.kind === "cog" && whole > list.length ? `, ${whole} including subcommands` : "";
    components.push(
      text(
        summary
          ? listBody(summary.label, "", list, page, prefix, "command", extra)
          : homeBody(prefix),
      ),
    );
  } else {
    components.push(text(homeBody(prefix)));
  }

  components.push(separator(true));
  components.push(cogSelect(cog, ownerId));

  if (view.kind === "cog" && cog && showsGroups(cog)) {
    const groups = groupSelect(cog, ownerId);
    if (groups) components.push(groups);
  } else if (view.kind === "alpha" && cog) {
    const letters = letterSelect(cog, view.letter, ownerId);
    if (letters) components.push(letters);
  } else if (list && list.length) {
    const open = openSelect(list, page, ownerId, prefix);
    if (open) components.push(open);

    const run = runSelect(list, page, ownerId, prefix);
    if (run) components.push(run);
  }

  const nav = navRow(view, page, ownerId);
  if (nav) components.push(nav);

  components.push(actionRow(view, ownerId));

  return { flags: 1 << 15, components: [accented({ type: 17, components })] };
}
