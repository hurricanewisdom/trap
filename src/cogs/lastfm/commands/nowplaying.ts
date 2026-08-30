import {
  IS_COMPONENTS_V2,
  accented,
  container,
  section,
  separator,
  text,
  thumbnail,
} from "../../../helpers/components.js";
import { redis } from "../../../core/redis.js";
import { register, type PrefixContext, type ReplyPayload } from "../../../core/prefix.js";
import {
  LastfmError,
  getRecentTracks,
  getTrackInfo,
  largestImage,
  type RecentTrack,
} from "../api/index.js";
import { recordNpPost } from "./board.js";
import { getNpMode, resolveColor, resolveReactions } from "../settings.js";
import { getCoverOverride } from "./albumart.js";
import { getTemplate } from "./cardeditor.js";
import { parseTemplate } from "../template.js";
import { TargetError, possessive, resolveTarget } from "../shared.js";

const NP_TTL = 8;

const NP_POST_TTL = 86_400;

export const npOwnerKey = (messageId: string) => `trap:np:owner:${messageId}`;

function linkLabel(value: string): string {
  return value.slice(0, 200).replaceAll("[", "［").replaceAll("]", "］");
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString().replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return null;
  }
}

function card(body: string, accent: number | null = null): ReplyPayload {
  return { flags: IS_COMPONENTS_V2, components: [container(accent, text(body))] };
}

async function latestTrack(
  username: string,
): Promise<{ track: RecentTrack | null; total: number }> {
  const cacheKey = `trap:lf:np:${username.toLowerCase()}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as { track: RecentTrack | null; total: number };
  } catch {}

  const { tracks, total } = await getRecentTracks(username, 1);
  const result = { track: tracks[0] ?? null, total };
  redis.set(cacheKey, JSON.stringify(result), "EX", NP_TTL).catch(() => {});
  return result;
}

interface View {
  username: string;
  track: string;
  artist: string;
  album: string;
  trackUrl: string;
  artistUrl: string;
  art: string | null;
  live: boolean;
  plays: number;
  total: number;
  loved: boolean;
  at?: string;
  color: number | null;
}

function renderDefault(v: View): ReplyPayload {
  return {
    embeds: [
      {
        ...(v.color === null ? {} : { color: v.color }),
        author: { name: `${v.live ? "Now Playing" : "Recently Played"} for ${v.username}` },
        fields: [
          { name: "Track", value: `[${linkLabel(v.track)}](${v.trackUrl})`, inline: true },
          { name: "Artist", value: `[${linkLabel(v.artist)}](${v.artistUrl})`, inline: true },
        ],
        ...(v.art ? { thumbnail: { url: v.art } } : {}),
        footer: {
          text: [
            `Plays: ${v.plays.toLocaleString("en-US")}`,
            `Total Scrobbles: ${v.total.toLocaleString("en-US")}`,
            v.album ? `Album: ${v.album}` : null,
          ]
            .filter(Boolean)
            .join(" • "),
        },
      },
    ],
  };
}

function renderCompact(v: View): ReplyPayload {
  return {
    embeds: [
      {
        ...(v.color === null ? {} : { color: v.color }),
        description:
          `**${v.username}** ${v.live ? "is listening to" : "last played"} ` +
          `[${linkLabel(v.track)}](${v.trackUrl}) by [${linkLabel(v.artist)}](${v.artistUrl})`,
      },
    ],
  };
}

function renderDetailed(v: View): ReplyPayload {
  const fields = [
    { name: "Track", value: `[${linkLabel(v.track)}](${v.trackUrl})`, inline: true },
    { name: "Artist", value: `[${linkLabel(v.artist)}](${v.artistUrl})`, inline: true },
    ...(v.album ? [{ name: "Album", value: linkLabel(v.album), inline: true }] : []),
    { name: "Plays", value: v.plays.toLocaleString("en-US"), inline: true },
    { name: "Scrobbles", value: v.total.toLocaleString("en-US"), inline: true },
    ...(v.loved ? [{ name: "Loved", value: "yes", inline: true }] : []),
  ];
  return {
    embeds: [
      {
        ...(v.color === null ? {} : { color: v.color }),
        author: { name: `${v.live ? "Now Playing" : "Recently Played"} for ${v.username}` },
        fields,
        ...(v.art ? { thumbnail: { url: v.art } } : {}),
        ...(v.at && !v.live ? { footer: { text: "Scrobbled" }, timestamp: v.at } : {}),
      },
    ],
  };
}

function renderContainer(v: View): ReplyPayload {
  const body = [
    `### ${v.live ? "Now Playing" : "Recently Played"}`,
    `**[${linkLabel(v.track)}](${v.trackUrl})**`,
    `by **[${linkLabel(v.artist)}](${v.artistUrl})**${v.album ? ` · *${linkLabel(v.album)}*` : ""}`,
  ].join("\n");

  const footer = [
    `${v.plays.toLocaleString("en-US")} plays`,
    `${v.total.toLocaleString("en-US")} scrobbles`,
    v.loved ? "loved" : null,
    !v.live && v.at ? `<t:${Math.floor(new Date(v.at).getTime() / 1000)}:R>` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    flags: IS_COMPONENTS_V2,
    components: [
      container(
        v.color,
        v.art ? section(thumbnail(v.art, v.album || v.track), body) : text(body),
        separator(false),
        text(`-# ${v.username} · ${footer}`),
      ),
    ],
  };
}

