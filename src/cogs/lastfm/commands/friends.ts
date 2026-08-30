import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import { getFriends, getLibraryArtists, getRecentTracks } from "../api/index.js";
import {
  USER_ACCENT,
  artistUrl,
  buildPages,
  label,
  plain,
  resolveTarget,
  simpleCard,
  trackUrl,
  url,
} from "../shared.js";

const FRIEND_LIMIT = 100;
const LIBRARY_PAGE = 200;

const NOW_PLAYING_CAP = 25;
const NOW_PLAYING_CONCURRENCY = 5;

const userUrl = (name: string) => `https://www.last.fm/user/${encodeURIComponent(name)}`;

async function mapLimited<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) continue;
        out[index] = await job(item);
      }
    }),
  );
  return out;
}

async function friends(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const { friends: list, total } = await getFriends(target.username, FRIEND_LIMIT);
  const heading = `${target.username}'s friends`;

  if (list.length === 0) {
    await paginate(ctx, simpleCard(heading, "No friends listed on Last.fm."), USER_ACCENT);
    return;
  }

  const rows = list.map((friend, index) => {
    const details = [
      friend.realname?.trim() ? plain(friend.realname.trim()) : null,
      friend.country && friend.country !== "None" ? plain(friend.country) : null,
    ].filter(Boolean);

    return (
      `\`${index + 1}\` **[${label(friend.name)}](${url(friend.url, userUrl(friend.name))})**` +
      (details.length ? `\n-# ${details.join(" · ")}` : "")
    );
  });

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      noun: "friends",
      total: total || list.length,
    }),
    USER_ACCENT,
  );
}

async function friendsPlaying(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const { friends: list, total } = await getFriends(target.username, FRIEND_LIMIT);

  if (list.length === 0) {
    await paginate(
      ctx,
      simpleCard(`${target.username}'s friends`, "No friends listed on Last.fm."),
      USER_ACCENT,
    );
    return;
  }

  const checked = list.slice(0, NOW_PLAYING_CAP);

  const results = await mapLimited(checked, NOW_PLAYING_CONCURRENCY, async (friend) => {
    try {
      const { tracks } = await getRecentTracks(friend.name, 1);
      const current = tracks[0];
      if (!current || current["@attr"]?.nowplaying !== "true") return null;
      const artist = current.artist?.name ?? current.artist?.["#text"] ?? "";
      return { friend: friend.name, artist, track: current.name };
    } catch {
      return null;
    }
  });

  const playing = results.filter((row): row is NonNullable<typeof row> => row !== null);
  const heading = `${target.username}'s friends, right now`;

  if (playing.length === 0) {
    await paginate(
      ctx,
      simpleCard(
        heading,
        `None of the ${checked.length} friends checked are playing anything.`,
      ),
      USER_ACCENT,
    );
    return;
  }

  const rows = playing.map((row, index) => {
    const who = `**[${label(row.friend)}](${userUrl(row.friend)})**`;
    const what = `[${label(row.track)}](${trackUrl(row.artist, row.track)})`;
    return `\`${index + 1}\` ${who}\n-# ${what} · ${plain(row.artist)}`;
  });

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      noun: "listening",
      total: playing.length,
      footer:
        `${playing.length} of ${checked.length} checked` +
        (total > checked.length ? ` · ${total} friends in total` : ""),
    }),
    USER_ACCENT,
  );
}

async function library(ctx: PrefixContext): Promise<void> {
  const words = ctx.argument.trim().split(/\s+/).filter(Boolean);
  const pageAt = words.findIndex((word) => /^\d{1,4}$/.test(word));
  const page = pageAt === -1 ? 1 : Math.max(1, Number.parseInt(words[pageAt] ?? "1", 10));
  const remaining = words.filter((_, index) => index !== pageAt).join(" ");

  const { target } = await resolveTarget(ctx, remaining);
  const { artists, total, pages } = await getLibraryArtists(target.username, LIBRARY_PAGE, page);

  const heading = `${target.username}'s library`;

  if (artists.length === 0) {
    await paginate(
      ctx,
      simpleCard(
        heading,
        page > 1
          ? `Page ${page} is past the end. There are ${pages.toLocaleString("en-US")} pages.`
          : "No artists in that library.",
      ),
      USER_ACCENT,
    );
    return;
  }

  const offset = (page - 1) * LIBRARY_PAGE;
  const rows = artists.map((artist, index) => {
    const plays = Number(artist.playcount ?? 0);
    return (
      `\`${offset + index + 1}\` **[${label(artist.name)}](${url(artist.url, artistUrl(artist.name))})**` +
      ` · **${plays.toLocaleString("en-US")}** plays`
    );
  });

  await paginate(
    ctx,
    buildPages(rows, {
      heading,
      username: target.username,
      noun: "artists",
      total,
      footer:
        `${total.toLocaleString("en-US")} artists` +
        (pages > 1 ? ` · set ${page} of ${pages.toLocaleString("en-US")}, \`,library ${page + 1}\` for more` : ""),
    }),
    USER_ACCENT,
  );
}

export function registerFriends(): void {
  register({
    name: "friends",
    aliases: ["following", "lffriends"],
    description: "Who someone follows on Last.fm",
    handler: guard(friends),
  });
  register({
    name: "friendsplaying",
    aliases: ["friendsnow", "fnp"],
    description: "What everyone they follow is playing right now",
    handler: guard(friendsPlaying),
  });
  register({
    name: "library",
    aliases: ["allartists", "lib"],
    description: "Every artist in a library, most played first",
    handler: guard(library),
  });
}
