import { sql } from "../../core/db.js";

// Everything with a duration lands here rather than in a timer, so a restart does
// not quietly forget to unban somebody. The tick is deliberately slow: nothing
// here is worth a second of precision.
const TICK_MS = 30_000;

export type Kind = "unban" | "unjail" | "unmute" | "untimeout" | "role" | "remind";

export interface Due {
  id: string;
  guildId: string;
  kind: Kind;
  targetId: string;
  extra: string | null;
}

export async function later(
  guildId: string,
  kind: Kind,
  targetId: string,
  extra: string | null,
  ms: number,
): Promise<void> {
  await sql`
    INSERT INTO mod_pending (guild_id, kind, target_id, extra, due)
    VALUES (${guildId}, ${kind}, ${targetId}, ${extra}, now() + ${`${Math.round(ms / 1000)} seconds`}::interval)
  `;
}

export async function cancel(guildId: string, kind: Kind, targetId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM mod_pending
    WHERE guild_id = ${guildId} AND kind = ${kind} AND target_id = ${targetId}
    RETURNING id
  `;
  return rows.length;
}

export async function pendingFor(guildId: string, kind: Kind): Promise<Due[]> {
  const rows = await sql<
    { id: string; guild_id: string; kind: string; target_id: string; extra: string | null }[]
  >`
    SELECT id, guild_id, kind, target_id, extra FROM mod_pending
    WHERE guild_id = ${guildId} AND kind = ${kind} ORDER BY due
  `;
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    kind: row.kind as Kind,
    targetId: row.target_id,
    extra: row.extra,
  }));
}

export async function remindersFor(guildId: string, userId: string): Promise<Due[]> {
  const rows = await sql<
    { id: string; guild_id: string; target_id: string; extra: string | null }[]
  >`
    SELECT id, guild_id, target_id, extra FROM mod_pending
    WHERE kind = 'remind' AND target_id = ${userId} AND guild_id = ${guildId} ORDER BY due
  `;
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    kind: "remind" as Kind,
    targetId: row.target_id,
    extra: row.extra,
  }));
}

export async function forget(id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM mod_pending WHERE id = ${id} RETURNING id
  `;
  return rows.length > 0;
}

export type Runner = (due: Due) => Promise<void>;

const runners = new Map<Kind, Runner>();

export function onDue(kind: Kind, runner: Runner): void {
  runners.set(kind, runner);
}

// Claimed with DELETE ... RETURNING so two ticks cannot run the same row twice.
async function claim(): Promise<Due[]> {
  const rows = await sql<
    { id: string; guild_id: string; kind: string; target_id: string; extra: string | null }[]
  >`
    DELETE FROM mod_pending
    WHERE id IN (SELECT id FROM mod_pending WHERE due <= now() ORDER BY due LIMIT 25)
    RETURNING id, guild_id, kind, target_id, extra
  `;
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    kind: row.kind as Kind,
    targetId: row.target_id,
    extra: row.extra,
  }));
}

let timer: NodeJS.Timeout | null = null;

export function startSchedule(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      try {
        for (const due of await claim()) {
          const runner = runners.get(due.kind);
          if (runner) await runner(due).catch(() => {});
        }
      } catch {}
    })();
  }, TICK_MS);
  timer.unref?.();
}
