import type { Cog } from "../../core/cog.js";
import { registerGeneral } from "./commands.js";

export const generalCog: Cog = {
  name: "information",
  label: "Information",
  description: "Bot status and utilities",
  setup(ctx) {
    registerGeneral({
      botVersion: ctx.version.bot,
      libVersion: ctx.version.library,
      latency: ctx.gateway.latency,
      shardCount: ctx.gateway.shards,
      prefix: ctx.prefix,
    });
  },
};
