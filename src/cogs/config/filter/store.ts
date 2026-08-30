import { sql } from "../../../core/db.js";

export interface Settings {
  enabled: boolean;
  threshold: number | null;
  exemptRoles: string[];
  exemptChannels: string[];
}

interface Cached {
  byKind: Map<string, Settings>;
  at: number;
}

const CACHE_MS = 60_000;

const EMPTY: Settings = { enabled: false, threshold: null, exemptRoles: [], exemptChannels: [] };

const cache = new Map<string, Cached>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

async function load(guildId: string): Promise<Map<string, Settings>> {
  const byKind = new Map<string, Settings>();

  const rows = await sql<{ kind: string; enabled: boolean; threshold: number | null }[]>`
    SELECT kind, enabled, threshold FROM filter_settings WHERE guild_id = ${guildId}
  `;
  for (const row of rows) {
    byKind.set(row.kind, {
      enabled: row.enabled,
      threshold: row.threshold,
      exemptRoles: [],
      exemptChannels: [],
    });
  }

  const roles = await sql<{ kind: string; role_id: string }[]>`
    SELECT kind, role_id FROM filter_exempt_roles WHERE guild_id = ${guildId}
  `;
  for (const row of roles) {
    const held = byKind.get(row.kind) ?? { ...EMPTY, exemptRoles: [], exemptChannels: [] };
    held.exemptRoles = [...held.exemptRoles, row.role_id];
    byKind.set(row.kind, held);
  }

  const channels = await sql<{ kind: string; channel_id: string }[]>`
    SELECT kind, channel_id FROM filter_exempt_channels WHERE guild_id = ${guildId}
  `;
  for (const row of channels) {
    const held = byKind.get(row.kind) ?? { ...EMPTY, exemptRoles: [], exemptChannels: [] };
    held.exemptChannels = [...held.exemptChannels, row.channel_id];
    byKind.set(row.kind, held);
  }

  return byKind;
}

export async function allSettings(guildId: string): Promise<Map<string, Settings>> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.byKind;

  let byKind: Map<string, Settings>;
  try {
    byKind = await load(guildId);
  } catch {
    return hit?.byKind ?? new Map();
  }

  cache.set(guildId, { byKind, at: Date.now() });
  return byKind;
}

export async function settingsFor(guildId: string, kind: string): Promise<Settings> {
  return (await allSettings(guildId)).get(kind) ?? EMPTY;
}

export async function setEnabled(guildId: string, kind: string, enabled: boolean): Promise<void> {
  await sql`
    INSERT INTO filter_settings (guild_id, kind, enabled, updated_at)
    VALUES (${guildId}, ${kind}, ${enabled}, now())
    ON CONFLICT (guild_id, kind) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
  `;
  forget(guildId);
}

export async function setThreshold(
  guildId: string,
  kind: string,
  threshold: number,
): Promise<void> {
  await sql`
    INSERT INTO filter_settings (guild_id, kind, enabled, threshold, updated_at)
    VALUES (${guildId}, ${kind}, true, ${threshold}, now())
    ON CONFLICT (guild_id, kind) DO UPDATE SET threshold = EXCLUDED.threshold, updated_at = now()
  `;
  forget(guildId);
}

export async function toggleRole(
  guildId: string,
  kind: string,
  roleId: string,
): Promise<"added" | "removed"> {
  const gone = await sql`
    DELETE FROM filter_exempt_roles
    WHERE guild_id = ${guildId} AND kind = ${kind} AND role_id = ${roleId}
    RETURNING role_id
  `;
  if (gone.length > 0) {
    forget(guildId);
    return "removed";
  }

  await sql`
    INSERT INTO filter_exempt_roles (guild_id, kind, role_id)
    VALUES (${guildId}, ${kind}, ${roleId})
    ON CONFLICT DO NOTHING
  `;
  forget(guildId);
  return "added";
}

export async function setChannel(
  guildId: string,
  kind: string,
  channelId: string,
  exempt: boolean,
): Promise<void> {
  if (exempt) {
    await sql`
      INSERT INTO filter_exempt_channels (guild_id, kind, channel_id)
      VALUES (${guildId}, ${kind}, ${channelId})
      ON CONFLICT DO NOTHING
    `;
  } else {
    await sql`
      DELETE FROM filter_exempt_channels
      WHERE guild_id = ${guildId} AND kind = ${kind} AND channel_id = ${channelId}
    `;
  }
  forget(guildId);
}

export async function clearKind(guildId: string, kind: string): Promise<void> {
  await sql`DELETE FROM filter_settings WHERE guild_id = ${guildId} AND kind = ${kind}`;
  await sql`DELETE FROM filter_exempt_roles WHERE guild_id = ${guildId} AND kind = ${kind}`;
  await sql`DELETE FROM filter_exempt_channels WHERE guild_id = ${guildId} AND kind = ${kind}`;
  forget(guildId);
}
