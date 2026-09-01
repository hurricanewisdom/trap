import { sql } from "../../../core/db.js";
import { api, sendMessage, write } from "../../../core/discord.js";
import { paginate } from "../../../core/pager.js";
import { requireManageMessages } from "../../../core/permissions.js";
import { groupUnder, lookupIn, register, type PrefixContext } from "../../../core/prefix.js";
import { plain } from "../../../helpers/markdown.js";
import { card, messageLink, stamp, words } from "../shared.js";
import { pagesOf } from "../pages.js";
import { isEmpty, parse, serialise, REFERENCE, type Embed } from "./code.js";

const MOST_NAME = 32;

const MOST_SAVED = 50;

const NAME_OK = /^[\w-]{1,32}$/;

async function post(ctx: PrefixContext, code: string): Promise<boolean> {
  const { built, unknown } = parse(code);
  if (isEmpty(built)) {
    await card(ctx, [
      "That code makes an empty message.",
      ...(unknown.length ? ["", `-# unread: ${plain(unknown.slice(0, 3).join(", "))}`] : []),
      "",
      ...REFERENCE,
    ]);
    return false;
  }

  const sent = await sendMessage(ctx.channelId, {
    ...(built.content ? { content: built.content } : {}),
    allowed_mentions: { parse: [] },
    ...({ embeds: built.embeds } as Record<string, unknown>),
  });

  if (!sent.ok) {
    await card(ctx, ["Discord refused that embed.", "", `-# ${plain(sent.message.slice(0, 160))}`]);
    return false;
  }
  // Worth saying, but only after the thing they asked for actually posted.
  if (unknown.length) {
    await card(ctx, [`-# ignored: ${plain(unknown.slice(0, 3).join(", "))}`]);
  }
  return true;
}

async function createembed(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "post an embed");
  if (!guildId) return;

  const code = ctx.argument.trim();
  if (!code) {
    await card(ctx, ["### Embed code", ...REFERENCE, "", "-# `createembed {title: hi}$v{description: there}`"]);
    return;
  }
  await post(ctx, code);
}

async function embedcode(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "copy an embed");
  if (!guildId) return;

  const link = messageLink(words(ctx.argument)[0]);
  if (!link) {
    await card(ctx, ["Which message?", "", "-# `embedcode <message link>`"]);
    return;
  }
  if (link.guildId !== guildId) {
    await card(ctx, ["That message is in another server."]);
    return;
  }

  const message = await api<{ content?: string; embeds?: Embed[] }>(
    `/channels/${link.channelId}/messages/${link.messageId}`,
  );
  if (!message) {
    await card(ctx, ["That message could not be read.", "", "-# The bot needs to see that channel."]);
    return;
  }

  const code = serialise(message);
  if (!code) {
    await card(ctx, ["There is nothing on that message to copy."]);
    return;
  }

  // In a code block so it can be copied whole; the code contains the very
  // characters Discord would otherwise format.
  await card(ctx, ["### Code", "```", code.slice(0, 3800), "```"]);
}

async function editembed(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "edit an embed");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const link = messageLink(parts[0]);
  const code = ctx.argument.slice(parts[0]?.length ?? 0).trim();
  if (!link || !code) {
    await card(ctx, ["Which message, and what code?", "", "-# `editembed <message link> {title: new}`"]);
    return;
  }
  if (link.guildId !== guildId) {
    await card(ctx, ["That message is in another server."]);
    return;
  }

  const { built, unknown } = parse(code);
  if (isEmpty(built)) {
    await card(ctx, ["That code makes an empty message.", "", ...REFERENCE]);
    return;
  }

  // Only the bot's own messages can be edited, and Discord's error for anything
  // else is unhelpful, so it is checked first.
  const message = await api<{ author?: { id: string } }>(
    `/channels/${link.channelId}/messages/${link.messageId}`,
  );
  if (!message) {
    await card(ctx, ["That message could not be read."]);
    return;
  }

  const done = await write(
    "PATCH",
    `/channels/${link.channelId}/messages/${link.messageId}`,
    {
      content: built.content ?? "",
      embeds: built.embeds,
      allowed_mentions: { parse: [] },
    },
  );

  if (!done.ok) {
    await card(ctx, [
      done.status === 403
        ? "That is not one of my messages, so I cannot edit it."
        : "That edit was refused.",
      "",
      `-# ${plain(done.message.slice(0, 160))}`,
    ]);
    return;
  }
  await card(ctx, ["Edited.", ...(unknown.length ? [`-# ignored: ${plain(unknown.join(", "))}`] : [])]);
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "see the saved embeds");
  if (!guildId) return;

  const rows = await sql<{ name: string; code: string; author_id: string; at: Date }[]>`
    SELECT name, code, author_id, at FROM embeds WHERE guild_id = ${guildId} ORDER BY name
  `;

  const lines = rows.map(
    (row) =>
      `**${plain(row.name)}** — ${row.code.length} characters · <@${row.author_id}> · ${stamp(row.at.toISOString())}`,
  );

  await paginate(
    ctx,
    pagesOf(
      `${rows.length} saved embed${rows.length === 1 ? "" : "s"}`,
      lines,
      10,
      rows.length ? "`embed preview <name>`" : "nothing saved — `embed create <name> <code>`",
    ),
    null,
  );
}

