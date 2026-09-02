import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../../core/prefix.js";
import { requireGuild } from "../../../core/permissions.js";
import { onBoost } from "../../../core/hooks.js";
import { memberOf } from "../../../core/discord.js";
import { HEADING, awardIfDue, card, words } from "./shared.js";
import { iconRemove, removeOwn, rename, setColor, setDominant, setIcon, setRandom } from "./member.js";
import {
  award,
  awardClear,
  awardShow,
  cleanup,
  clearAll,
  sync,
  filter,
  filterList,
  link,
  listRoles,
  setBase,
  setLimit,
} from "./admin.js";
import { share, shareClear, shareLimit, shareList, shareMax, shareRemove } from "./share.js";
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
      "`boosterrole random` picks a colour for you",
      "`boosterrole dominant` takes it from your avatar",
      "`boosterrole rename <name>` renames it",
      "`boosterrole icon <url>` sets its icon",
      "`boosterrole share <member>` lets someone else wear it",
      "`boosterrole remove` deletes it",
      "",
      "-# Admins: `base`, `limit`, `award`, `filter`, `list`, `link`, `cleanup`.",
    ].join("\n"),
  );
}

async function root(ctx: PrefixContext): Promise<void> {
  if (!ctx.argument.trim()) {
    await usage(ctx);
    return;
  }
  await setColor(ctx);
}

export function registerBoosterRole(): void {
  onBoost(async (event) => {
    const member = await memberOf(event.guildId, event.userId);
    if (member) await awardIfDue(event.guildId, member);
  });

  register({
    name: "boosterrole",
    // `color` is not among these on purpose: Last.fm already answers to it for
    // `,lfcolor`, and the config cog loads first, so claiming it here would
    // silently take that command away. `,boosterrole color` still works.
    aliases: ["br", "cr", "boostrole"],
    description: "Give boosters a personal colour role",
    handler: dispatcher("boosterrole", root),
  });

  groupUnder("boosterrole", () => {
    register({
      name: "color",
      aliases: ["colour"],
      description: "Set your booster role colour and name",
      handler: setColor,
    });

    register({
      name: "random",
      description: "Give your booster role a random colour",
      handler: setRandom,
    });

    register({
      name: "dominant",
      aliases: ["avatar", "pfp", "av"],
      description: "Take your booster role colour from your avatar",
      handler: setDominant,
    });

    register({
      name: "rename",
      aliases: ["name"],
      description: "Rename your booster role",
      handler: rename,
    });

    register({
      name: "icon",
      aliases: ["image", "img"],
      description: "Set or clear your booster role icon",
      handler: dispatcher("boosterrole icon", setIcon),
    });

    register({
      name: "remove",
      aliases: ["delete", "del", "rm"],
      description: "Delete your booster role",
      handler: removeOwn,
    });

    register({
      name: "share",
      aliases: ["give", "unshare"],
      description: "Let other members wear your booster role",
      handler: dispatcher("boosterrole share", share),
    });

    register({
      name: "base",
      aliases: ["set"],
      description: "Set the role new booster roles are placed under",
      handler: setBase,
    });

    register({
      name: "limit",
      description: "Cap how many booster roles this server can hold",
      handler: setLimit,
    });

    register({
      name: "award",
      description: "Set a role given to anyone who boosts",
      handler: dispatcher("boosterrole award", award),
    });

    register({
      name: "filter",
      description: "Block words in booster role names",
      handler: dispatcher("boosterrole filter", filter),
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "Every booster role in this server",
      handler: listRoles,
    });

    register({
      name: "link",
      description: "Mark an existing role as someone's booster role",
      handler: link,
    });

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Delete every booster role in this server",
      handler: clearAll,
    });

    register({
      name: "sync",
      aliases: ["organized"],
      description: "Tidy the booster roles and put them back under the base",
      handler: sync,
    });

    register({
      name: "include",
      aliases: ["allow", "inc", "i"],
      description: "Let a role make booster roles without boosting",
      handler: dispatcher("boosterrole include", includeAdd),
    });

    register({
      name: "cleanup",
      description: "Delete booster roles whose owner stopped boosting",
      handler: cleanup,
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

    register({
      name: "clear",
      aliases: ["reset", "purge"],
      description: "Remove all exceptions and only allow boosters",
      handler: includeClear,
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
      name: "max",
      description: "How many members one booster role may hold",
      handler: shareMax,
    });

    register({
      name: "limit",
      description: "How many shared booster roles a member may wear",
      handler: shareLimit,
    });

    register({
      name: "list",
      aliases: ["ls"],
      description: "Who is wearing your booster role",
      handler: shareList,
    });

    register({
      name: "remove",
      aliases: ["leave", "delete", "del", "rm"],
      description: "Leave a booster role someone shared with you",
      handler: shareRemove,
    });
  });

  groupUnder("boosterrole award", () => {
    register({
      name: "view",
      description: "Show the role handed to boosters",
      handler: awardShow,
    });

    register({
      name: "unset",
      aliases: ["clear"],
      description: "Stop handing a role to boosters",
      handler: awardClear,
    });
  });

  groupUnder("boosterrole filter", () => {
    register({
      name: "list",
      description: "Every word blocked in booster role names",
      handler: filterList,
    });
  });
}
