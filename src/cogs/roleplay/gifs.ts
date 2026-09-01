const ENDPOINT = "https://api.otakugifs.xyz/gif";

const FETCH_MS = 8_000;

// One reaction's worth of urls, kept so a run of the same command does not make
// a request every time and does not repeat the same picture either.
const POOL_SIZE = 12;

const pools = new Map<string, string[]>();

/**
 * A gif for one reaction, or null if the service will not answer.
 *
 * The bot posts the line either way: a reaction command that says nothing
 * because somebody else's cdn is down is worse than one without a picture.
 */
export async function gifFor(reaction: string): Promise<string | null> {
  const held = pools.get(reaction);
  if (held && held.length > 0) return held.pop() ?? null;

  const fetched = await Promise.all(
    Array.from({ length: 4 }, () => oneGif(reaction)),
  );
  const fresh = [...new Set(fetched.filter((one): one is string => one !== null))];
  if (fresh.length === 0) return null;

  // Whatever is left over answers the next few invocations without a request.
  pools.set(reaction, fresh.slice(1, POOL_SIZE));
  return fresh[0] ?? null;
}

async function oneGif(reaction: string): Promise<string | null> {
  try {
    const answer = await fetch(`${ENDPOINT}?reaction=${encodeURIComponent(reaction)}`, {
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { "user-agent": "trap-bot/1.x" },
    });
    if (!answer.ok) return null;

    const body = (await answer.json()) as { url?: string };
    // The url is going into a message, so it is checked rather than trusted.
    return typeof body.url === "string" && body.url.startsWith("https://") ? body.url : null;
  } catch {
    return null;
  }
}
