import type { Cog } from "../../core/cog.js";
import { inCategory } from "../../core/prefix.js";
import { registerGeneral } from "./commands.js";
import { registerExpressions } from "./expressions.js";
import { registerImages } from "./images.js";
import { registerInfo } from "./info.js";
import { registerLookups } from "./lookups.js";
import { registerPersonal } from "./personal.js";
import { registerServices } from "./services.js";

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

    inCategory("serverinfo", registerInfo);
    inCategory("expressions", registerExpressions);
    inCategory("images", registerImages);
    inCategory("lookups", registerLookups);
    inCategory("personal", registerPersonal);
    inCategory("lookups", registerServices);
  },
};
