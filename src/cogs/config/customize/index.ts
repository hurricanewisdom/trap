import { botId, editSelfMember, memberOf } from "../../../core/discord.js";
import { notice, requireOwner } from "../../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { plain } from "../../../helpers/markdown.js";
import { asDataUri } from "./images.js";
import { bio, saveBio } from "./store.js";

const HEADING = "Appearance";

const MOST_BIO = 190;

const CLEARING = new Set(["clear", "none", "reset", "remove", "off", "default"]);

async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply(notice([`### ${HEADING}`, ...lines].join("\n")));
}

function cdn(guildId: string, kind: "avatars" | "banners", hash: string): string {
  const moving = hash.startsWith("a_");
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${botId()}/${kind}/${hash}.${
    moving ? "gif" : "png"
  }?size=512`;
}

// Discord throttles these hard and says so precisely, which is worth passing on
// rather than flattening into "that did not work".
function why(message: string): string {
  if (/AVATAR_RATE_LIMIT|avatar too fast/i.test(message)) {
    return "Discord is refusing more avatar changes for now. It rations them; try again later.";
  }
  if (/BANNER_RATE_LIMIT|banner too fast/i.test(message)) {
    return "Discord is refusing more banner changes for now. It rations them; try again later.";
  }
  return message.slice(0, 180);
}

function picture(kind: "avatar" | "banner"): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireOwner(ctx, `change the bot's ${kind} here`);
    if (!guildId) return;

    const said = ctx.argument.trim();
    if (!said) {
      await card(ctx, [
        `What should the ${kind} be?`,
        "",
        `-# \`customize ${kind} <link to an image>\` · \`customize ${kind} clear\``,
      ]);
      return;
    }

    if (CLEARING.has(said.toLowerCase())) {
      const done = await editSelfMember(guildId, { [kind]: null });
      await card(
        ctx,
        done.ok
          ? [`The ${kind} is back to default in this server.`]
          : [`That did not work.`, "", `-# ${why(done.message)}`],
      );
      return;
    }

    const got = await asDataUri(said);
    if ("error" in got) {
      await card(ctx, [got.error, "", `-# \`customize ${kind} <link to an image>\``]);
      return;
    }

    const done = await editSelfMember(guildId, { [kind]: got.uri });
    if (!done.ok) {
      await card(ctx, ["That did not work.", "", `-# ${why(done.message)}`]);
      return;
    }

    await card(ctx, [
      `The bot's ${kind} in this server has changed.`,
      "",
      "-# Only here. Every other server sees the bot's usual one.",
    ]);
  };
}

async function setBio(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "change the bot's bio here");
  if (!guildId) return;

  const said = ctx.argument.trim();
  if (!said) {
    const held = await bio(guildId);
    await card(ctx, [
      held ? `The bio is:\n> ${plain(held)}` : "There is no bio here.",
      "",
      "-# `customize bio <text>` · `customize bio clear`",
    ]);
    return;
  }

  const clearing = CLEARING.has(said.toLowerCase());
  const text = clearing ? "" : said.slice(0, MOST_BIO);

  const done = await editSelfMember(guildId, { bio: text });
  if (!done.ok) {
    await card(ctx, ["That did not work.", "", `-# ${why(done.message)}`]);
    return;
  }

  await saveBio(guildId, clearing ? null : text);
  await card(
    ctx,
    clearing
      ? ["The bio is cleared in this server."]
      : [`The bio is now:`, `> ${plain(text)}`],
  );
}

async function overview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireOwner(ctx, "see the bot's appearance here");
  if (!guildId) return;

  const me = await memberOf(guildId, botId());
  const held = await bio(guildId);

  await card(ctx, [
    "What the bot looks like in this server.",
    `-# avatar: ${me?.avatar ? cdn(guildId, "avatars", me.avatar) : "default"}`,
    `-# banner: ${me?.banner ? cdn(guildId, "banners", me.banner) : "none"}`,
    `-# bio: ${held ? plain(held.slice(0, 120)) : "none"}`,
    "",
    "`customize avatar <link>` · `customize banner <link>` · `customize bio <text>`",
    "-# Any of them takes `clear` to undo it.",
    "-# Discord will not tell a bot its own bio, so that line is what was last set here.",
  ]);
}

export function registerCustomize(): void {
  const handler: PrefixHandler = async (ctx) => {
    const sub = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn("customize", sub) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await overview(ctx);
  };

  register({
    name: "customize",
    aliases: ["customise"],
    description: "Customize the bot's server appearance",
    handler,
  });

  groupUnder("customize", () => {
    register({
      name: "avatar",
      description: "Customize the bot's server avatar",
      handler: picture("avatar"),
    });
    register({
      name: "banner",
      description: "Customize the bot's server banner",
      handler: picture("banner"),
    });
    register({ name: "bio", description: "Customize the bot's server bio", handler: setBio });
  });
}
