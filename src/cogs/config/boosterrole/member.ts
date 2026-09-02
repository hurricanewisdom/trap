import {
  createRole,
  deleteRole,
  displayName,
  editRole,
  giveRole,
  moveRole,
  type Role,
  type RolePayload,
} from "../../../core/discord.js";
import type { PrefixContext } from "../../../core/prefix.js";
import {
  HEADING,
  belowMe,
  blockedWord,
  card,
  dominantColor,
  hex,
  hierarchyNote,
  parseColor,
  randomColor,
  requireBooster,
  requireBotRoles,
  roleById,
  tierNote,
  words,
  memberId,
} from "./shared.js";
import { claim, config, countRoles, release, roleOf } from "./store.js";

const NAME_LIMIT = 100;

interface Wanted {
  primary: number;
  secondary: number | null;
  name: string | null;
}

function parseWanted(argument: string): Wanted | { error: string } {
  const parts = words(argument);
  if (parts.length === 0) return { error: "Give me a colour, like `#1db954` or `blue`." };

  const primary = parseColor(parts[0] as string);
  if (primary === null) {
    return { error: `\`${(parts[0] as string).slice(0, 20)}\` is not a colour I can read.` };
  }

  let at = 1;
  let secondary: number | null = null;
  if (parts.length > 1) {
    const maybe = parseColor(parts[1] as string);
    if (maybe !== null) {
      secondary = maybe;
      at = 2;
    }
  }

  const name = parts.slice(at).join(" ").trim();
  return { primary, secondary, name: name || null };
}

function payloadFor(wanted: Wanted, name?: string): RolePayload {
  const body: RolePayload = {
    ...(name === undefined ? {} : { name: name.slice(0, NAME_LIMIT) }),
  };

  if (wanted.secondary === null) {
    body.color = wanted.primary;
    body.colors = { primary_color: wanted.primary, secondary_color: null, tertiary_color: null };
  } else {
    body.color = wanted.primary;
    body.colors = {
      primary_color: wanted.primary,
      secondary_color: wanted.secondary,
      tertiary_color: null,
    };
  }
  return body;
}

export async function place(guildId: string, roleId: string): Promise<void> {
  const { baseRoleId, baseAbove } = await config(guildId);
  if (!baseRoleId) return;

  const base = await roleById(guildId, baseRoleId);
  if (!base) return;

  // Taking the base's own position pushes the base up one, which lands the new
  // role directly below it. One higher lands it directly above.
  const at = baseAbove ? base.position + 1 : base.position;
  await moveRole(guildId, roleId, at, "Booster role placement");
}

export async function existing(guildId: string, userId: string): Promise<Role | null> {
  const roleId = await roleOf(guildId, userId);
  if (!roleId) return null;

  const role = await roleById(guildId, roleId);
  if (!role) {
    await release(guildId, userId);
    return null;
  }
  return role;
}

async function apply(ctx: PrefixContext, wanted: Wanted): Promise<void> {
  const guildId = await requireBooster(ctx, "set a booster role colour");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  const chosenName = wanted.name;
  if (chosenName) {
    const banned = await blockedWord(guildId, chosenName);
    if (banned) {
      await card(
        ctx,
        [`### ${HEADING}`, `That name contains a blocked word: \`${banned}\`.`].join("\n"),
      );
      return;
    }
  }

  const held = await existing(guildId, ctx.authorId);

  if (held) {
    if (!(await belowMe(guildId, held))) {
      await card(ctx, hierarchyNote(held));
      return;
    }

    const edited = await editRole(
      guildId,
      held.id,
      payloadFor(wanted, chosenName ?? undefined),
      `Booster role for ${ctx.authorId}`,
    );
    if (!edited.ok) {
      await card(ctx, [`### ${HEADING}`, "Discord refused that change.", tierNote(edited.message)].join("\n"));
      return;
    }
    await done(ctx, edited.data, wanted, "updated");
    return;
  }

  const { roleLimit } = await config(guildId);
  if (roleLimit !== null && (await countRoles(guildId)) >= roleLimit) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        `This server is at its limit of ${roleLimit} booster role${roleLimit === 1 ? "" : "s"}.`,
        "-# An admin can raise it with `boosterrole limit`.",
      ].join("\n"),
    );
    return;
  }

  const name = chosenName ?? (await displayName(guildId, ctx.authorId));
  const created = await createRole(guildId, payloadFor(wanted, name), `Booster role for ${ctx.authorId}`);
  if (!created.ok) {
    await card(ctx, [`### ${HEADING}`, "Discord refused to create the role.", tierNote(created.message)].join("\n"));
    return;
  }

  await claim(guildId, ctx.authorId, created.data.id);
  await place(guildId, created.data.id);
  await giveRole(guildId, ctx.authorId, created.data.id, "Booster role");
  await done(ctx, created.data, wanted, "created");
}

