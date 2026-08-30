import { lookup, lookupPath, register, type PrefixContext } from "../../core/prefix.js";
import { canRunCommands, runCommand } from "../../core/runner.js";
import { commandMention } from "../../core/slash.js";
import { cancel, keepAlive } from "../../core/expiry.js";
import { primaryPrefix } from "../../core/prefixes.js";
import {
  findCog,
  findCommand,
  findSection,
  hasSubcommands,
  pathOf,
  subcommandsOf,
  summaryOf,
  type CogSummary,
  type Entry,
} from "./model.js";
import { search, searchCount, suggest } from "./search.js";
import {
  FIND_MODAL_PREFIX,
  HOME,
  JUMP_PREFIX,
  clampPage,
  decode,
  decodeKey,
  findModal,
  jumpModal,
  pageCount,
  renderView,
  type View,
} from "./render.js";

function resolveCog(query: string): CogSummary | null {
  const direct = findCog(query);
  if (direct) return direct;
  const command = lookup(query.trim().replace(/^,/, ""));
  return command ? findCog(command.name) : null;
}

function stripGroup(query: string): string | null {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return resolveCog(words[0] ?? "") ? words.slice(1).join(" ") : null;
}

function groupPath(query: string): string | null {
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const head = lookup(parts[0] as string);
  if (!head) return null;

  const path = [head.name, ...parts.slice(1)].join(" ");
  return subcommandsOf(path).length > 0 ? path : null;
}

function openingOf(entry: Entry): View {
  return hasSubcommands(entry)
    ? { kind: "group", owner: pathOf(entry), page: 0 }
    : { kind: "command", name: pathOf(entry) };
}

export function viewFor(query: string): View {
  const trimmed = query.trim();
  if (!trimmed) return HOME;

  const cog = resolveCog(trimmed);
  if (cog) return { kind: "cog", cog: cog.name, page: 0 };

  const command = findCommand(trimmed);
  if (command) return openingOf(command);

  const section = findSection(trimmed);
  if (section) return { kind: "section", slug: section.slug, page: 0 };

  const nested = groupPath(trimmed);
  if (nested) return { kind: "group", owner: nested, page: 0 };

  const withoutGroup = stripGroup(trimmed);
  if (withoutGroup) {
    const grouped = findCommand(withoutGroup);
    if (grouped) return openingOf(grouped);
    const groupedSection = findSection(withoutGroup);
    if (groupedSection) return { kind: "section", slug: groupedSection.slug, page: 0 };
  }

  if (searchCount(trimmed) === 1) {
    const only = search(trimmed, 1)[0];
    if (only) return openingOf(only);
  }

  return { kind: "search", query: trimmed, page: 0 };
}

async function show(ctx: PrefixContext, view: View): Promise<void> {
  const rendered = renderView(view, ctx.authorId, await primaryPrefix(ctx.guildId));
  const sent = await ctx.reply(rendered);
  const messageId = sent?.id ? String(sent.id) : null;
  if (messageId) keepAlive(ctx.channelId, messageId, rendered.components);
}

async function handle(ctx: PrefixContext): Promise<void> {
  await show(ctx, viewFor(ctx.argument));
}

export function registerHelp(): void {
  register({
    name: "help",
    aliases: ["h", "commands", "cmds"],
    description: "Browse and search every command",
    handler: handle,
  });
}

export interface HelpInteraction {
  data?: { customId?: string; values?: string[] };
  user?: { id?: string | bigint };
  message?: { id?: string | bigint };
  channelId?: string | bigint;
  guildId?: string | bigint;
  respond: (payload: any, options?: any) => Promise<any>;
  edit: (payload: any) => Promise<any>;
  deferEdit: () => Promise<any>;
}

function armIdle(interaction: any, rendered: { components: unknown[] }): void {
  const messageId = interaction.message?.id ? String(interaction.message.id) : null;
  const channelId = interaction.channelId ? String(interaction.channelId) : null;
  if (messageId && channelId) keepAlive(channelId, messageId, rendered.components);
}