async function create(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "save an embed");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const name = (parts[0] ?? "").toLowerCase();
  const code = ctx.argument.slice(parts[0]?.length ?? 0).trim();

  if (!name || !NAME_OK.test(name)) {
    await card(ctx, [
      "What should it be called?",
      "",
      `-# \`embed create <name> <code>\` — letters, numbers and dashes, up to ${MOST_NAME}`,
    ]);
    return;
  }
  if (!code) {
    await card(ctx, [`### Saving \`${plain(name)}\``, "Paste the code after the name.", "", ...REFERENCE]);
    return;
  }

  const { built } = parse(code);
  if (isEmpty(built)) {
    await card(ctx, ["That code makes an empty message.", "", ...REFERENCE]);
    return;
  }

  const held = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM embeds WHERE guild_id = ${guildId}
  `;
  const existing = await sql<{ name: string }[]>`
    SELECT name FROM embeds WHERE guild_id = ${guildId} AND name = ${name}
  `;
  if (Number(held[0]?.n ?? 0) >= MOST_SAVED && existing.length === 0) {
    await card(ctx, [`That is the ${MOST_SAVED}th. Delete one first.`]);
    return;
  }

  await sql`
    INSERT INTO embeds (guild_id, name, code, author_id) VALUES (${guildId}, ${name}, ${code}, ${ctx.authorId})
    ON CONFLICT (guild_id, name) DO UPDATE SET code = ${code}, author_id = ${ctx.authorId}, at = now()
  `;

  await card(ctx, [
    `### ${existing.length ? "Replaced" : "Saved"} \`${plain(name)}\``,
    `-# \`embed preview ${plain(name)}\` to post it.`,
  ]);
}

async function preview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "post a saved embed");
  if (!guildId) return;

  const name = (words(ctx.argument)[0] ?? "").toLowerCase();
  if (!name) {
    await card(ctx, ["Which one?", "", "-# `embed preview <name>` · `embed list`"]);
    return;
  }

  const rows = await sql<{ code: string }[]>`
    SELECT code FROM embeds WHERE guild_id = ${guildId} AND name = ${name}
  `;
  if (!rows[0]) {
    await card(ctx, [`Nothing saved as \`${plain(name)}\`.`, "", "-# `embed list`"]);
    return;
  }
  await post(ctx, rows[0].code);
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "delete a saved embed");
  if (!guildId) return;

  const name = (words(ctx.argument)[0] ?? "").toLowerCase();
  if (!name) {
    await card(ctx, ["Which one?", "", "-# `embed delete <name>`"]);
    return;
  }

  const gone = await sql<{ name: string }[]>`
    DELETE FROM embeds WHERE guild_id = ${guildId} AND name = ${name} RETURNING name
  `;
  await card(ctx, gone[0] ? [`Deleted \`${plain(name)}\`.`] : [`Nothing saved as \`${plain(name)}\`.`]);
}

async function overview(ctx: PrefixContext): Promise<void> {
  const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
  const found = sub ? lookupIn("embed", sub) : undefined;
  if (found) {
    await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
    return;
  }

  await card(ctx, [
    "### Embeds",
    "-# `embed create <name> <code>` — save one",
    "-# `embed list` · `embed preview <name>` · `embed delete <name>`",
    "-# `embed copy <message link>` — read a code back out of a message",
    "",
    "-# `createembed <code>` posts one without saving it,",
    "-# and `editembed <link> <code>` rewrites one already posted.",
    "",
    ...REFERENCE,
  ]);
}

export function registerEmbeds(): void {
  register({ name: "embed", description: "Manage and create embeds", handler: overview });

  groupUnder("embed", () => {
    register({ name: "list", description: "List all available embeds", handler: list });
    register({ name: "copy", description: "Copy an existing embed's code", handler: embedcode });
    register({ name: "delete", description: "Delete a stored embed", handler: remove });
    register({ name: "preview", description: "Send an existing embed", handler: preview });
    register({ name: "create", description: "Save an embed under a name", handler: create });
  });

  register({ name: "createembed", description: "Create your own embed", handler: createembed });
  register({ name: "editembed", description: "Edit an embed you created", handler: editembed });
  register({ name: "embedcode", description: "Copy an existing embed's code", handler: embedcode });
}
