/** Shapes returned by the Last.fm endpoints this bot uses. */

export interface LfImage {
  "#text": string;
  size: string;
}

export interface LfArtistRef {
  name?: string;
  "#text"?: string;
  url?: string;
  mbid?: string;
}

export interface TopArtist {
  name: string;
  url: string;
  playcount: string;
  image?: LfImage[];
}

export interface TopAlbum {
  name: string;
  url: string;
  playcount: string;
  artist: LfArtistRef;
  image?: LfImage[];
}

export interface TopTrack {
  name: string;
  url: string;
  playcount: string;
  duration?: string;
  artist: LfArtistRef;
  image?: LfImage[];
}

export interface LovedTrack {
  name: string;
  url: string;
  artist: LfArtistRef;
  date?: { uts: string };
}

export interface ArtistStats {
  name: string;
  url: string;
  stats?: { listeners?: string; playcount?: string; userplaycount?: string };
  tags?: { tag?: { name: string }[] };
  bio?: { summary?: string };
  image?: LfImage[];
}

export interface AlbumStats {
  name: string;
  url: string;
  artist: string;
  playcount?: string;
  userplaycount?: string;
  listeners?: string;
  image?: LfImage[];
  tracks?: { track?: { name: string; url: string; duration?: string | null }[] };
}
