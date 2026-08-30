/**
 * Comparison commands: `,taste` puts two libraries side by side, and
 * `,recommendation` mines artist.getSimilar for something the user has missed.
 *
 * Both follow the chart commands' shape — resolve who, fetch, render, paginate.
 */

import { paginate } from "../../../core/pager.js";
import { register, type PrefixContext } from "../../../core/prefix.js";
import { call, getArtistInfo, getTopArtists, type Period } from "../api/index.js";
import { guard } from "../guard.js";
import {
  EMBED_COLOR,
  artistUrl,
  avatarOf,
  buildPages,
  chartLine,
  extractPeriod,
  label,
  periodLabel,
  plural,
  profile,
  resolveTarget,
  simpleCard,
  url,
} from "../shared.js";
import type { ArtistStats, LfImage, TopArtist } from "../types.js";

/** How many artists from each side form the compared sets. */
const TOP_N = 100;

/** Depth of the "already heard" set — anything this deep is not a discovery. */
const EXCLUDE_POOL = 300;
/** The seed is drawn from genuine favourites, not the long tail. */
const SEED_POOL = 30;
const MAX_SEEDS = 3;
/** Similar artists are ranked by match, so only the head is worth sampling. */
const CANDIDATE_WINDOW = 25;
/** Play-count checks per seed; each one is an extra API round trip. */
const MAX_CHECKS = 2;
/** More scrobbles than this and it is not a recommendation, it is a reminder. */
const HEARD_ENOUGH = 5;

/**
 * `,taste` needs a real member, so a leading mention is not optional. The
 * lookahead keeps this in step with resolveTarget, which only accepts a mention
 * that is a whole word: without it `,taste <@123…>x` passes this check, fails
 * resolveTarget's, and silently falls back to comparing the caller to himself —
 * the exact outcome the check exists to prevent.
 */
