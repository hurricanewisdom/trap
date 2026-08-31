import { channelExists, pinnedMessages, sendMessage, unpinMessage, type PostedMessage } from "../../../core/discord.js";
import { onChannelPins } from "../../../core/hooks.js";
import { notice, requireManageGuild } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { switchWord } from "../../../helpers/flags.js";
import { plain } from "../../../helpers/markdown.js";
import { reset as wipe, save, setup } from "./store.js";

const HEADING = "Pin archive";

const CHANNEL = /^<#(\d{15,25})>$/;

const PIN_CAP = 50;

const ARCHIVE_AT = 45;

const PER_POST = 10;

const SNIPPET = 90;

const busy = new Set<string>();

async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function jump(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function line(guildId: string, channelId: string, message: PostedMessage): string {
  const body = (message.content ?? "").replace(/\n/g, " ").trim();
  const shown = body ? plain(body.slice(0, SNIPPET)) + (body.length > SNIPPET ? "..." : "") : "*no text*";
  return `<@${message.author?.id ?? "0"}> · [jump](${jump(guildId, channelId, message.id)})\n-# ${shown}`;
}

async function archive(
  guildId: string,
  channelId: string,
  into: string,
  alsoUnpin: boolean,
): Promise<{ count: number; posted: number } | string> {
  const held = await pinnedMessages(channelId);
  if (!held) return "I cannot read the pins in that channel.";
  if (held.length === 0) return "There are no pins there.";

  const oldestFirst = [...held].reverse();
  let posted = 0;

  for (let at = 0; at < oldestFirst.length; at += PER_POST) {
    const chunk = oldestFirst.slice(at, at + PER_POST);
    const body = [
      `### Pins from <#${channelId}>`,
      chunk.map((message) => line(guildId, channelId, message)).join("\n"),
      "",
      `-# ${at + 1}-${at + chunk.length} of ${oldestFirst.length}`,
    ].join("\n");

    const shown = notice(body);
    const sent = await sendMessage(into, {
      components: shown.components,
      flags: shown.flags,
      allowed_mentions: { parse: [] },
    });
    if (!sent.ok) return "I could not post in the archive channel.";
    posted += 1;
  }

  if (alsoUnpin) {
    for (const message of oldestFirst) {
      await unpinMessage(channelId, message.id, "Pin archive");
    }
  }

  return { count: oldestFirst.length, posted };
}

async function config(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the pin archive settings");
  if (!guildId) return;

  const held = await setup(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.enabled
        ? `On. At ${ARCHIVE_AT} pins in a channel I archive them automatically.`
        : "Off. Nothing is archived unless you run `pins archive`.",
      held.channelId ? `Archive channel: <#${held.channelId}>` : "No archive channel set.",
      `Unpinning after archiving: ${held.unpin ? "on" : "off"}`,
      "",
      "`pins channel #channel` sets where they go",
      "`pins set on` or `off` switches the automatic side",
      "`pins unpin on` or `off` decides whether archiving clears them",
      "`pins archive` archives this channel now",
      "`pins reset` clears all of it",
      "",
      `-# Discord caps a channel at ${PIN_CAP} pins.`,
    ].join("\n"),
  );
}

async function setChannel(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the archive channel");
  if (!guildId) return;

  const mention = CHANNEL.exec(ctx.argument.trim());
  if (!mention) {
    await card(ctx, [`### ${HEADING}`, "Give me a channel.", "", "-# `pins channel #channel`"].join("\n"));
    return;
  }

  const channelId = mention[1] as string;
  if (!(await channelExists(guildId, channelId))) {
    await card(ctx, [`### ${HEADING}`, "That channel is not in this server."].join("\n"));
    return;
  }

  await save(guildId, { channelId });
  await card(
    ctx,
    [`### ${HEADING}`, `Pins will be archived into <#${channelId}>.`].join("\n"),
  );
}

function toggler(
  field: "enabled" | "unpin",
  action: string,
  describes: (on: boolean) => string,
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageGuild(ctx, action);
    if (!guildId) return;

    const wanted = switchWord(ctx.argument.trim().split(/\s+/)[0] ?? "");
    if (wanted === null) {
      await card(ctx, [`### ${HEADING}`, "Say `on` or `off`."].join("\n"));
      return;
    }

    const held = await setup(guildId);
    if (field === "enabled" && wanted && !held.channelId) {
      await card(
        ctx,
        [`### ${HEADING}`, "Set the archive channel first.", "", "-# `pins channel #channel`"].join("\n"),
      );
      return;
    }

    await save(guildId, { [field]: wanted });
    await card(ctx, [`### ${HEADING}`, describes(wanted)].join("\n"));
  };
}

async function archiveHere(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "archive the pins");
  if (!guildId) return;

  const held = await setup(guildId);
  if (!held.channelId) {
    await card(
      ctx,
      [`### ${HEADING}`, "There is no archive channel yet.", "", "-# `pins channel #channel`"].join("\n"),
    );
    return;
  }
  if (held.channelId === ctx.channelId) {
    await card(ctx, [`### ${HEADING}`, "That would archive this channel into itself."].join("\n"));
    return;
  }

  const outcome = await archive(guildId, ctx.channelId, held.channelId, held.unpin);
  if (typeof outcome === "string") {
    await card(ctx, [`### ${HEADING}`, outcome].join("\n"));
    return;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Archived ${outcome.count} pin${outcome.count === 1 ? "" : "s"} into <#${held.channelId}>.`,
      held.unpin ? "-# They are unpinned here now." : "-# They are still pinned here.",
    ].join("\n"),
  );
}

async function resetAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "reset the pin archive settings");
  if (!guildId) return;

  const gone = await wipe(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone ? "The pin archive settings are cleared." : "There was nothing to clear.",
      "-# Nothing already archived is touched.",
    ].join("\n"),
  );
}

async function whenPinned(event: { guildId: string; channelId: string }): Promise<void> {
  const held = await setup(event.guildId);
  if (!held.enabled || !held.channelId) return;
  if (held.channelId === event.channelId) return;

  const pins = await pinnedMessages(event.channelId);
  if (!pins || pins.length < ARCHIVE_AT) return;

  const key = `${event.guildId}:${event.channelId}`;
  if (busy.has(key)) return;
  busy.add(key);

  try {
    await archive(event.guildId, event.channelId, held.channelId, held.unpin);
  } finally {
    busy.delete(key);
  }
}

export function registerPinArchive(): void {
  onChannelPins(whenPinned);

  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("pins", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await config(ctx);
  };

  register({
    name: "pins",
    aliases: ["pinarchive"],
    description: "Archive a channel's pins into another channel",
    handler,
  });

  groupUnder("pins", () => {
    register({ name: "config", aliases: ["settings"], description: "The pin archive settings", handler: config });
    register({
      name: "set",
      description: "Switch automatic archiving on or off",
      handler: toggler("enabled", "switch the pin archive on or off", (on) =>
        on
          ? `On. At ${ARCHIVE_AT} pins in a channel I archive them automatically.`
          : "Off. Only `pins archive` will move anything now.",
      ),
    });
    register({
      name: "unpin",
      description: "Whether archiving also unpins",
      handler: toggler("unpin", "change whether archiving unpins", (on) =>
        on ? "Archiving will unpin them afterwards." : "Archiving will leave them pinned.",
      ),
    });
    register({ name: "channel", description: "Where archived pins go", handler: setChannel });
    register({ name: "archive", description: "Archive this channel's pins now", handler: archiveHere });
    register({ name: "reset", description: "Clear the pin archive settings", handler: resetAll });
  });
}
