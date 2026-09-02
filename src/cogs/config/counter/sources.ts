import type { Kind } from "./store.js";

/**
 * What each platform can actually be read for, from this box, today.
 *
 * Every one of these was probed before it was written. Three platforms are
 * listed as unavailable rather than half-implemented: a counter that silently
 * never updates is worse than a command that says why up front.
 */
export interface Platform {
  kind: Kind;
  label: string;
  /** null when it can be read with no credentials. */
  needs: string | null;
  takes: string;
  fields: { token: string; describes: string }[];
  fallback: string;
}

export const PLATFORMS: Platform[] = [
  {
    kind: "youtube",
    label: "YouTube",
    needs: null,
    takes: "a channel handle, like `@MrBeast`",
    fields: [
      { token: "{username}", describes: "the handle you gave" },
      { token: "{subscribers}", describes: "subscriber count" },
    ],
    fallback: "{username} · {subscribers|human} subscribers",
  },
  {
    kind: "soundcloud",
    label: "SoundCloud",
    needs: null,
    takes: "a profile name, like `flume`",
    fields: [
      { token: "{username}", describes: "the display name" },
      { token: "{followers}", describes: "follower count" },
      { token: "{tracks}", describes: "how many tracks they have" },
    ],
    fallback: "{username} · {followers|human} followers",
  },
  {
    kind: "soundcloudtrack",
    label: "SoundCloud track",
    needs: null,
    takes: "a track link",
    fields: [
      { token: "{title}", describes: "the track title" },
      { token: "{plays}", describes: "play count" },
      { token: "{likes}", describes: "like count" },
    ],
    fallback: "{title} · {plays|human} plays",
  },
  {
    kind: "tiktok",
    label: "TikTok",
    needs: null,
    takes: "a username, with or without the @",
    fields: [
      { token: "{username}", describes: "the handle" },
      { token: "{followers}", describes: "follower count" },
      { token: "{likes}", describes: "total likes" },
    ],
    fallback: "{username} · {followers|human} followers",
  },
  {
    kind: "twitch",
    label: "Twitch",
    needs: null,
    takes: "a channel name",
    fields: [
      { token: "{username}", describes: "the channel name" },
      { token: "{live}", describes: "whether they are streaming" },
      { token: "{viewers}", describes: "viewers, 0 when offline" },
      { token: "{game}", describes: "what they are playing" },
    ],
    fallback: "{if: {live} && 🔴 {viewers} viewers && twitch.tv/{username}}",
  },
  {
    kind: "spotify",
    label: "Spotify",
    needs:
      "monthly listeners are drawn by the page's own scripts and are in no API, official or otherwise",
    takes: "an artist link",
    fields: [{ token: "{name}", describes: "the artist name" }],
    fallback: "{name} · {monthly|human} monthly listeners",
  },
  {
    kind: "instagram",
    label: "Instagram",
    needs: "a login; the profile endpoints answer 400 and 429 to anyone signed out",
    takes: "a username",
    fields: [{ token: "{username}", describes: "the handle" }],
    fallback: "{username} · {followers|human} followers",
  },
  {
    kind: "twitter",
    label: "Twitter / X",
    needs: "a paid API key; the old public widget endpoints are gone",
    takes: "a username",
    fields: [{ token: "{username}", describes: "the handle" }],
    fallback: "{username} · {followers|human} followers",
  },
];

export function platformFor(kind: Kind): Platform | null {
  return PLATFORMS.find((one) => one.kind === kind) ?? null;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function page(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function first(body: string, pattern: RegExp): string | null {
  return pattern.exec(body)?.[1] ?? null;
}

/** "30.3M" as Discord writes it, back into a number. */
function loose(text: string): number | null {
  const match = /([\d.,]+)\s*([KMB])?/i.exec(text.replace(/\s/g, ""));
  if (!match) return null;

  const value = Number.parseFloat((match[1] as string).replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  const suffix = (match[2] ?? "").toUpperCase();
  if (suffix === "K") return Math.round(value * 1_000);
  if (suffix === "M") return Math.round(value * 1_000_000);
  if (suffix === "B") return Math.round(value * 1_000_000_000);
  return Math.round(value);
}

export type Reading = Record<string, string | number | boolean>;

/**
 * Reads one account. Returns null when the platform could not be reached at
 * all, so the caller can leave the channel name alone rather than blanking it.
 */
export async function read(kind: Kind, handle: string): Promise<Reading | null> {
  const clean = handle.trim();

  if (kind === "youtube") {
    const name = clean.startsWith("@") ? clean : `@${clean}`;
    const body = await page(`https://www.youtube.com/${encodeURIComponent(name)}/about`);
    if (!body) return null;
    const subs = first(body, /([\d.,]+[KMB]?)\s+subscribers/i);
    if (subs === null) return null;
    return { username: name.replace(/^@/, ""), subscribers: loose(subs) ?? 0 };
  }

  if (kind === "soundcloud") {
    const body = await page(`https://soundcloud.com/${encodeURIComponent(clean.replace(/^@/, ""))}`);
    if (!body) return null;
    const followers = first(body, /"followers_count":(\d+)/);
    if (followers === null) return null;
    return {
      username: first(body, /"username":"([^"]+)"/) ?? clean,
      followers: Number(followers),
      tracks: Number(first(body, /"track_count":(\d+)/) ?? 0),
    };
  }

  if (kind === "soundcloudtrack") {
    const url = clean.startsWith("http") ? clean : `https://soundcloud.com/${clean}`;
    const body = await page(url);
    if (!body) return null;
    const plays = first(body, /"playback_count":(\d+)/);
    if (plays === null) return null;
    return {
      title: first(body, /"title":"([^"]+)"/) ?? "track",
      plays: Number(plays),
      likes: Number(first(body, /"likes_count":(\d+)/) ?? 0),
    };
  }

  if (kind === "tiktok") {
    const name = clean.replace(/^@/, "");
    const body = await page(`https://www.tiktok.com/@${encodeURIComponent(name)}`);
    if (!body) return null;
    const followers = first(body, /"followerCount":(\d+)/);
    if (followers === null) return null;
    return {
      username: name,
      followers: Number(followers),
      likes: Number(first(body, /"heartCount":(\d+)/) ?? 0),
    };
  }

  if (kind === "twitch") {
    // The site's own GraphQL endpoint and its public web client id. No account
    // and no registered application, which is why this one works at all.
    try {
      const res = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: { "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko", "content-type": "application/json" },
        body: JSON.stringify([
          {
            operationName: "UseLive",
            variables: { channelLogin: clean.replace(/^@/, "").toLowerCase() },
            extensions: {
              persistedQuery: {
                version: 1,
                sha256Hash: "639d5f11bfb8bf3053b424d9ef650d04c4ebb7d94711d644afb08fe9a0fad5d9",
              },
            },
          },
        ]),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { data?: { user?: { login?: string; stream?: unknown } } }[];
      const user = body[0]?.data?.user;
      if (!user) return null;

      const stream = user.stream as { viewersCount?: number; game?: { name?: string } } | null;
      return {
        username: user.login ?? clean,
        live: Boolean(stream),
        viewers: stream?.viewersCount ?? 0,
        game: stream?.game?.name ?? "",
      };
    } catch {
      return null;
    }
  }

  // spotify, instagram and twitter: nothing to read without credentials.
  return null;
}
