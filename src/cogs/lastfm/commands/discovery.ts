import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { guard } from "../guard.js";
import {
  getArtistTags,
  getGlobalChart,
  getSimilarArtists,
  getSimilarTracks,
  getTagTop,
  getTopArtists,
  getTopTracks,
  getRecentTracks,
} from "../api/index.js";
import {
  USER_ACCENT,
  TargetError,
  artistUrl,
  avatarOf,
  buildPages,
  label,
  plain,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";

const SEPARATOR = /\s+[-–—]\s+/;

const trackUrl = (artist: string, track: string) =>
  `${artistUrl(artist)}/_/${encodeURIComponent(track)}`;

async function subjectArtist(ctx: PrefixContext, argument: string): Promise<string> {
  const named = argument.trim();
  if (named) return named;

  const { target } = await resolveTarget(ctx, "");
  const { tracks } = await getRecentTracks(target.username, 1);
  const current = tracks[0];
  const artist = current?.artist?.name ?? current?.artist?.["#text"];
  if (!artist) throw new TargetError("Name an artist, or play something first.");
  return artist;
}

async function subjectPair(ctx: PrefixContext, argument: string): Promise<[string, string]> {
  const named = argument.trim();
  if (named) {
    const parts = named.split(SEPARATOR);
    if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new TargetError("Give it as `artist - track`, with a space, a dash and a space.");
    }
    return [parts[0].trim(), parts.slice(1).join(" - ").trim()];
  }

  const { target } = await resolveTarget(ctx, "");
  const { tracks } = await getRecentTracks(target.username, 1);
  const current = tracks[0];
  const artist = current?.artist?.name ?? current?.artist?.["#text"];
  if (!artist || !current) throw new TargetError("Name a track, or play something first.");
  return [artist, current.name];
}

async function similar(ctx: PrefixContext): Promise<void> {
  const artist = await subjectArtist(ctx, ctx.argument);
  const found = await getSimilarArtists(artist, 60);
  const heading = `Artists like ${artist}`;

  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `Last.fm has nothing similar for **${label(artist)}**.`), USER_ACCENT);
    return;
  }

  const rows = found.map((a, i) => {
    const match = Number(a.match ?? 0);
    const pct = match > 0 ? ` · ${Math.round(match * 100)}% match` : "";
    return `\`${i + 1}\` **[${label(a.name)}](${url(a.url, artistUrl(a.name))})**${pct}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: artist, noun: "artists", total: found.length }),
    USER_ACCENT,
  );
}

async function similarTracks(ctx: PrefixContext): Promise<void> {
  const [artist, track] = await subjectPair(ctx, ctx.argument);
  const found = await getSimilarTracks(artist, track, 60);
  const heading = `Tracks like ${track}`;

  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `Nothing similar to **${label(track)}**.`), USER_ACCENT);
    return;
  }

  const rows = found.map((t, i) => {
    const by = t.artist?.name ?? "";
    return `\`${i + 1}\` **[${label(t.name)}](${url(t.url, trackUrl(by || artist, t.name))})**${by ? ` · ${plain(by)}` : ""}`;
  });

  await paginate(
    ctx,
    buildPages(rows, { heading, username: artist, noun: "tracks", total: found.length }),
    USER_ACCENT,
  );
}

async function tags(ctx: PrefixContext): Promise<void> {
  const artist = await subjectArtist(ctx, ctx.argument);
  const found = await getArtistTags(artist);
  const heading = `Tags for ${artist}`;

  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `No tags on **${label(artist)}**.`), USER_ACCENT);
    return;
  }

  const rows = found.map(
    (t, i) => `\`${i + 1}\` **${label(t.name)}**${t.count ? ` · ${t.count}` : ""}`,
  );
  await paginate(
    ctx,
    buildPages(rows, { heading, username: artist, noun: "tags", total: found.length }),
    USER_ACCENT,
  );
}

async function genre(ctx: PrefixContext): Promise<void> {
  const tag = ctx.argument.trim();
  if (!tag) throw new TargetError("Name a tag, for example `,genre shoegaze`.");

  const found = await getTagTop("artists", tag, 60);
  const heading = `Top artists tagged ${tag}`;
  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `Last.fm has no artists under **${label(tag)}**.`), USER_ACCENT);
    return;
  }

  const rows = found.map(
    (a, i) => `\`${i + 1}\` **[${label(a.name)}](${url(a.url, artistUrl(a.name))})**`,
  );
  await paginate(
    ctx,
    buildPages(rows, { heading, username: tag, noun: "artists", total: found.length }),
    USER_ACCENT,
  );
}

async function genreTracks(ctx: PrefixContext): Promise<void> {
  const tag = ctx.argument.trim();
  if (!tag) throw new TargetError("Name a tag, for example `,genretracks dream pop`.");

  const found = await getTagTop("tracks", tag, 60);
  const heading = `Top tracks tagged ${tag}`;
  if (found.length === 0) {
    await paginate(ctx, simpleCard(heading, `Nothing under **${label(tag)}**.`), USER_ACCENT);
    return;
  }

  const rows = found.map((t, i) => {
    const by = t.artist?.name ?? "";
    return `\`${i + 1}\` **[${label(t.name)}](${url(t.url, trackUrl(by, t.name))})**${by ? ` · ${plain(by)}` : ""}`;
  });
  await paginate(
    ctx,
    buildPages(rows, { heading, username: tag, noun: "tracks", total: found.length }),
    USER_ACCENT,
  );
}

