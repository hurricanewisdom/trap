import { sql } from "../../../core/db.js";
import { channelExists, sendMessage } from "../../../core/discord.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { VARIABLES, preview, render, unknownTokens } from "./variables.js";

const MESSAGE_LIMIT = 1800;

const CHANNEL = /^<#(\d{15,25})>$/;

export interface Greeting {
  kind: string;
  command: string;
  aliases: string[];
  heading: string;
  description: string;
  when: string;
  note?: string;
}

interface Row {
  channel_id: string;
  message: string;
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

function channelId(token: string): string | null {
  const mention = CHANNEL.exec(token);
  if (mention) return mention[1] as string;
  return /^\d{15,25}$/.test(token) ? token : null;
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

async function rowsFor(guildId: string, kind: string): Promise<Row[]> {
  return sql<Row[]>`
    SELECT channel_id, message FROM channel_messages
    WHERE guild_id = ${guildId} AND kind = ${kind} ORDER BY updated_at
  `;
}

async function messageIn(guildId: string, kind: string, channel: string): Promise<string | null> {
  const rows = await sql<{ message: string }[]>`
    SELECT message FROM channel_messages
    WHERE guild_id = ${guildId} AND kind = ${kind} AND channel_id = ${channel}
  `;
  return rows[0]?.message ?? null;
}

export async function postGreeting(
  kind: string,
  guildId: string,
  userId: string,
): Promise<number> {
  const rows = await rowsFor(guildId, kind);

  for (const row of rows) {
    const body = await render(row.message, { guildId, channelId: row.channel_id, userId });
    await sendMessage(row.channel_id, {
      content: body.slice(0, 2000),
      allowed_mentions: { parse: ["users", "roles"] },
    });
  }
  return rows.length;
}

export function registerGreeting(spec: Greeting): void {
  const { kind, command, heading, when } = spec;

  const usage = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `set up ${heading.toLowerCase()}`);
    if (!guildId) return;

    const rows = await rowsFor(guildId, kind);
    await card(
      ctx,
      [
        `### ${heading}`,
        rows.length
          ? `Posting in ${rows.map((row) => `<#${row.channel_id}>`).join(" · ")}.`
          : `No ${heading.toLowerCase().replace(/s$/, "")} is set up yet.`,
        "",
        `\`${command} add <channel> <message>\` sets one up`,
        `\`${command} view <channel>\` shows what a channel posts`,
        `\`${command} remove <channel>\` stops it`,
        `\`${command} list\` shows every channel`,
        `\`${command} variables\` lists what you can put in a message`,
        "",
        `-# ${rows.length} channel${rows.length === 1 ? "" : "s"} · posted ${when}.`,
      ].join("\n"),
    );
  };

