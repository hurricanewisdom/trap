import { onComponent } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { render as renderScript } from "../greetings/variables.js";
import { PREFIX, render } from "./render.js";
import {
  MAX_PER_MESSAGE,
  STYLES,
  addButton,
  buttonById,
  buttonsIn,
  buttonsOn,
  clearGuild,
  clearMessage,
  latestIn,
  removeButton,
  reorder,
  setField,
  styleName,
} from "./store.js";

const HEADING = "Response buttons";

const LINK = /channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})/;

const EMOJI = /^(?:<a?:[\w~]+:\d{15,25}>|\p{Extended_Pictographic}[\u{FE0F}\u{20E3}]*)$/u;

/** Where a label stops and the script starts. A script routinely has commas in
 * it, so the separator has to be something a sentence does not carry. */
const SPLIT = "|";

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

interface Target {
  channelId: string;
  messageId: string;
  rest: string;
}

/**
 * Pulls the message out of the argument, or falls back to the last one
 * configured in this channel.
 *
 * The spec makes the message optional on every command, and this is what makes
 * that work: give a link once, then keep working on the same message.
 */
async function target(ctx: PrefixContext, guildId: string): Promise<Target | null> {
  const tokens = words(ctx.argument);
  const at = tokens.findIndex((token) => LINK.test(token));

  if (at >= 0) {
    const match = LINK.exec(tokens[at] as string);
    if (!match || match[1] !== guildId) {
      await card(ctx, [`### ${HEADING}`, "That link points at another server."].join("\n"));
      return null;
    }
    tokens.splice(at, 1);
    return {
      channelId: match[2] as string,
      messageId: match[3] as string,
      rest: tokens.join(" ").trim(),
    };
  }

  const messageId = await latestIn(guildId, ctx.channelId);
  if (!messageId) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Give me a message link from this server.",
        "",
        "-# Right click one of my messages and Copy Message Link.",
        "-# After the first one, this channel remembers it and the link is optional.",
      ].join("\n"),
    );
    return null;
  }
  return { channelId: ctx.channelId, messageId, rest: tokens.join(" ").trim() };
}

/** The button at a 1-based index on a message, or a card saying why not. */
async function pick(
  ctx: PrefixContext,
  messageId: string,
  raw: string | undefined,
): Promise<{ id: string; position: number } | null> {
  const held = await buttonsOn(messageId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "That message has no response buttons."].join("\n"));
    return null;
  }

  const index = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(index) || index < 1 || index > held.length) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        held.length === 1 ? "There is one button, so the index is 1." : `Give an index from 1 to ${held.length}.`,
      ].join("\n"),
    );
    return null;
  }

  const one = held[index - 1] as { id: string };
  return { id: one.id, position: index };
}

function describe(one: { position: number; style: number; emoji: string | null; label: string | null; script: string }): string {
  const face = [one.emoji ?? "", one.label ?? ""].filter(Boolean).join(" ") || "(no label)";
  return `**${one.position}.** ${face} — \`${styleName(one.style)}\` · ${one.script.slice(0, 60)}${one.script.length > 60 ? "…" : ""}`;
}

async function afterChange(ctx: PrefixContext, spot: Target, said: string[]): Promise<void> {
  const done = await render(spot.channelId, spot.messageId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      ...said,
      done.ok ? "" : `-# The message was not updated: ${done.why}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the response buttons");
  if (!guildId) return;

  const held = await buttonsIn(guildId);
  const messages = new Set(held.map((one) => one.messageId));

  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? `${held.length} button${held.length === 1 ? "" : "s"} across ${messages.size} message${messages.size === 1 ? "" : "s"}.`
        : "No message has response buttons yet.",
      "",
      "`button add <link> [style] [emoji] label | what it replies` attaches one",
      "`button list` shows them all, `button remove <index>` takes one off",
      "",
      "-# The reply is only ever shown to whoever pressed the button.",
    ].join("\n"),
  );
}

async function add(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "add a response button");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const held = await buttonsOn(spot.messageId);
  if (held.length >= MAX_PER_MESSAGE) {
    await card(ctx, [`### ${HEADING}`, `That message already holds ${MAX_PER_MESSAGE} buttons.`].join("\n"));
    return;
  }

  // [style] [emoji] come first if they are there at all, then the rest splits
  // on a pipe into the label and the script.
  const tokens = words(spot.rest);
  let style = 2;
  if (tokens[0] && STYLES[tokens[0].toLowerCase()] !== undefined) {
    style = STYLES[(tokens.shift() as string).toLowerCase()] as number;
  }
  let emoji: string | null = null;
  if (tokens[0] && EMOJI.test(tokens[0])) emoji = tokens.shift() as string;

  const rest = tokens.join(" ").trim();
  const cut = rest.indexOf(SPLIT);
  const label = cut >= 0 ? rest.slice(0, cut).trim() : "";
  const script = (cut >= 0 ? rest.slice(cut + 1) : rest).trim();

  if (!script) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Tell me what the button should reply with.",
        "",
        "-# `button add <link> [style] [emoji] Label | the reply`",
        "-# Everything before the `|` is the label; without one it is all reply.",
      ].join("\n"),
    );
    return;
  }
  if (!label && !emoji) {
    await card(
      ctx,
      [`### ${HEADING}`, "A button needs a label or an emoji, or nobody can tell what it is."].join("\n"),
    );
    return;
  }

  const position = await addButton(guildId, spot.channelId, spot.messageId, {
    style,
    emoji,
    label: label.slice(0, 80) || null,
    script: script.slice(0, 1800),
  });

  await afterChange(ctx, spot, [`Added button **${position}** — ${styleName(style)}.`]);
}

