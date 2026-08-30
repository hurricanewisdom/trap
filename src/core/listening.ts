/**
 * "What is this person playing right now?", asked without naming a service.
 *
 * More than one cog may want the answer, but only the Last.fm cog knows how
 * to get it. Importing that cog directly would tie the two together and break
 * the rule that a cog never reaches into a sibling.
 *
 * So the direction is inverted: whoever *can* answer registers a provider at
 * setup, and whoever *needs* the answer asks here. If no cog registered one,
 * callers get null and say so, rather than failing to compile.
 */

/** A track someone is playing, reduced to what a lookup needs. */
export interface NowPlaying {
  artist: string;
  track: string;
  album?: string;
  /** Ready-to-render "Track by Artist", for messages about this result. */
  label: string;
  /** False when this is the most recent scrobble rather than a live one. */
  playing: boolean;
}

export type NowPlayingProvider = (discordId: string) => Promise<NowPlaying | null>;

let provider: NowPlayingProvider | null = null;

/**
 * Registers the source of listening data. Called once, from a cog's setup.
 *
 * A second registration replaces the first rather than stacking: there is one
 * answer to "what are you playing", and silently preferring whichever cog
 * loaded first would be the harder behaviour to debug.
 */
export function provideNowPlaying(next: NowPlayingProvider): void {
  provider = next;
}

/** True when some cog can answer. */
export function hasNowPlayingProvider(): boolean {
  return provider !== null;
}

/**
 * What this user is playing, or null if nothing is known — either because no
 * provider is registered, or because they have not linked an account, or
 * because they have not scrobbled anything.
 */
export async function nowPlayingFor(discordId: string): Promise<NowPlaying | null> {
  if (!provider) return null;
  return await provider(discordId);
}
