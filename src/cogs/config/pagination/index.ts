import { botId, editMessage, getMessage } from "../../../core/discord.js";
import { onComponent } from "../../../core/hooks.js";
import {
  notice,
  requireAdministrator,
  requireManageMessages,
} from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { FIELDS, describe, parseEmbed, type Embed } from "./embedcode.js";
import {
  MAX_PAGES,
  MAX_PAGINATIONS,
  addPage,
  count,
  create,
  destroy,
  inGuild,
  load,
  removePage,
  reset as wipeAll,
  setCurrent,
  tracked,
  updatePage,
} from "./store.js";

const HEADING = "Pagination";

const ID = "pgn";

const TURN = `${ID}:`;

const LINK = /channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function jump(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

interface Target {
  channelId: string;
  messageId: string;
  rest: string;
}

function target(argument: string, guildId: string): Target | null {
  const tokens = argument.split(/\s+/).filter(Boolean);
  const at = tokens.findIndex((token) => LINK.test(token));
  if (at < 0) return null;

  const match = LINK.exec(tokens[at] as string);
  if (!match || match[1] !== guildId) return null;

  tokens.splice(at, 1);
  return {
    channelId: match[2] as string,
    messageId: match[3] as string,
    rest: tokens.join(" ").trim(),
  };
}

function needLink(usage: string): string {
  return [
    `### ${HEADING}`,
    "Give me a message link from this server.",
    "",
    `-# \`${usage}\``,
    "-# Right click the message and Copy Message Link.",
  ].join("\n");
}

function controls(index: number, total: number): unknown[] {
  if (total < 2) return [];

  const button = (action: string, label: string, off = false) => ({
    type: 2,
    style: 2,
    custom_id: `${TURN}${action}`,
    label,
    ...(off ? { disabled: true } : {}),
  });

  return [
    {
      type: 1,
      components: [
        button("prev", "Back"),
        button("at", `${index} / ${total}`, true),
        button("next", "Next"),
      ],
    },
  ];
}

interface Shown {
  embeds: unknown[];
  components: unknown[];
}

async function page(messageId: string): Promise<Shown | null> {
  const held = await load(messageId);
  if (!held || held.pages.length === 0) return null;

  const index = Math.min(Math.max(held.current, 1), held.pages.length);
  const shown = held.pages[index - 1];
  if (!shown) return null;

  return { embeds: [shown.embed as Embed], components: controls(index, held.pages.length) };
}

async function render(messageId: string): Promise<boolean> {
  const held = await load(messageId);
  const body = await page(messageId);
  if (!held || !body) return false;

  const saved = await editMessage(held.channelId, messageId, body);
  return saved.ok;
}

async function ours(ctx: PrefixContext, spot: Target): Promise<boolean> {
  const message = await getMessage(spot.channelId, spot.messageId);
  if (!message) {
    await card(ctx, [`### ${HEADING}`, "I cannot see that message.", "", "-# I need to be able to read that channel."].join("\n"));
    return false;
  }
  if (message.author?.id !== botId()) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "That message is not mine.",
        "",
        "-# Discord only lets a bot edit its own messages, so pagination only works on mine.",
      ].join("\n"),
    );
    return false;
  }
  return true;
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "see the paginations");
  if (!guildId) return;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Put several pages behind one message, turned with the buttons underneath.",
      "",
      "`pagination set <link>` takes an embed I posted and makes it page 1",
      "`pagination add <link> <code>` adds a page",
      "`pagination update <link> <id> <code>` rewrites one",
      "`pagination remove <link> <id>` deletes one",
      "`pagination list` shows them all",
      "`pagination restorereactions <link>` puts the buttons back",
      "`pagination delete <link>` stops paginating that message",
      "`pagination reset` clears every one, Administrator only",
      "",
      "**Page code**",
      FIELDS.map(([block, describes]) => `\`${block}\` ${describes}`).join("\n"),
      "",
      `-# ${await count(guildId)} of ${MAX_PAGINATIONS} in this server.`,
    ].join("\n"),
  );
}

