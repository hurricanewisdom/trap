import { guildRoles, type Role } from "../../../core/discord.js";
import { GRANTABLE, grantableFor, provideFakePermissions } from "../../../core/fakeperms.js";
import { notice, requireOwner } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { MAX_GRANTS, all, forRole, grant, reset as wipe, revoke } from "./store.js";

const HEADING = "Fake permissions";

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function findRole(guildId: string, token: string): Promise<Role | null> {
  const roles = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return roles.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return roles.find((role) => role.name.toLowerCase() === needle) ?? null;
}

function names(): string {
  return GRANTABLE.map((one) => `\`${one.name}\``).join(" · ");
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "set up fake permissions");
  if (!guildId) return;

  const held = await all(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Let a role use my commands without holding the real permission on Discord.",
      "",
      "`fakepermissions add <role> <permission>` grants one",
      "`fakepermissions remove <role> <permission>` takes it back",
      "`fakepermissions list <role>` shows what a role has",
      "`fakepermissions reset` clears everything",
      "",
      `**Grantable** ${names()}`,
      "",
      "-# This only changes what my commands allow. Nobody gains anything on Discord itself.",
      "-# Owner only, and it stays owner only: a fake permission can never reach this command.",
      `-# ${held.length} of ${MAX_GRANTS} granted here.`,
    ].join("\n"),
  );
}

function editor(adding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireOwner(
      ctx,
      adding ? "grant a fake permission" : "remove a fake permission",
    );
    if (!guildId) return;

    const parts = words(ctx.argument);
    if (parts.length < 2) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          "Give me a role and a permission.",
          "",
          `-# \`fakepermissions ${adding ? "add" : "remove"} <role> <permission>\``,
          `-# ${names()}`,
        ].join("\n"),
      );
      return;
    }

    const wanted = grantableFor(parts[parts.length - 1] as string);
    if (!wanted) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          `I do not hand out \`${(parts[parts.length - 1] as string).slice(0, 30)}\`.`,
          "",
          `-# ${names()}`,
        ].join("\n"),
      );
      return;
    }

    const role = await findRole(guildId, parts.slice(0, -1).join(" "));
    if (!role) {
      await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
      return;
    }
    if (role.id === guildId) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          "`@everyone` would hand that to the whole server.",
          "",
          "-# Grant it to a role people are actually given.",
        ].join("\n"),
      );
      return;
    }

    if (adding) {
      if ((await all(guildId)).length >= MAX_GRANTS) {
        await card(ctx, [`### ${HEADING}`, `That is the ${MAX_GRANTS} grant limit.`].join("\n"));
        return;
      }
      const made = await grant(guildId, role.id, wanted.name);
      await card(
        ctx,
        [
          `### ${HEADING}`,
          made
            ? `<@&${role.id}> can now use my commands that need \`${wanted.name}\`.`
            : `<@&${role.id}> already had \`${wanted.name}\`.`,
          made ? `-# ${wanted.describes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }

    const gone = await revoke(guildId, role.id, wanted.name);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        gone
          ? `<@&${role.id}> no longer has \`${wanted.name}\`.`
          : `<@&${role.id}> did not have \`${wanted.name}\`.`,
      ].join("\n"),
    );
  };
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "list the fake permissions");
  if (!guildId) return;

  const typed = ctx.argument.trim();
  if (typed) {
    const role = await findRole(guildId, typed);
    if (!role) {
      await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
      return;
    }
    const held = await forRole(guildId, role.id);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `<@&${role.id}>`,
        "",
        held.length ? held.map((one) => `\`${one}\``).join(" · ") : "Nothing granted.",
      ].join("\n"),
    );
    return;
  }

  const held = await all(guildId);
  if (held.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, "Nothing is granted here.", "", "-# `fakepermissions add <role> <permission>`"].join("\n"),
    );
    return;
  }

  const byRole = new Map<string, string[]>();
  for (const one of held) byRole.set(one.roleId, [...(byRole.get(one.roleId) ?? []), one.permission]);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      [...byRole.entries()]
        .slice(0, 20)
        .map(([roleId, perms]) => `<@&${roleId}>\n-# ${perms.map((p) => `\`${p}\``).join(" · ")}`)
        .join("\n"),
      "",
      `-# ${held.length} of ${MAX_GRANTS} across ${byRole.size} role${byRole.size === 1 ? "" : "s"}`,
    ].join("\n"),
  );
}

async function resetAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "clear the fake permissions");
  if (!guildId) return;

  const gone = await wipe(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone === 0 ? "There was nothing to clear." : `Cleared ${gone} grant${gone === 1 ? "" : "s"}.`,
      "-# Real Discord permissions are untouched, because they always were.",
    ].join("\n"),
  );
}

export function registerFakePermissions(): void {
  provideFakePermissions(async (guildId, roleIds) => {
    const held = await all(guildId);
    if (held.length === 0) return 0n;

    const mine = new Set(roleIds);
    let bits = 0n;
    for (const one of held) {
      if (!mine.has(one.roleId)) continue;
      const found = grantableFor(one.permission);
      if (found) bits |= found.bit;
    }
    return bits;
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("fakepermissions", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "fakepermissions",
    aliases: ["fakeperms", "fp"],
    description: "Let a role use my commands without the real permission",
    handler,
  });

  groupUnder("fakepermissions", () => {
    register({ name: "add", aliases: ["grant"], description: "Grant a fake permission to a role", handler: editor(true) });
    register({ name: "remove", aliases: ["revoke", "rm"], description: "Take a fake permission back", handler: editor(false) });
    register({ name: "list", aliases: ["all"], description: "What a role has been granted", handler: list });
    register({ name: "reset", aliases: ["clear"], description: "Clear every fake permission", handler: resetAll });
  });
}
