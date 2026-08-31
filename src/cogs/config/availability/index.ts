import { EVENTS, PROTECTED, provideAvailability } from "../../../core/availability.js";
import { loadedCogs } from "../../../core/cog.js";
import { notice, requireManageChannels } from "../../../core/permissions.js";
import {
  allCommands,
  groupUnder,
  lookup,
  lookupPath,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import {
  EVERYWHERE,
  blocks,
  copy,
  disable,
  enable,
  listing,
  rules,
  type Kind,
} from "./store.js";

const HEADING = "Availability";

const CHANNEL = /^<#(\d{15,25})>$/;

const MEMBER = /^<@!?(\d{15,25})>$/;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

function modules(): string[] {
  return loadedCogs().map((cog) => cog.name);
}

function targetOf(token: string | undefined): { id: string; kind: "channel" | "member" } | null {
  if (!token) return null;

  const channel = CHANNEL.exec(token);
  if (channel) return { id: channel[1] as string, kind: "channel" };

  const member = MEMBER.exec(token);
  if (member) return { id: member[1] as string, kind: "member" };

  return null;
}

function shows(target: string): string {
  if (target === EVERYWHERE) return "**every channel**";
  return `<#${target}>`;
}

function resolveCommand(name: string): { name: string; label: string; owner?: string } | null {
  const typed = name.trim().replace(/^,/, "").toLowerCase();
  if (!typed) return null;

  const command = lookupPath(typed) ?? lookup(typed);
  if (!command) return null;

  if (command.groupedUnder) {
    return { name: command.name, label: `,${command.groupedUnder} ${command.name}`, owner: command.groupedUnder };
  }
  return { name: command.name, label: `,${command.name}` };
}

function ownedNote(found: { label: string; owner?: string }): string {
  const top = (found.owner ?? "").split(" ")[0] ?? "";
  return [
    `### ${HEADING}`,
    `\`${found.label}\` is a subcommand, and only whole commands can be switched off.`,
    "",
    `-# Switch off \`,${top}\` to cover it.`,
  ].join("\n");
}

function protectedNote(name: string): string {
  return [
    `### ${HEADING}`,
    `\`,${name}\` cannot be switched off.`,
    "",
    "-# Turning off the commands that turn things back on would lock the server out.",
  ].join("\n");
}

async function report(ctx: PrefixContext, kind: Kind, label: string): Promise<void> {
  const guildId = await requireManageChannels(ctx, `see the disabled ${label}`);
  if (!guildId) return;

  const held = await listing(guildId, kind);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, `No ${label} are switched off here.`].join("\n"));
    return;
  }

  const byName = new Map<string, string[]>();
  for (const rule of held) {
    byName.set(rule.name, [...(byName.get(rule.name) ?? []), rule.target]);
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Disabled ${label}`,
      "",
      [...byName.entries()]
        .slice(0, 20)
        .map(([name, targets]) => `\`${name}\`\n-# ${targets.map(shows).join(" · ")}`)
        .join("\n"),
      "",
      `-# ${byName.size} ${byName.size === 1 ? "entry" : "entries"}${byName.size > 20 ? ", showing the first 20" : ""}`,
    ].join("\n"),
  );
}

interface Spec {
  kind: Kind;
  noun: string;
  plural: string;
  takesMember: boolean;
  resolve: (value: string) => { name: string; label: string } | null;
  choices: () => string[];
}

const SPECS: Spec[] = [
  {
    kind: "command",
    noun: "command",
    plural: "commands",
    takesMember: true,
    resolve: resolveCommand,
    choices: () =>
      allCommands()
        .filter((command) => !command.groupedUnder)
        .map((command) => command.name)
        .sort()
        .slice(0, 12),
  },
  {
    kind: "module",
    noun: "module",
    plural: "modules",
    takesMember: false,
    resolve: (value) => {
      const wanted = value.trim().toLowerCase();
      const found = modules().find((name) => name === wanted);
      return found ? { name: found, label: found } : null;
    },
    choices: modules,
  },
  {
    kind: "event",
    noun: "event",
    plural: "events",
    takesMember: false,
    resolve: (value) => {
      const wanted = value.trim().toLowerCase();
      const found = EVENTS.find((event) => event.name === wanted);
      return found ? { name: found.name, label: found.name } : null;
    },
    choices: () => EVENTS.map((event) => event.name),
  },
];

