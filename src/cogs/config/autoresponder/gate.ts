import { botCeiling, type Role } from "../../../core/discord.js";

export async function botCanManage(guildId: string, role: Role): Promise<string | null> {
  if (role.id === guildId) return "`@everyone` is not a role I can hand out.";

  const ceiling = await botCeiling(guildId);
  if (!ceiling.manageRoles) {
    return "I need the **Manage Roles** permission before I can hand a role out.";
  }
  if (ceiling.position <= role.position) {
    return `<@&${role.id}> sits at or above my own role, so Discord will not let me touch it.`;
  }
  return null;
}