async function remove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "remove a response button");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const one = await pick(ctx, spot.messageId, words(spot.rest)[0]);
  if (!one) return;

  await removeButton(one.id);
  // Renumber, so the indexes on the next `button list` are the ones the other
  // commands take.
  await reorder((await buttonsOn(spot.messageId)).map((row) => row.id));
  await afterChange(ctx, spot, [`Removed button **${one.position}**.`]);
}

async function clear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "clear the response buttons");
  if (!guildId) return;

  // With a link it clears that message; bare it clears the server, which is
  // what the spec asks for and worth saying out loud in the reply.
  const tokens = words(ctx.argument);
  if (tokens.some((token) => LINK.test(token))) {
    const spot = await target(ctx, guildId);
    if (!spot) return;
    const gone = await clearMessage(spot.messageId);
    await afterChange(ctx, spot, [
      gone === 0 ? "That message had no buttons." : `Removed ${gone} from that message.`,
    ]);
    return;
  }

  const { removed, messages } = await clearGuild(guildId);
  for (const one of messages) await render(one.channelId, one.messageId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      removed === 0
        ? "There were no response buttons in this server."
        : `Removed ${removed} button${removed === 1 ? "" : "s"} from ${messages.length} message${messages.length === 1 ? "" : "s"}.`,
      messages.length ? "-# The messages themselves are untouched." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function list(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the response buttons");
  if (!guildId) return;

  const held = await buttonsIn(guildId);
  if (held.length === 0) {
    await card(ctx, [`### ${HEADING}`, "No message has response buttons yet."].join("\n"));
    return;
  }

  const byMessage = new Map<string, typeof held>();
  for (const one of held) {
    const list = byMessage.get(one.messageId);
    if (list) list.push(one);
    else byMessage.set(one.messageId, [one]);
  }

  const blocks = [...byMessage.entries()].map(([messageId, ones]) => {
    const link = `https://discord.com/channels/${guildId}/${ones[0]?.channelId}/${messageId}`;
    return [`[message](${link}) in <#${ones[0]?.channelId}>`, ...ones.map(describe)].join("\n");
  });

  await card(
    ctx,
    [`### ${HEADING}`, blocks.join("\n\n"), "", `-# ${held.length} across ${byMessage.size} message${byMessage.size === 1 ? "" : "s"}`].join("\n"),
  );
}

async function view(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "read a response button");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const one = await pick(ctx, spot.messageId, words(spot.rest)[0]);
  if (!one) return;

  const held = await buttonById(one.id);
  if (!held) return;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Button **${one.position}** — \`${styleName(held.style)}\`${held.emoji ? ` · ${held.emoji}` : ""}${held.label ? ` · ${held.label}` : ""}`,
      "",
      `>>> ${held.script}`,
    ].join("\n"),
  );
}

async function edit(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change a response button");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = words(spot.rest);
  const one = await pick(ctx, spot.messageId, tokens[0]);
  if (!one) return;

  const script = tokens.slice(1).join(" ").trim();
  if (!script) {
    await card(ctx, [`### ${HEADING}`, "Give me the new reply."].join("\n"));
    return;
  }

  await setField(one.id, "script", script.slice(0, 1800));
  // The script is not on the button itself, so nothing needs re-rendering.
  await card(ctx, [`### ${HEADING}`, `Button **${one.position}** replies with that now.`].join("\n"));
}

async function style(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "restyle a response button");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = words(spot.rest);
  const one = await pick(ctx, spot.messageId, tokens[0]);
  if (!one) return;

  const wanted = STYLES[(tokens[1] ?? "").toLowerCase()];
  if (wanted === undefined) {
    await card(
      ctx,
      [`### ${HEADING}`, "Pick one of `primary`, `secondary`, `success` or `danger`."].join("\n"),
    );
    return;
  }

  await setField(one.id, "style", wanted);
  await afterChange(ctx, spot, [`Button **${one.position}** is ${styleName(wanted)} now.`]);
}

