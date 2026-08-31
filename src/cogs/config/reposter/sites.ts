export interface Site {
  name: string;
  hosts: string[];
  through: string;
  path?: RegExp;
  // Tumblr gives every blog its own subdomain, so no list of exact hosts can
  // ever cover it.
  suffixes?: string[];
}

// `through` is a third-party service that re-serves a post so Discord can play
// the video inline. It is only a fallback now that the downloader exists, and it
// is empty for most sites because no such service exists for them. They also come
// and go: ddinstagram.com stopped resolving entirely and kkinstagram took over,
// which is why this is one table to edit rather than a rule spread through the
// code.
//
// Measured from this box, not assumed. These download: youtube, tiktok,
// instagram, x, snapchat, tumblr, pinterest, twitch, streamable, medal,
// soundcloud. These do not, and lean on `through` or on Discord's own embed:
// reddit and facebook want an account, bilibili answers 412 to this datacenter.
// Gofile is absent because yt-dlp has no extractor for it at all.
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
    path: /^\/@[^/]+\/(?:video|photo)\//,
  },
  {
    name: "tiktok",
    hosts: ["vm.tiktok.com", "vt.tiktok.com"],
    through: "vxtiktok.com",
    path: /^\/[\w-]+/,
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
    // Reddit demands an account from the downloader, so this one really does
    // depend on the rewrite host to play at all.
    name: "reddit",
    hosts: ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com"],
    through: "rxddit.com",
    path: /^\/r\/[^/]+\/(?:comments|s)\//,
  },
  {
    name: "snapchat",
    hosts: ["snapchat.com", "www.snapchat.com", "t.snapchat.com"],
    through: "",
    path: /^\/(?:spotlight|p|t)\//,
  },
  {
    name: "facebook",
    hosts: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"],
    through: "",
    path: /^\/(?:watch|reel\/|share\/|video\.php|[^/]+\/videos\/)/,
  },
  {
    name: "facebook",
    hosts: ["fb.watch"],
    through: "",
    path: /^\/[\w-]+/,
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
    name: "bilibili",
    hosts: ["bilibili.com", "www.bilibili.com", "m.bilibili.com"],
    through: "",
    path: /^\/video\//,
  },
  {
    name: "bilibili",
    hosts: ["b23.tv"],
    through: "",
    path: /^\/[A-Za-z0-9]+$/,
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

function rewrite(site: Site, parsed: URL): string {
  // Most sites have no rewrite host: Discord either plays them already or
  // nothing re-serves them, so the downloader is the only path.
  if (!site.through) return parsed.toString();

  const out = new URL(parsed.toString());
  out.host = site.through;
  out.protocol = "https:";
  out.search = "";
  out.hash = "";
  return out.toString();
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