function chartCommand(kind: "artists" | "tracks") {
  return async (ctx: PrefixContext): Promise<void> => {
    const country = ctx.argument.trim();
    const found = await getGlobalChart(kind, country || undefined, 60);
    const heading = country ? `Top ${kind} in ${country}` : `Top ${kind} on Last.fm`;

    if (found.length === 0) {
      await paginate(
        ctx,
        simpleCard(
          heading,
          country
            ? `No chart for **${label(country)}**. Use a country name such as \`Japan\` or \`United Kingdom\`.`
            : "Last.fm returned no chart.",
        ),
        USER_ACCENT,
      );
      return;
    }

    const rows = found.map((row, i) => {
      const by = row.artist?.name ?? "";
      const link = kind === "artists" ? artistUrl(row.name) : trackUrl(by, row.name);
      const listeners = row.listeners ? ` · ${Number(row.listeners).toLocaleString("en-US")} listeners` : "";
      return `\`${i + 1}\` **[${label(row.name)}](${url(row.url, link)})**${by ? ` · ${plain(by)}` : ""}${listeners}`;
    });

    await paginate(
      ctx,
      buildPages(rows, { heading, username: country || "last.fm", noun: kind, total: found.length }),
      USER_ACCENT,
    );
  };
}

function pick<T>(items: T[]): T | undefined {
  return items.length ? items[Math.floor(Math.random() * items.length)] : undefined;
}

async function roulette(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const { items } = await getTopTracks(target.username, "overall", 500);
  const chosen = pick(items);

  const heading = `${target.username}, play this`;
  if (!chosen) {
    await paginate(ctx, simpleCard(heading, "Not enough history to pick from yet.", icon), USER_ACCENT);
    return;
  }

  const by = chosen.artist?.name ?? chosen.artist?.["#text"] ?? "";
  const body = [
    `**[${label(chosen.name)}](${url(chosen.url, trackUrl(by, chosen.name))})**`,
    `by **[${label(by)}](${artistUrl(by)})**`,
    "",
    `-# You have played it ${plural(Number(chosen.playcount ?? 0), "time")}. Picked from your top 500.`,
  ].join("\n");

  await paginate(ctx, simpleCard(heading, body, icon), USER_ACCENT);
}

async function randomArtist(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const { items } = await getTopArtists(target.username, "overall", 500);
  const chosen = pick(items);

  const heading = `${target.username}, revisit this`;
  if (!chosen) {
    await paginate(ctx, simpleCard(heading, "Not enough history to pick from yet.", icon), USER_ACCENT);
    return;
  }

  const body = [
    `**[${label(chosen.name)}](${url(chosen.url, artistUrl(chosen.name))})**`,
    "",
    `-# ${plural(Number(chosen.playcount ?? 0), "play")}. Picked from your top 500 artists.`,
  ].join("\n");

  await paginate(ctx, simpleCard(heading, body, icon), USER_ACCENT);
}

async function discover(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const { items } = await getTopArtists(target.username, "overall", 200);
  const heading = `Something new for ${target.username}`;

  if (items.length === 0) {
    await paginate(ctx, simpleCard(heading, "Play something first so I know your taste.", icon), USER_ACCENT);
    return;
  }

  const known = new Set(items.map((a) => a.name.toLowerCase()));
  const seed = pick(items.slice(0, 30));
  if (!seed) {
    await paginate(ctx, simpleCard(heading, "Could not pick a starting point.", icon), USER_ACCENT);
    return;
  }

  const neighbours = await getSimilarArtists(seed.name, 60);
  const fresh = neighbours.filter((a) => !known.has(a.name.toLowerCase()));
  const chosen = pick(fresh);

  if (!chosen) {
    await paginate(
      ctx,
      simpleCard(heading, `Everything near **${label(seed.name)}** is already in your library.`, icon),
      USER_ACCENT,
    );
    return;
  }

  const body = [
    `**[${label(chosen.name)}](${url(chosen.url, artistUrl(chosen.name))})**`,
    "",
    `-# Because you listen to **${label(seed.name)}**, and this is not in your top 200.`,
  ].join("\n");

  await paginate(ctx, simpleCard(heading, body, icon), USER_ACCENT);
}

export function registerDiscovery(): void {
  const add = (
    name: string,
    aliases: string[],
    description: string,
    handler: (ctx: PrefixContext) => Promise<void>,
  ) => register({ name, aliases, description, handler: guard(handler) });

  add("similar", ["sim", "like"], "Artists that sound like another", similar);
  add("similartracks", ["simtracks", "liketrack"], "Tracks similar to another", similarTracks);
  add("tags", ["artisttags", "genres"], "How Last.fm tags an artist", tags);
  add("genre", ["tag", "mood"], "Top artists carrying a tag", genre);
  add("genretracks", ["tagtracks"], "Top tracks carrying a tag", genreTracks);
  add("trending", ["global", "chart"], "What Last.fm is playing right now", chartCommand("artists"));
  add("hot", ["globaltracks", "trendingtracks"], "The most played tracks on Last.fm", chartCommand("tracks"));
  add("roulette", ["shuffle", "pickone"], "A random track out of your library", roulette);
  add("randomartist", ["ra", "anyartist"], "A random artist out of your library", randomArtist);
  add("discover", ["new", "fresh"], "An artist near your taste", discover);
}
