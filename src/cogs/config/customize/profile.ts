import { editSelfMember } from "../../../core/discord.js";
import { notice, styled } from "../../../core/permissions.js";
import type { PrefixContext } from "../../../core/prefix.js";
import { KINDS, withStyle, type Kind } from "../../../core/style.js";
import { switchWord } from "../../../helpers/flags.js";
import { forget, resetAll, setStyle, setToggle, styleOf } from "./settings.js";
import { saveBio } from "./store.js";

export const HEADING = "Bot appearance";

const EMOJI = /^(?:<a?:[\w~]+:\d{15,25}>|\p{Extended_Pictographic}[\u{FE0F}\u{20E3}]*)$/u;

const NAMED: Record<string, number> = {
  red: 0xed4245,
  orange: 0xe67e22,
  yellow: 0xfee75c,
  green: 0x57f287,
  blue: 0x3498db,
  purple: 0x9b59b6,
  pink: 0xeb459e,
  white: 0xffffff,
  black: 0x2b2d31,
  blurple: 0x5865f2,
};

export function parseColor(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (NAMED[text] !== undefined) return NAMED[text] as number;

  const hex = /^#?([0-9a-f]{6})$/i.exec(text);
  return hex ? Number.parseInt(hex[1] as string, 16) : null;
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export async function card(ctx: PrefixContext, body: string): Promise<void> {
  await ctx.reply(notice(body));
}

function words(argument: string): string[] {
  return argument.split(/\s+/).filter(Boolean);
}

/* ------------------------------------------------------------------ display */

export async function setDisplay(ctx: PrefixContext, guildId: string): Promise<void> {
  const name = ctx.argument.trim();
  if (!name) {
    await card(ctx, [`### ${HEADING}`, "Give me the name to use here."].join("\n"));
    return;
  }
  if (name.length > 32) {
    await card(ctx, [`### ${HEADING}`, "A nickname is 32 characters at most."].join("\n"));
    return;
  }

  const done = await editSelfMember(guildId, { nick: name });
  await card(
    ctx,
    [
      `### ${HEADING}`,
      done.ok ? `I am **${name}** in this server now.` : "Discord would not let me change that.",
      done.ok ? "" : `-# ${done.message}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function resetDisplay(ctx: PrefixContext, guildId: string): Promise<void> {
  const done = await editSelfMember(guildId, { nick: null });
  await card(
    ctx,
    [`### ${HEADING}`, done.ok ? "My name here is back to normal." : "Discord would not let me change that."].join("\n"),
  );
}

/* ------------------------------------------------------------------ toggles */

export function toggle(field: "ping" | "punctuation", what: string) {
  return async (ctx: PrefixContext, guildId: string): Promise<void> => {
    const style = await styleOf(guildId);
    const state = switchWord(words(ctx.argument)[0] ?? "");
    const on = field === "ping" ? style.ping : style.punctuation;

    if (state === null) {
      await card(
        ctx,
        [`### ${HEADING}`, `${what} — **${on ? "on" : "off"}**.`, "", "-# `on` or `off` changes it."].join("\n"),
      );
      return;
    }

    await setToggle(guildId, field, state);
    await card(ctx, [`### ${HEADING}`, `${what} — **${state ? "on" : "off"}**.`].join("\n"));
  };
}

/* ---------------------------------------------------------------- responses */

const WHAT: Record<Kind, string> = {
  approve: "Approval messages",
  default: "Ordinary messages",
  loading: "Progress messages",
  warn: "Warnings and refusals",
};

const REACH: Record<Kind, string> = {
  approve: "Used by commands that report something done.",
  default: "Used by nearly every card the bot sends.",
  loading: "Used by commands that report progress while they work.",
  warn: "Used by every permission refusal in the bot.",
};

export function responseSetter(kind: Kind) {
  return async (ctx: PrefixContext, guildId: string): Promise<void> => {
    const tokens = words(ctx.argument);
    const style = await styleOf(guildId);

    if (tokens.length === 0) {
      // Rendered in its own style, so what it looks like is the answer.
      await ctx.reply(
        withStyle(style, () =>
          styled(
          [
            `### ${HEADING}`,
            `**${WHAT[kind]}** — ${style.emoji[kind] ?? "no emoji"}, ${
              style.color[kind] === undefined ? "no colour" : hex(style.color[kind] as number)
            }`,
            `-# ${REACH[kind]}`,
            "",
            `-# \`customize response ${kind} [emoji] [colour]\` changes it. This card is in that style.`,
          ].join("\n"),
          kind,
          ),
        ),
      );
      return;
    }

    let emoji: string | null = null;
    let color: number | null = null;
    let soft: boolean | null = null;

    for (const token of tokens) {
      const named = /^soft\s*=\s*(\w+)$/i.exec(token);
      if (named && kind === "warn") {
        soft = switchWord(named[1] as string) ?? false;
        continue;
      }
      if (EMOJI.test(token)) {
        emoji = token;
        continue;
      }
      const parsed = parseColor(token);
      if (parsed !== null) color = parsed;
    }

    if (emoji === null && color === null && soft === null) {
      await card(
        ctx,
        [
          `### ${HEADING}`,
          "Give an emoji, a colour, or both.",
          "-# A colour is `#5865f2` or a name like `blurple`.",
        ].join("\n"),
      );
      return;
    }

    await setStyle(guildId, kind, emoji ?? style.emoji[kind] ?? null, color ?? style.color[kind] ?? null);
    if (soft !== null) await setToggle(guildId, "warn_soft", soft);
    forget(guildId);

    // The style scope was opened at dispatch, so this command is still running
    // inside the OLD one. Re-entering with the new style is what makes "this
    // card is in that style" true, rather than a promise about the next card.
    const next = await styleOf(guildId);
    await ctx.reply(
      withStyle(next, () =>
        styled(
          [
            `### ${HEADING}`,
            `**${WHAT[kind]}** — ${next.emoji[kind] ?? "no emoji"}, ${
              next.color[kind] === undefined ? "no colour" : hex(next.color[kind] as number)
            }`,
            kind === "warn" && next.warnSoft ? "-# Soft: warnings use the ordinary colour." : "",
            `-# ${REACH[kind]} This card is in that style.`,
          ]
            .filter(Boolean)
            .join("\n"),
          kind,
        ),
      ),
    );
  };
}

export async function responseOverview(ctx: PrefixContext, guildId: string): Promise<void> {
  const style = await styleOf(guildId);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      ...KINDS.map(
        (kind) =>
          `**${kind}** — ${style.emoji[kind] ?? "no emoji"}, ${
            style.color[kind] === undefined ? "no colour" : hex(style.color[kind] as number)
          }`,
      ),
      "",
      "-# `customize response <kind> [emoji] [colour]` changes one.",
      "-# Each one shows itself in its own style.",
    ].join("\n"),
  );
}

export async function resetEverything(ctx: PrefixContext, guildId: string): Promise<void> {
  await resetAll(guildId);
  await saveBio(guildId, null);
  await editSelfMember(guildId, { nick: null, avatar: null, banner: null });

  await card(
    ctx,
    [
      `### ${HEADING}`,
      "Back to normal: name, avatar, banner, bio, responses, pings and punctuation.",
    ].join("\n"),
  );
}
