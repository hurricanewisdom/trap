import type { CommandFlag } from "../../../helpers/flags.js";
import type { Role } from "../../../core/discord.js";

import {
  PERMISSION,
  botCeiling,
  giveRole,
  guildRoles,
  memberOf,
} from "../../../core/discord.js";
import { onMemberJoin } from "../../../core/hooks.js";
import { notice, requireManageRoles } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { parseFlags, unknownFlags } from "../../../helpers/flags.js";
import {
  MAX_ROLES,
  addRole,
  autoRoles,
  clearRoles,
  removeRole,
  type Targets,
} from "./store.js";

const HEADING = "Autorole";

const REASON = "Autorole";

const ROLE_MENTION = /^<@&(\d{15,25})>$/;

const HUMANS: CommandFlag = {
  name: "humans",
  description: "Only give it to people, never to bots.",
  aliases: ["human", "people"],
};

const BOTS: CommandFlag = {
  name: "bots",
  description: "Only give it to bots, never to people.",
  aliases: ["bot"],
};

const FLAGS = [HUMANS, BOTS];

/**
 * Permissions nobody should hand to an unknown account on sight.
 *
 * Administrator is refused outright: auto-granting it means the next person
 * through the door owns the server. The rest are allowed but said out loud,
 * because there are real uses for them and the person running this already
 * holds Manage Roles.
 */
const LOUD: [string, bigint][] = [
  ["Manage Server", PERMISSION.manageGuild],
  ["Manage Roles", PERMISSION.manageRoles],
  ["Manage Channels", PERMISSION.manageChannels],
  ["Ban Members", PERMISSION.banMembers],
  ["Kick Members", PERMISSION.kickMembers],
  ["Manage Webhooks", PERMISSION.manageWebhooks],
];

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

async function findRole(guildId: string, token: string): Promise<Role | null> {
  const roles = await guildRoles(guildId);
  const mention = ROLE_MENTION.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return roles.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return roles.find((role) => role.name.toLowerCase() === needle) ?? null;
}

function loudPermissions(role: Role): string[] {
  const bits = BigInt(role.permissions || "0");
  return LOUD.filter(([, bit]) => (bits & bit) !== 0n).map(([label]) => label);
}

function describe(targets: Targets): string {
  if (targets === "humans") return " (people only)";
  if (targets === "bots") return " (bots only)";
  return "";
}

/**
 * The list, rendered once and reused by every command that shows it.
 *
 * It names roles that have since been deleted rather than hiding them, because
 * a silently shrinking list looks like the feature forgot the setting.
 */
