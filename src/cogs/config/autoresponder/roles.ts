import { botCanManage } from "./gate.js";
import { requireManageChannels } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import {
  HEADING,
  card,
  findRole,
  missing,
  needTrigger,
  roleList,
  shown,
  words,
} from "./shared.js";
import { one, toggleRole } from "./store.js";

interface Side {
  action: "add" | "remove";
  verb: string;
  usage: string;
}

const SIDES: Side[] = [
  { action: "add", verb: "given", usage: "autoresponder role add <role> <trigger>" },
  { action: "remove", verb: "taken away", usage: "autoresponder role remove <role> <trigger>" },
];

function held(side: Side, roles: { give: string[]; take: string[] }): string[] {
  return side.action === "add" ? roles.give : roles.take;
}

function build(side: Side): void {
  const list = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, "see the autoresponder roles");
    if (!guildId) return;

    const trigger = ctx.argument.trim();
    if (!trigger) {
      await card(ctx, needTrigger(`${side.usage.replace("<role> ", "")} list <trigger>`));
      return;
    }

    const responder = await one(guildId, trigger);
    if (!responder) {
      await card(ctx, missing(trigger));
      return;
    }

    const ids = held(side, responder);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `Roles ${side.verb} on ${shown(responder.trigger)}`,
        "",
        ids.length ? roleList(ids) : "None yet.",
      ].join("\n"),
    );
  };

  const main = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageChannels(ctx, "change the autoresponder roles");
    if (!guildId) return;

    const parts = words(ctx.argument);
    if (parts.length < 2) {
      await card(ctx, [`### ${HEADING}`, "Give me a role and a trigger.", "", `-# \`${side.usage}\``].join("\n"));
      return;
    }

    const trigger = parts.slice(1).join(" ");
    const responder = await one(guildId, trigger);
    if (!responder) {
      await card(ctx, missing(trigger));
      return;
    }

    const role = await findRole(guildId, parts[0] as string);
    if (!role) {
      await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
      return;
    }

    const blocked = await botCanManage(guildId, role);
    if (blocked) {
      await card(ctx, [`### ${HEADING}`, blocked].join("\n"));
      return;
    }

    const outcome = await toggleRole(guildId, responder.trigger, role.id, side.action);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        outcome === "added"
          ? `<@&${role.id}> is now ${side.verb} on ${shown(responder.trigger)}.`
          : `<@&${role.id}> is no longer ${side.verb} on ${shown(responder.trigger)}.`,
      ].join("\n"),
    );
  };

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    if (sub === "list") {
      await list({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await main(ctx);
  };

  register({
    name: side.action,
    description: `Roles ${side.verb} when a trigger fires`,
    handler,
  });

  groupUnder(`autoresponder role ${side.action}`, () => {
    register({
      name: "list",
      description: `Roles ${side.verb} on a trigger`,
      handler: list,
    });
  });
}

export function registerRoles(): void {
  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("autoresponder role", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }

    const guildId = await requireManageChannels(ctx, "change the autoresponder roles");
    if (!guildId) return;

    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give or take a role when a trigger fires.",
        "",
        "`autoresponder role add <role> <trigger>` gives one",
        "`autoresponder role remove <role> <trigger>` takes one",
        "`autoresponder role add list <trigger>` shows what is given",
        "`autoresponder role remove list <trigger>` shows what is taken",
        "",
        "-# The bot needs Manage Roles, and its own role above the one it hands out.",
      ].join("\n"),
    );
  };

  register({
    name: "role",
    aliases: ["roles"],
    description: "Give or take roles when a trigger fires",
    handler,
  });

  groupUnder("autoresponder role", () => {
    for (const side of SIDES) build(side);
  });
}
