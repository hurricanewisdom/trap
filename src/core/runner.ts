/**
 * Running a command from something other than a slash invocation.
 *
 * The help menu lets you pick a command from a dropdown and have it run there
 * and then, which means a button press has to end up in the same place a
 * slash command does: deferred, then answered, with a real message for the
 * pager to attach to.
 *
 * Only `src/index.ts` owns the bot and knows how to reply to an interaction,
 * and it must not be imported from a cog. So the direction is inverted the
 * same way `core/listening.ts` does it: index registers a runner at startup
 * and cogs ask for one.
 */

import type { PrefixCommand } from "./prefix.js";

/**
 * Runs `command` for whoever triggered `interaction`, as though they had typed
 * it. `argument` is the text the handler will parse.
 */
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

/**
 * Runs a command, or does nothing if no runner is registered.
 *
 * Returns whether it ran, so a caller can fall back to explaining rather than
 * leaving a click with no visible effect.
 */
export async function runCommand(
  interaction: unknown,
  command: PrefixCommand,
  argument: string,
): Promise<boolean> {
  if (!runner) return false;
  await runner(interaction, command, argument);
  return true;
}
