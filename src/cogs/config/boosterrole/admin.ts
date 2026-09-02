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

export async function setLimit(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "set the booster role limit");
  if (!guildId) return;

  const raw = words(ctx.argument)[0] ?? "";
  if (!raw) {
    const { roleLimit } = await config(guildId);
    await card(
      ctx,
      [
        `### ${HEADING}`,
        roleLimit === null ? "No limit is set." : `The limit is ${roleLimit}.`,
        "-# `boosterrole limit <number>` sets one, `boosterrole limit none` clears it.",
      ].join("\n"),
    );
    return;
  }

  if (/^(none|off|clear|reset)$/i.test(raw)) {
    await setConfig(guildId, "role_limit", null);
    await card(ctx, [`### ${HEADING}`, "Limit cleared."].join("\n"));
    return;
  }

  const limit = Number.parseInt(raw, 10);
  if (!Number.isInteger(limit) || limit < 0 || limit > 250) {
    await card(ctx, [`### ${HEADING}`, "Give a whole number between 0 and 250."].join("\n"));
    return;
  }

  await setConfig(guildId, "role_limit", limit);
  await card(
    ctx,
    [`### ${HEADING}`, `At most ${limit} booster role${limit === 1 ? "" : "s"} from now on.`].join("\n"),
  );
}

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

export async function cleanup(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "clean up booster roles");
  if (!guildId) return;

  const owned = (await allRoles(guildId)).slice(0, CLEANUP_CAP);
  if (owned.length === 0) {
    await card(ctx, [`### ${HEADING}`, "There are no booster roles to clean up."].join("\n"));
    return;
  }

  const removed: string[] = [];
  const stale: string[] = [];

  for (const entry of owned) {
    const role = await roleById(guildId, entry.roleId);
    if (!role) {
      await forgetRole(guildId, entry.roleId);
      stale.push(entry.roleId);
      continue;
    }

    const member = await memberOf(guildId, entry.userId);
    if (member?.premium_since) continue;

    await forgetRole(guildId, entry.roleId);
    const gone = await deleteRole(guildId, entry.roleId, "Booster role cleanup: no longer boosting");
    if (gone.ok) removed.push(role.name);
  }

  const lines = [`### ${HEADING}`];
  if (removed.length === 0 && stale.length === 0) {
    lines.push("Every booster role still belongs to a booster.");
  } else {
    if (removed.length) lines.push(`Deleted ${removed.length} role${removed.length === 1 ? "" : "s"} whose owner stopped boosting.`);
    if (stale.length) lines.push(`Forgot ${stale.length} record${stale.length === 1 ? "" : "s"} whose role no longer exists.`);
  }
  lines.push("", `-# Checked ${owned.length} record${owned.length === 1 ? "" : "s"}.`);
  await card(ctx, lines.join("\n"));
}

async function awardView(ctx: PrefixContext, guildId: string): Promise<void> {
  const { awardRoleId } = await config(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      awardRoleId ? `Boosters are given <@&${awardRoleId}>.` : "No award role is set.",
      "-# `boosterrole award <role>` sets one, `boosterrole award unset` clears it.",
    ].join("\n"),
  );
}

export async function awardShow(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "view the award role");
  if (!guildId) return;
  await awardView(ctx, guildId);
}

export async function awardClear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "clear the award role");
  if (!guildId) return;

  await setConfig(guildId, "award_role_id", null);
  await card(ctx, [`### ${HEADING}`, "Award role cleared."].join("\n"));
}

export async function award(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "set the award role");
  if (!guildId) return;

  const raw = ctx.argument.trim();
  if (!raw) {
    await awardView(ctx, guildId);
    return;
  }

  const role = await findRole(guildId, raw);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }
  if (!(await belowMe(guildId, role))) {
    await card(ctx, hierarchyNote(role));
    return;
  }

  await setConfig(guildId, "award_role_id", role.id);
  await card(ctx, [`### ${HEADING}`, `Anyone who boosts is given <@&${role.id}>.`].join("\n"));
}

export async function filterList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "see the booster name filter");
  if (!guildId) return;

  const banned = await filters(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      banned.length ? banned.map((word) => `\`${word}\``).join(" · ") : "No words are blocked.",
      "",
      `-# ${banned.length} blocked word${banned.length === 1 ? "" : "s"} · \`boosterrole filter <word>\` adds or removes one.`,
    ].join("\n"),
  );
}

export async function filter(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageGuild(ctx, "manage the booster name filter");
  if (!guildId) return;

  const word = ctx.argument.trim().toLowerCase().slice(0, 50);
  if (!word) {
    await filterList(ctx);
    return;
  }

  const added = await addFilter(guildId, word);
  if (!added) {
    await dropFilter(guildId, word);
    await card(ctx, [`### ${HEADING}`, `\`${word}\` is no longer blocked.`].join("\n"));
    return;
  }
  await card(ctx, [`### ${HEADING}`, `\`${word}\` is blocked in booster role names.`].join("\n"));
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

export async function link(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "link a booster role");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const userId = memberId(parts[0] ?? "");
  if (!userId || parts.length < 2) {
    await card(
      ctx,
      [`### ${HEADING}`, "Use `boosterrole link <member> <role>`."].join("\n"),
    );
    return;
  }

  const role = await findRole(guildId, parts.slice(1).join(" "));
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  const taken = await ownerOf(guildId, role.id);
  if (taken && taken !== userId) {
    await card(
      ctx,
      [`### ${HEADING}`, `<@&${role.id}> is already <@${taken}>'s booster role.`].join("\n"),
    );
    return;
  }

  await claim(guildId, userId, role.id);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@&${role.id}> is now <@${userId}>'s booster role.`,
      `-# ${await displayName(guildId, userId)} can edit it with \`boosterrole color\`.`,
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
  const kept: string[] = [];

  for (const entry of owned) {
    const role = await roleById(guildId, entry.roleId);
    if (!role) {
      await forgetRole(guildId, entry.roleId);
      forgotten += 1;
      continue;
    }
    if (!(await belowMe(guildId, role))) continue;
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
      forgotten ? `-# Forgot ${forgotten} record${forgotten === 1 ? "" : "s"} whose role no longer exists.` : "",
      baseRoleId
        ? `-# Repositioned ${moved} against <@&${baseRoleId}>.`
        : "-# No base role is set, so nothing was moved. `boosterrole base <role>` sets one.",
      "-# `boosterrole cleanup` is the one that deletes roles whose owner stopped boosting.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
