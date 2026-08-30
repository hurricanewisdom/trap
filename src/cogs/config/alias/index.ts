import { onUnmatchedCommand } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import { primaryPrefix } from "../../../core/prefixes.js";
import {
  groupUnder,
  lookup,
  lookupIn,
  register,
  split,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import {
  MAX_ALIASES,
  addAlias,
  aliasesFor,
  countAliases,
  dropAlias,
  dropForCommand,
  listAliases,
  resetAliases,
  targetOf,
} from "./store.js";

const HEADING = "Aliases";

const SHORTCUT = /^[^\s`]{1,32}$/;

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

export interface Resolved {
  command: string;
  rest: string;
}

export function resolveTarget(target: string): Resolved | { error: string } {
  const { name, argument } = split(target);
  if (!name) return { error: "Tell me which command the shortcut should run." };

  const head = lookup(name);
  if (!head) return { error: `\`${name.slice(0, 30)}\` is not a command.` };

  if (head.groupedUnder) {
    return { error: `\`${name}\` lives under \`${head.groupedUnder}\`, so point at \`${head.groupedUnder} ${head.name}\` instead.` };
  }

  return { command: head.name, rest: argument.trim() };
}

function full(resolved: Resolved): string {
  return resolved.rest ? `${resolved.command} ${resolved.rest}` : resolved.command;
}

async function usage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "manage the server's aliases");
  if (!guildId) return;

  const count = await countAliases(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      "A shortcut is one word this server treats as another command.",
      "",
      "`alias add <shortcut> <command>` makes one",
      "`alias remove <shortcut>` deletes it",
      "`alias removeall <command>` deletes every shortcut for a command",
      "`alias view <shortcut>` shows what it runs",
      "`alias list` shows them all",
      "`alias reset` clears every one",
      "",
      `-# ${count} alias${count === 1 ? "" : "es"} of ${MAX_ALIASES} · a shortcut never overrides a real command.`,
    ].join("\n"),
  );
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "add an alias");
  if (!guildId) return;

  const { name: shortcut, argument: target } = split(ctx.argument);
  const word = shortcut.toLowerCase();

  if (!word || !target.trim()) {
    await card(ctx, [`### ${HEADING}`, "Use `alias add <shortcut> <command>`."].join("\n"));
    return;
  }

  if (!SHORTCUT.test(word)) {
    await card(
      ctx,
      [`### ${HEADING}`, "A shortcut is one word, at most 32 characters, with no backtick."].join("\n"),
    );
    return;
  }

  const taken = lookup(word);
  if (taken) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `\`${word}\` is already a command${taken.groupedUnder ? ` under \`${taken.groupedUnder}\`` : ""}.`,
        "-# A shortcut can never override a real command, so pick another word.",
      ].join("\n"),
    );
    return;
  }

  const resolved = resolveTarget(target);
  if ("error" in resolved) {
    await card(ctx, [`### ${HEADING}`, resolved.error].join("\n"));
    return;
  }

  const existing = await targetOf(guildId, word);
  if (!existing && (await countAliases(guildId)) >= MAX_ALIASES) {
    await card(
      ctx,
      [`### ${HEADING}`, `This server is at its limit of ${MAX_ALIASES} aliases.`].join("\n"),
    );
    return;
  }

  await addAlias(guildId, word, full(resolved), ctx.authorId);
  const here = await primaryPrefix(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `\`${here}${word}\` now runs \`${here}${full(resolved)}\`.`,
      existing ? `-# It used to run \`${here}${existing}\`.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove an alias");
  if (!guildId) return;

  const word = (words(ctx.argument)[0] ?? "").toLowerCase();
  if (!word) {
    await card(ctx, [`### ${HEADING}`, "Use `alias remove <shortcut>`."].join("\n"));
    return;
  }

  const gone = await dropAlias(guildId, word);
  await card(
    ctx,
    [`### ${HEADING}`, gone ? `\`${word}\` is gone.` : `\`${word}\` is not an alias here.`].join("\n"),
  );
}

