import {
  createWebhook,
  deleteWebhook,
  editWebhookMessage,
  executeWebhook,
  guildWebhooks,
  type Webhook,
} from "../../../core/discord.js";
import { notice, requireGuild, requireManageWebhooks } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { parseEmbed } from "../pagination/embedcode.js";
import { MAX_WEBHOOKS, all, drop, one, remember, setLock } from "./store.js";

const HEADING = "Webhooks";

const LINK = /channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

const MAX_NAME = 80;

const MAX_CONTENT = 1900;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function tag(identifier: string): string {
  return `\`${identifier}\``;
}

async function token(guildId: string, webhookId: string): Promise<Webhook | null> {
  const live = await guildWebhooks(guildId);
  if (!live) return null;
  return live.find((hook) => hook.id === webhookId && hook.token) ?? null;
}

async function usable(
  ctx: PrefixContext,
  guildId: string,
  identifier: string,
): Promise<{ held: NonNullable<Awaited<ReturnType<typeof one>>>; hook: Webhook } | null> {
  const held = await one(guildId, identifier);
  if (!held) {
    await card(
      ctx,
      [`### ${HEADING}`, `Nothing here is called ${tag(identifier)}.`, "", "-# `webhook list` shows them."].join("\n"),
    );
    return null;
  }

  if (held.lockedBy && held.lockedBy !== ctx.authorId) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `${tag(held.identifier)} is locked by <@${held.lockedBy}>.`,
        "",
        "-# Only they can send through it or unlock it.",
      ].join("\n"),
    );
    return null;
  }

  const hook = await token(guildId, held.webhookId);
  if (!hook) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `${tag(held.identifier)} no longer exists on Discord.`,
        "",
        "-# `webhook delete " + held.identifier + "` clears the record.",
      ].join("\n"),
    );
    return null;
  }

  return { held, hook };
}

function payload(source: string): { body: Record<string, unknown> | null; problems: string[] } {
  const trimmed = source.trim();
  if (!trimmed) return { body: null, problems: ["There is nothing to send."] };

  if (trimmed.includes("{") && trimmed.includes("}")) {
    const { embed, problems } = parseEmbed(trimmed);
    if (embed) return { body: { embeds: [embed], allowed_mentions: { parse: [] } }, problems };
    return { body: null, problems };
  }

  return {
    body: { content: trimmed.slice(0, MAX_CONTENT), allowed_mentions: { parse: [] } },
    problems: [],
  };
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageWebhooks(ctx, "manage the webhooks");
  if (!guildId) return;

  const held = await all(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Post as a named identity in a channel.",
      "",
      "`webhook create <name>` makes one here",
      "`webhook list` shows them",
      "`webhook send <id> <message>` posts through one",
      "`webhook edit <link> <message>` rewrites something it posted",
      "`webhook lock <id>` keeps it to you, `unlock` gives it back",
      "`webhook delete <id>` removes it",
      "",
      "-# Each one gets a short id. Message text, or `{title: ...}` for an embed.",
      "-# The URL is never shown, because anyone holding it can post as that webhook.",
      `-# ${held.length} of ${MAX_WEBHOOKS} in this server.`,
    ].join("\n"),
  );
}