async function set(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "set up a pagination");
  if (!guildId) return;

  const spot = target(ctx.argument, guildId);
  if (!spot) {
    await card(ctx, needLink("pagination set <link>"));
    return;
  }
  if (!(await ours(ctx, spot))) return;

  if (await tracked(spot.messageId)) {
    await card(ctx, [`### ${HEADING}`, "That message is already paginated.", "", "-# `pagination add <link> <code>` adds another page."].join("\n"));
    return;
  }
  if ((await count(guildId)) >= MAX_PAGINATIONS) {
    await card(ctx, [`### ${HEADING}`, `A server can hold ${MAX_PAGINATIONS} paginations, and they are all used.`].join("\n"));
    return;
  }

  const message = await getMessage(spot.channelId, spot.messageId);
  const first = (message?.embeds ?? [])[0] as Embed | undefined;
  if (!first) {
    await card(
      ctx,
      [`### ${HEADING}`, "That message has no embed to make page 1 from.", "", "-# Post an embed first, then set it."].join("\n"),
    );
    return;
  }

  await create(guildId, spot.channelId, spot.messageId, first, ctx.authorId);
  await render(spot.messageId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `[That message](${jump(guildId, spot.channelId, spot.messageId)}) is page 1.`,
      "",
      "-# `pagination add <link> <code>` adds the next one.",
    ].join("\n"),
  );
}

async function held(ctx: PrefixContext, guildId: string, spot: Target): Promise<boolean> {
  if (await tracked(spot.messageId)) return true;
  await card(
    ctx,
    [`### ${HEADING}`, "That message is not paginated.", "", "-# `pagination set <link>` starts one."].join("\n"),
  );
  return false;
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "add a page");
  if (!guildId) return;

  const spot = target(ctx.argument, guildId);
  if (!spot) {
    await card(ctx, needLink("pagination add <link> {title: ...}{description: ...}"));
    return;
  }
  if (!(await held(ctx, guildId, spot))) return;

  const current = await load(spot.messageId);
  if ((current?.pages.length ?? 0) >= MAX_PAGES) {
    await card(ctx, [`### ${HEADING}`, `That message already holds ${MAX_PAGES} pages.`].join("\n"));
    return;
  }

  const { embed, problems } = parseEmbed(spot.rest);
  if (!embed) {
    await card(ctx, [`### ${HEADING}`, "That page code does not work.", "", problems.map((line) => `-# ${line}`).join("\n")].join("\n"));
    return;
  }

  const pageId = await addPage(spot.messageId, embed);
  await render(spot.messageId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Added page \`${pageId}\` · ${describe(embed)}`,
      problems.length ? problems.map((line) => `-# ${line}`).join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function update(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "update a page");
  if (!guildId) return;

  const spot = target(ctx.argument, guildId);
  if (!spot) {
    await card(ctx, needLink("pagination update <link> <id> {title: ...}"));
    return;
  }
  if (!(await held(ctx, guildId, spot))) return;

  const [first, ...rest] = spot.rest.split(/\s+/);
  const pageId = Number.parseInt(first ?? "", 10);
  if (!Number.isFinite(pageId)) {
    await card(ctx, [`### ${HEADING}`, "Which page? Give me its id.", "", "-# `pagination list` shows them."].join("\n"));
    return;
  }

  const { embed, problems } = parseEmbed(rest.join(" "));
  if (!embed) {
    await card(ctx, [`### ${HEADING}`, "That page code does not work.", "", problems.map((line) => `-# ${line}`).join("\n")].join("\n"));
    return;
  }

  const done = await updatePage(spot.messageId, pageId, embed);
  if (!done) {
    await card(ctx, [`### ${HEADING}`, `There is no page \`${pageId}\` on that message.`].join("\n"));
    return;
  }

  await render(spot.messageId);
  await card(ctx, [`### ${HEADING}`, `Page \`${pageId}\` is now ${describe(embed)}`].join("\n"));
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "remove a page");
  if (!guildId) return;

  const spot = target(ctx.argument, guildId);
  if (!spot) {
    await card(ctx, needLink("pagination remove <link> <id>"));
    return;
  }
  if (!(await held(ctx, guildId, spot))) return;

  const pageId = Number.parseInt(spot.rest.split(/\s+/)[0] ?? "", 10);
  if (!Number.isFinite(pageId)) {
    await card(ctx, [`### ${HEADING}`, "Which page? Give me its id.", "", "-# `pagination list` shows them."].join("\n"));
    return;
  }

  const current = await load(spot.messageId);
  if ((current?.pages.length ?? 0) <= 1) {
    await card(
      ctx,
      [`### ${HEADING}`, "That is the only page left.", "", "-# `pagination delete <link>` removes the whole thing."].join("\n"),
    );
    return;
  }

  const gone = await removePage(spot.messageId, pageId);
  if (!gone) {
    await card(ctx, [`### ${HEADING}`, `There is no page \`${pageId}\` on that message.`].join("\n"));
    return;
  }

  const after = await load(spot.messageId);
  if (after && after.current > after.pages.length) await setCurrent(spot.messageId, after.pages.length);
  await render(spot.messageId);

  await card(ctx, [`### ${HEADING}`, `Page \`${pageId}\` is gone. ${after?.pages.length ?? 0} left.`].join("\n"));
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "list the paginations");
  if (!guildId) return;

  const all = await inGuild(guildId);
  if (all.length === 0) {
    await card(
      ctx,
      [`### ${HEADING}`, "Nothing is paginated yet.", "", "-# `pagination set <link>` starts one."].join("\n"),
    );
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      all
        .slice(0, 15)
        .map(
          (one) =>
            `[message](${jump(guildId, one.channelId, one.messageId)}) in <#${one.channelId}> · ${one.pages.length} page${one.pages.length === 1 ? "" : "s"}\n-# ids ${one.pages.map((page) => page.pageId).join(", ")}`,
        )
        .join("\n"),
      "",
      `-# ${all.length} of ${MAX_PAGINATIONS}${all.length > 15 ? ", showing the first 15" : ""}`,
    ].join("\n"),
  );
}

