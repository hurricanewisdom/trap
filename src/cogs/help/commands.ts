/**
 * `,help`: the command itself, plus the interaction handling for its menu.
 */

import { lookup, register, type PrefixContext } from "../../core/prefix.js";
import { canRunCommands, runCommand } from "../../core/runner.js";
import { slashifyPayload } from "../../helpers/slashtext.js";
import {
  FIND_MODAL_PREFIX,
  HELP_ACCENT,
  decode,
  findModal,
  findCog,
  findCommand,
  findSection,
  pageCountForCog,
  type CogSummary,
  pageCountForSection,
  renderView,
  type View,
} from "./render.js";

/** Set once at startup so help can print the live prefix. */
let prefix = ",";

export function setHelpPrefix(value: string): void {
  prefix = value;
}

function card(body: string) {
  return {
    flags: 1 << 15,
    components: [
      { type: 17, accent_color: HELP_ACCENT, components: [{ type: 10, content: body }] },
    ],
  };
}

/**
 * The cog a query names, directly or through a command alias.
 *
 * ",lf" is an alias of the ",lastfm" command, which shares its name with the
 * cog, so people type ",help lf" and mean the cog rather than the command.
 */
function resolveCog(query: string): CogSummary | null {
  const direct = findCog(query);
  if (direct) return direct;
  const command = lookup(query.trim().replace(/^,/, ""));
  return command ? findCog(command.name) : null;
}

/**
 * Drops a leading group name so help understands the shape the prefix router
 * already accepts.
 *
 * Every Last.fm command is reachable as ",lf <sub>" as well as on its own, so
 * ",help lf cover" has to mean ",help cover" — otherwise the form people
 * actually type is the one help cannot explain. Returns null when the first
 * word is not a group, which leaves multi-word section labels such as "Now
 * playing" to be matched whole.
 */
function stripGroup(query: string): string | null {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return resolveCog(words[0] ?? "") ? words.slice(1).join(" ") : null;
}

/** `,help`, `,help <command>`, `,help <cog>`, `,help <section>`. */
async function handle(ctx: PrefixContext): Promise<void> {
  const query = ctx.argument.trim();

  if (!query) {
    await ctx.reply(renderView({ kind: "home" }, ctx.authorId, prefix));
    return;
  }

  /**
   * A cog wins over a same-named command. ",help lastfm" means "show me the
   * Last.fm commands", not "explain the ,lastfm command". The cog view lists
   * that command anyway, so nothing becomes unreachable.
   */
  const cog = resolveCog(query);
  if (cog) {
    await ctx.reply(renderView({ kind: "cog", cog: cog.name, page: 0 }, ctx.authorId, prefix));
    return;
  }

  const command = findCommand(query);
  if (command) {
    await ctx.reply(renderView({ kind: "command", name: command.command.name }, ctx.authorId, prefix));
    return;
  }

  const section = findSection(query);
  if (section) {
    await ctx.reply(
      renderView({ kind: "section", slug: section.slug, page: 0 }, ctx.authorId, prefix),
    );
    return;
  }

  // ",help lf cover" is the same request as ",help cover"; the router accepts
  // that form, so help has to resolve it too.
  const withoutGroup = stripGroup(query);
  if (withoutGroup) {
    const grouped = findCommand(withoutGroup);
    if (grouped) {
      await ctx.reply(
        renderView({ kind: "command", name: grouped.command.name }, ctx.authorId, prefix),
      );
      return;
    }
    const groupedSection = findSection(withoutGroup);
    if (groupedSection) {
      await ctx.reply(
        renderView({ kind: "section", slug: groupedSection.slug, page: 0 }, ctx.authorId, prefix),
      );
      return;
    }
  }

  await ctx.reply(
    card(
      `### Nothing found\nNo command, cog or section called \`${query.slice(0, 40)}\`.` +
        `\n-# Run \`${prefix}help\` to browse everything.`,
    ),
  );
}

export function registerHelp(): void {
  register({
    name: "help",
    aliases: ["h", "commands", "cmds"],
    description: "Browse every command",
    handler: handle,
  });
}

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */

export interface HelpInteraction {
  data?: { customId?: string; values?: string[] };
  user?: { id?: string | bigint };
  message?: { id?: string | bigint };
  // Raw payloads; discordeno v21 predates Components V2.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  respond: (payload: any, options?: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edit: (payload: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deferEdit: () => Promise<any>;
}

/**
 * Drives the menu. Returns the message id when the caller should delete the
 * message (the close button), otherwise null.
 */
