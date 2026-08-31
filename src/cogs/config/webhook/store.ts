import { sql } from "../../../core/db.js";

export interface Held {
  identifier: string;
  webhookId: string;
  channelId: string;
  createdBy: string;
  lockedBy: string | null;
}

export const MAX_WEBHOOKS = 25;

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

const CACHE_MS = 60_000;

const cache = new Map<string, { held: Held[]; at: number }>();

export function forget(guildId: string): void {
  cache.delete(guildId);
}

function code(): string {
  let out = "";
  for (let at = 0; at < 6; at += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export async function all(guildId: string): Promise<Held[]> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.held;

  let held: Held[];
  try {
    const rows = await sql<
      {
        identifier: string;
        webhook_id: string;
        channel_id: string;
        created_by: string;
        locked_by: string | null;
      }[]
    >`
      SELECT identifier, webhook_id, channel_id, created_by, locked_by
      FROM webhooks WHERE guild_id = ${guildId} ORDER BY created_at
    `;
    held = rows.map((row) => ({
      identifier: row.identifier,
      webhookId: row.webhook_id,
      channelId: row.channel_id,
      createdBy: row.created_by,
      lockedBy: row.locked_by,
    }));
  } catch {
    return hit?.held ?? [];
  }

  cache.set(guildId, { held, at: Date.now() });
  return held;
}

export async function one(guildId: string, identifier: string): Promise<Held | null> {
  const wanted = identifier.trim().toLowerCase();
  return (await all(guildId)).find((held) => held.identifier === wanted) ?? null;
}

export async function byWebhookId(guildId: string, webhookId: string): Promise<Held | null> {
  return (await all(guildId)).find((held) => held.webhookId === webhookId) ?? null;
}

export async function remember(
  guildId: string,
  webhookId: string,
  channelId: string,
  createdBy: string,
): Promise<string> {
  const taken = new Set((await all(guildId)).map((held) => held.identifier));
  let identifier = code();
  while (taken.has(identifier)) identifier = code();

  await sql`
    INSERT INTO webhooks (guild_id, identifier, webhook_id, channel_id, created_by)
    VALUES (${guildId}, ${identifier}, ${webhookId}, ${channelId}, ${createdBy})
  `;
  forget(guildId);
  return identifier;
}

export async function drop(guildId: string, identifier: string): Promise<boolean> {
  const gone = await sql`
    DELETE FROM webhooks WHERE guild_id = ${guildId} AND identifier = ${identifier}
    RETURNING identifier
  `;
  forget(guildId);
  return gone.length > 0;
}

export async function setLock(
  guildId: string,
  identifier: string,
  lockedBy: string | null,
): Promise<void> {
  await sql`
    UPDATE webhooks SET locked_by = ${lockedBy}
    WHERE guild_id = ${guildId} AND identifier = ${identifier}
  `;
  forget(guildId);
}
