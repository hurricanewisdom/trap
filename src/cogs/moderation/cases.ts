import { sql } from "../../core/db.js";

export interface Case {
  caseId: number;
  action: string;
  targetId: string;
  moderatorId: string;
  reason: string | null;
  durationMs: number | null;
  proof: string | null;
  at: Date;
}

interface Row {
  case_id: number;
  action: string;
  target_id: string;
  moderator_id: string;
  reason: string | null;
  duration_ms: string | number | null;
  proof: string | null;
  at: Date;
}

function shaped(row: Row): Case {
  return {
    caseId: Number(row.case_id),
    action: row.action,
    targetId: row.target_id,
    moderatorId: row.moderator_id,
    reason: row.reason,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    proof: row.proof,
    at: row.at,
  };
}

const COLUMNS = sql`case_id, action, target_id, moderator_id, reason, duration_ms, proof, at`;

// Case numbers are per server and handed out by the database in the same
// statement that moves the counter. Two moderators acting at once would
// otherwise be given the same number, and the number is how every other command
// finds the case.
async function nextCase(guildId: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO mod_config (guild_id, next_case) VALUES (${guildId}, 2)
    ON CONFLICT (guild_id) DO UPDATE SET next_case = mod_config.next_case + 1
    RETURNING next_case - 1 AS id
  `;
  return Number(rows[0]?.id ?? 1);
}

export async function record(
  guildId: string,
  action: string,
  targetId: string,
  moderatorId: string,
  reason: string | null,
  durationMs: number | null = null,
): Promise<number> {
  const caseId = await nextCase(guildId);
  await sql`
    INSERT INTO mod_cases (guild_id, case_id, action, target_id, moderator_id, reason, duration_ms)
    VALUES (${guildId}, ${caseId}, ${action}, ${targetId}, ${moderatorId},
            ${reason}, ${durationMs})
  `;
  return caseId;
}

export async function find(guildId: string, caseId: number): Promise<Case | null> {
  const rows = await sql<Row[]>`
    SELECT ${COLUMNS} FROM mod_cases WHERE guild_id = ${guildId} AND case_id = ${caseId}
  `;
  return rows[0] ? shaped(rows[0]) : null;
}

export async function forTarget(
  guildId: string,
  targetId: string,
  action?: string,
): Promise<Case[]> {
  const rows = action
    ? await sql<Row[]>`
        SELECT ${COLUMNS} FROM mod_cases
        WHERE guild_id = ${guildId} AND target_id = ${targetId} AND action = ${action}
        ORDER BY case_id DESC LIMIT 200
      `
    : await sql<Row[]>`
        SELECT ${COLUMNS} FROM mod_cases
        WHERE guild_id = ${guildId} AND target_id = ${targetId}
        ORDER BY case_id DESC LIMIT 200
      `;
  return rows.map(shaped);
}

export async function byModerator(
  guildId: string,
  moderatorId: string,
  action?: string,
): Promise<Case[]> {
  const rows = action
    ? await sql<Row[]>`
        SELECT ${COLUMNS} FROM mod_cases
        WHERE guild_id = ${guildId} AND moderator_id = ${moderatorId} AND action = ${action}
        ORDER BY case_id DESC LIMIT 200
      `
    : await sql<Row[]>`
        SELECT ${COLUMNS} FROM mod_cases
        WHERE guild_id = ${guildId} AND moderator_id = ${moderatorId}
        ORDER BY case_id DESC LIMIT 200
      `;
  return rows.map(shaped);
}

export async function tally(guildId: string, moderatorId: string): Promise<Record<string, number>> {
  const rows = await sql<{ action: string; many: string }[]>`
    SELECT action, count(*)::text AS many FROM mod_cases
    WHERE guild_id = ${guildId} AND moderator_id = ${moderatorId}
    GROUP BY action ORDER BY count(*) DESC
  `;
  const out: Record<string, number> = {};
  for (const row of rows) out[row.action] = Number(row.many);
  return out;
}

export async function setReason(
  guildId: string,
  caseId: number,
  reason: string,
): Promise<boolean> {
  const rows = await sql<{ case_id: number }[]>`
    UPDATE mod_cases SET reason = ${reason}
    WHERE guild_id = ${guildId} AND case_id = ${caseId}
    RETURNING case_id
  `;
  return rows.length > 0;
}

export async function setProof(guildId: string, caseId: number, proof: string): Promise<boolean> {
  const rows = await sql<{ case_id: number }[]>`
    UPDATE mod_cases SET proof = ${proof}
    WHERE guild_id = ${guildId} AND case_id = ${caseId}
    RETURNING case_id
  `;
  return rows.length > 0;
}

export async function drop(guildId: string, caseId: number): Promise<boolean> {
  const rows = await sql<{ case_id: number }[]>`
    DELETE FROM mod_cases WHERE guild_id = ${guildId} AND case_id = ${caseId}
    RETURNING case_id
  `;
  await sql`DELETE FROM mod_case_proof WHERE guild_id = ${guildId} AND case_id = ${caseId}`;
  return rows.length > 0;
}

export async function dropAllFor(guildId: string, targetId: string): Promise<number> {
  const rows = await sql<{ case_id: number }[]>`
    DELETE FROM mod_cases WHERE guild_id = ${guildId} AND target_id = ${targetId}
    RETURNING case_id
  `;
  for (const row of rows) {
    await sql`DELETE FROM mod_case_proof WHERE guild_id = ${guildId} AND case_id = ${row.case_id}`;
  }
  return rows.length;
}

export async function attachments(guildId: string, caseId: number): Promise<string[]> {
  const rows = await sql<{ url: string }[]>`
    SELECT url FROM mod_case_proof
    WHERE guild_id = ${guildId} AND case_id = ${caseId} ORDER BY idx
  `;
  return rows.map((row) => row.url);
}

export async function attach(guildId: string, caseId: number, urls: string[]): Promise<number> {
  const held = await attachments(guildId, caseId);
  let idx = held.length;
  for (const url of urls) {
    await sql`
      INSERT INTO mod_case_proof (guild_id, case_id, idx, url)
      VALUES (${guildId}, ${caseId}, ${idx}, ${url})
      ON CONFLICT (guild_id, case_id, idx) DO NOTHING
    `;
    idx += 1;
  }
  return idx - held.length;
}

// Reindexed after a removal so the numbers people are told stay the numbers they
// can use next time.
export async function detach(guildId: string, caseId: number, index: number): Promise<boolean> {
  const held = await attachments(guildId, caseId);
  if (index < 1 || index > held.length) return false;

  const left = held.filter((_, at) => at !== index - 1);
  await sql`DELETE FROM mod_case_proof WHERE guild_id = ${guildId} AND case_id = ${caseId}`;
  await attach(guildId, caseId, left);
  return true;
}
