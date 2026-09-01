import { sql } from "../../../core/db.js";

/** Who a role is handed to. */
export type Targets = "all" | "humans" | "bots";

export interface AutoRole {
  roleId: string;
  targets: Targets;
}

/**
 * Ten is not a Discord limit, it is a rate-limit one.
 *
 * Every role is a separate PUT, so a server with no cap and a join flood turns
 * one member into a dozen requests. Ten is more than anyone configures by hand
 * and few enough that a raid does not queue thousands of writes.
 */
export const MAX_ROLES = 10;

const CACHE_MS = 60_000;

const cache = new Map<string, { roles: AutoRole[]; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

/**
 * Reads fail to the last known answer rather than to an empty list.
 *
 * An empty list here means "hand out nothing", which is the safe direction: a
 * database blip should not start granting roles it cannot verify, and it should
 * not silently stop granting them either if the answer is still remembered.
 */
export async function autoRoles(guildId: string): Promise<AutoRole[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.roles;

  let roles: AutoRole[];
  try {
    const rows = await sql<{ role_id: string; targets: string }[]>`
      SELECT role_id, targets FROM autoroles
      WHERE guild_id = ${guildId}
      ORDER BY created_at
    `;
    roles = rows.map((row) => ({
      roleId: row.role_id,
      targets: (row.targets as Targets) ?? "all",
    }));
  } catch {
    return hit?.roles ?? [];
  }

  cache.set(guildId, { roles, at: Date.now() });
  return roles;
}

export async function addRole(
  guildId: string,
  roleId: string,
  targets: Targets,
  addedBy: string,
): Promise<void> {
  await sql`
    INSERT INTO autoroles (guild_id, role_id, targets, added_by)
    VALUES (${guildId}, ${roleId}, ${targets}, ${addedBy})
    ON CONFLICT (guild_id, role_id)
      DO UPDATE SET targets = EXCLUDED.targets, added_by = EXCLUDED.added_by
  `;
  forget(guildId);
}

export async function removeRole(guildId: string, roleId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM autoroles WHERE guild_id = ${guildId} AND role_id = ${roleId} RETURNING role_id
  `;
  forget(guildId);
  return rows.length > 0;
}

export async function clearRoles(guildId: string): Promise<number> {
  const rows = await sql`
    DELETE FROM autoroles WHERE guild_id = ${guildId} RETURNING role_id
  `;
  forget(guildId);
  return rows.length;
}
