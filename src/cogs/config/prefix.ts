import { groupUnder, lookupIn, register, type PrefixContext } from "../../core/prefix.js";
import { notice, requireGuild, requireManageGuild } from "../../core/permissions.js";
import {
  DEFAULT_PREFIX,
  MAX_PREFIXES,
  addPrefix,
  checkPrefix,
  customPrefixes,
  primaryPrefix,
  removePrefix,
  resetPrefixes,
  setPrefixes,
} from "../../core/prefixes.js";

const HEADING = "Prefixes";

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

function chips(prefixes: string[]): string {
  return prefixes.map((prefix) => `\`${prefix}\``).join(" · ");
}

function counted(prefixes: string[]): string {
  return `${prefixes.length} prefix${prefixes.length === 1 ? "" : "es"}`;
}

async function effective(guildId: string): Promise<string[]> {
  const stored = await customPrefixes(guildId);
  return stored.length ? stored : [DEFAULT_PREFIX];
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

async function usage(ctx: PrefixContext, guildId: string, lead: string): Promise<void> {
  const here = await primaryPrefix(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      lead,
      "",
      `\`${here}prefix list\` shows them`,
      `\`${here}prefix add <prefix>\` adds one`,
      `\`${here}prefix remove <prefix>\` takes one away`,
      `\`${here}prefix set <prefix>\` replaces every prefix with it`,
      `\`${here}prefix reset\` goes back to \`${DEFAULT_PREFIX}\``,
      "",
      "-# Changing them needs **Manage Server**. Mentioning the bot always works.",
    ].join("\n"),
  );
}

async function current(
  ctx: PrefixContext,
): Promise<{ guildId: string; lead: string } | null> {
  const guildId = await requireGuild(ctx, "see the server's prefixes");
  if (!guildId) return null;

  const stored = await customPrefixes(guildId);
  const live = stored.length ? stored : [DEFAULT_PREFIX];
  const lead = stored.length
    ? `${chips(live)}\n-# ${counted(live)} in this server`
    : `${chips(live)}\n-# The default, nothing custom set yet`;

  return { guildId, lead };
}

async function showList(ctx: PrefixContext): Promise<void> {
  const found = await current(ctx);
  if (!found) return;
  await usage(ctx, found.guildId, found.lead);
}

async function onlyList(ctx: PrefixContext): Promise<void> {
  const found = await current(ctx);
  if (!found) return;
  await card(ctx, [`### ${HEADING}`, found.lead].join("\n"));
}

function invalid(given: string[], reasons: string[]): string {
  return [
    `### Bad prefix`,
    reasons.join("\n"),
    "",
    `-# Given: ${given.map((value) => `\`${value.slice(0, 20)}\``).join(" ")}`,
  ].join("\n");
}

function collect(argument: string): { good: string[]; bad: string[] } {
  const good: string[] = [];
  const bad: string[] = [];

  for (const candidate of words(argument)) {
    const checked = checkPrefix(candidate);
    if (checked.ok) good.push(checked.prefix);
    else bad.push(`\`${candidate.slice(0, 20)}\` — ${checked.reason}`);
  }
  return { good, bad };
}

async function doAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "add a prefix");
  if (!guildId) return;

  if (!ctx.argument.trim()) {
    await usage(ctx, guildId, "Tell me which prefix to add.");
    return;
  }

  const { good, bad } = collect(ctx.argument);
  if (good.length === 0) {
    await card(ctx, invalid(words(ctx.argument), bad));
    return;
  }

  const added: string[] = [];
  const already: string[] = [];
  let full = false;

  for (const prefix of good) {
    const outcome = await addPrefix(guildId, prefix, ctx.authorId);
    if (outcome === "added") added.push(prefix);
    else if (outcome === "exists") already.push(prefix);
    else full = true;
  }

  const live = await effective(guildId);
  const lines = [`### ${added.length ? "Prefix added" : HEADING}`];

  if (added.length) lines.push(`${chips(added)} ${added.length === 1 ? "now works" : "now work"} here.`);
  if (already.length) lines.push(`${chips(already)} was already set.`);
  if (full) lines.push(`Could not add the rest, this server is at the ${MAX_PREFIXES} prefix limit.`);
  if (bad.length) lines.push("", bad.join("\n"));

  lines.push("", `-# ${counted(live)}: ${chips(live)}`);
  await card(ctx, lines.join("\n"));
}

