/**
 * The card editor: writing, checking and previewing your own now-playing
 * layout. The markup itself lives in ../template.ts.
 */

import { sql } from "../../../core/db.js";
import { redis } from "../../../core/redis.js";
import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { EMBED_COLOR, TargetError, simpleCard } from "../shared.js";
import { BLOCKS, EXAMPLE, VARIABLE_NAMES, validateTemplate } from "../template.js";

const CACHE_TTL = 60;
const MAX_SOURCE = 2000;

const key = (discordId: string) => `trap:lf:tmpl:${discordId}`;

/** The caller's saved template, or null. */
export async function getTemplate(discordId: string): Promise<string | null> {
  try {
    const hit = await redis.get(key(discordId));
    if (hit !== null) return hit === "" ? null : hit;
  } catch {
    /* fall through to the database */
  }
  const rows = await sql<{ np_template: string | null }[]>`
    SELECT np_template FROM lastfm_user_settings WHERE discord_id = ${discordId}
  `;
  const template = rows[0]?.np_template ?? null;
  redis.set(key(discordId), template ?? "", "EX", CACHE_TTL).catch(() => {});
  return template;
}

async function saveTemplate(discordId: string, source: string | null): Promise<void> {
  await sql`
    INSERT INTO lastfm_user_settings (discord_id, np_template)
    VALUES (${discordId}, ${source})
    ON CONFLICT (discord_id) DO UPDATE
      SET np_template = ${source}, updated_at = now()
  `;
  await redis.del(key(discordId)).catch(() => {});
}

/** Strips a code fence, since people paste one out of habit. */
function unfence(raw: string): string {
  const fenced = raw.trim().match(/^```(?:[a-zA-Z0-9]*)\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] ?? "" : raw).trim();
}

function helpCard(current: string | null) {
  const blocks = BLOCKS.map(([form, what]) => `\`${form}\`\n-# ${what}`).join("\n");
  const variables = VARIABLE_NAMES.map((v) => `\`{${v}}\``).join(" ");

  return [
    "Write one block a line. Anything in braces is replaced when the card is sent.",
    "",
    "**Blocks**",
    blocks,
    "",
    "**Values**",
    variables,
    "",
    "**Example**",
    "```",
    EXAMPLE,
    "```",
    current ? "" : "-# `,card set <your template>` to save one, then `,lfmode custom`.",
    current ? "-# `,card show` to see yours, `,card preview` to try it." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function cardCommand(ctx: PrefixContext): Promise<void> {
  const argument = ctx.argument.trim();
  const [word = ""] = argument.split(/\s+/);
  const rest = argument.slice(word.length).trim();
  const sub = word.toLowerCase();

  if (!sub || sub === "help") {
    const current = await getTemplate(ctx.authorId);
    await paginate(ctx, simpleCard("Card editor", helpCard(current)), EMBED_COLOR);
    return;
  }

  if (sub === "show") {
    const current = await getTemplate(ctx.authorId);
    if (!current) {
      await paginate(
        ctx,
        simpleCard("Card editor", "You have no template saved. `,card help` explains the blocks."),
        EMBED_COLOR,
      );
      return;
    }
    await paginate(
      ctx,
      simpleCard("Your card template", "```\n" + current.slice(0, 1800) + "\n```"),
      EMBED_COLOR,
    );
    return;
  }

  if (sub === "reset" || sub === "clear" || sub === "remove") {
    await saveTemplate(ctx.authorId, null);
    await paginate(
      ctx,
      simpleCard("Card editor", "Template cleared. `,lfmode default` puts the standard card back."),
      EMBED_COLOR,
    );
    return;
  }

  if (sub === "example") {
    await saveTemplate(ctx.authorId, EXAMPLE);
    await paginate(
      ctx,
      simpleCard(
        "Card editor",
        "Saved the example template. Run `,lfmode custom`, then `,np` to see it.\n\n```\n" +
          EXAMPLE +
          "\n```",
      ),
      EMBED_COLOR,
    );
    return;
  }

  if (sub === "set") {
    const source = unfence(rest);
    if (!source) throw new TargetError("Give the template after `,card set`. `,card help` shows the blocks.");
    if (source.length > MAX_SOURCE) throw new TargetError(`That is longer than ${MAX_SOURCE} characters.`);

    const errors = validateTemplate(source);
    if (errors.length > 0) {
      await paginate(
        ctx,
        simpleCard(
          "That template will not render",
          errors.slice(0, 8).map((e) => `- ${e}`).join("\n") + "\n\n-# Nothing was saved.",
        ),
        EMBED_COLOR,
      );
      return;
    }

    await saveTemplate(ctx.authorId, source);
    await paginate(
      ctx,
      simpleCard(
        "Card saved",
        "Run `,lfmode custom` to use it, then `,np`.\n\n```\n" + source.slice(0, 1500) + "\n```",
      ),
      EMBED_COLOR,
    );
    return;
  }

  if (sub === "check") {
    const source = unfence(rest) || (await getTemplate(ctx.authorId)) || "";
    if (!source) throw new TargetError("Nothing to check. Pass a template or save one first.");
    const errors = validateTemplate(source);
    await paginate(
      ctx,
      simpleCard(
        errors.length ? "Problems found" : "Template is fine",
        errors.length ? errors.map((e) => `- ${e}`).join("\n") : "Every line parses and fits Discord's limits.",
      ),
      EMBED_COLOR,
    );
    return;
  }

  throw new TargetError("Use `,card help`, `set`, `show`, `check`, `example` or `reset`.");
}

export function registerCardEditor(): void {
  register({
    name: "card",
    aliases: ["template", "npcard"],
    description: "Build your own now playing card",
    handler: guard(cardCommand),
  });
}
