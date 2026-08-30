import { sql } from "../../../core/db.js";

export interface BoosterConfig {
  baseRoleId: string | null;
  awardRoleId: string | null;
  roleLimit: number | null;
  shareMax: number | null;
  shareLimit: number | null;
}

interface ConfigRow {
  base_role_id: string | null;
  award_role_id: string | null;
  role_limit: number | null;
  share_max: number | null;
  share_limit: number | null;
}

const EMPTY: BoosterConfig = {
  baseRoleId: null,
  awardRoleId: null,
  roleLimit: null,
  shareMax: null,
  shareLimit: null,
};

export async function config(guildId: string): Promise<BoosterConfig> {
  const rows = await sql<ConfigRow[]>`
    SELECT base_role_id, award_role_id, role_limit, share_max, share_limit
    FROM booster_config WHERE guild_id = ${guildId}
  `;
  const row = rows[0];
  if (!row) return EMPTY;

  return {
    baseRoleId: row.base_role_id,
    awardRoleId: row.award_role_id,
    roleLimit: row.role_limit,
    shareMax: row.share_max,
    shareLimit: row.share_limit,
  };
}

type ConfigField = "base_role_id" | "award_role_id" | "role_limit" | "share_max" | "share_limit";

export async function setConfig(
  guildId: string,
  field: ConfigField,
  value: string | number | null,
): Promise<void> {
  await sql`
    INSERT INTO booster_config (guild_id, ${sql(field)}, updated_at)
    VALUES (${guildId}, ${value}, now())
    ON CONFLICT (guild_id) DO UPDATE
      SET ${sql(field)} = EXCLUDED.${sql(field)}, updated_at = now()
  `;
}

export interface OwnedRole {
  userId: string;
  roleId: string;
}

export async function roleOf(guildId: string, userId: string): Promise<string | null> {
  const rows = await sql<{ role_id: string }[]>`
    SELECT role_id FROM booster_roles WHERE guild_id = ${guildId} AND user_id = ${userId}
  `;
  return rows[0]?.role_id ?? null;
}

export async function ownerOf(guildId: string, roleId: string): Promise<string | null> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM booster_roles WHERE guild_id = ${guildId} AND role_id = ${roleId}
  `;
  return rows[0]?.user_id ?? null;
}

export async function allRoles(guildId: string): Promise<OwnedRole[]> {
  const rows = await sql<{ user_id: string; role_id: string }[]>`
    SELECT user_id, role_id FROM booster_roles
    WHERE guild_id = ${guildId} ORDER BY created_at
  `;
  return rows.map((row) => ({ userId: row.user_id, roleId: row.role_id }));
}

export async function countRoles(guildId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM booster_roles WHERE guild_id = ${guildId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function claim(guildId: string, userId: string, roleId: string): Promise<void> {
  await sql`
    INSERT INTO booster_roles (guild_id, user_id, role_id)
    VALUES (${guildId}, ${userId}, ${roleId})
    ON CONFLICT (guild_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id
  `;
}

export async function release(guildId: string, userId: string): Promise<string | null> {
  const rows = await sql<{ role_id: string }[]>`
    DELETE FROM booster_roles WHERE guild_id = ${guildId} AND user_id = ${userId}
    RETURNING role_id
  `;
  const roleId = rows[0]?.role_id ?? null;
  if (roleId) await sql`DELETE FROM booster_shares WHERE guild_id = ${guildId} AND role_id = ${roleId}`;
  return roleId;
}

export async function forgetRole(guildId: string, roleId: string): Promise<void> {
  await sql`DELETE FROM booster_roles WHERE guild_id = ${guildId} AND role_id = ${roleId}`;
  await sql`DELETE FROM booster_shares WHERE guild_id = ${guildId} AND role_id = ${roleId}`;
}

export async function filters(guildId: string): Promise<string[]> {
  const rows = await sql<{ word: string }[]>`
    SELECT word FROM booster_filters WHERE guild_id = ${guildId} ORDER BY word
  `;
  return rows.map((row) => row.word);
}

export async function addFilter(guildId: string, word: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO booster_filters (guild_id, word) VALUES (${guildId}, ${word})
    ON CONFLICT (guild_id, word) DO NOTHING
    RETURNING word
  `;
  return rows.length > 0;
}

export async function dropFilter(guildId: string, word: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM booster_filters WHERE guild_id = ${guildId} AND word = ${word} RETURNING word
  `;
  return rows.length > 0;
}

export async function sharedWith(guildId: string, roleId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM booster_shares
    WHERE guild_id = ${guildId} AND role_id = ${roleId} ORDER BY shared_at
  `;
  return rows.map((row) => row.user_id);
}

export async function sharesFor(guildId: string, userId: string): Promise<string[]> {
  const rows = await sql<{ role_id: string }[]>`
    SELECT role_id FROM booster_shares
    WHERE guild_id = ${guildId} AND user_id = ${userId} ORDER BY shared_at
  `;
  return rows.map((row) => row.role_id);
}

export async function share(guildId: string, roleId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    INSERT INTO booster_shares (guild_id, role_id, user_id)
    VALUES (${guildId}, ${roleId}, ${userId})
    ON CONFLICT (guild_id, role_id, user_id) DO NOTHING
    RETURNING user_id
  `;
  return rows.length > 0;
}

export async function unshare(guildId: string, roleId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM booster_shares
    WHERE guild_id = ${guildId} AND role_id = ${roleId} AND user_id = ${userId}
    RETURNING user_id
  `;
  return rows.length > 0;
}
