import { botId, editSelfMember, memberOf } from "../../../core/discord.js";
import { notice, requireOwner } from "../../../core/permissions.js";
import { KINDS, provideStyle } from "../../../core/style.js";
import {
  resetDisplay,
  resetEverything,
  responseOverview,
  responseSetter,
  setDisplay,
  toggle,
} from "./profile.js";
import { styleOf } from "./settings.js";
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
  // core asks for the style, this cog answers. The reply path never imports a
  // cog, so the styling works with the cog absent and simply does nothing.
  provideStyle(styleOf);

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

  // Every one of these is Server Owner, like the three that were here first.
  const owned =
    (what: string, run: (ctx: PrefixContext, guildId: string) => Promise<void>): PrefixHandler =>
    async (ctx) => {
      const guildId = await requireOwner(ctx, what);
      if (!guildId) return;
      await run(ctx, guildId);
    };

  const sub = (path: string, fallback: PrefixHandler): PrefixHandler => async (ctx) => {
    const first = ctx.argument.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const found = first ? lookupIn(path, first) : undefined;

    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };

  groupUnder("customize", () => {
    register({
      name: "avatar",
      aliases: ["pfp", "av"],
      description: "Change the bot's avatar",
      handler: sub("customize avatar", picture("avatar")),
    });
    register({
      name: "banner",
      description: "Change the bot's banner",
      handler: sub("customize banner", picture("banner")),
    });
    register({
      name: "bio",
      aliases: ["about", "description"],
      description: "Change the bot's bio",
      handler: setBio,
    });
    register({
      name: "display",
      aliases: ["style", "effect", "font", "name"],
      description: "Change the bot's display name",
      handler: sub("customize display", owned("change my name here", setDisplay)),
    });
    register({
      name: "ping",
      aliases: ["mention", "pings", "mentions"],
      description: "Toggle whether the bot mentions users in its responses",
      handler: owned("change whether I ping people", toggle("ping", "Pinging people in my replies")),
    });
    register({
      name: "punctuation",
      aliases: ["punctuate", "periods", "fullstops", "fullstop", "grammar", "punc"],
      description: "Toggle whether responses end in a full stop",
      handler: owned(
        "change my punctuation",
        toggle("punctuation", "A full stop at the end of a reply"),
      ),
    });
    register({
      name: "reset",
      aliases: ["clear", "default"],
      description: "Reset the bot's profile to default",
      handler: owned("reset my profile here", resetEverything),
    });
    register({
      name: "response",
      aliases: ["msgs", "invoke"],
      description: "Customize the responses by the bot",
      handler: sub("customize response", owned("see my responses", responseOverview)),
    });
  });

  groupUnder("customize avatar", () => {
    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Reset the bot's avatar to default",
      handler: (ctx) => picture("avatar")({ ...ctx, argument: "clear" }),
    });
  });

  groupUnder("customize banner", () => {
    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove the bot's banner",
      handler: (ctx) => picture("banner")({ ...ctx, argument: "clear" }),
    });
  });

  groupUnder("customize display", () => {
    register({
      name: "reset",
      aliases: ["default", "normal"],
      description: "Reset the bot's display name to default",
      handler: owned("reset my name here", resetDisplay),
    });
  });

  groupUnder("customize response", () => {
    for (const kind of KINDS) {
      register({
        name: kind,
        aliases:
          kind === "approve"
            ? ["success", "approval", "tick"]
            : kind === "default"
              ? ["neutral", "info"]
              : kind === "loading"
                ? ["progress", "wait", "working"]
                : ["warning", "error", "cross"],
        description: `Customize the response used for ${kind} messages`,
        handler: owned(`change my ${kind} responses`, responseSetter(kind)),
      });
    }

    register({
      name: "reset",
      aliases: ["clear", "normal"],
      description: "Reset the custom responses to their default values",
      handler: owned("reset my responses", async (ctx, guildId) => {
        const { clearStyles } = await import("./settings.js");
        await clearStyles(guildId);
        await ctx.reply(notice(["### Bot appearance", "My responses look ordinary again."].join("\n")));
      }),
    });
  });
}
