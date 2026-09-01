import { paginate } from "../../core/pager.js";
import { groupUnder, lookupIn, register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, stamp, words } from "./shared.js";
import { pagesOf } from "./pages.js";

const READ_MS = 15_000;

// Discogs asks for a real user agent and refuses a generic one.
const UA = "TrapBot/1.0 +https://github.com/hurricanewisdom/trap";

async function read<T>(path: string): Promise<T | null> {
  try {
    const answer = await fetch(`https://api.discogs.com${path}`, {
      signal: AbortSignal.timeout(READ_MS),
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!answer.ok) return null;
    return (await answer.json()) as T;
  } catch {
    return null;
  }
}

interface Result {
  title?: string;
  year?: string;
  country?: string;
  format?: string[];
  label?: string[];
  genre?: string[];
  type?: string;
  uri?: string;
}

async function search(ctx: PrefixContext): Promise<void> {
  const query = ctx.argument.trim();
  if (!query) {
    await card(ctx, ["What are you looking for?", "", "-# `discog search daft punk`"]);
    return;
  }

  const body = await read<{ results?: Result[] }>(
    `/database/search?q=${encodeURIComponent(query)}&per_page=50`,
  );
  if (!body) {
    await card(ctx, ["Discogs could not be reached."]);
    return;
  }

  const results = body.results ?? [];
  if (results.length === 0) {
    await card(ctx, [`Nothing on Discogs for **${plain(query)}**.`]);
    return;
  }

  const lines = results.map((one) => {
    const where = [one.year, one.country].filter(Boolean).join(" · ");
    const how = (one.format ?? []).slice(0, 2).join(", ");
    return (
      `**${plain((one.title ?? "untitled").slice(0, 90))}**` +
      (where ? ` — ${plain(where)}` : "") +
      (how ? ` · ${plain(how)}` : "") +
      (one.uri ? ` · [open](https://www.discogs.com${one.uri})` : "")
    );
  });

  await paginate(
    ctx,
    pagesOf(`${results.length} results for ${plain(query.slice(0, 60))}`, lines, 8),
    null,
  );
}

interface Profile {
  username?: string;
  name?: string;
  profile?: string;
  location?: string;
  registered?: string;
  num_collection?: number;
  num_wantlist?: number;
  num_for_sale?: number;
  num_lists?: number;
  rating_avg?: number;
  releases_contributed?: number;
  avatar_url?: string;
  uri?: string;
}

async function profile(ctx: PrefixContext): Promise<void> {
  const who = words(ctx.argument)[0];
  if (!who) {
    await card(ctx, ["Which Discogs user?", "", "-# `discog profile someuser`"]);
    return;
  }

  const found = await read<Profile>(`/users/${encodeURIComponent(who)}`);
  if (!found) {
    await card(ctx, [`No Discogs user called **${plain(who)}**.`]);
    return;
  }

  await card(ctx, [
    `### ${plain(found.username ?? who)}`,
    ...(found.avatar_url ? [found.avatar_url] : []),
    ...(found.name ? [`-# ${plain(found.name)}`] : []),
    ...(found.location ? [`-# ${plain(found.location)}`] : []),
    `-# collection: ${found.num_collection ?? 0} · wantlist: ${found.num_wantlist ?? 0}`,
    `-# for sale: ${found.num_for_sale ?? 0} · lists: ${found.num_lists ?? 0}`,
    ...(found.releases_contributed
      ? [`-# contributed ${found.releases_contributed} releases`]
      : []),
    ...(found.registered ? [`-# joined ${stamp(found.registered, "D")}`] : []),
    ...(found.uri ? [`-# ${found.uri}`] : []),
  ]);
}

// The rest of the Discogs set — login, logout, collections, wantlist — is a
// per-person thing and needs OAuth against an app this bot does not have. Saying
// so beats registering four commands that cannot work.
const NEEDS_OAUTH = [
  "### Not connected yet",
  "-# `discog search` and `discog profile` work now and need no account.",
  "",
  "-# Reading **your own** collection or wantlist needs Discogs OAuth, which needs",
  "-# an app registered with them and somewhere public for them to send you back to.",
  "-# Neither exists yet, so those are not registered rather than pretending.",
];

async function overview(ctx: PrefixContext): Promise<void> {
  const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
  const found = sub ? lookupIn("discog", sub) : undefined;
  if (found) {
    await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
    return;
  }

  if (["login", "logout", "collection", "collections", "wantlist"].includes(sub)) {
    await card(ctx, NEEDS_OAUTH);
    return;
  }

  await card(ctx, [
    "### Discogs",
    "-# `discog search <query>` — the release database",
    "-# `discog profile <user>` — anybody's public profile",
    "",
    "-# Neither needs an account.",
  ]);
}

export function registerDiscogs(): void {
  register({
    name: "discog",
    aliases: ["discogs"],
    description: "Search Discogs and read public profiles",
    handler: overview,
  });

  groupUnder("discog", () => {
    register({ name: "search", description: "Search for a query in Discogs' database", handler: search });
    register({ name: "profile", description: "View a user's Discogs profile", handler: profile });
  });
}
