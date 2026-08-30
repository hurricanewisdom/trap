/**
 * The wrapper every command handler is registered through.
 *
 * Handlers are written as though nothing fails: they fetch, they format, they
 * reply. That only works if something catches what they throw and turns it
 * into a reply, because an unhandled rejection in a gateway event leaves the
 * user staring at a command that did nothing at all.
 *
 * Two kinds of failure are distinguished. A `UserError` is a sentence meant
 * for whoever typed the command ("you have not linked an account") and is
 * shown as-is. Anything else is a bug or an outage: it is logged with a stack
 * for us, and shown as a short message to them.
 */

import { paginate } from "./pager.js";
import { EMBED_COLOR, simpleCard } from "../helpers/cards.js";
import type { PrefixContext } from "./prefix.js";

/**
 * An error whose message is safe and useful to show the user.
 *
 * Throw this for anything the user can act on. Never put an upstream error
 * body in one — those go to the log.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type Handler = (ctx: PrefixContext) => Promise<void>;

/**
 * Builds a guard for one cog. `title` is the heading shown on the card when a
 * command reports a problem, so it should read as the feature's name.
 */
export function guardFor(title: string) {
  return function guard(handler: Handler): Handler {
    return async (ctx: PrefixContext) => {
      try {
        await handler(ctx);
      } catch (err) {
        if (err instanceof UserError) {
          await paginate(ctx, simpleCard(title, err.message), EMBED_COLOR);
          return;
        }

        console.error(`${title} command failed:`, err);
        const message = err instanceof Error ? err.message : "Something went wrong.";
        await paginate(ctx, simpleCard("Error", message), EMBED_COLOR);
      }
    };
  };
}
