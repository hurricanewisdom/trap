import { deleteRole, displayName, memberOf } from "../../../core/discord.js";
import type { PrefixContext } from "../../../core/prefix.js";
import { requireManageGuild } from "../../../core/permissions.js";
import { place } from "./member.js";
import {
  HEADING,
  belowMe,
  card,
  findRole,
  hierarchyNote,
  memberId,
  requireManager,
  roleById,
  words,
} from "./shared.js";
import {
  addFilter,
  allRoles,
  claim,
  config,
  dropFilter,
  filters,
  forgetRole,
  ownerOf,
  setConfig,
} from "./store.js";

const CLEANUP_CAP = 200;

export async function setBase(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "set the base role");
  if (!guildId) return;

  let raw = ctx.argument.trim();
  if (!raw) {
    const { baseRoleId, baseAbove } = await config(guildId);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        baseRoleId
          ? `New booster roles go ${baseAbove ? "above" : "below"} <@&${baseRoleId}>.`
          : "No base role is set.",
        "-# `boosterrole base [above|below] <role>` sets one, `boosterrole base none` clears it.",
      ].join("\n"),
    );
    return;
  }

  // `above` or `below` may lead, and below is the default because it is what
  // the command did before the word existed.
  const side = /^(above|below)\s+/i.exec(raw);
  const above = (side?.[1] ?? "below").toLowerCase() === "above";
  if (side) raw = raw.slice(side[0].length).trim();
  if (!raw) {
    await card(ctx, [`### ${HEADING}`, "Name the role to sit " + (above ? "under" : "over") + "."].join("\n"));
    return;
  }

  if (/^(none|off|clear|reset)$/i.test(raw)) {
    await setConfig(guildId, "base_role_id", null);
    await card(ctx, [`### ${HEADING}`, "Base role cleared."].join("\n"));
    return;
  }

  const role = await findRole(guildId, raw);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  await setConfig(guildId, "base_role_id", role.id);
  await setConfig(guildId, "base_above", above);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `New booster roles will sit ${above ? "above" : "below"} <@&${role.id}>.`,
      "-# `boosterrole sync` moves the ones already made.",
    ].join("\n"),
  );
}

export async function listRoles(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "list the booster roles");
  if (!guildId) return;

  const owned = await allRoles(guildId);
  if (owned.length === 0) {
    await card(ctx, [`### ${HEADING}`, "Nobody has a booster role yet."].join("\n"));
    return;
  }

  const lines: string[] = [];
  for (const entry of owned.slice(0, 25)) {
    const role = await roleById(guildId, entry.roleId);
    lines.push(`<@&${entry.roleId}> — <@${entry.userId}>${role ? "" : " *(role deleted)*"}`);
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      lines.join("\n"),
      "",
      `-# ${owned.length} booster role${owned.length === 1 ? "" : "s"}${owned.length > 25 ? ", showing 25" : ""}`,
    ].join("\n"),
  );
}

/**
 * Deletes every booster role in the server.
 *
 * Unlike `cleanup`, which only takes back roles whose owner stopped boosting,
 * this takes the lot. It says how many it is about to remove and does it, rather
 * than asking twice -- Manage Server is already the gate, and the roles are
 * recreated by their owners with one command.
 */
export async function clearAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "remove every booster role");
  if (!guildId) return;

  const owned = (await allRoles(guildId)).slice(0, CLEANUP_CAP);
  if (owned.length === 0) {
    await card(ctx, [`### ${HEADING}`, "There are no booster roles."].join("\n"));
    return;
  }

  let deleted = 0;
  let stuck = 0;
  for (const entry of owned) {
    await forgetRole(guildId, entry.roleId);
    const role = await roleById(guildId, entry.roleId);
    if (!role) continue;
    if (!(await belowMe(guildId, role))) {
      stuck += 1;
      continue;
    }
    const gone = await deleteRole(guildId, entry.roleId, "Booster roles cleared");
    if (gone.ok) deleted += 1;
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `Deleted ${deleted} booster role${deleted === 1 ? "" : "s"}.`,
      stuck
        ? `-# ${stuck} sat above my own role and were left alone, though they are no longer tracked.`
        : "",
      "-# Boosters can make a new one whenever they like.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/**
 * Tidies the booster roles and puts them back where they belong.
 *
 * `cleanup` deletes the ones whose owner stopped boosting; this does that and
 * then repositions everything still standing against the base role, which is
 * what drifts when the base is moved or a role is dragged by hand.
 */
export async function sync(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "sync the booster roles");
  if (!guildId) return;

  const { baseRoleId } = await config(guildId);
  const owned = (await allRoles(guildId)).slice(0, CLEANUP_CAP);
  if (owned.length === 0) {
    await card(ctx, [`### ${HEADING}`, "There are no booster roles to sync."].join("\n"));
    return;
  }

  let forgotten = 0;
  let moved = 0;
  let dropped = 0;
  const kept: string[] = [];

  for (const entry of owned) {
    const role = await roleById(guildId, entry.roleId);
    if (!role) {
      await forgetRole(guildId, entry.roleId);
      forgotten += 1;
      continue;
    }
    if (!(await belowMe(guildId, role))) continue;

    // What `cleanup` used to do on its own: a role whose owner stopped boosting
    // is deleted rather than repositioned.
    const member = await memberOf(guildId, entry.userId);
    if (!member?.premium_since) {
      await forgetRole(guildId, entry.roleId);
      const went = await deleteRole(guildId, entry.roleId, "Booster role sync: no longer boosting");
      if (went.ok) dropped += 1;
      continue;
    }

    kept.push(entry.roleId);
  }

  if (baseRoleId) {
    for (const roleId of kept) {
      await place(guildId, roleId);
      moved += 1;
    }
  }

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `${kept.length} booster role${kept.length === 1 ? "" : "s"} in place.`,
      dropped ? `-# Deleted ${dropped} whose owner stopped boosting.` : "",
      forgotten ? `-# Forgot ${forgotten} record${forgotten === 1 ? "" : "s"} whose role no longer exists.` : "",
      baseRoleId
        ? `-# Repositioned ${moved} against <@&${baseRoleId}>.`
        : "-# No base role is set, so nothing was moved. `boosterrole base <role>` sets one.",
""
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
