/**
 * The `,lastfm` group.
 *
 * `,lf`         link status
 * `,lf link`    sends an authorisation link by DM
 * `,lf unlink`  removes the link (alias: remove)
 */

import { configured } from "../../../core/env.js";
import { lookup, register, type PrefixContext } from "../../../core/prefix.js";
import { ButtonStyle, ComponentType, IS_COMPONENTS_V2, container, row, section, separator, text } from "../../../helpers/components.js";
import { authorizeUrl, getUserInfo, LastfmError } from "../api/index.js";
import { createLinkState, getUsername, removeLink } from "../store.js";
import { nowPlayingHandler } from "./nowplaying.js";

const ACCENT = 0xd51007; // Last.fm red

/** Renders a Components V2 card so replies match the rest of the bot. */
function card(body: string, accent = ACCENT) {
  return {
    flags: IS_COMPONENTS_V2,
    components: [container(accent, text(body))],
  };
}

function notConfigured() {
  return card(
    "### Last.fm is not set up\nThe bot has no Last.fm API credentials, so linking cannot run here.",
    0x2b2d31,
  );
}

async function showStatus(ctx: PrefixContext): Promise<void> {
  if (!configured("LASTFM_API_KEY", "LASTFM_API_SECRET")) {
    await ctx.reply(notConfigured());
    return;
  }

  const username = await getUsername(ctx.authorId);
  if (!username) {
    await ctx.reply(
      card(
        [
          "### Last.fm",
          "No account is linked to you.",
          "",
          "Run `,lf link` and authorise the bot on Last.fm.",
        ].join("\n"),
      ),
    );
    return;
  }

  // The profile call is best-effort: a linked account still shows without it.
  let detail = "";
  try {
    const info = await getUserInfo(username);
    const plays = Number(info.playcount).toLocaleString("en-US");
    detail = `\n${plays} scrobbles`;
  } catch {
    detail = "";
  }

  await ctx.reply({
    flags: IS_COMPONENTS_V2,
    components: [
      container(
        ACCENT,
        section(
          {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: "Open profile",
            url: `https://www.last.fm/user/${encodeURIComponent(username)}`,
          },
          "### Last.fm",
          `Linked to **${username}**${detail}`,
        ),
        separator(false),
        text("-# `,lf unlink` to disconnect"),
      ),
    ],
  });
}

async function startLink(ctx: PrefixContext): Promise<void> {
  if (!configured("LASTFM_API_KEY", "LASTFM_API_SECRET")) {
    await ctx.reply(notConfigured());
    return;
  }

  const existing = await getUsername(ctx.authorId);
  const state = await createLinkState(ctx.authorId);
  const url = authorizeUrl(state);

  // The link carries a single-use token that binds whoever authorises it to
  // this Discord account, so it goes by DM rather than into a channel.
  const sent = await ctx.dm({
    flags: IS_COMPONENTS_V2,
    components: [
      container(
        ACCENT,
        section(
          {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: "Authorise Last.fm",
            url,
          },
          "### Connect your Last.fm",
          existing
            ? `Linked to **${existing}** at the moment. Authorising again replaces it.`
            : "Use the button to approve access on Last.fm.",
        ),
        separator(false),
        text("-# The link is personal and expires in 10 minutes. Do not share it."),
      ),
    ],
  });

  if (sent) {
    await ctx.reply(card("### Check your DMs\nI sent you a link to authorise Last.fm."));
    return;
  }

  await ctx.reply(
    card(
      [
        "### I could not DM you",
        "Your privacy settings block direct messages from this server.",
        "Allow them and run `,lf link` again.",
      ].join("\n"),
      0x2b2d31,
    ),
  );
}

async function unlink(ctx: PrefixContext): Promise<void> {
  const removed = await removeLink(ctx.authorId);
  await ctx.reply(
    card(
      removed
        ? `### Unlinked\nThe link to **${removed}** is gone.`
        : "### Nothing to unlink\nNo Last.fm account is linked to you.",
      removed ? ACCENT : 0x2b2d31,
    ),
  );
}

async function handle(ctx: PrefixContext): Promise<void> {
  const [sub = ""] = ctx.argument.split(/\s+/);
  try {
    switch (sub.toLowerCase()) {
      case "":
        await showStatus(ctx);
        break;
      case "link":
      case "login":
      case "connect":
        await startLink(ctx);
        break;
      case "unlink":
      case "remove":
      case "logout":
        await unlink(ctx);
        break;
      case "np":
      case "now":
      case "nowplaying":
        // Same command, reached as a subcommand; strip "np" from the argument.
        await nowPlayingHandler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
        break;
      default: {
        /**
         * Anything else is looked up as a command in this cog, so every
         * Last.fm command is reachable as a subcommand: ",lf tt" runs the
         * same handler as ",toptracks". The group itself is excluded, or
         * ",lf lastfm" would call straight back into here.
         */
        const command = lookup(sub);
        if (command && command.cog === "lastfm" && command.name !== "lastfm") {
          await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
          break;
        }

        await ctx.reply(
          card(
            [
              "### Last.fm",
              `\`,lf\` shows your linked account`,
              "`,lf link` connects an account",
              "`,lf unlink` disconnects it",
              "",
              `Every Last.fm command also works here: \`,lf tt\`, \`,lf np\`, \`,lf wk radiohead\`.`,
              "-# `,help lastfm` lists them all.",
            ].join("\n"),
            0x2b2d31,
          ),
        );
      }
    }
  } catch (err) {
    const message =
      err instanceof LastfmError ? `Last.fm said: ${err.message}` : "Something went wrong.";
    console.error("lastfm command failed:", err);
    await ctx.reply(card(`### Error\n${message}`, 0x2b2d31));
  }
}

export function registerAccount(): void {
  register({
    name: "lastfm",
    aliases: ["lf"],
    description: "Link and inspect your Last.fm account",
    handler: handle,
  });
}