async function done(
  ctx: PrefixContext,
  role: Role,
  wanted: Wanted,
  verb: string,
): Promise<void> {
  const colour =
    wanted.secondary === null
      ? `\`${hex(wanted.primary)}\``
      : `\`${hex(wanted.primary)}\` into \`${hex(wanted.secondary)}\``;

  await card(
    ctx,
    [
      `### ${HEADING}`,
      `<@&${role.id}> ${verb}, ${colour}.`,
      wanted.secondary !== null && role.colors?.secondary_color == null
        ? "-# Discord kept only the first colour; a gradient needs boost level 2."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function setColor(ctx: PrefixContext): Promise<void> {
  const wanted = parseWanted(ctx.argument);
  if ("error" in wanted) {
    await card(ctx, [`### ${HEADING}`, wanted.error].join("\n"));
    return;
  }
  await apply(ctx, wanted);
}

export async function setRandom(ctx: PrefixContext): Promise<void> {
  await apply(ctx, { primary: randomColor(), secondary: null, name: null });
}

export async function setDominant(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBooster(ctx, "use an avatar colour");
  if (!guildId) return;

  // Naming somebody else takes the colour from their avatar and puts it on your
  // own role. It never touches theirs.
  const named = memberId(words(ctx.argument)[0] ?? "");
  const whose = named ?? ctx.authorId;

  const colour = await dominantColor(guildId, whose);
  if (colour === null) {
    await card(
      ctx,
      [
        `### ${HEADING}`,
        named
          ? `I could not read a colour from <@${named}>'s avatar.`
          : "I could not read a colour from your avatar.",
      ].join("\n"),
    );
    return;
  }
  await apply(ctx, { primary: colour, secondary: null, name: null });
}

export async function rename(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBooster(ctx, "rename a booster role");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  const name = ctx.argument.trim().slice(0, NAME_LIMIT);
  if (!name) {
    await card(ctx, [`### ${HEADING}`, "Give me the new name."].join("\n"));
    return;
  }

  const banned = await blockedWord(guildId, name);
  if (banned) {
    await card(ctx, [`### ${HEADING}`, `That name contains a blocked word: \`${banned}\`.`].join("\n"));
    return;
  }

  const role = await existing(guildId, ctx.authorId);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "You do not have a booster role yet."].join("\n"));
    return;
  }
  if (!(await belowMe(guildId, role))) {
    await card(ctx, hierarchyNote(role));
    return;
  }

  const edited = await editRole(guildId, role.id, { name }, `Booster role rename by ${ctx.authorId}`);
  if (!edited.ok) {
    await card(ctx, [`### ${HEADING}`, "Discord refused that name.", tierNote(edited.message)].join("\n"));
    return;
  }
  await card(ctx, [`### ${HEADING}`, `Your role is now <@&${role.id}>.`].join("\n"));
}

export async function setIcon(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBooster(ctx, "set a booster role icon");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  const role = await existing(guildId, ctx.authorId);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "You do not have a booster role yet."].join("\n"));
    return;
  }
  if (!(await belowMe(guildId, role))) {
    await card(ctx, hierarchyNote(role));
    return;
  }

  const url = ctx.argument.trim();
  if (!url || /^(remove|delete|del|rm|clear|none|off)$/i.test(url)) {
    const cleared = await editRole(guildId, role.id, { icon: null }, "Booster role icon cleared");
    await card(
      ctx,
      [
        `### ${HEADING}`,
        cleared.ok ? "Icon cleared." : "Discord refused that.",
        cleared.ok ? "" : tierNote(cleared.message),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }

  const encoded = await fetchIcon(url);
  if (!encoded) {
    await card(
      ctx,
      [`### ${HEADING}`, "I could not read an image from that link.", "-# Give a direct PNG, JPEG or GIF link under 256KB."].join("\n"),
    );
    return;
  }

  const edited = await editRole(guildId, role.id, { icon: encoded }, `Booster role icon by ${ctx.authorId}`);
  if (!edited.ok) {
    await card(ctx, [`### ${HEADING}`, "Discord refused that icon.", tierNote(edited.message)].join("\n"));
    return;
  }
  await card(ctx, [`### ${HEADING}`, `Icon set on <@&${role.id}>.`].join("\n"));
}

async function fetchIcon(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const type = res.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpe?g|gif|webp)/i.test(type)) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 256_000) return null;

    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function removeOwn(ctx: PrefixContext): Promise<void> {
  const guildId = await requireBooster(ctx, "remove a booster role");
  if (!guildId) return;
  if (!(await requireBotRoles(ctx, guildId))) return;

  const role = await existing(guildId, ctx.authorId);
  if (!role) {
    await card(ctx, [`### ${HEADING}`, "You do not have a booster role."].join("\n"));
    return;
  }

  await release(guildId, ctx.authorId);
  const gone = await deleteRole(guildId, role.id, `Booster role removed by ${ctx.authorId}`);
  await card(
    ctx,
    [
      `### ${HEADING}`,
      gone.ok ? `**${role.name}** is gone.` : `Removed from my records, but Discord refused to delete **${role.name}**.`,
    ].join("\n"),
  );
}

/**
 * The same clearing the bare `icon` does, as its own command.
 *
 * It delegates rather than repeating the hierarchy and ownership checks, which
 * is the whole reason `setIcon` treats a removal word as an empty argument.
 */
export async function iconRemove(ctx: PrefixContext): Promise<void> {
  await setIcon({ ...ctx, argument: "" });
}