const LEADING_MENTION = /^<@!?\d{15,25}>(?=\s|$)/;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Last.fm collapses a single-element list into a bare object. */
function list<T>(value: T | T[] | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

/** Play counts arrive as strings, and occasionally as nothing at all. */
function count(value: string | undefined): number {
  return Number(value ?? 0) || 0;
}

/** Fisher-Yates on a copy; the guard keeps strict index checking happy. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* artist.getSimilar                                                  */
/* ------------------------------------------------------------------ */

interface SimilarArtist {
  name: string;
  url?: string;
  /** 0..1 as a string, where 1 is the seed itself. */
  match?: string;
  image?: LfImage[];
}

/**
 * Neighbours of one artist. Best-effort: a dead seed just means the caller
 * moves on to the next one rather than the whole command failing.
 */
async function similarArtists(artist: string, limit = 50): Promise<SimilarArtist[]> {
  try {
    const data = await call<{
      similarartists?: { artist?: SimilarArtist | SimilarArtist[] };
    }>(
      "artist.getSimilar",
      { artist, autocorrect: "1", limit: String(limit) },
      { timeoutMs: 8000 },
    );
    return list(data.similarartists?.artist).filter((a) => Boolean(a?.name));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* ,taste                                                             */
/* ------------------------------------------------------------------ */

interface Overlap {
  name: string;
  link: string;
  mine: number;
  theirs: number;
}

function usage(): unknown[][] {
  return simpleCard(
    "Taste comparison",
    [
      "Compare your top artists against someone else's.",
      "",
      "`,taste @user` · overall",
      "`,taste @user week` · the last 7 days",
      "`,taste @user year` · the last 12 months",
      "",
      "-# Both of you need a linked account. Run `,lf link` to connect one.",
    ].join("\n"),
  );
}

async function taste(ctx: PrefixContext): Promise<void> {
  const { period, rest } = extractPeriod(ctx.argument);

  // resolveTarget silently falls back to the caller, which would turn a typo
  // into a pointless self-comparison, so the mention is checked up front.
  if (!LEADING_MENTION.test(rest)) {
    await paginate(ctx, usage(), EMBED_COLOR);
    return;
  }

  // Mine first: "you are not linked" is the more actionable of the two errors.
  const { target: me } = await resolveTarget(ctx, "");
  const { target: them } = await resolveTarget(ctx, rest);

  const heading = `${me.username} vs ${them.username} · ${periodLabel(period)} taste`;
  const icon = avatarOf(await profile(me.username));

  if (me.username.toLowerCase() === them.username.toLowerCase()) {
    await paginate(
      ctx,
      simpleCard(heading, "That is your own account, so a flawless 100% match.", icon),
      EMBED_COLOR,
    );
    return;
  }

  const [myTop, theirTop] = await Promise.all([
    topArtists(me.username, period),
    topArtists(them.username, period),
  ]);

  if (myTop.length === 0 || theirTop.length === 0) {
    const who = myTop.length === 0 ? me.username : them.username;
    await paginate(
      ctx,
      simpleCard(heading, `${who} has no scrobbles for that period.`, icon),
      EMBED_COLOR,
    );
    return;
  }

  // Annotated as a tuple: without it the entries widen to (string | TopArtist)[]
  // and the Map constructor rejects them.
  const theirPlays = new Map(
    theirTop.map((a): [string, TopArtist] => [a.name.toLowerCase(), a]),
  );

  const shared: Overlap[] = [];
  for (const artist of myTop) {
    const match = theirPlays.get(artist.name.toLowerCase());
    if (!match) continue;
    shared.push({
      name: artist.name,
      link: url(artist.url, artistUrl(artist.name)),
      mine: count(artist.playcount),
      theirs: count(match.playcount),
    });
  }

  // Similarity is the overlap of the two sets, divided by the smaller of them
  // so a listener with a short history is not punished for it.
  const compared = Math.min(myTop.length, theirTop.length);
  const percent = Math.round((shared.length / compared) * 100);

  if (shared.length === 0) {
    await paginate(
      ctx,
      simpleCard(
        heading,
        `Nothing in common across the top ${compared} artists each, so a 0% taste match.`,
        icon,
      ),
      EMBED_COLOR,
    );
    return;
  }

  shared.sort((a, b) => b.mine + b.theirs - (a.mine + a.theirs) || a.name.localeCompare(b.name));

  const lines = shared.map(
    (a, i) =>
      `${chartLine(i + 1, a.name, a.link, a.mine)} vs **${plural(a.theirs, "play")}**`,
  );

  // The similarity summary replaces the default "N artists total" footer.
  await paginate(
    ctx,
    buildPages(lines, {
      heading,
      username: me.username,
      icon,
      noun: "artists",
      footer: `${shared.length.toLocaleString("en-US")} artists in common • ${percent}% taste match (top ${compared} each)`,
      total: shared.length,
    }),
    EMBED_COLOR,
  );
}

/** The compared set, capped so "top N" means the same thing for both sides. */
async function topArtists(username: string, period: Period): Promise<TopArtist[]> {
  const { items } = await getTopArtists(username, period, TOP_N);
  return items.filter((a) => Boolean(a?.name)).slice(0, TOP_N);
}

/* ------------------------------------------------------------------ */
/* ,recommendation                                                    */
/* ------------------------------------------------------------------ */

function describe(
  pick: SimilarArtist,
  seed: TopArtist,
  stats: ArtistStats | null,
  plays: number,
  username: string,
): string {
  const link = url(pick.url ?? stats?.url, artistUrl(pick.name));
  const seedLink = url(seed.url, artistUrl(seed.name));
  const match = Math.round((Number(pick.match) || 0) * 100);

  const tags = list(stats?.tags?.tag)
    .map((tag) => tag.name)
    .filter(Boolean)
    .slice(0, 4);
  const listeners = count(stats?.stats?.listeners);

  // A failed artist.getInfo yields plays === 0 too, so the play line is only
  // stated when the lookup actually came back. Otherwise the card would assert
  // "never scrobbled by X" on the strength of a timeout.
  const scrobbles = !stats
    ? null
    : plays > 0
      ? `${plural(plays, "scrobble")} from ${username}`
      : `never scrobbled by ${username}`;

  const footer = [listeners > 0 ? plural(listeners, "listener") : null, scrobbles]
    .filter((part): part is string => part !== null)
    .join(" • ");

  return [
    `**[${label(pick.name)}](${link})**`,
    `Picked because it sits next to **[${label(seed.name)}](${seedLink})**` +
      (match > 0 ? ` · ${match}% similar` : "") +
      `, already good for ${plural(count(seed.playcount), "play")}.`,
    tags.length > 0 ? `Tagged ${tags.map((tag) => label(tag)).join(" • ")}` : null,
    // Both footer parts can be absent, and an empty `-# ` renders as a stray
    // subtext line, so the blank spacer and the footer stand or fall together.
    footer ? "" : null,
    footer ? `-# ${footer}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function recommendation(ctx: PrefixContext): Promise<void> {
  const { target } = await resolveTarget(ctx, ctx.argument);
  const icon = avatarOf(await profile(target.username));
  const heading = `A recommendation for ${target.username}`;

  const { items } = await getTopArtists(target.username, "overall", EXCLUDE_POOL);
  const known = items.filter((a) => Boolean(a?.name));
  if (known.length === 0) {
    await paginate(
      ctx,
      simpleCard(heading, "There is no listening history to work from yet.", icon),
      EMBED_COLOR,
    );
    return;
  }

  // Everything already in the library, so "new" really means new.
  const heard = new Set(known.map((a) => a.name.toLowerCase()));

  for (const seed of shuffle(known.slice(0, SEED_POOL)).slice(0, MAX_SEEDS)) {
    const candidates = (await similarArtists(seed.name)).filter(
      (a) => !heard.has(a.name.toLowerCase()),
    );

    for (const pick of shuffle(candidates.slice(0, CANDIDATE_WINDOW)).slice(0, MAX_CHECKS)) {
      // getSimilar knows nothing about this user, so confirm the artist really
      // is unplayed rather than merely outside the top few hundred.
      const stats = await getArtistInfo(pick.name, target.username);
      const plays = count(stats?.stats?.userplaycount);
      if (plays > HEARD_ENOUGH) continue;

      await paginate(
        ctx,
        simpleCard(heading, describe(pick, seed, stats, plays, target.username), icon),
        EMBED_COLOR,
      );
      return;
    }
  }

  await paginate(
    ctx,
    simpleCard(
      heading,
      "Nothing new turned up this time. The neighbours of those artists are all in the library already. Try again for a different seed.",
      icon,
    ),
    EMBED_COLOR,
  );
}

export function registerCompare(): void {
  register({
    name: "taste",
    aliases: ["compare", "tastecompare"],
    description: "Compare your top artists with another member's",
    handler: guard(taste),
  });
  register({
    name: "recommendation",
    aliases: ["rec", "recommend"],
    description: "Suggest an artist you have not heard yet",
    handler: guard(recommendation),
  });
}
