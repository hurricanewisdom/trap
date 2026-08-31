import { sql } from "../../../core/db.js";

export interface Grant {
  roleId: string;
  permission: string;
}

export const MAX_GRANTS = 60;

const CACHE_MS = 60_000;

const cache = new Map<string, { grants: Grant[]; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export async function all(guildId: string): Promise<Grant[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.grants;

  let grants: Grant[];
  try {
    const rows = await sql<{ role_id: string; permission: string }[]>`
      SELECT role_id, permission FROM fake_permissions WHERE guild_id = ${guildId}
      ORDER BY role_id, permission
    `;
    grants = rows.map((row) => ({ roleId: row.role_id, permission: row.permission }));
  } catch {
    return hit?.grants ?? [];
  }

  cache.set(guildId, { grants, at: Date.now() });
  return grants;
}

export async function forRole(guildId: string, roleId: string): Promise<string[]> {
  return (await all(guildId))
    .filter((grant) => grant.roleId === roleId)
    .map((grant) => grant.permission);
}

export async function grant(
  guildId: string,
  roleId: string,
  permission: string,
): Promise<boolean> {
  const done = await sql`
    INSERT INTO fake_permissions (guild_id, role_id, permission)
    VALUES (${guildId}, ${roleId}, ${permission})
    ON CONFLICT DO NOTHING
    RETURNING permission
  `;
  forget(guildId);
  return done.length > 0;
}

export async function revoke(
  guildId: string,
  roleId: string,
  permission: string,
): Promise<boolean> {
  const gone = await sql`
    DELETE FROM fake_permissions
    WHERE guild_id = ${guildId} AND role_id = ${roleId} AND permission = ${permission}
    RETURNING permission
  `;
  forget(guildId);
  return gone.length > 0;
}

export async function reset(guildId: string): Promise<number> {
  const gone = await sql`
    DELETE FROM fake_permissions WHERE guild_id = ${guildId} RETURNING permission
  `;
  forget(guildId);
  return gone.length;
}