async function restore(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "restore the buttons");
  if (!guildId) return;

  const spot = target(ctx.argument, guildId);
  if (!spot) {
    await card(ctx, needLink("pagination restorereactions <link>"));
    return;
  }
  if (!(await held(ctx, guildId, spot))) return;

  const back = await render(spot.messageId);
  await card(
    ctx,
    [`### ${HEADING}`, "The buttons are back on that message.", "", ""].join("\n"),
  );
}

async function remove_all(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "delete a pagination");
  if (!guildId) return;

  const spot = target(ctx.argument, guildId);
  if (!spot) {
    await card(ctx, needLink("pagination delete <link>"));
    return;
  }

  const gone = await destroy(spot.messageId);
  await card(
    ctx,
    gone
      ? [`### ${HEADING}`, "That message is no longer paginated.", "", "-# The message itself is untouched."].join("\n")
      : [`### ${HEADING}`, "That message is not paginated."].join("\n"),
  );
}

async function resetAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "clear every pagination");
  if (!guildId) return;

  const gone = await wipeAll(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone === 0 ? "There was nothing to clear." : `Cleared ${gone} pagination${gone === 1 ? "" : "s"}.`,
      "",
      "-# The messages themselves are untouched.",
    ].join("\n"),
  );
}

export function registerPagination(): void {
  onComponent(TURN, async (interaction: any) => {
    const messageId = String(interaction.message?.id ?? "");
    const action = String(interaction.data?.customId ?? "").slice(TURN.length);
    if (!messageId || (action !== "prev" && action !== "next")) return;

    const held = await load(messageId);
    if (!held || held.pages.length < 2) {
      await interaction.deferEdit();
      return;
    }

    const total = held.pages.length;
    const at = Math.min(Math.max(held.current, 1), total);
    const next = action === "next" ? (at % total) + 1 : ((at - 2 + total) % total) + 1;

    await setCurrent(messageId, next);
    const body = await page(messageId);
    if (body) await interaction.edit(body);
    else await interaction.deferEdit();
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("pagination", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "pagination",
    aliases: ["pages", "paginate"],
    description: "Put several pages behind one message",
    handler,
  });

  groupUnder("pagination", () => {
    register({ name: "set", description: "Turn one of my embeds into page 1", handler: set });
    register({ name: "add", description: "Add a page", handler: add });
    register({ name: "update", aliases: ["edit"], description: "Rewrite one page", handler: update });
    register({ name: "remove", aliases: ["rm"], description: "Delete one page", handler: remove });
    register({ name: "list", aliases: ["all"], description: "Every pagination in this server", handler: list });
    register({
      name: "restorereactions",
      aliases: ["restore", "buttons"],
      description: "Put the buttons back on a pagination",
      handler: restore,
    });
    register({ name: "delete", description: "Stop paginating a message", handler: remove_all });
    register({ name: "reset", description: "Clear every pagination in this server", handler: resetAll });
  });
}
