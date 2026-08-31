import { sql } from "../../core/db.js";
import { displayName } from "../../core/discord.js";
import { requireAdministrator, requireManageMessages } from "../../core/permissions.js";
import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { humanDuration } from "../../helpers/duration.js";
import { plain } from "../../helpers/markdown.js";
import {
  attach,
  attachments,
  byModerator,
  detach,
  drop,
  dropAllFor,
  find,
  forTarget,
  setProof,
  setReason,
  tally,
  type Case,
} from "./cases.js";
import { card, userId, words } from "./shared.js";

const MOST_SHOWN = 15;

const URL_IN = /https?:\/\/[^\s<>]+/gi;

function line(one: Case): string {
  const when = `<t:${Math.floor(one.at.getTime() / 1000)}:R>`;
  const held = one.durationMs ? ` for ${humanDuration(one.durationMs)}` : "";
  return `-# **#${one.caseId}** ${one.action}${held} · ${when} · ${plain(
    (one.reason ?? "no reason").slice(0, 80),
  )}`;
}

function listing(title: string, held: Case[]): string[] {
  // The title is kept when the list is empty, so "nothing recorded" still says
  // who it is nothing about.
  if (held.length === 0) return [title, "-# nothing recorded"];
  return [
    title,
    ...held.slice(0, MOST_SHOWN).map(line),
    ...(held.length > MOST_SHOWN ? [`-# and ${held.length - MOST_SHOWN} more`] : []),
  ];
}

// The same reading of "<member> [action]" for both history commands, since the
// spec gives them the same two arguments.
function targeted(argument: string): { who: string | null; action: string | undefined } {
  const parts = words(argument);
  return { who: userId(parts[0]), action: parts[1]?.toLowerCase() };
}

function forSomeone(byMod: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const guildId = await requireManageMessages(ctx, "see moderation history");
    if (!guildId) return;

    const { who, action } = targeted(ctx.argument);
    if (!who) {
      await card(ctx, [
        "Which member?",
        "",
        `-# \`${byMod ? "moderationhistory" : "history"} @member [action]\``,
      ]);
      return;
    }

    const held = byMod
      ? await byModerator(guildId, who, action)
      : await forTarget(guildId, who, action);
    const name = await displayName(guildId, who);
    await card(
      ctx,
      listing(
        byMod
          ? `**${plain(name)}** has handed out ${held.length}${action ? " " + action : ""}:`
          : `**${plain(name)}** has ${held.length}${action ? " " + action : ""} on record:`,
        held,
      ),
    );
  };
}

async function shown(ctx: PrefixContext, caseId: number | null): Promise<void> {
  const guildId = await requireManageMessages(ctx, "read a case log");
  if (!guildId) return;

  if (caseId === null) {
    await card(ctx, ["Which case?", "", "-# `caselog <id>`"]);
    return;
  }

  const one = await find(guildId, caseId);
  if (!one) {
    await card(ctx, [`There is no case #${caseId}.`]);
    return;
  }

  const proof = await attachments(guildId, caseId);
  await card(ctx, [
    `**Case #${one.caseId}** · ${one.action}`,
    `-# member: <@${one.targetId}>`,
    `-# moderator: <@${one.moderatorId}>`,
    `-# when: <t:${Math.floor(one.at.getTime() / 1000)}:F>`,
    ...(one.durationMs ? [`-# duration: ${humanDuration(one.durationMs)}`] : []),
    `-# reason: ${plain((one.reason ?? "none given").slice(0, 300))}`,
    ...(one.proof ? [`-# proof: ${plain(one.proof.slice(0, 300))}`] : []),
    ...(proof.length > 0 ? [`-# attachments: ${proof.length}`] : []),
  ]);
}