function unknown(spec: Spec, typed: string): string {
  return [
    `### ${HEADING}`,
    `I do not know the ${spec.noun} \`${typed.slice(0, 40)}\`.`,
    "",
    `-# ${spec.plural}: ${spec.choices().map((name) => `\`${name}\``).join(" · ")}`,
  ].join("\n");
}

function build(spec: Spec, off: boolean): void {
  const verb = off ? "disable" : "enable";
  const command = `${verb}${spec.noun}`;

  const everywhere = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `${verb} a ${spec.noun} everywhere`);
    if (!guildId) return;

    const typed = ctx.argument.trim();
    if (!typed) {
      await card(ctx, [`### ${HEADING}`, `Which ${spec.noun}?`, "", `-# \`${command} all <${spec.noun}>\``].join("\n"));
      return;
    }

    const found = spec.resolve(typed);
    if (!found) {
      await card(ctx, unknown(spec, typed));
      return;
    }
    if (spec.kind === "command" && (found as { owner?: string }).owner) {
      await card(ctx, ownedNote(found as { label: string; owner?: string }));
      return;
    }
    if (spec.kind === "command" && PROTECTED.has(found.name)) {
      await card(ctx, protectedNote(found.name));
      return;
    }

    if (off) {
      await enable(guildId, spec.kind, found.name, EVERYWHERE);
      await disable(guildId, spec.kind, found.name, EVERYWHERE);
      await card(ctx, [`### ${HEADING}`, `\`${found.label}\` is off in **every channel**.`].join("\n"));
      return;
    }

    const gone = await enable(guildId, spec.kind, found.name, EVERYWHERE);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        gone === 0
          ? `\`${found.label}\` was already on everywhere.`
          : `\`${found.label}\` is on again everywhere.`,
      ].join("\n"),
    );
  };

  const main = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, `${verb} a ${spec.noun}`);
    if (!guildId) return;

    const parts = words(ctx.argument);
    const target = targetOf(parts[0]);
    if (!target) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          spec.takesMember
            ? `Give me a channel or a member, then the ${spec.noun}.`
            : `Give me a channel, then the ${spec.noun}.`,
          "",
          `-# \`${command} ${spec.takesMember ? "<#channel or @member>" : "<#channel>"} <${spec.noun}>\``,
          `-# \`${command} all <${spec.noun}>\` covers every channel.`,
        ].join("\n"),
      );
      return;
    }
    if (target.kind === "member" && !spec.takesMember) {
      await card(ctx, [`### ${HEADING}`, `A ${spec.noun} is switched off per channel, not per member.`].join("\n"));
      return;
    }

    const typed = parts.slice(1).join(" ");
    const found = typed ? spec.resolve(typed) : null;
    if (!found) {
      await card(ctx, typed ? unknown(spec, typed) : [`### ${HEADING}`, `Which ${spec.noun}?`].join("\n"));
      return;
    }
    if (spec.kind === "command" && (found as { owner?: string }).owner) {
      await card(ctx, ownedNote(found as { label: string; owner?: string }));
      return;
    }
    if (spec.kind === "command" && PROTECTED.has(found.name)) {
      await card(ctx, protectedNote(found.name));
      return;
    }

    const where = target.kind === "member" ? `<@${target.id}>` : `<#${target.id}>`;
    if (off) {
      const made = await disable(guildId, spec.kind, found.name, target.id);
      await card(
        ctx,
        [
          `### ${HEADING}`,
          made
            ? `\`${found.label}\` is off in ${where}.`
            : `\`${found.label}\` was already off in ${where}.`,
        ].join("\n"),
      );
      return;
    }

    const gone = await enable(guildId, spec.kind, found.name, target.id);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        gone === 0
          ? `\`${found.label}\` was not off in ${where}.`
          : `\`${found.label}\` is on again in ${where}.`,
      ].join("\n"),
    );
  };

  const handler: PrefixHandler = async (ctx) => {
    const first = words(ctx.argument)[0]?.toLowerCase() ?? "";
    if (first === "all") {
      await everywhere({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    if (off && first === "list") {
      await report(ctx, spec.kind, spec.plural);
      return;
    }
    await main(ctx);
  };

  register({
    name: command,
    description: off ? `Turn a ${spec.noun} off in a channel` : `Turn a ${spec.noun} back on`,
    handler,
  });

  groupUnder(command, () => {
    register({
      name: "all",
      description: off ? `Turn a ${spec.noun} off everywhere` : `Turn a ${spec.noun} on everywhere`,
      handler: everywhere,
    });

    if (off) {
      register({
        name: "list",
        description: `Every ${spec.noun} switched off here`,
        handler: (ctx) => report(ctx, spec.kind, spec.plural),
      });
    }
  });
}

async function copyDisabled(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageChannels(ctx, "copy what is switched off");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const from = targetOf(parts[0]);
  const to = targetOf(parts[1]);

  if (!from || !to || from.kind !== "channel" || to.kind !== "channel") {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give me the channel to copy from, then the one to copy to.",
        "",
        "-# `copydisabled <#from> <#to>`",
      ].join("\n"),
    );
    return;
  }
  if (from.id === to.id) {
    await card(ctx, [`### ${HEADING}`, "Those are the same channel."].join("\n"));
    return;
  }

  const { found, made } = await copy(guildId, from.id, to.id);
  const outcome =
    found === 0
      ? `Nothing is switched off in <#${from.id}>, so there was nothing to copy.`
      : made === 0
        ? `All ${found} of them are already switched off in <#${to.id}>.`
        : `Copied ${made} of ${found} from <#${from.id}> to <#${to.id}>.`;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      outcome,
      "",
      "-# Commands, modules and events. Anything already off there is left alone.",
    ].join("\n"),
  );
}

export function registerAvailability(): void {
  provideAvailability({
    async command(guildId, channelId, userId, name, cog) {
      const held = await rules(guildId);
      if (held.length === 0) return false;

      const targets = [channelId, userId, EVERYWHERE];
      return blocks(held, "command", name, targets) || blocks(held, "module", cog, targets);
    },
    async event(guildId, channelId, name) {
      const held = await rules(guildId);
      if (held.length === 0) return false;
      return blocks(held, "event", name, [channelId, EVERYWHERE]);
    },
  });

  for (const spec of SPECS) {
    build(spec, true);
    build(spec, false);
  }

  register({
    name: "copydisabled",
    description: "Copy what is switched off from one channel to another",
    handler: copyDisabled,
  });
}
