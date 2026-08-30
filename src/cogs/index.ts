import type { Cog } from "../core/cog.js";
import { generalCog } from "./general/index.js";
import { configCog } from "./config/index.js";
import { lastfmCog } from "./lastfm/index.js";
import { utilityCog } from "./utility/index.js";
import { helpCog } from "./help/index.js";

export const cogs: Cog[] = [generalCog, configCog, utilityCog, lastfmCog, helpCog];
