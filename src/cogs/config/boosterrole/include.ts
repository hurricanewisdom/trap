import { sql } from "../../../core/db.js";
import type { PrefixContext } from "../../../core/prefix.js";
import { HEADING, card, findRole, requireManager, roleList, words } from "./shared.js";

/**
 * Roles allowed to make a booster role without boosting.
 *
 * Kept in its own table rather than a column on the config row, because it is a
 * list: staff, a paid tier, whoever the server decides. `requireBooster()`
 * checks it, so every member command opens up the same way at once.
 */
const MAX_INCLUDED = 20;

const CACHE_MS = 60_000;

const cache = new Map<string, { ids: string[]; at: number }>();

export function forgetIncluded(guildId: string): void {
  cache.delete(guildId);
}

export async function includedRoles(guildId: string): Promise<string[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;

  let ids: string[];
  try {
    const rows = await sql<{ role_id: string }[]>`
      SELECT role_id FROM booster_include WHERE guild_id = ${guildId} ORDER BY added_at
    `;
    ids = rows.map((row) => row.role_id);
  } catch {
    // Failing to an empty list means "boosters only", which is the setting the
    // server had before anyone added an exception. Failing to the last known
    // list would be worse: a database blip should not hand out the ability to
    // make roles.
    return hit?.ids ?? [];
  }

  cache.set(guildId, { ids, at: Date.now() });
  return ids;
}

/** Whether this member holds one of the included roles. */
export async function isIncluded(guildId: string, roleIds: string[]): Promise<boolean> {
  const allowed = await includedRoles(guildId);
  return allowed.length > 0 && roleIds.some((id) => allowed.includes(id));
}

export async function includeAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "let a role make booster roles");
  if (!guildId) return;

  const raw = ctx.argument.trim();
  if (!raw) {
    await includeList(ctx);
    return;
  }

  const role = await findRole(guildId, raw);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }
  if (role.id === guildId) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        "Including @everyone would let the whole server make booster roles.",
        "-# Name a real role, or the feature stops being about boosting at all.",
      ].join("\n"),
    );
    return;
  }

  const held = await includedRoles(guildId);
  if (held.includes(role.id)) {
    await card(ctx, [`### ${HEADING}`, `<@&${role.id}> can already make one.`].join("\n"));
    return;
  }
  if (held.length >= MAX_INCLUDED) {
    await card(ctx, [`### ${HEADING}`, `That is ${MAX_INCLUDED} roles already.`].join("\n"));
    return;
  }

  await sql`
    INSERT INTO booster_include (guild_id, role_id) VALUES (${guildId}, ${role.id})
    ON CONFLICT (guild_id, role_id) DO NOTHING
  `;
  forgetIncluded(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@&${role.id}> can make a booster role without boosting.`,
      `-# ${held.length + 1} of ${MAX_INCLUDED} · they keep it if they lose the role, until \`boosterrole sync\` tidies up`,
    ].join("\n"),
  );
}

export async function includeRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "stop a role making booster roles");
  if (!guildId) return;

  const raw = ctx.argument.trim();
  if (!raw) {
    await card(ctx, [`### ${HEADING}`, "Name the role to remove."].join("\n"));
    return;
  }

  // A deleted role can still be listed, so an id typed straight in has to work.
  const role = await findRole(guildId, raw);
  const roleId = role?.id ?? (/^\d{15,25}$/.test(raw) ? raw : null);
  if (!roleId) {
    await card(ctx, [`### ${HEADING}`, "I cannot find that role."].join("\n"));
    return;
  }

  const rows = await sql`
    DELETE FROM booster_include
    WHERE guild_id = ${guildId} AND role_id = ${roleId} RETURNING role_id
  `;
  forgetIncluded(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.length
        ? `<@&${roleId}> can no longer make a booster role. Roles already made stay.`
        : "That role was not on the list.",
    ].join("\n"),
  );
}

export async function includeClear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "clear the booster role exceptions");
  if (!guildId) return;

  const rows = await sql`
    DELETE FROM booster_include WHERE guild_id = ${guildId} RETURNING role_id
  `;
  forgetIncluded(guildId);

  await card(
    ctx,
    [
      `### ${HEADING}`,
      rows.length === 0
        ? "There were no exceptions; only boosters could make a role."
        : `${rows.length} removed. Only boosters can make a role now, and the ones already made stay.`,
    ].join("\n"),
  );
}

export async function includeList(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManager(ctx, "see the booster role exceptions");
  if (!guildId) return;

  const held = await includedRoles(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      held.length
        ? `These can make a booster role without boosting:\n${roleList(held)}`
        : "Only boosters can make a booster role.",
      "",
      `-# \`boosterrole include <role>\` adds one${held.length ? ` · ${held.length} of ${MAX_INCLUDED}` : ""}`,
    ].join("\n"),
  );
}

export function includedCount(ids: string[]): number {
  return ids.length;
}

export { words };
