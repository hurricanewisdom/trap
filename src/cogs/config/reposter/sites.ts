export interface Site {
  name: string;
  hosts: string[];
  through: string;
  path?: RegExp;
}

// These rewrite hosts are third-party services that re-serve a post so Discord
// can play the video inline. They come and go: ddinstagram.com stopped resolving
// entirely and kkinstagram took over, which is why this is one table to edit
// rather than a rule spread through the code.
export const SITES: Site[] = [
  {
    name: "x",
    hosts: ["x.com", "twitter.com", "www.x.com", "www.twitter.com"],
    through: "fxtwitter.com",
    path: /^\/[^/]+\/status\/\d+/,
  },
  {
    name: "instagram",
    hosts: ["instagram.com", "www.instagram.com"],
    through: "kkinstagram.com",
    path: /^\/(?:p|reel|reels|tv)\//,
  },
  {
    name: "tiktok",
    hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com"],
    through: "vxtiktok.com",
  },
  {
    name: "reddit",
    hosts: ["reddit.com", "www.reddit.com", "old.reddit.com"],
    through: "rxddit.com",
    path: /^\/r\/[^/]+\/comments\//,
  },
];

const URL_IN_TEXT = /https?:\/\/[^\s<>()\[\]]+/gi;

export interface Found {
  site: Site;
  original: string;
  rewritten: string;
}

function rewrite(site: Site, parsed: URL): string {
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
    const site = SITES.find((one) => one.hosts.includes(host));
    if (!site) continue;
    if (site.path && !site.path.test(parsed.pathname)) continue;

    return { site, original: raw, rewritten: rewrite(site, parsed) };
  }

  return null;
}
