import { beginCogAttribution, endCogAttribution } from "./prefix.js";
import type { WebRouter } from "../web/server.js";

export interface CogContext {
  prefix: string;
  version: {
    bot: string;
    library: string;
  };
  gateway: {
    latency: () => string;
    shards: () => number;
  };

  web: WebRouter;
  messages: {
    delete: (channelId: string, messageId: string) => Promise<void>;
  };
}

export interface Cog {
  name: string;
  label?: string;
  description: string;
  setup: (ctx: CogContext) => void | Promise<void>;
}

const loaded: Cog[] = [];

export function loadedCogs(): readonly Cog[] {
  return loaded;
}

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
