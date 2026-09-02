import { PERMISSION, getGuild, hasPermission, memberOf } from "./discord.js";
import { fakeBits } from "./fakeperms.js";
import { accented, IS_COMPONENTS_V2 } from "../helpers/components.js";
import { colorFor, decorate, type Kind } from "./style.js";
import type { PrefixContext, ReplyPayload } from "./prefix.js";

export const MANAGE_GUILD = "Manage Server";

export const MANAGE_CHANNELS = "Manage Channels";

export const MANAGE_MESSAGES = "Manage Messages";

export const ADMINISTRATOR = "Administrator";

export const MANAGE_WEBHOOKS = "Manage Webhooks";

export const OWNER = "Server Owner";

// Command gates go through this rather than hasPermission directly, so a role
// granted a fake permission can use the bot without holding the real one on
// Discord. Nothing here changes what anyone can do outside the bot.
export async function holds(guildId: string, userId: string, bit: bigint): Promise<boolean> {
  if (await hasPermission(guildId, userId, bit)) return true;

  const member = await memberOf(guildId, userId);
  const bits = await fakeBits(guildId, member?.roles ?? []);
  return (bits & PERMISSION.administrator) !== 0n || (bits & bit) !== 0n;
}

export async function isOwner(guildId: string, userId: string): Promise<boolean> {
  const guild = await getGuild(guildId);
  return Boolean(guild) && guild?.owner_id === userId;
}

/**
 * One card, in one of the four kinds `,customize response` knows about.
 *
 * The kind picks the emoji and the colour the server chose. `notice` is the
 * neutral one and is what almost everything sends; `warned` is every refusal in
 * this file, which is what makes `customize response warn` mean something
 * across the whole bot without a call site having to opt in.
 */
export function styled(body: string, kind: Kind): ReplyPayload {
  const text = decorate(body, kind);
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      accented({ type: 17, components: [{ type: 10, content: text }] }, colorFor(kind)),
    ],
  };
}

export function notice(body: string): ReplyPayload {
  return styled(body, "default");
}

export function warned(body: string): ReplyPayload {
  return styled(body, "warn");
}

export function approved(body: string): ReplyPayload {
  return styled(body, "approve");
}

export function loading(body: string): ReplyPayload {
  return styled(body, "loading");
}

export async function requireGuild(ctx: PrefixContext, action: string): Promise<string | null> {
  if (ctx.guildId) return ctx.guildId;

  await ctx.reply(
    warned(
      `### Server only\nYou can only ${action} inside a server, not in a direct message.`,
    ),
  );
  return null;
}

export async function requireManageGuild(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageGuild)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission\nYou need the **${MANAGE_GUILD}** permission to ${action}.` +
        `\n-# Ask a server administrator, or someone who has it.`,
    ),
  );
  return null;
}

export async function requireManageChannels(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageChannels)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission\nYou need the **${MANAGE_CHANNELS}** permission to ${action}.` +
        `\n-# Ask a server administrator, or someone who has it.`,
    ),
  );
  return null;
}

export async function requireManageMessages(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageMessages)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MANAGE_MESSAGES}** permission to ${action}.` +
        `
-# Ask a server administrator, or someone who has it.`,
    ),
  );
  return null;
}

export async function requireAdministrator(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.administrator)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${ADMINISTRATOR}** permission to ${action}.` +
        `
-# This one clears everything at once, so it asks for more than the rest.`,
    ),
  );
  return null;
}

export async function requireManageWebhooks(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageWebhooks)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MANAGE_WEBHOOKS}** permission to ${action}.` +
        `
-# Ask a server administrator, or someone who has it.`,
    ),
  );
  return null;
}

// Deliberately not routed through holds(): ownership cannot be faked, or the
// role granted a fake permission could grant itself more.
export async function requireOwner(ctx: PrefixContext, action: string): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await isOwner(guildId, ctx.authorId)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
Only the **${OWNER}** can ${action}.` +
        `
-# This one hands out permissions, so it cannot be handed out.`,
    ),
  );
  return null;
}

export const BAN_MEMBERS = "Ban Members";

export async function requireBanMembers(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.banMembers)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${BAN_MEMBERS}** permission to ${action}.`,
    ),
  );
  return null;
}

export const MODERATE_MEMBERS = "Moderate Members";

export async function requireModerateMembers(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.moderateMembers)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MODERATE_MEMBERS}** permission to ${action}.`,
    ),
  );
  return null;
}

export const MANAGE_ROLES = "Manage Roles";

export async function requireManageRoles(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageRoles)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MANAGE_ROLES}** permission to ${action}.`,
    ),
  );
  return null;
}

export const MANAGE_NICKNAMES = "Manage Nicknames";

export async function requireManageNicknames(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageNicknames)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MANAGE_NICKNAMES}** permission to ${action}.`,
    ),
  );
  return null;
}

export const MOVE_MEMBERS = "Move Members";

export async function requireMoveMembers(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.moveMembers)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MOVE_MEMBERS}** permission to ${action}.`,
    ),
  );
  return null;
}

export const MANAGE_THREADS = "Manage Threads";

export async function requireManageThreads(
  ctx: PrefixContext,
  action: string,
): Promise<string | null> {
  const guildId = await requireGuild(ctx, action);
  if (!guildId) return null;

  if (await holds(guildId, ctx.authorId, PERMISSION.manageThreads)) return guildId;

  await ctx.reply(
    warned(
      `### Missing permission
You need the **${MANAGE_THREADS}** permission to ${action}.`,
    ),
  );
  return null;
}
