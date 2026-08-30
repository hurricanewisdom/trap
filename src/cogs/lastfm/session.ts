import type { PrefixContext } from "../../core/prefix.js";
import { INVALID_SESSION, LastfmError } from "./api/index.js";
import { getSessionKey } from "./store.js";
import { TargetError } from "./guard.js";

export interface OwnAccount {
  username: string;
  sessionKey: string;
}

export async function ownAccount(ctx: PrefixContext): Promise<OwnAccount> {
  const link = await getSessionKey(ctx.authorId);
  if (!link) {
    throw new TargetError("You have not linked a Last.fm account. Run `,lf link` to connect one.");
  }
  if (!link.sessionKey) {
    throw new TargetError("Your link has no session key. Run `,lf link` again to re-authorise.");
  }
  return link;
}

export function explain(err: unknown): never {
  if (err instanceof LastfmError && err.code === INVALID_SESSION) {
    throw new TargetError(
      "Last.fm rejected the stored authorisation. Run `,lf link` again to reconnect.",
    );
  }
  throw err;
}
