import type { PrefixCommand } from "./prefix.js";

export type CommandRunner = (
  interaction: unknown,
  command: PrefixCommand,
  argument: string,
) => Promise<void>;

let runner: CommandRunner | null = null;

export function provideRunner(next: CommandRunner): void {
  runner = next;
}

export function canRunCommands(): boolean {
  return runner !== null;
}

export async function runCommand(
  interaction: unknown,
  command: PrefixCommand,
  argument: string,
): Promise<boolean> {
  if (!runner) return false;
  await runner(interaction, command, argument);
  return true;
}
