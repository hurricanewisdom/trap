/**
 * The cog list.
 *
 * Adding a feature to the bot means adding a folder here and one line below —
 * nothing in `src/index.ts` needs to change.
 *
 * Order matters only for `help`, which reads the command registry at setup and
 * so must come last.
 */

import type { Cog } from "../core/cog.js";
import { generalCog } from "./general/index.js";
import { lastfmCog } from "./lastfm/index.js";
import { helpCog } from "./help/index.js";

export const cogs: Cog[] = [generalCog, lastfmCog, helpCog];
