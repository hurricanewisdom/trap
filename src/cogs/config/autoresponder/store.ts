import { sql } from "../../../core/db.js";

export interface Responder {
  trigger: string;
  reply: string;
  strict: boolean;
  ticket: boolean;
  wipe: boolean;
  quote: boolean;
  give: string[];
  take: string[];
  onlyRoles: string[];
  onlyChannels: string[];
}

export const MAX_RESPONDERS = 100;

export const MAX_TRIGGER = 60;

export const MAX_REPLY = 1800;

const CACHE_MS = 60_000;

const cache = new Map<string, { list: Responder[]; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

export function normalise(trigger: string): string {
  return trigger.trim().toLowerCase().replace(/\s+/g, " ");
}

async function load(guildId: string): Promise<Responder[]> {
  const rows = await sql<
    {
      trigger: string;
      reply: string;
      strict: boolean;
      ticket: boolean;
      wipe: boolean;
      quote: boolean;
    }[]
  >`
    SELECT trigger, reply, strict, ticket, wipe, quote
    FROM autoresponders WHERE guild_id = ${guildId} ORDER BY trigger
  `;

  const byTrigger = new Map<string, Responder>();
  for (const row of rows) {
    byTrigger.set(row.trigger, {
      ...row,
      give: [],
      take: [],
      onlyRoles: [],
      onlyChannels: [],
    });
  }

  const roles = await sql<{ trigger: string; role_id: string; action: string }[]>`
    SELECT trigger, role_id, action FROM autoresponder_roles WHERE guild_id = ${guildId}
  `;
  for (const row of roles) {
    const held = byTrigger.get(row.trigger);
    if (!held) continue;
    if (row.action === "add") held.give.push(row.role_id);
    else held.take.push(row.role_id);
  }

  const only = await sql<{ trigger: string; target_id: string; kind: string }[]>`
    SELECT trigger, target_id, kind FROM autoresponder_exclusive WHERE guild_id = ${guildId}
  `;
  for (const row of only) {
    const held = byTrigger.get(row.trigger);
    if (!held) continue;
    if (row.kind === "role") held.onlyRoles.push(row.target_id);
    else held.onlyChannels.push(row.target_id);
  }

  return [...byTrigger.values()];
}

export async function all(guildId: string): Promise<Responder[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;

  let list: Responder[];
  try {
    list = await load(guildId);
  } catch {
    return hit?.list ?? [];
  }

  cache.set(guildId, { list, at: Date.now() });
  return list;
}

export async function one(guildId: string, trigger: string): Promise<Responder | null> {
  const wanted = normalise(trigger);
  return (await all(guildId)).find((held) => held.trigger === wanted) ?? null;
}

export async function save(
  guildId: string,
  trigger: string,
  reply: string,
  flags: { strict: boolean; ticket: boolean; wipe: boolean; quote: boolean },
  authorId: string,
): Promise<void> {
  await sql`
    INSERT INTO autoresponders (guild_id, trigger, reply, strict, ticket, wipe, quote, created_by, updated_at)
    VALUES (${guildId}, ${normalise(trigger)}, ${reply}, ${flags.strict}, ${flags.ticket},
            ${flags.wipe}, ${flags.quote}, ${authorId}, now())
    ON CONFLICT (guild_id, trigger) DO UPDATE
      SET reply = EXCLUDED.reply, strict = EXCLUDED.strict, ticket = EXCLUDED.ticket,
          wipe = EXCLUDED.wipe, quote = EXCLUDED.quote, updated_at = now()
  `;
  forget(guildId);
}

export async function remove(guildId: string, trigger: string): Promise<boolean> {
  const wanted = normalise(trigger);
  const gone = await sql`
    DELETE FROM autoresponders WHERE guild_id = ${guildId} AND trigger = ${wanted} RETURNING trigger
  `;
  await sql`DELETE FROM autoresponder_roles WHERE guild_id = ${guildId} AND trigger = ${wanted}`;
  await sql`DELETE FROM autoresponder_exclusive WHERE guild_id = ${guildId} AND trigger = ${wanted}`;
  forget(guildId);
  return gone.length > 0;
}

export async function reset(guildId: string): Promise<number> {
  const gone = await sql`
    DELETE FROM autoresponders WHERE guild_id = ${guildId} RETURNING trigger
  `;
  await sql`DELETE FROM autoresponder_roles WHERE guild_id = ${guildId}`;
  await sql`DELETE FROM autoresponder_exclusive WHERE guild_id = ${guildId}`;
  forget(guildId);
  return gone.length;
}

export async function count(guildId: string): Promise<number> {
  return (await all(guildId)).length;
}

export async function toggleRole(
  guildId: string,
  trigger: string,
  roleId: string,
  action: "add" | "remove",
): Promise<"added" | "removed"> {
  const wanted = normalise(trigger);
  const gone = await sql`
    DELETE FROM autoresponder_roles
    WHERE guild_id = ${guildId} AND trigger = ${wanted} AND role_id = ${roleId} AND action = ${action}
    RETURNING role_id
  `;
  if (gone.length > 0) {
    forget(guildId);
    return "removed";
  }

  await sql`
    INSERT INTO autoresponder_roles (guild_id, trigger, role_id, action)
    VALUES (${guildId}, ${wanted}, ${roleId}, ${action})
    ON CONFLICT DO NOTHING
  `;
  forget(guildId);
  return "added";
}

export async function toggleExclusive(
  guildId: string,
  trigger: string,
  targetId: string,
  kind: "role" | "channel",
): Promise<"added" | "removed"> {
  const wanted = normalise(trigger);
  const gone = await sql`
    DELETE FROM autoresponder_exclusive
    WHERE guild_id = ${guildId} AND trigger = ${wanted} AND target_id = ${targetId}
    RETURNING target_id
  `;
  if (gone.length > 0) {
    forget(guildId);
    return "removed";
  }

  await sql`
    INSERT INTO autoresponder_exclusive (guild_id, trigger, target_id, kind)
    VALUES (${guildId}, ${wanted}, ${targetId}, ${kind})
    ON CONFLICT DO NOTHING
  `;
  forget(guildId);
  return "added";
}
