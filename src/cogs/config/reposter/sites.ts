export interface Site {
  name: string;
  hosts: string[];
  through: string;
  path?: RegExp;
  // Tumblr gives every blog its own subdomain, so no list of exact hosts can
  // ever cover it.
  suffixes?: string[];
  // A path that hides what it points at, and has to be followed before anything
  // can be decided about it.
  short?: RegExp;
  // Where photo posts can be read from, and the path that says it is one. Photo
  // posts are not video and yt-dlp will not touch them.
  album?: string;
  photos?: RegExp;
  // A photo post carries the same id a video would, and yt-dlp answers for the
  // video form even when it refuses the photo one. That is where the counts are.
  counts?: { from: RegExp; to: string };
}

// `through` is a third-party service that re-serves a post so Discord can play
// the video inline. It is only a fallback now that the downloader exists, and it
// is empty for most sites because no such service exists for them. They also come
// and go: ddinstagram.com stopped resolving entirely and kkinstagram took over,
// which is why this is one table to edit rather than a rule spread through the
// code.
//
// Measured from this box, not assumed. Reddit refuses this address outright, so
// it is fetched through its rewrite host instead, which serves both the video and
// the counts. Gofile is absent because yt-dlp has no extractor for it at all.
export const SITES: Site[] = [
  {
    name: "x",
    hosts: ["x.com", "twitter.com", "www.x.com", "www.twitter.com", "fixupx.com"],
    through: "fxtwitter.com",
    path: /^\/[^/]+\/status\/\d+/,
  },
  {
    name: "instagram",
    hosts: ["instagram.com", "www.instagram.com", "ddinstagram.com"],
    through: "kkinstagram.com",
    path: /^\/(?:p|reel|reels|tv|share)\//,
  },
  {
    name: "tiktok",
    hosts: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"],
    through: "vxtiktok.com",
    album: "tnktok.com",
    path: /^\/(?:@[^/]+\/(?:video|photo)\/|t\/)/,
    short: /^\/t\//,
    photos: /\/photo\//,
    counts: { from: /\/photo\//, to: "/video/" },
  },
  {
    name: "tiktok",
    hosts: ["vm.tiktok.com", "vt.tiktok.com"],
    through: "vxtiktok.com",
    album: "tnktok.com",
    path: /^\/[\w-]+/,
    short: /^\//,
    photos: /\/photo\//,
    counts: { from: /\/photo\//, to: "/video/" },
  },
  {
    name: "youtube",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com"],
    through: "",
    path: /^\/(?:watch|shorts\/|live\/|embed\/)/,
  },
  {
    name: "youtube",
    hosts: ["youtu.be"],
    through: "",
    path: /^\/[\w-]{6,}$/,
  },
  {
    // Reddit answers this address with 403 whatever the extractor does, so this
    // one depends entirely on the rewrite host. rxddit.com started returning 502
    // and had to be swapped out, which is the whole argument for this table.
    name: "reddit",
    hosts: ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"],
    through: "vxreddit.com",
    path: /^\/r\/[^/]+\/(?:comments|s)\//,
  },
  {
    name: "snapchat",
    hosts: ["snapchat.com", "www.snapchat.com", "t.snapchat.com"],
    through: "",
    path: /^\/(?:spotlight|p|t)\//,
  },
  {
    name: "tumblr",
    hosts: ["tumblr.com", "www.tumblr.com"],
    suffixes: [".tumblr.com"],
    through: "",
    path: /^\/post\/\d+|^\/[^/]+\/\d+/,
  },
  {
    name: "pinterest",
    hosts: ["pinterest.com", "www.pinterest.com", "pinterest.co.uk", "pinterest.ca"],
    through: "",
    path: /^\/pin\//,
  },
  {
    name: "pinterest",
    hosts: ["pin.it"],
    through: "",
    path: /^\/[\w-]+/,
  },
  {
    // clips.twitch.tv puts the slug at the root; twitch.tv itself needs a longer
    // path, or every channel link would be treated as a video.
    name: "twitch",
    hosts: ["clips.twitch.tv"],
    through: "",
    path: /^\/[\w-]+$/,
  },
  {
    name: "twitch",
    hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"],
    through: "",
    path: /^\/(?:videos\/\d+|[^/]+\/clip\/)/,
  },
  {
    name: "streamable",
    hosts: ["streamable.com", "www.streamable.com"],
    through: "",
    path: /^\/\w+$/,
  },
  {
    name: "soundcloud",
    hosts: ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"],
    through: "",
    path: /^\/[^/]+\/[^/]+/,
  },
  {
    name: "soundcloud",
    hosts: ["on.soundcloud.com"],
    through: "",
    path: /^\/[\w-]+/,
  },
  {
    name: "medal",
    hosts: ["medal.tv", "www.medal.tv"],
    through: "",
    path: /^\/(?:games\/[^/]+\/)?clips\//,
  },
];

// Two entries share the twitch name, so the listing has to be deduplicated or
// the help text says it twice.
export const SITE_NAMES: string[] = [...new Set(SITES.map((one) => one.name))];

const URL_IN_TEXT = /https?:\/\/[^\s<>()\[\]]+/gi;

export interface Found {
  site: Site;
  original: string;
  rewritten: string;
}

// Moves a link onto another host, keeping the path and dropping the tracking
// query that short links arrive with.
export function hostedAt(url: string, host: string): string | null {
  try {
    const out = new URL(url);
    out.host = host;
    out.protocol = "https:";
    out.search = "";
    out.hash = "";
    return out.toString();
  } catch {
    return null;
  }
}

function rewrite(site: Site, parsed: URL): string {
  // Most sites have no rewrite host: Discord either plays them already or
  // nothing re-serves them, so the downloader is the only path.
  if (!site.through) return parsed.toString();
  return hostedAt(parsed.toString(), site.through) ?? parsed.toString();
}

// True when the link cannot be understood without following it first.
export function isShort(site: Site, url: string): boolean {
  if (!site.short) return false;
  try {
    return site.short.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// The url to ask for a photo post's engagement counts, which is not the url the
// photos come from.
export function countsUrl(site: Site, url: string): string | null {
  if (!site.counts) return null;
  const swapped = url.replace(site.counts.from, site.counts.to);
  return swapped === url ? null : swapped;
}

// Where to read a photo post from, or null when this is not one.
export function albumFor(site: Site, url: string): string | null {
  if (!site.album || !site.photos) return null;
  try {
    if (!site.photos.test(new URL(url).pathname)) return null;
  } catch {
    return null;
  }
  return hostedAt(url, site.album);
}

export function findLink(content: string, strict: boolean): Found | null {
  const matches = [...content.matchAll(URL_IN_TEXT)].map((hit) => hit[0]);
  if (matches.length === 0) return null;

  // Without strict, the message has to be the link and nothing else, so a link
  // mentioned in passing does not drag a video into the channel.
  if (!strict) {
    const only = content.trim();
    if (matches.length !== 1 || only !== matches[0]) return null;
  }

  for (const raw of matches) {
    let parsed: URL;
    try {
      parsed = new URL(raw.replace(/[.,!?)]+$/, ""));
    } catch {
      continue;
    }

    const host = parsed.hostname.toLowerCase();
    const site = SITES.find(
      (one) =>
        (one.hosts.includes(host) ||
          (one.suffixes ?? []).some((tail) => host.endsWith(tail))) &&
        (!one.path || one.path.test(parsed.pathname)),
    );
    if (!site) continue;

    return { site, original: raw, rewritten: rewrite(site, parsed) };
  }

  return null;
}
