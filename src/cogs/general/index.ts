/** Core commands that work anywhere: latency and bot info. */

import type { Cog } from "../../core/cog.js";
import { lookup } from "../../core/prefix.js";
import { flatProvider, provideSlash } from "../../core/slash.js";
import { registerGeneral } from "./commands.js";

export const generalCog: Cog = {
  name: "information",
  description: "Latency and bot info",
  setup(ctx) {
    registerGeneral({
      botVersion: ctx.version.bot,
      libVersion: ctx.version.library,
      latency: ctx.gateway.latency,
      shardCount: ctx.gateway.shards,
      prefix: ctx.prefix,
    });

    // Registered at the top level: there are only two, and neither belongs
    // under /lastfm.
    const flat = ["ping", "botinfo"]
      .map((name) => ({ name, command: lookup(name) }))
      .filter((entry): entry is { name: string; command: NonNullable<typeof entry.command> } =>
        entry.command !== undefined,
      );
    provideSlash(flatProvider(flat));
  },
};
