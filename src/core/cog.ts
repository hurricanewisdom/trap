/**
 * Cogs.
 *
 * A cog is one self-contained feature — its commands, its state and any web
 * routes it needs. Cogs are listed in `src/cogs/index.ts` and loaded once at
 * startup; nothing else in the bot knows a given feature exists.
 *
 * Cogs receive a narrow context rather than the bot object, so a feature
 * cannot quietly reach into the gateway or the REST client. Anything a cog
 * genuinely needs from the runtime is added here deliberately.
 */

import { beginCogAttribution, endCogAttribution } from "./prefix.js";
import type { WebRouter } from "../web/server.js";

export interface CogContext {
  /** The text-command prefix, e.g. ",". */
  prefix: string;
  version: {
    bot: string;
    library: string;
  };
  gateway: {
    /** Human-readable heartbeat round-trip, e.g. "42 ms". */
    latency: () => string;
    shards: () => number;
  };
  /** Register HTTP routes served under the bot's public hostname. */
  web: WebRouter;
  messages: {
    /** Removes one of the bot's own messages; failures are swallowed. */
    delete: (channelId: string, messageId: string) => Promise<void>;
  };
}

export interface Cog {
  /** Short identifier, used in the startup log. */
  name: string;
  /** One line, shown to developers reading the cog list. */
  description: string;
  /**
   * Called once at startup. Register commands, event hooks and web routes
   * here. Throwing aborts boot, which is the right outcome for a cog that
   * cannot function.
   */
  setup: (ctx: CogContext) => void | Promise<void>;
}

const loaded: Cog[] = [];

/** Every cog that has been loaded, in order. Used by the help menu. */
export function loadedCogs(): readonly Cog[] {
  return loaded;
}

/**
 * Loads every cog in order and reports what came up.
 *
 * Setups run one at a time so that commands registered inside one can be
 * attributed to it without each command naming its own cog.
 */
export async function loadCogs(cogs: Cog[], ctx: CogContext): Promise<void> {
  for (const cog of cogs) {
    beginCogAttribution(cog.name);
    try {
      await cog.setup(ctx);
      loaded.push(cog);
    } finally {
      endCogAttribution();
    }
  }
  console.log(`cogs: loaded ${cogs.length} (${cogs.map((c) => c.name).join(", ")})`);
}
