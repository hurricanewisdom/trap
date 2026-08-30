export interface NowPlaying {
  artist: string;
  track: string;
  album?: string;
  label: string;
  playing: boolean;
}

export type NowPlayingProvider = (discordId: string) => Promise<NowPlaying | null>;

let provider: NowPlayingProvider | null = null;

export function provideNowPlaying(next: NowPlayingProvider): void {
  provider = next;
}

export function hasNowPlayingProvider(): boolean {
  return provider !== null;
}

export async function nowPlayingFor(discordId: string): Promise<NowPlaying | null> {
  if (!provider) return null;
  return await provider(discordId);
}