async function label(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "relabel a response button");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = words(spot.rest);
  const one = await pick(ctx, spot.messageId, tokens[0]);
  if (!one) return;

  const wanted = tokens.slice(1).join(" ").trim();
  const held = await buttonById(one.id);
  if (!wanted && !held?.emoji) {
    await card(
      ctx,
      [`### ${HEADING}`, "That button has no emoji, so it needs to keep its label."].join("\n"),
    );
    return;
  }

  await setField(one.id, "label", wanted ? wanted.slice(0, 80) : null);
  await afterChange(ctx, spot, [
    wanted ? `Button **${one.position}** reads "${wanted.slice(0, 80)}".` : `Button **${one.position}** has no label now.`,
  ]);
}

async function emoji(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "change a response button's emoji");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = words(spot.rest);
  const one = await pick(ctx, spot.messageId, tokens[0]);
  if (!one) return;

  const wanted = tokens[1];
  if (wanted && !EMOJI.test(wanted)) {
    await card(ctx, [`### ${HEADING}`, "Give one emoji, or nothing to clear it."].join("\n"));
    return;
  }

  const held = await buttonById(one.id);
  if (!wanted && !held?.label) {
    await card(
      ctx,
      [`### ${HEADING}`, "That button has no label, so it needs to keep its emoji."].join("\n"),
    );
    return;
  }

  await setField(one.id, "emoji", wanted ?? null);
  await afterChange(ctx, spot, [
    wanted ? `Button **${one.position}** wears ${wanted}.` : `Button **${one.position}** has no emoji now.`,
  ]);
}

async function move(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "reorder the response buttons");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const tokens = words(spot.rest);
  const one = await pick(ctx, spot.messageId, tokens[0]);
  if (!one) return;

  const held = await buttonsOn(spot.messageId);
  const to = Number.parseInt(tokens[1] ?? "", 10);
  if (!Number.isInteger(to) || to < 1 || to > held.length) {
    await card(ctx, [`### ${HEADING}`, `Give a position from 1 to ${held.length}.`].join("\n"));
    return;
  }

  const ids = held.map((row) => row.id);
  const [moved] = ids.splice(one.position - 1, 1);
  ids.splice(to - 1, 0, moved as string);
  await reorder(ids);

  await afterChange(ctx, spot, [`Button **${one.position}** is now **${to}**.`]);
}

async function refresh(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "re-apply the response buttons");
  if (!guildId) return;

  const spot = await target(ctx, guildId);
  if (!spot) return;

  const done = await render(spot.channelId, spot.messageId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      done.ok
        ? done.count === 0
          ? "That message has no buttons, so it now has none on it either."
          : `Put ${done.count} button${done.count === 1 ? "" : "s"} back on that message.`
        : done.why,
    ].join("\n"),
  );
}

export function registerButtons(): void {
  onComponent(PREFIX, async (interaction: any) => {
    const id = String(interaction.data?.customId ?? "").slice(PREFIX.length);
    const held = await buttonById(id);
    if (!held) {
      await interaction.respond(
        { content: "That button is no longer configured." },
        { isPrivate: true },
      );
      return;
    }

    const body = await renderScript(held.script, {
      guildId: String(interaction.guildId ?? ""),
      channelId: String(interaction.channelId ?? ""),
      userId: String(interaction.user?.id ?? interaction.member?.id ?? ""),
    });

    // Always ephemeral: a response button answers the person who pressed it,
    // which is what lets one message serve a whole channel without filling it.
    await interaction.respond({ content: body.slice(0, 2000) }, { isPrivate: true });
  });

  const handler: PrefixHandler = async (ctx) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("button", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "button",
    aliases: ["responsebutton", "rbutton", "rb"],
    description: "Attach response buttons to messages",
    handler,
  });

  groupUnder("button", () => {
    register({
      name: "add",
      aliases: ["create", "new"],
      description: "Add an ephemeral-response button to a message",
      handler: add,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all response buttons from a message or from every message",
      handler: clear,
    });

    register({
      name: "edit",
      aliases: ["update"],
      description: "Replace the script that a button responds with",
      handler: edit,
    });

    register({
      name: "emoji",
      description: "Set or clear the emoji on a response button",
      handler: emoji,
    });

    register({
      name: "label",
      description: "Set or clear the text label on a response button",
      handler: label,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View every response button configured in this server",
      handler: list,
    });

    register({
      name: "move",
      description: "Re-order a response button by moving it to a new position",
      handler: move,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove a button from a message by its index",
      handler: remove,
    });

    register({
      name: "render",
      aliases: ["refresh", "sync"],
      description: "Re-apply all response buttons to a message",
      handler: refresh,
    });

    register({
      name: "style",
      description: "Change the style of a response button",
      handler: style,
    });

    register({
      name: "view",
      aliases: ["script", "show", "inspect"],
      description: "View the response script a button is configured with",
      handler: view,
    });
  });
}
