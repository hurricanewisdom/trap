import { channelExists, guildRoles, botCeiling } from "../../../core/discord.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { onMemberUpdate } from "../../../core/hooks.js";
import { switchWord } from "../../../helpers/flags.js";
import { plain } from "../../../helpers/markdown.js";
import { VARIABLES, preview, unknownTokens } from "../greetings/variables.js";
import { checkOne, sweep } from "./sync.js";
import {
  addRole,
  config,
  dropRole,
  roles,
  save,
  DEFAULT_MESSAGE,
} from "./store.js";

const HEADING = "Server tag";

const MOST = 1500;

const CHANNEL = /^<#(\d{15,25})>$/;

const ROLE = /^<@&(\d{15,25})>$/;

async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply(notice([`### ${HEADING}`, ...lines].join("\n")));
}

function words(argument: string): string[] {
  return argument.trim().split(/\s+/).filter(Boolean);
}

async function findRole(guildId: string, token: string): Promise<{ id: string; name: string } | null> {
  const all = await guildRoles(guildId);
  const mention = ROLE.exec(token);
  const id = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return all.find((role) => role.id === id) ?? null;

  const needle = token.toLowerCase();
  return all.find((role) => role.name.toLowerCase() === needle) ?? null;
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change the server tag rewards");
  if (!guildId) return;

  const wanted = switchWord(words(ctx.argument)[0] ?? "");
  const held = wanted === null ? await config(guildId) : await save(guildId, { enabled: wanted });
  const list = await roles(guildId);

  await card(ctx, [
    held.enabled ? "On." : "Off.",
    `-# award channel: ${held.channelId ? `<#${held.channelId}>` : "none"}`,
    `-# roles awarded: ${list.length === 0 ? "none" : list.map((id) => `<@&${id}>`).join(" ")}`,
    `-# message: ${held.message ? "set" : "the default"}`,
    "",
    "`badge on` or `off` · `badge channel #channel` · `badge role add @role`",
    "`badge sync` applies it to everybody now.",
    "-# Roles are taken back when somebody removes the tag, not only handed out.",
  ]);
}

async function setChannel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the award channel");
  if (!guildId) return;

  const token = words(ctx.argument)[0] ?? "";
  const mention = CHANNEL.exec(token);
  const wanted = mention?.[1] ?? (/^\d{15,25}$/.test(token) ? token : null);
  if (!wanted) {
    await card(ctx, ["Which channel?", "", "-# `badge channel #channel`"]);
    return;
  }
  if (!(await channelExists(guildId, wanted))) {
    await card(ctx, ["That channel is not in this server."]);
    return;
  }

  await save(guildId, { channelId: wanted });
  await card(ctx, [`New tag wearers are announced in <#${wanted}>.`]);
}

async function roleOverview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the awarded roles");
  if (!guildId) return;

  const list = await roles(guildId);
  await card(ctx, [
    list.length === 0
      ? "No roles are awarded for the tag yet."
      : `${list.length} awarded: ${list.map((id) => `<@&${id}>`).join(" ")}`,
    "",
    "-# `badge role add @role` · `badge role remove @role` · `badge role list`",
  ]);
}

function roleEditor(adding: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageGuild(ctx, "change the awarded roles");
    if (!guildId) return;

    const token = words(ctx.argument)[0] ?? "";
    if (!token) {
      await card(ctx, ["Which role?", "", `-# \`badge role ${adding ? "add" : "remove"} @role\``]);
      return;
    }

    const found = await findRole(guildId, token);
    if (!found) {
      await card(ctx, ["No role by that name."]);
      return;
    }

    if (adding) {
      // A role the bot sits below cannot be given to anybody, and finding that
      // out at sync time means a silent failure for every member.
      const ceiling = await botCeiling(guildId);
      const all = await guildRoles(guildId);
      const position = all.find((role) => role.id === found.id)?.position ?? 0;
      if (position >= ceiling.position) {
        await card(ctx, [
          `<@&${found.id}> sits above the bot, so it cannot hand that one out.`,
          "",
          "-# Move the bot's role higher in Server Settings, or pick a lower role.",
        ]);
        return;
      }
    }

    const changed = adding
      ? await addRole(guildId, found.id)
      : await dropRole(guildId, found.id);

    await card(ctx, [
      changed
        ? adding
          ? `<@&${found.id}> is awarded for wearing the tag.`
          : `<@&${found.id}> is no longer awarded.`
        : adding
          ? `<@&${found.id}> was already on the list.`
          : `<@&${found.id}> was not on the list.`,
    ]);
  };
}