async function caselog(ctx: PrefixContext): Promise<void> {
  const said = words(ctx.argument)[0]?.replace(/^#/, "") ?? "";
  await shown(ctx, /^\d{1,9}$/.test(said) ? Number(said) : null);
}

async function reasonCmd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "change a case reason");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const said = parts[0]?.replace(/^#/, "") ?? "";
  const reason = parts.slice(1).join(" ").trim();
  if (!/^\d{1,9}$/.test(said) || !reason) {
    await card(ctx, ["Which case, and what reason?", "", "-# `reason <id> <reason>`"]);
    return;
  }

  const done = await setReason(guildId, Number(said), reason.slice(0, 500));
  await card(
    ctx,
    done ? [`Case #${said} now reads: ${plain(reason.slice(0, 200))}`] : [`There is no case #${said}.`],
  );
}

async function warnings(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "see warnings");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `warnings @member`"]);
    return;
  }

  const held = await forTarget(guildId, who, "warn");
  await card(ctx, listing(`**${plain(await displayName(guildId, who))}** has ${held.length} warnings:`, held));
}

async function modstats(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "see moderator statistics");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]) ?? ctx.authorId;
  const counts = await tally(guildId, who);
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, many]) => sum + many, 0);

  await card(ctx, [
    `**${plain(await displayName(guildId, who))}** has recorded ${total} action${total === 1 ? "" : "s"}.`,
    ...(rows.length === 0 ? [] : rows.map(([action, many]) => `-# ${action}: ${many}`)),
  ]);
}

async function historyView(ctx: PrefixContext): Promise<void> {
  const said = words(ctx.argument)[0]?.replace(/^#/, "") ?? "";
  await shown(ctx, /^\d{1,9}$/.test(said) ? Number(said) : null);
}

async function historyRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "remove a punishment");
  if (!guildId) return;

  const parts = words(ctx.argument);
  // The member is asked for as well as the case, so a typo removes nothing
  // rather than somebody else's case.
  const who = userId(parts[0]);
  const said = parts[1]?.replace(/^#/, "") ?? "";
  if (!who || !/^\d{1,9}$/.test(said)) {
    await card(ctx, ["Which member, and which case?", "", "-# `history remove @member <id>`"]);
    return;
  }

  const one = await find(guildId, Number(said));
  if (!one || one.targetId !== who) {
    await card(ctx, [`Case #${said} is not on <@${who}>.`]);
    return;
  }

  await drop(guildId, Number(said));
  await card(ctx, [`Case #${said} is gone from <@${who}>'s record.`]);
}

async function historyRemoveAll(ctx: PrefixContext): Promise<void> {
  const guildId = await requireAdministrator(ctx, "clear somebody's record");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `history removeall @member`"]);
    return;
  }

  const many = await dropAllFor(guildId, who);
  await card(ctx, [
    many === 0 ? `<@${who}> had nothing on record.` : `Removed ${many} from <@${who}>'s record.`,
  ]);
}