async function create(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageWebhooks(ctx, "create a webhook");
  if (!guildId) return;

  const name = ctx.argument.trim().slice(0, MAX_NAME);
  if (!name) {
    await card(ctx, [`### ${HEADING}`, "Give it a name.", "", "-# `webhook create <name>`"].join("\n"));
    return;
  }
  if ((await all(guildId)).length >= MAX_WEBHOOKS) {
    await card(
      ctx,
      [`### ${HEADING}`, `This server already holds ${MAX_WEBHOOKS} of mine.`].join("\n"),
    );
    return;
  }

  const made = await createWebhook(ctx.channelId, name, `Webhook by ${ctx.authorId}`);
  if (!made.ok) {
    await card(
      ctx,
      [`### ${HEADING}`, "Discord would not create it.", `-# ${made.message.slice(0, 180)}`].join("\n"),
    );
    return;
  }

  const identifier = await remember(guildId, made.data.id, ctx.channelId, ctx.authorId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `**${name}** is live in <#${ctx.channelId}> as ${tag(identifier)}.`,
      "",
      `-# \`webhook send ${identifier} hello\` posts through it.`,
      "-# I am not printing the URL. Anyone who has it can post as this webhook.",
    ].join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "list the webhooks");
  if (!guildId) return;

  const held = await all(guildId);
  if (held.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, "There are none yet.", "", "-# `webhook create <name>` makes one."].join("\n"),
    );
    return;
  }

  const live = (await guildWebhooks(guildId)) ?? [];
  const names = new Map(live.map((hook) => [hook.id, hook.name ?? "unnamed"]));

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held
        .slice(0, 20)
        .map((row) => {
          const mark = row.lockedBy ? ` · locked by <@${row.lockedBy}>` : "";
          const gone = names.has(row.webhookId) ? "" : " · *deleted on Discord*";
          return `${tag(row.identifier)} **${names.get(row.webhookId) ?? "unknown"}** in <#${row.channelId}>${mark}${gone}`;
        })
        .join("\n"),
      "",
      `-# ${held.length} of ${MAX_WEBHOOKS}${held.length > 20 ? ", showing the first 20" : ""}`,
    ].join("\n"),
  );
}

async function send(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageWebhooks(ctx, "send through a webhook");
  if (!guildId) return;

  const [identifier, ...rest] = ctx.argument.trim().split(/\s+/);
  if (!identifier) {
    await card(ctx, [`### ${HEADING}`, "Which webhook?", "", "-# `webhook send <id> <message>`"].join("\n"));
    return;
  }

  const found = await usable(ctx, guildId, identifier);
  if (!found) return;

  const { body, problems } = payload(rest.join(" "));
  if (!body) {
    await card(ctx, [`### ${HEADING}`, "That will not send.", "", problems.map((p) => `-# ${p}`).join("\n")].join("\n"));
    return;
  }

  const sent = await executeWebhook(found.held.webhookId, found.hook.token as string, body);
  await card(
    ctx,
    sent.ok
      ? [
          `### ${HEADING}`,
          `Sent through ${tag(found.held.identifier)} in <#${found.held.channelId}>.`,
          problems.length ? problems.map((p) => `-# ${p}`).join("\n") : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [`### ${HEADING}`, "Discord would not send it.", `-# ${sent.message.slice(0, 180)}`].join("\n"),
  );
}

async function edit(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageWebhooks(ctx, "edit a webhook message");
  if (!guildId) return;

  const tokens = ctx.argument.trim().split(/\s+/).filter(Boolean);
  const at = tokens.findIndex((word) => LINK.test(word));
  const match = at >= 0 ? LINK.exec(tokens[at] as string) : null;

  if (!match || match[1] !== guildId) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give me a link to the message, then what it should say.",
        "",
        "-# `webhook edit <link> <message>`",
      ].join("\n"),
    );
    return;
  }

  tokens.splice(at, 1);
  const channelId = match[2] as string;
  const messageId = match[3] as string;

  const held = (await all(guildId)).find((row) => row.channelId === channelId);
  if (!held) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `I have no webhook in <#${channelId}>.`,
        "",
        "-# I can only edit what one of my own webhooks posted.",
      ].join("\n"),
    );
    return;
  }

  const found = await usable(ctx, guildId, held.identifier);
  if (!found) return;

  const { body, problems } = payload(tokens.join(" "));
  if (!body) {
    await card(ctx, [`### ${HEADING}`, "That will not send.", "", problems.map((p) => `-# ${p}`).join("\n")].join("\n"));
    return;
  }

  const saved = await editWebhookMessage(
    found.held.webhookId,
    found.hook.token as string,
    messageId,
    body,
  );
  await card(
    ctx,
    saved.ok
      ? [`### ${HEADING}`, "That message is rewritten."].join("\n")
      : [
          `### ${HEADING}`,
          "I could not edit that message.",
          "",
          "-# A webhook can only edit what it posted itself.",
          `-# ${saved.message.slice(0, 160)}`,
        ].join("\n"),
  );
}