export async function handleHelpInteraction(
  interaction: HelpInteraction,
): Promise<{ deleteMessageId: string } | null> {
  const decoded = decode(String(interaction.data?.customId ?? ""));
  if (!decoded) return null;

  // The menu belongs to whoever ran the command.
  if (String(interaction.user?.id ?? "") !== decoded.ownerId) {
    await interaction.respond(
      { content: `That menu is not yours. Run \`${prefix}help\` to open your own.` },
      { isPrivate: true },
    );
    return null;
  }

  if (decoded.action === "close") {
    await interaction.deferEdit();
    const messageId = interaction.message?.id ? String(interaction.message.id) : null;
    return messageId ? { deleteMessageId: messageId } : null;
  }

  /**
   * The run dropdown. Picking a command executes it there and then, as a new
   * message, leaving the help card open behind it.
   *
   * Only commands that need no argument can be run this way — the dropdown has
   * nowhere to type an artist — so one that does is pointed at its own slash
   * command instead of being run with an empty operand and failing.
   */
  if (decoded.action === "find") {
    await interaction.respond(findModal(decoded.ownerId));
    return null;
  }

  if (decoded.action === "run") {
    const chosen = (interaction.data?.values ?? [])[0];
    const command = chosen ? lookup(String(chosen)) : undefined;

    if (!command || !canRunCommands()) {
      await interaction.respond({ content: "That command is not available." }, { isPrivate: true });
      return null;
    }

    await runCommand(interaction, command, "");
    return null;
  }

  const view = nextView(decoded.action, decoded.view, interaction.data?.values ?? []);
  // Edits bypass the send path, so the rewrite has to be applied here too.
  await interaction.edit(slashifyPayload(renderView(view, decoded.ownerId, prefix)));
  return null;
}

/**
 * The Find modal's answer.
 *
 * Resolves the same way `/help <query>` does — command, cog or category, with
 * the group prefix stripped — so anything typeable there works here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleFindModal(interaction: any): Promise<void> {
  const ownerId = String(interaction.data?.customId ?? "").slice(FIND_MODAL_PREFIX.length);
  if (String(interaction.user?.id ?? "") !== ownerId) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (interaction.data?.components ?? []) as any[];
  const typed = String(rows[0]?.components?.[0]?.value ?? "").trim();

  const view = viewFor(typed);
  if (!view) {
    await interaction.respond(
      { content: `Nothing here is called \`${typed.slice(0, 40)}\`.` },
      { isPrivate: true },
    );
    return;
  }

  await interaction.edit(slashifyPayload(renderView(view, ownerId, prefix)));
}

/** The view a typed query leads to, or null when nothing matches. */
function viewFor(query: string): View | null {
  if (!query) return null;

  const cog = resolveCog(query);
  if (cog) return { kind: "cog", cog: cog.name, page: 0 };

  const command = findCommand(query);
  if (command) return { kind: "command", name: command.command.name };

  const section = findSection(query);
  if (section) return { kind: "section", slug: section.slug, page: 0 };

  const withoutGroup = stripGroup(query);
  if (withoutGroup) {
    const grouped = findCommand(withoutGroup);
    if (grouped) return { kind: "command", name: grouped.command.name };
    const groupedSection = findSection(withoutGroup);
    if (groupedSection) return { kind: "section", slug: groupedSection.slug, page: 0 };
  }

  return null;
}

/** Paging wraps, matching the other paginated cards. */
function step(page: number, count: number, delta: number): number {
  return ((page + delta) % count + count) % count;
}

/** Works out which view a control leads to. */
function nextView(action: string, current: View, values: string[]): View {
  const chosen = values[0];

  switch (action) {
    case "home":
      return { kind: "home" };

    case "cogselect":
      return chosen ? { kind: "cog", cog: chosen, page: 0 } : { kind: "home" };

    case "sectionselect":
      return chosen ? { kind: "section", slug: chosen, page: 0 } : { kind: "home" };

    case "cmdselect":
      return chosen ? { kind: "command", name: chosen } : { kind: "home" };

    case "cogprev":
    case "cognext": {
      if (current.kind !== "cog") return { kind: "home" };
      const count = pageCountForCog(current.cog);
      return {
        kind: "cog",
        cog: current.cog,
        page: step(current.page, count, action === "cognext" ? 1 : -1),
      };
    }

    case "secprev":
    case "secnext": {
      if (current.kind !== "section") return { kind: "home" };
      const count = pageCountForSection(current.slug);
      return {
        kind: "section",
        slug: current.slug,
        page: step(current.page, count, action === "secnext" ? 1 : -1),
      };
    }

    default:
      return current;
  }
}