async function caseArg(
  ctx: PrefixContext,
  usage: string,
): Promise<{ guildId: string; caseId: number; rest: string } | null> {
  const guildId = await requireManageMessages(ctx, "manage case proof");
  if (!guildId) return null;

  const parts = words(ctx.argument);
  const said = parts[0]?.replace(/^#/, "") ?? "";
  if (!/^\d{1,9}$/.test(said)) {
    await card(ctx, ["Which case?", "", `-# \`${usage}\``]);
    return null;
  }
  if (!(await find(guildId, Number(said)))) {
    await card(ctx, [`There is no case #${said}.`]);
    return null;
  }
  return { guildId, caseId: Number(said), rest: parts.slice(1).join(" ") };
}

async function proofSet(ctx: PrefixContext): Promise<void> {
  const got = await caseArg(ctx, "proof set <id> <explanation>");
  if (!got) return;

  if (!got.rest.trim()) {
    await card(ctx, ["What is the proof?", "", "-# `proof set <id> <explanation>`"]);
    return;
  }

  // Links in the explanation are kept as attachments too, so "set" does what
  // somebody pasting a screenshot link expects.
  const urls = got.rest.match(URL_IN) ?? [];
  await setProof(got.guildId, got.caseId, got.rest.slice(0, 900));
  if (urls.length > 0) await attach(got.guildId, got.caseId, urls);

  await card(ctx, [
    `Proof set on case #${got.caseId}.`,
    ...(urls.length > 0 ? [`-# ${urls.length} attachment${urls.length === 1 ? "" : "s"} kept`] : []),
  ]);
}

async function proofAdd(ctx: PrefixContext): Promise<void> {
  const got = await caseArg(ctx, "proof add <id> <url>");
  if (!got) return;

  const urls = got.rest.match(URL_IN) ?? [];
  if (urls.length === 0) {
    await card(ctx, ["Which link?", "", "-# `proof add <id> <url>`"]);
    return;
  }

  const many = await attach(got.guildId, got.caseId, urls);
  await card(ctx, [`Added ${many} to case #${got.caseId}.`]);
}

async function proofView(ctx: PrefixContext): Promise<void> {
  const got = await caseArg(ctx, "proof view <id>");
  if (!got) return;

  const one = await find(got.guildId, got.caseId);
  const held = await attachments(got.guildId, got.caseId);
  await card(ctx, [
    `**Case #${got.caseId}** proof`,
    one?.proof ? plain(one.proof.slice(0, 600)) : "-# nothing written down",
    ...(held.length === 0 ? [] : ["", ...held.map((url, at) => `-# ${at + 1}. ${url}`)]),
  ]);
}

async function proofList(ctx: PrefixContext): Promise<void> {
  const got = await caseArg(ctx, "proof list <id>");
  if (!got) return;

  const held = await attachments(got.guildId, got.caseId);
  await card(
    ctx,
    held.length === 0
      ? [`Case #${got.caseId} has no attachments.`]
      : [`Case #${got.caseId} has ${held.length}:`, ...held.map((url, at) => `-# ${at + 1}. ${url}`)],
  );
}

async function proofRemove(ctx: PrefixContext): Promise<void> {
  const got = await caseArg(ctx, "proof remove <id> <number>");
  if (!got) return;

  const said = got.rest.trim().split(/\s+/)[0] ?? "";
  if (!/^\d{1,3}$/.test(said)) {
    await card(ctx, ["Which attachment?", "", "-# `proof remove <id> <number>` · `proof list <id>`"]);
    return;
  }

  const done = await detach(got.guildId, got.caseId, Number(said));
  await card(
    ctx,
    done
      ? [`Attachment ${said} removed from case #${got.caseId}.`, "-# The rest were renumbered."]
      : [`Case #${got.caseId} has no attachment ${said}.`],
  );
}

async function proofOverview(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "manage case proof");
  if (!guildId) return;

  await card(ctx, [
    "Proof for a case log.",
    "",
    "-# `proof set <id> <explanation>` · `proof add <id> <url>`",
    "-# `proof view <id>` · `proof list <id>` · `proof remove <id> <number>`",
  ]);
}

async function notesFor(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "read notes");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `notes @member`"]);
    return;
  }

  const rows = await sql<{ note_id: number; author_id: string; body: string }[]>`
    SELECT note_id, author_id, body FROM mod_notes
    WHERE guild_id = ${guildId} AND user_id = ${who} ORDER BY note_id
  `;
  await card(
    ctx,
    rows.length === 0
      ? [`Nothing noted about <@${who}>.`]
      : [
          `${rows.length} note${rows.length === 1 ? "" : "s"} on <@${who}>:`,
          ...rows.map(
            (row) => `-# **${row.note_id}.** ${plain(row.body.slice(0, 150))} — <@${row.author_id}>`,
          ),
        ],
  );
}