async function roleList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the awarded roles");
  if (!guildId) return;

  const list = await roles(guildId);
  await card(
    ctx,
    list.length === 0
      ? ["No roles are awarded for the tag."]
      : [`${list.length} awarded:`, list.map((id) => `<@&${id}>`).join(" ")],
  );
}

async function syncNow(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "sync the server tag roles");
  if (!guildId) return;

  const list = await roles(guildId);
  if (list.length === 0) {
    await card(ctx, ["No roles to award yet.", "", "-# `badge role add @role` first."]);
    return;
  }

  const done = await sweep(guildId, false);
  if (!done) {
    await card(ctx, [
      "The member list could not be read.",
      "",
      "-# The bot needs the Server Members intent for this.",
    ]);
    return;
  }

  await card(ctx, [
    `${done.wearing} wearing the tag.`,
    `-# roles given: ${done.given}`,
    `-# roles taken back: ${done.taken}`,
    ...(done.failed > 0 ? [`-# could not change: ${done.failed}`] : []),
    "",
    "-# Syncing does not announce anybody; it only settles the roles.",
  ]);
}

async function setMessage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the award message");
  if (!guildId) return;

  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, [
      "What should it say?",
      "",
      "-# `badge message {user} thanks for repping us`",
      "-# `badge message view` shows the current one.",
      "",
      VARIABLES.map((one) => `\`${one.token}\``).join(" · "),
    ]);
    return;
  }

  const unknown = unknownTokens(said);
  if (unknown.length > 0) {
    await card(ctx, [
      `Nothing replaces ${unknown.map((one) => `\`${one}\``).join(", ")}.`,
      "",
      VARIABLES.map((one) => `\`${one.token}\``).join(" · "),
    ]);
    return;
  }

  await save(guildId, { message: said.slice(0, MOST) });
  await card(ctx, [
    "Saved. It will read:",
    "",
    plain(preview(said, { guildId, channelId: ctx.channelId, userId: ctx.authorId })),
  ]);
}

async function viewMessage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the award message");
  if (!guildId) return;

  const held = await config(guildId);
  await card(ctx, [
    held.message ? "The award message is:" : "No message is set, so the default is used:",
    "",
    plain(held.message ?? DEFAULT_MESSAGE),
    "",
    plain(
      preview(held.message ?? DEFAULT_MESSAGE, {
        guildId,
        channelId: ctx.channelId,
        userId: ctx.authorId,
      }),
    ),
  ]);
}

export function registerBadge(): void {
  // Whether Discord reports a tag going on as a member update is not something
  // that could be verified from here, so this is the quick path rather than the
  // guaranteed one: `badge sync` is what actually settles everybody.
  onMemberUpdate(async (event) => {
    await checkOne(event.guildId, event.userId).catch(() => {});
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("badge", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "badge",
    aliases: ["servertag", "guildtag"],
    description: "Reward members for setting the guild tag",
    handler,
  });

  groupUnder("badge", () => {
    register({
      name: "channel",
      description: "Set an award channel for new guild tag members",
      handler: setChannel,
    });
    register({ name: "sync", description: "Sync guild tag member roles", handler: syncNow });

    register({
      name: "role",
      description: "Award members for applying the guild tag",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("badge role", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await roleOverview(ctx);
      },
    });

    groupUnder("badge role", () => {
      register({
        name: "add",
        description: "Add a role to the list awarded for the guild tag",
        handler: roleEditor(true),
      });
      register({
        name: "remove",
        aliases: ["delete"],
        description: "Remove a role from the list awarded for the guild tag",
        handler: roleEditor(false),
      });
      register({
        name: "list",
        description: "List all roles that can be awarded for the guild tag",
        handler: roleList,
      });
    });

    register({
      name: "message",
      description: "Set an award message",
      handler: async (ctx) => {
        const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
        const found = sub ? lookupIn("badge message", sub) : undefined;
        if (found) {
          await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
          return;
        }
        await setMessage(ctx);
      },
    });

    groupUnder("badge message", () => {
      register({
        name: "view",
        aliases: ["show"],
        description: "View current award message",
        handler: viewMessage,
      });
    });
  });
}
