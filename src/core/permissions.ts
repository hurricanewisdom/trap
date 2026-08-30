import { PERMISSION, canManageGuild, hasPermission } from "./discord.js";
import { accented, IS_COMPONENTS_V2 } from "../helpers/components.js";
import type { PrefixContext, ReplyPayload } from "./prefix.js";

export const MANAGE_GUILD = "Manage Server";

export const MANAGE_CHANNELS = "Manage Channels";

export const MANAGE_MESSAGES = "Manage Messages";

export function notice(body: string): ReplyPayload {
  return {
    flags: IS_COMPONENTS_V2,
    components: [accented({ type: 17, components: [{ type: 10, content: body }] })],
  };
}

export async function requireGuild(ctx: PrefixContext, action: string): Promise<string | null> {
  if (ctx.guildId) return ctx.guildId;

  await ctx.reply(
    notice(
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

  if (await canManageGuild(guildId, ctx.authorId)) return guildId;

  await ctx.reply(
    notice(
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

  if (await hasPermission(guildId, ctx.authorId, PERMISSION.manageChannels)) return guildId;

  await ctx.reply(
    notice(
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

  if (await hasPermission(guildId, ctx.authorId, PERMISSION.manageMessages)) return guildId;

  await ctx.reply(
    notice(
      `### Missing permission
You need the **${MANAGE_MESSAGES}** permission to ${action}.` +
        `
-# Ask a server administrator, or someone who has it.`,
    ),
  );
  return null;
}