async function notesAdd(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "add a note");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  const body = parts.slice(1).join(" ").trim();
  if (!who || !body) {
    await card(ctx, ["Which member, and what note?", "", "-# `notes add @member <note>`"]);
    return;
  }

  // Numbered per member so the id somebody is shown is the id they can remove.
  const rows = await sql<{ note_id: number }[]>`
    INSERT INTO mod_notes (guild_id, user_id, note_id, author_id, body)
    SELECT ${guildId}, ${who},
           coalesce(max(note_id), 0) + 1, ${ctx.authorId}, ${body.slice(0, 500)}
    FROM mod_notes WHERE guild_id = ${guildId} AND user_id = ${who}
    RETURNING note_id
  `;
  await card(ctx, [`Noted about <@${who}> as **${rows[0]?.note_id ?? 1}**.`]);
}

async function notesRemove(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "remove a note");
  if (!guildId) return;

  const parts = words(ctx.argument);
  const who = userId(parts[0]);
  const said = parts[1] ?? "";
  if (!who || !/^\d{1,4}$/.test(said)) {
    await card(ctx, ["Which member, and which note?", "", "-# `notes remove @member <id>`"]);
    return;
  }

  const rows = await sql<{ note_id: number }[]>`
    DELETE FROM mod_notes
    WHERE guild_id = ${guildId} AND user_id = ${who} AND note_id = ${Number(said)}
    RETURNING note_id
  `;
  await card(ctx, rows.length > 0 ? [`Note ${said} removed.`] : [`<@${who}> has no note ${said}.`]);
}

async function notesClear(ctx: PrefixContext): Promise<void> {
  const guildId = await requireManageMessages(ctx, "clear notes");
  if (!guildId) return;

  const who = userId(words(ctx.argument)[0]);
  if (!who) {
    await card(ctx, ["Which member?", "", "-# `notes clear @member`"]);
    return;
  }

  const rows = await sql<{ note_id: number }[]>`
    DELETE FROM mod_notes WHERE guild_id = ${guildId} AND user_id = ${who} RETURNING note_id
  `;
  await card(ctx, [
    rows.length === 0 ? `<@${who}> had no notes.` : `Cleared ${rows.length} from <@${who}>.`,
  ]);
}

function under(owner: string, fallback: PrefixHandler): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
    const found = sub ? lookupIn(owner, sub) : undefined;
    if (found) {
      await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
      return;
    }
    await fallback(ctx);
  };
}

export function registerHistory(): void {
  register({
    name: "history",
    description: "View a list of every punishment recorded",
    handler: under("history", forSomeone(false)),
  });
  groupUnder("history", () => {
    register({ name: "view", description: "View an ID's case log", handler: historyView });
    register({
      name: "remove",
      description: "Remove a punishment from a member",
      handler: historyRemove,
    });
    register({
      name: "removeall",
      description: "Remove all punishments from a member",
      handler: historyRemoveAll,
    });
  });

  register({
    name: "moderationhistory",
    aliases: ["modhistory"],
    description: "View moderation actions from a staff member",
    handler: forSomeone(true),
  });
  register({ name: "caselog", description: "View a case log", handler: caselog });
  register({ name: "reason", description: "Updates the reason on a case log", handler: reasonCmd });
  register({ name: "warnings", description: "View warnings for a member", handler: warnings });
  register({
    name: "modstats",
    description: "View punishment statistics for a moderator",
    handler: modstats,
  });

  register({
    name: "proof",
    description: "Manage proof for a case log",
    handler: under("proof", proofOverview),
  });
  groupUnder("proof", () => {
    register({ name: "set", description: "Set the proof for a case log", handler: proofSet });
    register({ name: "add", description: "Add attachments to a case log", handler: proofAdd });
    register({ name: "view", description: "View the proof for a case log", handler: proofView });
    register({ name: "list", description: "List all attachments for a case log", handler: proofList });
    register({
      name: "remove",
      description: "Remove an attachment from a case log",
      handler: proofRemove,
    });
  });

  register({
    name: "notes",
    description: "View notes on a member",
    handler: under("notes", notesFor),
  });
  groupUnder("notes", () => {
    register({ name: "add", description: "Add a note for a member", handler: notesAdd });
    register({ name: "remove", description: "Removes a note for a member", handler: notesRemove });
    register({ name: "clear", description: "Clears all notes for a member", handler: notesClear });
  });
}