async function doRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove a prefix");
  if (!guildId) return;

  if (!ctx.argument.trim()) {
    await usage(ctx, guildId, "Tell me which prefix to remove.");
    return;
  }

  const stored = await customPrefixes(guildId);
  if (stored.length === 0) {
    await usage(
      ctx,
      guildId,
      `Nothing custom to remove, this server is on the default \`${DEFAULT_PREFIX}\`.`,
    );
    return;
  }

  const removed: string[] = [];
  const missing: string[] = [];

  for (const candidate of words(ctx.argument)) {
    if (await removePrefix(guildId, candidate)) removed.push(candidate);
    else missing.push(candidate);
  }

  const live = await effective(guildId);
  const lines = [`### ${removed.length ? "Prefix removed" : HEADING}`];

  if (removed.length) lines.push(`${chips(removed)} no longer works here.`);
  if (missing.length) lines.push(`${chips(missing)} was not a prefix here.`);
  if (removed.length && (await customPrefixes(guildId)).length === 0) {
    lines.push(`That was the last one, so the server is back on the default \`${DEFAULT_PREFIX}\`.`);
  }

  lines.push("", `-# ${counted(live)}: ${chips(live)}`);
  await card(ctx, lines.join("\n"));
}

async function doSet(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the server's prefix");
  if (!guildId) return;

  if (!ctx.argument.trim()) {
    await usage(ctx, guildId, "Tell me what to set the prefix to.");
    return;
  }

  const { good, bad } = collect(ctx.argument);
  if (good.length === 0) {
    await card(ctx, invalid(words(ctx.argument), bad));
    return;
  }

  const kept = good.slice(0, MAX_PREFIXES);
  await setPrefixes(guildId, kept, ctx.authorId);

  const lines = [
    `### Prefix set`,
    kept.length === 1
      ? `${chips(kept)} is now the only prefix here.`
      : `${chips(kept)} are now the prefixes here.`,
  ];
  if (bad.length) lines.push("", bad.join("\n"));
  lines.push("", `-# ${counted(kept)} · \`${kept[kept.length - 1]}prefix reset\` restores \`${DEFAULT_PREFIX}\``);

  await card(ctx, lines.join("\n"));
}

async function doReset(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "reset the server's prefixes");
  if (!guildId) return;

  const cleared = await resetPrefixes(guildId);
  await card(
    ctx,
    [
      `### ${cleared ? "Prefixes reset" : HEADING}`,
      cleared
        ? `Cleared ${cleared} custom prefix${cleared === 1 ? "" : "es"}.`
        : "Nothing custom was set.",
      `This server is on the default \`${DEFAULT_PREFIX}\`.`,
    ].join("\n"),
  );
}

async function handle(ctx: PrefixContext): Promise<void> {
  const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
  if (!sub) {
    await showList(ctx);
    return;
  }

  const command = lookupIn("prefix", sub);
  if (command && command.name !== "prefix") {
    await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
    return;
  }

  const guildId = ctx.guildId;
  if (!guildId) {
    await showList(ctx);
    return;
  }
  await usage(ctx, guildId, `There is no \`prefix ${sub.slice(0, 20)}\` subcommand.`);
}

export function registerPrefix(): void {
  register({
    name: "prefix",
    aliases: ["prefixes"],
    description: "Show and change the prefixes this server answers to",
    handler: handle,
  });

  groupUnder("prefix", () => {
    register({
      name: "list",
      aliases: ["show", "ls"],
      description: "List every prefix this server answers to",
      handler: onlyList,
    });

    register({
      name: "add",
      aliases: ["new", "+"],
      description: "Add another prefix to this server",
      handler: doAdd,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm", "-"],
      description: "Remove a prefix from this server",
      handler: doRemove,
    });

    register({
      name: "set",
      aliases: ["only"],
      description: "Replace every prefix with the one you give",
      handler: doSet,
    });

    register({
      name: "reset",
      aliases: ["default", "clear"],
      description: "Go back to the default prefix",
      handler: doReset,
    });
  });
}
