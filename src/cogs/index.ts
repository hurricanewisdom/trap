import type { Cog } from "../core/cog.js";
import { configCog } from "./config/index.js";
import { lastfmCog } from "./lastfm/index.js";
import { moderationCog } from "./moderation/index.js";
import { helpCog } from "./help/index.js";

export const cogs: Cog[] = [
  configCog,
  moderationCog,
  lastfmCog,
  helpCog,
];
