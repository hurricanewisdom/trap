import { giveRole, takeRole } from "../../../core/discord.js";
import { requireManageGuild } from "../../../core/permissions.js";
import type { PrefixContext } from "../../../core/prefix.js";
import {
  HEADING,
  belowMe,
  card,
  findRole,
  hierarchyNote,
  memberId,
  requireBotRoles,
  requireGuildHere,
  words,
} from "./shared.js";
import { existing } from "./member.js";
import {
  config,
  setConfig,
  share as recordShare,
  sharedWith,
  sharesFor,
  unshare,
} from "./store.js";

async function setNumber(
  ctx: PrefixContext,
  field: "share_max" | "share_limit",
  raw: string,
  action: string,
  describe: (value: number | null) => string,
): Promise<void> {
  const guildId = await requireManageGuild(ctx, action);
  if (!guildId) return;

  const current = await config(guildId);
  const value = field === "share_max" ? current.shareMax : current.shareLimit;

  if (!raw) {
    await card(ctx, [`### ${HEADING}`, describe(value)].join("\n"));
    return;
  }

  if (/^(none|off|clear|reset)$/i.test(raw)) {
    await setConfig(guildId, field, null);
    await card(ctx, [`### ${HEADING}`, describe(null)].join("\n"));
    return;
  }

  const wanted = Number.parseInt(raw, 10);
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > 250) {
    await card(ctx, [`### ${HEADING}`, "Give a whole number between 0 and 250."].join("\n"));
    return;
  }

  await setConfig(guildId, field, wanted);
  await card(ctx, [`### ${HEADING}`, describe(wanted)].join("\n"));
}

export async function shareMax(ctx: PrefixContext): Promise<void> {
  await setNumber(ctx, "share_max", ctx.argument.trim(), "set the share size", (value) =>
    value === null
      ? "A booster role can be shared with any number of members."
      : `A booster role can hold ${value} shared member${value === 1 ? "" : "s"}.`,
  );
}

export async function shareLimit(ctx: PrefixContext): Promise<void> {
  await setNumber(ctx, "share_limit", ctx.argument.trim(), "set the share limit", (value) =>
    value === null
      ? "A member can be in any number of booster roles."
      : `A member can be in ${value} booster role${value === 1 ? "" : "s"}.`,
  );
}

export async function shareList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuildHere(ctx, "list a booster role's members");
  if (!guildId) return;

  const role = await existing(guildId, ctx.authorId);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "You do not have a booster role."].join("\n"));
    return;
  }

  const members = await sharedWith(guildId, role.id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@&${role.id}>`,
      members.length ? members.map((id) => `<@${id}>`).join(" · ") : "Nobody else is wearing it.",
      "",
      `-# ${members.length} shared member${members.length === 1 ? "" : "s"}`,
    ].join("\n"),
  );
}

export async function shareRemove(ctx: PrefixContext): Promise<void> {
  const raw = ctx.argument.trim();
  const guildId = await requireGuildHere(ctx, "leave a shared booster role");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  if (!raw) {
    const mine = await sharesFor(guildId, ctx.authorId);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        mine.length
          ? mine.map((id) => `<@&${id}>`).join(" · ")
          : "You are not in anyone else's booster role.",
        "",
        "-# `boosterrole share remove <role>` leaves one.",
      ].join("\n"),
    );
    return;
  }

  const role = await findRole(guildId, raw);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  const left = await unshare(guildId, role.id, ctx.authorId);
  if (!left) {
    await card(ctx, [`### ${HEADING}`, `You are not in <@&${role.id}>.`].join("\n"));
    return;
  }

  await takeRole(guildId, ctx.authorId, role.id, "Left a shared booster role");
  await card(ctx, [`### ${HEADING}`, `You left <@&${role.id}>.`].join("\n"));
}

export async function share(ctx: PrefixContext): Promise<void> {
  const token = words(ctx.argument)[0] ?? "";
  const guildId = await requireGuildHere(ctx, "share a booster role");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  const userId = memberId(token);
  if (!userId) {
    await card(
      ctx,
      [`### ${HEADING}`, "Use `boosterrole share <member>`, or `share list` to see who has it."].join("\n"),
    );
    return;
  }
  if (userId === ctx.authorId) {
    await card(ctx, [`### ${HEADING}`, "You already have your own role."].join("\n"));
    return;
  }

  const role = await existing(guildId, ctx.authorId);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "You do not have a booster role to share."].join("\n"));
    return;
  }
  if (!(await belowMe(guildId, role))) {
    await card(ctx, hierarchyNote(role));
    return;
  }

  const settings = await config(guildId);

  if (settings.shareMax !== null) {
    const already = await sharedWith(guildId, role.id);
    if (already.length >= settings.shareMax) {
      await card(
        ctx,
        [`### ${HEADING}`, `Your role already holds its limit of ${settings.shareMax} shared member${settings.shareMax === 1 ? "" : "s"}.`].join("\n"),
      );
      return;
    }
  }

  if (settings.shareLimit !== null) {
    const theirs = await sharesFor(guildId, userId);
    if (theirs.length >= settings.shareLimit) {
      await card(
        ctx,
        [`### ${HEADING}`, `<@${userId}> is already in ${settings.shareLimit} booster role${settings.shareLimit === 1 ? "" : "s"}.`].join("\n"),
      );
      return;
    }
  }

  const added = await recordShare(guildId, role.id, userId);
  if (!added) {
    await card(ctx, [`### ${HEADING}`, `<@${userId}> already has <@&${role.id}>.`].join("\n"));
    return;
  }

  const given = await giveRole(guildId, userId, role.id, `Shared booster role from ${ctx.authorId}`);
  if (!given.ok) {
    await unshare(guildId, role.id, userId);
    await card(
      ctx,
      [`### ${HEADING}`, "Discord refused to give out the role.", `-# ${given.message}`].join("\n"),
    );
    return;
  }

  await card(ctx, [`### ${HEADING}`, `<@${userId}> now wears <@&${role.id}>.`].join("\n"));
}

/**
 * Takes your booster role back off everyone wearing it.
 *
 * The role itself is untouched; only the shares go. Anyone who had it loses it
 * from their profile, which is the point of the command.
 */
export async function shareClear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireGuildHere(ctx, "unshare a booster role");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  const role = await existing(guildId, ctx.authorId);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "You do not have a booster role."].join("\n"));
    return;
  }

  const wearers = await sharedWith(guildId, role.id);
  if (wearers.length === 0) {
    await card(ctx, [`### ${HEADING}`, "Nobody is wearing your booster role."].join("\n"));
    return;
  }

  let taken = 0;
  for (const userId of wearers) {
    await unshare(guildId, role.id, userId);
    const gone = await takeRole(guildId, userId, role.id, "Booster role unshared");
    if (gone.ok) taken += 1;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Took <@&${role.id}> back from ${taken} member${taken === 1 ? "" : "s"}.`,
      taken === wearers.length ? "" : `-# ${wearers.length - taken} could not be changed, but are no longer recorded.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