async function listBody(guildId: string, lead: string): Promise<string> {
  const held = await autoRoles(guildId);
  if (held.length === 0) {
    return [
      `### ${HEADING}`,
      lead,
      "",
      "`autorole add <role>` starts handing one out",
    ].join("\n");
  }

  const roles = await guildRoles(guildId);
  const lines = held.map((one) => {
    const role = roles.find((r) => r.id === one.roleId);
    return role
      ? `<@&${one.roleId}>${describe(one.targets)}`
      : `\`${one.roleId}\` — deleted, still stored`;
  });

  const ceiling = await botCeiling(guildId);
  const above = held.filter((one) => {
    const role = roles.find((r) => r.id === one.roleId);
    return role ? role.position >= ceiling.position : false;
  });

  return [
    `### ${HEADING}`,
    lead,
    lines.join("\n"),
    "",
    !ceiling.manageRoles ? "⚠️ I do not have **Manage Roles**, so none of these are handed out." : "",
    above.length
      ? `⚠️ ${above.length === 1 ? "One of these sits" : `${above.length} of these sit`} above my own role, so I cannot hand ${above.length === 1 ? "it" : "them"} out. Drag my role higher in Server Settings.`
      : "",
    `-# ${held.length} of ${MAX_ROLES} · \`autorole remove <role>\` stops one`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "see the automatic roles");
  if (!guildId) return;
  await card(ctx, await listBody(guildId, "Roles handed to every member who joins."));
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "list the automatic roles");
  if (!guildId) return;
  await card(ctx, await listBody(guildId, "Roles handed to every member who joins."));
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "add an automatic role");
  if (!guildId) return;

  const parsed = parseFlags(ctx.argument, [HUMANS.name, ...(HUMANS.aliases ?? []), BOTS.name, ...(BOTS.aliases ?? [])]);
  const stray = unknownFlags(parsed, FLAGS);
  if (stray.length) {
    await card(
      ctx,
      [`### ${HEADING}`, `I do not know the flag \`--${stray[0]}\`.`, "", "-# `--humans` and `--bots` are the ones this takes."].join("\n"),
    );
    return;
  }

  const token = parsed.rest.trim();
  if (!token) {
    await card(ctx, [`### ${HEADING}`, "Name a role: `autorole add <role>`."].join("\n"));
    return;
  }

  const role = await findRole(guildId, token);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  if (role.id === guildId) {
    await card(ctx, [`### ${HEADING}`, "Everyone already has @everyone."].join("\n"));
    return;
  }

  // A managed role belongs to a bot, an integration or Nitro boosting. Discord
  // refuses to let anyone assign one, so storing it would only produce a 403 on
  // every join.
  if (role.managed) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `**${role.name}** is managed by Discord, so nobody can hand it out.`,
        "-# Bot roles, integration roles and the booster role all work this way.",
      ].join("\n"),
    );
    return;
  }

  const bits = BigInt(role.permissions || "0");
  if ((bits & PERMISSION.administrator) !== 0n) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `**${role.name}** has **Administrator**, so I will not hand it out automatically.`,
        "-# That would give the server away to whoever joins next.",
      ].join("\n"),
    );
    return;
  }

  const ceiling = await botCeiling(guildId);
  if (!ceiling.manageRoles) {
    await card(
      ctx,
      [`### ${HEADING}`, "I do not have **Manage Roles**, so I cannot hand out anything."].join("\n"),
    );
    return;
  }
  if (role.position >= ceiling.position) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `**${role.name}** sits above my own role, so I cannot hand it out.`,
        "-# Drag my role above it in Server Settings and try again.",
      ].join("\n"),
    );
    return;
  }

  const held = await autoRoles(guildId);
  const already = held.some((one) => one.roleId === role.id);
  if (!already && held.length >= MAX_ROLES) {
    await card(
      ctx,
      [`### ${HEADING}`, `That is ${MAX_ROLES} already, which is as many as I hand out.`].join("\n"),
    );
    return;
  }

  const wantsHumans = parsed.flags.has("humans") || parsed.flags.has("human") || parsed.flags.has("people");
  const wantsBots = parsed.flags.has("bots") || parsed.flags.has("bot");
  // Asking for both is asking for everyone, which is the default anyway.
  const targets: Targets = wantsHumans === wantsBots ? "all" : wantsHumans ? "humans" : "bots";

  await addRole(guildId, role.id, targets, ctx.authorId);

  const loud = loudPermissions(role);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      already
        ? `<@&${role.id}> updated${describe(targets) || " — everyone who joins"}.`
        : `<@&${role.id}> goes to everyone who joins${describe(targets)}.`,
      loud.length ? `⚠️ It carries **${loud.join("**, **")}**.` : "",
      "",
      `-# ${already ? held.length : held.length + 1} of ${MAX_ROLES} · existing members are not touched`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "remove an automatic role");
  if (!guildId) return;

  const token = ctx.argument.trim();
  if (!token) {
    await card(ctx, [`### ${HEADING}`, "Name a role: `autorole remove <role>`."].join("\n"));
    return;
  }

  // A deleted role can still be stored, and then `findRole` never finds it. An
  // id typed straight in has to work or the entry could never be cleared.
  const role = await findRole(guildId, token);
  const roleId = role?.id ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (!roleId) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  const gone = await removeRole(guildId, roleId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone
        ? `<@&${roleId}> is no longer handed out. Members who already have it keep it.`
        : "That role was not being handed out.",
    ].join("\n"),
  );
}

async function clear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageRoles(ctx, "clear the automatic roles");
  if (!guildId) return;

  const count = await clearRoles(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      count === 0
        ? "There was nothing being handed out."
        : `${count} ${count === 1 ? "role is" : "roles are"} no longer handed out. Members who already have them keep them.`,
    ].join("\n"),
  );
}

/**
 * Hands out the roles when somebody joins.
 *
 * Failures are per role: one role sitting above the bot must not stop the
 * others. Nothing is said in the channel, because a join is not the moment for
 * the bot to complain -- the state is visible in `,autorole`, which flags a
 * role it cannot reach.
 */
async function onJoin(guildId: string, userId: string): Promise<void> {
  const held = await autoRoles(guildId);
  if (held.length === 0) return;

  // Only worth a member fetch if some role actually cares who joined.
  let isBot: boolean | null = null;
  if (held.some((one) => one.targets !== "all")) {
    const member = await memberOf(guildId, userId);
    isBot = member?.user?.bot === true;
  }

  for (const one of held) {
    if (one.targets === "humans" && isBot === true) continue;
    if (one.targets === "bots" && isBot !== true) continue;
    await giveRole(guildId, userId, one.roleId, REASON);
  }
}

export function registerAutorole(): void {
  onMemberJoin(async (event) => {
    await onJoin(event.guildId, event.userId);
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("autorole", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "autorole",
    aliases: ["autoroles"],
    description: "Automatically assign roles to new members",
    handler,
  });

  groupUnder("autorole", () => {
    register({
      name: "add",
      aliases: ["create", "new"],
      description: "Add a role to be assigned automatically",
      handler: add,
      flags: FLAGS,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove a role from automatic assignment",
      handler: remove,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View all roles being assigned automatically",
      handler: list,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all roles from automatic assignment",
      handler: clear,
    });
  });
}