function renderCustom(v: View, source: string): ReplyPayload {
  const { components, accent, errors } = parseTemplate(source, {
    user: v.username,
    track: v.track,
    artist: v.artist,
    album: v.album,
    plays: v.plays.toLocaleString("en-US"),
    scrobbles: v.total.toLocaleString("en-US"),
    art: v.art ?? "",
    trackurl: v.trackUrl,
    artisturl: v.artistUrl,
    status: v.live ? "Now playing" : "Recently played",
    loved: v.loved ? "loved" : "",
    when: v.at ? `<t:${Math.floor(new Date(v.at).getTime() / 1000)}:R>` : "",
  });

  if (components.length === 0) {
    return {
      flags: IS_COMPONENTS_V2,
      components: [
        container(
          v.color,
          text(
            "### Your card template did not render\n" +
              errors.slice(0, 4).map((e) => `- ${e}`).join("\n") +
              "\n-# Fix it with `,card set`, or `,lfmode default`.",
          ),
        ),
      ],
    };
  }

  return {
    flags: IS_COMPONENTS_V2,
    components: [accented({ type: 17, components }, accent)],
  };
}

function render(mode: string, v: View, template: string | null): ReplyPayload {
  if (mode === "custom" && template) return renderCustom(v, template);
  switch (mode) {
    case "compact":
      return renderCompact(v);
    case "detailed":
      return renderDetailed(v);
    case "container":
      return renderContainer(v);
    default:
      return renderDefault(v);
  }
}

async function handle(ctx: PrefixContext): Promise<void> {
  try {
    const { target } = await resolveTarget(ctx, ctx.argument, { allowBare: true });
    const owner = possessive(ctx, target);

    const { track, total } = await latestTrack(target.username);
    if (!track) {
      await ctx.reply(
        card(`### Nothing scrobbled\n${owner ?? "You"} have no listening history yet.`),
      );
      return;
    }

    const artist = track.artist?.name ?? track.artist?.["#text"] ?? "Unknown artist";
    const album = track.album?.["#text"] ?? "";
    const live = track["@attr"]?.nowplaying === "true";

    const [info, cover, mode, color, template] = await Promise.all([
      getTrackInfo(artist, track.name, target.username),
      album ? getCoverOverride(artist, album) : Promise.resolve(null),
      getNpMode(ctx.authorId),
      resolveColor(ctx.authorId),
      getTemplate(ctx.authorId),
    ]);

    const artistUrl =
      safeUrl(track.artist?.url) ?? `https://www.last.fm/music/${encodeURIComponent(artist)}`;

    const view: View = {
      username: target.username,
      track: track.name,
      artist,
      album,
      trackUrl:
        safeUrl(track.url) ??
        safeUrl(info?.url) ??
        `${artistUrl}/_/${encodeURIComponent(track.name)}`,
      artistUrl,
      art: cover ?? largestImage(track.image),
      live,
      plays: Number(info?.userplaycount ?? 0),
      total,
      loved: track.loved === "1",
      at: track.date?.uts ? new Date(Number(track.date.uts) * 1000).toISOString() : undefined,
      color,
    };

    const sent = await ctx.reply(render(mode, view, template));

    const messageId = sent?.id ? String(sent.id) : null;
    if (messageId) {
      if (ctx.guildId) {
        await recordNpPost(messageId, ctx.guildId, ctx.authorId);
        redis.set(npOwnerKey(messageId), ctx.authorId, "EX", NP_POST_TTL).catch(() => {});
      }
      const { upvote, downvote } = await resolveReactions(ctx.authorId, ctx.guildId);
      await ctx.react(ctx.channelId, messageId, upvote);
      await ctx.react(ctx.channelId, messageId, downvote);
    }
  } catch (err) {
    if (err instanceof TargetError) {
      await ctx.reply(card(`### ${err.title ?? "Last.fm"}\n${err.message}`));
      return;
    }

    const message =
      err instanceof LastfmError ? `Last.fm said: ${err.message}` : "Something went wrong.";
    console.error("nowplaying failed:", err);
    await ctx.reply(card(`### Error\n${message}`));
  }
}

export function registerNowPlaying(): void {
  register({
    name: "nowplaying",
    aliases: ["np", "fm", "fmnp"],
    description: "Show the current or most recent scrobble",
    handler: handle,
  });
}

export const nowPlayingHandler = handle;