async function removeAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove a command's aliases");
  if (!guildId) return;

  const target = ctx.argument.trim();
  if (!target) {
    await card(ctx, [`### ${HEADING}`, "Use `alias removeall <command>`."].join("\n"));
    return;
  }

  const resolved = resolveTarget(target);
  const wanted = "error" in resolved ? target.toLowerCase() : full(resolved);
  const dropped = await dropForCommand(guildId, wanted);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      dropped.length
        ? `Removed ${dropped.length} alias${dropped.length === 1 ? "" : "es"} for \`${wanted}\`: ${dropped.map((s) => `\`${s}\``).join(" ")}`
        : `Nothing points at \`${wanted}\`.`,
    ].join("\n"),
  );
}

async function view(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "view an alias");
  if (!guildId) return;

  const word = (words(ctx.argument)[0] ?? "").toLowerCase();
  if (!word) {
    await card(ctx, [`### ${HEADING}`, "Use `alias view <shortcut>`."].join("\n"));
    return;
  }

  const target = await targetOf(guildId, word);
  if (!target) {
    await card(ctx, [`### ${HEADING}`, `\`${word}\` is not an alias here.`].join("\n"));
    return;
  }

  const resolved = resolveTarget(target);
  const here = await primaryPrefix(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `\`${here}${word}\` runs \`${here}${target}\`.`,
      "",
      "error" in resolved
        ? `-# That command no longer exists: ${resolved.error}`
        : `-# Anything after \`${here}${word}\` is passed along, so \`${here}${word} radiohead\` runs \`${here}${target} radiohead\`.`,
    ].join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the aliases");
  if (!guildId) return;

  const rows = await listAliases(guildId);
  if (rows.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No aliases are set."].join("\n"));
    return;
  }

  const here = await primaryPrefix(guildId);
  const width = rows.reduce((widest, row) => Math.max(widest, row.shortcut.length + here.length), 0);
  const shown = rows.slice(0, 40);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "```",
      shown.map((row) => `${(here + row.shortcut).padEnd(width)}  ${here}${row.command}`).join("\n"),
      "```",
      `-# ${rows.length} alias${rows.length === 1 ? "" : "es"}${rows.length > shown.length ? `, showing ${shown.length}` : ""}`,
    ].join("\n"),
  );
}

async function reset(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "reset the aliases");
  if (!guildId) return;

  const cleared = await resetAliases(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      cleared ? `Cleared ${cleared} alias${cleared === 1 ? "" : "es"}.` : "There were none to clear.",
    ].join("\n"),
  );
}

function dispatcher(fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const command = sub ? lookupIn("alias", sub) : undefined;

    if (command) {
      await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerAlias(): void {
  onUnmatchedCommand(async (name, ctx) => {
    if (!ctx.guildId) return null;

    const target = (await aliasesFor(ctx.guildId)).get(name.toLowerCase());
    if (!target) return null;

    const { name: head, argument: preset } = split(target);
    const command = lookup(head);
    if (!command || command.groupedUnder) return null;

    return async (inner) => {
      const argument = [preset, inner.argument].filter(Boolean).join(" ").trim();
      await command.handler({ ...inner, argument });
    };
  });

  register({
    name: "alias",
    aliases: ["aliases", "shortcut"],
    description: "Make one word run another command",
    handler: dispatcher(usage),
  });

  groupUnder("alias", () => {
    register({
      name: "add",
      aliases: ["create", "set"],
      description: "Make a shortcut run a command",
      handler: add,
    });

    register({
      name: "remove",
      aliases: ["delete", "rm"],
      description: "Delete one shortcut",
      handler: remove,
    });

    register({
      name: "removeall",
      aliases: ["clear"],
      description: "Delete every shortcut pointing at a command",
      handler: removeAll,
    });

    register({
      name: "view",
      description: "Show what a shortcut runs",
      handler: view,
    });

    register({
      name: "list",
      description: "Every shortcut in this server",
      handler: list,
    });

    register({
      name: "reset",
      description: "Clear every shortcut",
      handler: reset,
    });
  });
}
