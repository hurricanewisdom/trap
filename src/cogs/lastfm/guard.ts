/**
 * The error wrapper every Last.fm handler is registered through.
 *
 * A thin naming of the shared guard: `TargetError` is what this cog throws
 * when the problem is the user's to fix — no linked account, an unknown
 * period, a username that cannot exist — and it renders under a "Last.fm"
 * heading rather than as an error.
 */

import { UserError, guardFor } from "../../core/guard.js";

/** A problem the user can act on, shown to them verbatim. */
export class TargetError extends UserError {}

export const guard = guardFor("Last.fm");
