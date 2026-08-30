import { UserError, guardFor } from "../../core/guard.js";

export class TargetError extends UserError {}

export const guard = guardFor("Last.fm");
