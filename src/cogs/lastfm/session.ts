/**
 * The caller's own Last.fm credentials, for the commands that write.
 *
 * Every write method — loving, scrobbling, tagging — needs a session key, and
 * a session key is the authority to change somebody's account. So there is
 * one way to get one and it is always the *caller's*: no command here accepts
 * a `user:` token or a mention, because acting on a named account would let
 * anyone tag or scrobble to a stranger's profile.
 */

import type { PrefixContext } from "../../core/prefix.js";
import { INVALID_SESSION, LastfmError } from "./api/index.js";
import { getSessionKey } from "./store.js";
import { TargetError } from "./guard.js";

export interface OwnAccount {
  username: string;
  sessionKey: string;
}

/** The caller's own credentials. Never anyone else's. */
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

/**
 * Turns a dead session into instructions rather than a raw API error.
 *
 * Last.fm reports a revoked or expired session as error 9, which is
 * recoverable by re-linking — worth saying, rather than showing the user
 * "Invalid session key".
 */
export function explain(err: unknown): never {
  if (err instanceof LastfmError && err.code === INVALID_SESSION) {
    throw new TargetError(
      "Last.fm rejected the stored authorisation. Run `,lf link` again to reconnect.",
    );
  }
  throw err;
}