  const add = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `add a ${heading.toLowerCase().replace(/s$/, "")}`);
    if (!guildId) return;

    const channel = channelId(words(ctx.argument)[0] ?? "");
    const template = ctx.argument.replace(/^\S+\s*/, "").trim();

    if (!channel || !template) {
      await card(
        ctx,
        [
          `### ${heading}`,
          `Use \`${command} add <channel> <message>\`.`,
          `-# \`${command} variables\` lists what you can put in it.`,
        ].join("\n"),
      );
      return;
    }

    if (!(await channelExists(guildId, channel))) {
      await card(ctx, [`### ${heading}`, "That channel is not in this server."].join("\n"));
      return;
    }

    if (template.length > MESSAGE_LIMIT) {
      await card(
        ctx,
        [`### ${heading}`, `Keep the message under ${MESSAGE_LIMIT} characters.`].join("\n"),
      );
      return;
    }

    const unknown = unknownTokens(template);
    await sql`
      INSERT INTO channel_messages (guild_id, kind, channel_id, message, created_by, updated_at)
      VALUES (${guildId}, ${kind}, ${channel}, ${template}, ${ctx.authorId}, now())
      ON CONFLICT (guild_id, kind, channel_id) DO UPDATE
        SET message = EXCLUDED.message, created_by = EXCLUDED.created_by, updated_at = now()
    `;

    await card(
      ctx,
      [
        `### ${heading}`,
        `<#${channel}> will post this ${when}:`,
        "",
        preview(template, { guildId, channelId: channel, userId: ctx.authorId }),
        unknown.length
          ? `\n-# Not a variable, left as written: ${unknown.map((t) => `\`${t}\``).join(" ")}`
          : "",
        spec.note ? `-# ${spec.note}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  };

  const view = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `view a ${heading.toLowerCase().replace(/s$/, "")}`);
    if (!guildId) return;

    const channel = channelId(words(ctx.argument)[0] ?? "");
    if (!channel) {
      await card(ctx, [`### ${heading}`, `Use \`${command} view <channel>\`.`].join("\n"));
      return;
    }

    const template = await messageIn(guildId, kind, channel);
    if (!template) {
      await card(
        ctx,
        [`### ${heading}`, `<#${channel}> has no ${heading.toLowerCase().replace(/s$/, "")}.`].join("\n"),
      );
      return;
    }

    await card(
      ctx,
      [
        `### ${heading}`,
        `<#${channel}> posts:`,
        "",
        preview(template, { guildId, channelId: channel, userId: ctx.authorId }),
        "",
        "-# The raw message:",
        `\`\`\`\n${template.replace(/`/g, "'").slice(0, 900)}\n\`\`\``,
      ].join("\n"),
    );
  };

  const remove = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `remove a ${heading.toLowerCase().replace(/s$/, "")}`);
    if (!guildId) return;

    const channel = channelId(words(ctx.argument)[0] ?? "");
    if (!channel) {
      await card(ctx, [`### ${heading}`, `Use \`${command} remove <channel>\`.`].join("\n"));
      return;
    }

    const gone = await sql`
      DELETE FROM channel_messages
      WHERE guild_id = ${guildId} AND kind = ${kind} AND channel_id = ${channel}
      RETURNING channel_id
    `;

    await card(
      ctx,
      [
        `### ${heading}`,
        gone.length
          ? `<#${channel}> will not post any more.`
          : `<#${channel}> had no ${heading.toLowerCase().replace(/s$/, "")}.`,
      ].join("\n"),
    );
  };

  const list = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `list the ${heading.toLowerCase()}`);
    if (!guildId) return;

    const rows = await rowsFor(guildId, kind);
    if (rows.length === 0) {
      await card(ctx, [`### ${heading}`, `No ${heading.toLowerCase()} are set up.`].join("\n"));
      return;
    }

    await card(
      ctx,
      [
        `### ${heading}`,
        rows
          .map((row) => `<#${row.channel_id}>\n-# ${row.message.replace(/\s+/g, " ").slice(0, 80)}`)
          .join("\n"),
        "",
        `-# ${rows.length} channel${rows.length === 1 ? "" : "s"}`,
      ].join("\n"),
    );
  };

  const variables = async (ctx: PrefixContext): Promise<void> => {
    const guildId = await requireManageGuild(ctx, `see the ${heading.toLowerCase()} variables`);
    if (!guildId) return;

    const width = VARIABLES.reduce((widest, entry) => Math.max(widest, entry.token.length), 0);
    await card(
      ctx,
      [
        `### ${heading}`,
        "```",
        VARIABLES.map((entry) => `${entry.token.padEnd(width)}  ${entry.describes}`).join("\n"),
        "```",
        "-# Anything else in braces is left exactly as written.",
      ].join("\n"),
    );
  };

  const dispatcher: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn(command, sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await usage(ctx);
  };

  register({
    name: command,
    aliases: spec.aliases,
    description: spec.description,
    handler: dispatcher,
  });

  groupUnder(command, () => {
    register({ name: "add", aliases: ["set"], description: `Add a ${heading.toLowerCase().replace(/s$/, "")} to a channel`, handler: add });
    register({ name: "view", description: "Show what a channel posts", handler: view });
    register({ name: "remove", aliases: ["delete", "rm"], description: "Stop a channel posting", handler: remove });
    register({ name: "list", description: "Every channel with one set", handler: list });
    register({ name: "variables", aliases: ["vars"], description: "What you can put in a message", handler: variables });
  });
}