export async function handleHelpInteraction(
  interaction: HelpInteraction,
): Promise<{ deleteMessageId: string } | null> {
  const decoded = decode(String(interaction.data?.customId ?? ""));
  if (!decoded) return null;

  if (String(interaction.user?.id ?? "") !== decoded.ownerId) {
    await interaction.respond(
      { content: `That menu is not yours. Run ${commandMention("help")} to open your own.` },
      { isPrivate: true },
    );
    return null;
  }

  const { action, ownerId } = decoded;

  if (action === "close") {
    await interaction.deferEdit();
    const messageId = interaction.message?.id ? String(interaction.message.id) : null;
    if (messageId) cancel(messageId);
    return messageId ? { deleteMessageId: messageId } : null;
  }

  if (action === "find") {
    await interaction.respond(findModal(ownerId));
    return null;
  }

  if (action === "jump") {
    await interaction.respond(jumpModal(decoded.view, ownerId, pageCount(decoded.view)));
    return null;
  }

  if (action === "run") {
    const picked = (interaction.data?.values ?? [])[0];
    const name = picked
      ? String(picked)
      : decoded.view.kind === "command"
        ? decoded.view.name
        : "";
    const command = name ? (lookupPath(name) ?? lookup(name)) : undefined;

    if (!command || !canRunCommands()) {
      await interaction.respond({ content: "That command is not available." }, { isPrivate: true });
      return null;
    }

    await runCommand(interaction, command, "");
    return null;
  }

  const chosen = (interaction.data?.values ?? [])[0];
  const view = chosen ? decodeKey(String(chosen)) : stepped(action, decoded.view, decoded.page);

  const rendered = renderView(view, ownerId, await here(interaction));
  await interaction.edit(rendered);
  armIdle(interaction, rendered);
  return null;
}

async function here(interaction: { guildId?: string | bigint }): Promise<string> {
  return primaryPrefix(interaction.guildId ? String(interaction.guildId) : undefined);
}

function stepped(action: string, view: View, page: number): View {
  const targets: Record<string, number> = {
    first: 0,
    prev: page - 1,
    next: page + 1,
    last: pageCount(view) - 1,
  };
  const wanted = targets[action];
  if (wanted === undefined) return view;
  return { ...view, page: clampPage(view, wanted) } as View;
}

function typedValue(interaction: any): string {
  const rows = (interaction.data?.components ?? []) as any[];
  return String(rows[0]?.components?.[0]?.value ?? "").trim();
}

export async function handleFindModal(interaction: any): Promise<void> {
  const ownerId = String(interaction.data?.customId ?? "").slice(FIND_MODAL_PREFIX.length);
  if (String(interaction.user?.id ?? "") !== ownerId) return;

  const rendered = renderView(viewFor(typedValue(interaction)), ownerId, await here(interaction));
  await interaction.edit(rendered);
  armIdle(interaction, rendered);
}

export async function handleJumpModal(interaction: any): Promise<void> {
  const raw = String(interaction.data?.customId ?? "").slice(JUMP_PREFIX.length);
  const at = raw.lastIndexOf(":");
  if (at < 0) return;

  const ownerId = raw.slice(at + 1);
  if (String(interaction.user?.id ?? "") !== ownerId) return;

  const base = decodeKey(raw.slice(0, at));
  const wanted = Number.parseInt(typedValue(interaction), 10);
  if (!Number.isFinite(wanted)) return;

  const view = { ...base, page: clampPage(base, wanted - 1) } as View;
  const rendered = renderView(view, ownerId, await here(interaction));
  await interaction.edit(rendered);
  armIdle(interaction, rendered);
}

export function helpChoices(query: string): { name: string; value: string }[] {
  return suggest(query).map((entry) => {
    const label = `${pathOf(entry)} — ${summaryOf(entry)}`;
    return { name: label.slice(0, 100), value: pathOf(entry) };
  });
}
