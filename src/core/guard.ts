import { paginate } from "./pager.js";
import { USER_ACCENT, simpleCard } from "../helpers/cards.js";
import type { PrefixContext } from "./prefix.js";

export class UserError extends Error {
  readonly title: string | null;

  constructor(message: string, title: string | null = null) {
    super(message);
    this.name = "UserError";
    this.title = title;
  }
}

export type Handler = (ctx: PrefixContext) => Promise<void>;

export function guardFor(title: string) {
  return function guard(handler: Handler): Handler {
    return async (ctx: PrefixContext) => {
      try {
        await handler(ctx);
      } catch (err) {
        if (err instanceof UserError) {
          await paginate(ctx, simpleCard(err.title ?? title, err.message), USER_ACCENT);
          return;
        }

        console.error(`${title} command failed:`, err);
        const message = err instanceof Error ? err.message : "Something went wrong.";
        await paginate(ctx, simpleCard("Error", message), USER_ACCENT);
      }
    };
  };
}
