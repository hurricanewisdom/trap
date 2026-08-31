import { PERMISSION } from "./discord.js";

export interface Grantable {
  name: string;
  bit: bigint;
  describes: string;
}

export const GRANTABLE: Grantable[] = [
  { name: "manage_messages", bit: PERMISSION.manageMessages, describes: "pins, snipe clearing" },
  { name: "manage_channels", bit: PERMISSION.manageChannels, describes: "the filters, availability" },
  { name: "manage_guild", bit: PERMISSION.manageGuild, describes: "prefixes, greetings, aliases" },
  { name: "manage_roles", bit: PERMISSION.manageRoles, describes: "booster roles" },
  { name: "manage_webhooks", bit: PERMISSION.manageWebhooks, describes: "the webhook group" },
  { name: "administrator", bit: PERMISSION.administrator, describes: "everything the bot gates" },
];

export function grantableFor(name: string): Grantable | null {
  const wanted = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return GRANTABLE.find((one) => one.name === wanted) ?? null;
}

export function nameOfBit(bit: bigint): string {
  return GRANTABLE.find((one) => one.bit === bit)?.name ?? "unknown";
}

export type FakePermissions = (guildId: string, roleIds: string[]) => Promise<bigint>;

let granted: FakePermissions | null = null;

export function provideFakePermissions(provided: FakePermissions): void {
  granted = provided;
}

export async function fakeBits(guildId: string, roleIds: string[]): Promise<bigint> {
  if (!granted || roleIds.length === 0) return 0n;
  try {
    return await granted(guildId, roleIds);
  } catch {
    return 0n;
  }
}
