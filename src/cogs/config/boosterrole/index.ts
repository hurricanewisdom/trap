import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { requireGuild } from "../../../core/permissions.js";
import { HEADING, card, words } from "./shared.js";
import { iconRemove, removeOwn, rename, setColor, setDominant, setIcon } from "./member.js";
import { clearAll, listRoles, setBase, sync } from "./admin.js";
import { share, shareClear, shareLimit, shareList, shareRemove } from "./share.js";
import { includeAdd, includeClear, includeList, includeRemove } from "./include.js";

function dispatcher(path: string, fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const command = sub ? lookupIn(path, sub) : undefined;

    if (command) {
      await command.handler({ ...ctx, argument: ctx.argument.replace(/^\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

async function usage(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuild(ctx, "use booster roles");
  if (!guildId) return;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Boosters get one personal role they can colour and name.",
      "",
      "`boosterrole <colour> [second colour] [name]` makes or updates yours",
      "`boosterrole dominant [@member]` takes it from an avatar",
      "`boosterrole rename <name>` renames it",
      "`boosterrole icon <url>` sets its icon, `icon remove` clears it",
      "`boosterrole share <member>` lets someone else wear it",
      "`boosterrole remove` deletes it",
      "",
      "-# Admins: `base`, `include`, `list`, `sync`, `clear`.",
    ].join("\n"),
  );
}

/**
 * `color` is a word people type even though it is not a subcommand.
 *
 * The spec lists it as an alias of the group, but Last.fm already answers to
 * `,color` for `,lfcolor` and the configuration cog loads first, so claiming it
 * outright would quietly take that command away. Swallowing the word here means
 * `,boosterrole color red` keeps working without the registry claiming a name
 * that belongs to something else.
 */
async function root(ctx: PrefixContext): Promise<void> {
  const argument = ctx.argument.replace(/^(?:colou?r)\s+/i, "");

  if (!argument.trim()) {
    await usage(ctx);
    return;
  }
  await setColor({ ...ctx, argument });
}

export function registerBoosterRole(): void {
  register({
    name: "boosterrole",
    // `color` is deliberately not here; see `root` above.
    aliases: ["br", "cr", "boostrole"],
    description: "Assign a custom color to yourself",
    handler: dispatcher("boosterrole", root),
  });

  groupUnder("boosterrole", () => {
    register({
      name: "base",
      aliases: ["set"],
      description: "Set the base position for booster roles",
      handler: setBase,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all booster roles",
      handler: clearAll,
    });

    register({
      name: "dominant",
      aliases: ["avatar", "pfp", "av"],
      description: "Use the dominant color of your avatar",
      handler: setDominant,
    });

    register({
      name: "icon",
      aliases: ["image", "img"],
      description: "Change the icon of your booster role",
      handler: dispatcher("boosterrole icon", setIcon),
    });

    register({
      name: "include",
      aliases: ["allow", "inc", "i"],
      description: "Allow a role to create booster roles",
      handler: dispatcher("boosterrole include", includeAdd),
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View all booster roles",
      handler: listRoles,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove your booster role",
      handler: removeOwn,
    });

    register({
      name: "rename",
      aliases: ["name"],
      description: "Change the name of your booster role",
      handler: rename,
    });

    register({
      name: "share",
      aliases: ["give", "unshare"],
      description: "Share your booster role with another member",
      handler: dispatcher("boosterrole share", share),
    });

    register({
      name: "sync",
      aliases: ["organized"],
      description: "Clean up and reposition booster roles",
      handler: sync,
    });
  });

  groupUnder("boosterrole icon", () => {
    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove the icon of your booster role",
      handler: iconRemove,
    });
  });

  groupUnder("boosterrole include", () => {
    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all exceptions and only allow boosters to create roles",
      handler: includeClear,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View the roles that can create booster roles",
      handler: includeList,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Disallow a role from creating booster roles",
      handler: includeRemove,
    });
  });

  groupUnder("boosterrole share", () => {
    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove your booster role from all members with it",
      handler: shareClear,
    });

    register({
      name: "limit",
      aliases: ["max"],
      description: "Restrict how many members can share one booster role",
      handler: shareLimit,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "View members with your booster role shared",
      handler: shareList,
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Remove a booster role you've received from another member",
      handler: shareRemove,
    });
  });
}
