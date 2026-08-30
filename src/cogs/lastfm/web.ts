/**
 * The web half of the Last.fm link flow.
 *
 * Last.fm sends the user back to this route with a one-time token, which is
 * exchanged for a lasting session and stored against the Discord id that
 * started the flow.
 */

import { page, send, type RouteContext, type WebRouter } from "../../web/server.js";
import { getSession } from "./api/index.js";
import { consumeLinkState, saveLink } from "./store.js";

/**
 * The state normally rides in the path, because Last.fm appends its own
 * `?token=` to whatever callback it was given. Some API accounts pin the
 * callback to an exact URL, so `?state=` is accepted as well.
 */
const WITH_STATE = /^\/lastfm\/callback\/([A-Za-z0-9_-]{16,128})\/?$/;
const PLAIN = /^\/lastfm\/callback\/?$/;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;

async function complete(state: string, token: string | null, ctx: RouteContext): Promise<void> {
  if (!token) {
    send(
      ctx.res,
      400,
      page("Missing token", "Last.fm did not send an authorisation token.", false),
    );
    return;
  }

  // Claiming the state is atomic, so a refreshed or replayed callback fails here.
  const discordId = await consumeLinkState(state);
  if (!discordId) {
    send(
      ctx.res,
      410,
      page(
        "Link expired",
        "That link was already used or has expired. Run <b>,lf link</b> again.",
        false,
      ),
    );
    return;
  }

  try {
    const session = await getSession(token);
    const { previous } = await saveLink(discordId, session.name, session.key);
    console.log(
      `lastfm: linked discord ${discordId} -> ${session.name}` +
        (previous && previous !== session.name ? ` (was ${previous})` : ""),
    );
    send(
      ctx.res,
      200,
      page(
        "Connected",
        `Your Last.fm account <b>${session.name}</b> is now linked. You can close this tab.`,
        true,
      ),
    );
  } catch (err) {
    console.error("lastfm callback failed:", err);
    send(
      ctx.res,
      502,
      page("Could not connect", "Last.fm rejected the authorisation. Please try again.", false),
    );
  }
}

export function registerLastfmRoutes(web: WebRouter): void {
  web.get(WITH_STATE, async (ctx) => {
    const state = ctx.params[0] ?? "";
    if (!STATE.test(state)) {
      send(ctx.res, 400, page("Invalid link", "That authorisation link is malformed.", false));
      return;
    }
    await complete(state, ctx.url.searchParams.get("token"), ctx);
  });

  web.get(PLAIN, async (ctx) => {
    const state = ctx.url.searchParams.get("state") ?? "";
    if (!STATE.test(state)) {
      send(ctx.res, 400, page("Invalid link", "That authorisation link is malformed.", false));
      return;
    }
    await complete(state, ctx.url.searchParams.get("token"), ctx);
  });
}