function locker(lock: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageWebhooks(ctx, lock ? "lock a webhook" : "unlock a webhook");
    if (!guildId) return;

    const identifier = ctx.argument.trim().split(/\s+/)[0] ?? "";
    if (!identifier) {
      await card(
        ctx,
        [`### ${HEADING}`, "Which webhook?", "", `-# \`webhook ${lock ? "lock" : "unlock"} <id>\``].join("\n"),
      );
      return;
    }

    const held = await one(guildId, identifier);
    if (!held) {
      await card(ctx, [`### ${HEADING}`, `Nothing here is called ${tag(identifier)}.`].join("\n"));
      return;
    }
    if (held.lockedBy && held.lockedBy !== ctx.authorId) {
      await card(
        ctx,
        [`### ${HEADING}`, `${tag(held.identifier)} is locked by <@${held.lockedBy}>.`].join("\n"),
      );
      return;
    }
    if (lock && held.lockedBy === ctx.authorId) {
      await card(ctx, [`### ${HEADING}`, `${tag(held.identifier)} is already yours.`].join("\n"));
      return;
    }
    if (!lock && !held.lockedBy) {
      await card(ctx, [`### ${HEADING}`, `${tag(held.identifier)} is not locked.`].join("\n"));
      return;
    }

    await setLock(guildId, held.identifier, lock ? ctx.authorId : null);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        lock
          ? `${tag(held.identifier)} is yours now. Nobody else can send through it.`
          : `${tag(held.identifier)} is open to anyone with the permission again.`,
      ].join("\n"),
    );
  };
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageWebhooks(ctx, "delete a webhook");
  if (!guildId) return;

  const identifier = ctx.argument.trim().split(/\s+/)[0] ?? "";
  if (!identifier) {
    await card(ctx, [`### ${HEADING}`, "Which webhook?", "", "-# `webhook delete <id>`"].join("\n"));
    return;
  }

  const held = await one(guildId, identifier);
  if (!held) {
    await card(ctx, [`### ${HEADING}`, `Nothing here is called ${tag(identifier)}.`].join("\n"));
    return;
  }
  if (held.lockedBy && held.lockedBy !== ctx.authorId) {
    await card(
      ctx,
      [`### ${HEADING}`, `${tag(held.identifier)} is locked by <@${held.lockedBy}>.`].join("\n"),
    );
    return;
  }

  await deleteWebhook(held.webhookId, `Webhook removed by ${ctx.authorId}`);
  await drop(guildId, held.identifier);
  await card(
    ctx,
    [`### ${HEADING}`, `${tag(held.identifier)} is gone, on Discord and here.`].join("\n"),
  );
}

export function registerWebhooks(): void {
  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("webhook", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "webhook",
    aliases: ["webhooks"],
    description: "Post as a named identity in a channel",
    handler,
  });

  groupUnder("webhook", () => {
    register({ name: "create", aliases: ["add"], description: "Make a webhook here", handler: create });
    register({ name: "list", aliases: ["all"], description: "Every webhook in this server", handler: list });
    register({ name: "send", aliases: ["post"], description: "Post through a webhook", handler: send });
    register({ name: "edit", description: "Rewrite something a webhook posted", handler: edit });
    register({ name: "lock", description: "Keep a webhook to yourself", handler: locker(true) });
    register({ name: "unlock", description: "Give a webhook back to everyone", handler: locker(false) });
    register({ name: "delete", aliases: ["remove", "rm"], description: "Delete a webhook", handler: remove });
  });
}
