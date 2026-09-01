import { paginate } from "../../core/pager.js";
import { register, type PrefixContext, type PrefixHandler } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, stamp } from "./shared.js";
import { pagesOf } from "./pages.js";

const READ_MS = 15_000;

// ESPN's public scoreboard, which needs no key. The path is sport/league, and
// soccer needs a competition because there is no single "soccer league".
const LEAGUES: Record<string, { path: string; label: string }> = {
  nba: { path: "basketball/nba", label: "NBA" },
  nfl: { path: "football/nfl", label: "NFL" },
  mlb: { path: "baseball/mlb", label: "MLB" },
  nhl: { path: "hockey/nhl", label: "NHL" },
  soccer: { path: "soccer/eng.1", label: "Premier League" },
};

interface Event {
  name?: string;
  shortName?: string;
  date?: string;
  status?: { type?: { state?: string; completed?: boolean; shortDetail?: string } };
  competitions?: {
    competitors?: {
      homeAway?: string;
      score?: string;
      team?: { displayName?: string; abbreviation?: string };
      records?: { summary?: string }[];
    }[];
  }[];
}

function lineFor(one: Event): string {
  const play = one.competitions?.[0]?.competitors ?? [];
  const home = play.find((side) => side.homeAway === "home");
  const away = play.find((side) => side.homeAway === "away");
  const state = one.status?.type?.state ?? "pre";
  const detail = one.status?.type?.shortDetail ?? "";

  const name = (side: typeof home) =>
    plain(side?.team?.abbreviation ?? side?.team?.displayName ?? "?");

  // Before kick-off there is no score to show, so the time is the useful part;
  // after it, the score is.
  if (state === "pre") {
    return `**${name(away)}** at **${name(home)}** — ${stamp(one.date)}`;
  }

  const scores = `**${name(away)}** ${away?.score ?? "0"} — ${home?.score ?? "0"} **${name(home)}**`;
  return `${scores} · ${state === "in" ? "🔴 " : ""}${plain(detail)}`;
}

function scoreboard(key: keyof typeof LEAGUES | "soccer"): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const league = LEAGUES[key];
    if (!league) return;

    let body: { events?: Event[] } | null = null;
    try {
      // No user-agent header on purpose. ESPN answers 403 to anything it does
      // not recognise -- a bot-shaped one and a browser one both -- and 200 to
      // the runtime's own default. Setting a polite one here is what breaks it.
      const answer = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`,
        { signal: AbortSignal.timeout(READ_MS) },
      );
      if (answer.ok) body = (await answer.json()) as { events?: Event[] };
    } catch {
      body = null;
    }

    if (!body) {
      await card(ctx, [`The ${league.label} scoreboard could not be reached.`]);
      return;
    }

    const events = body.events ?? [];
    if (events.length === 0) {
      // Out of season, or a day with no fixtures. Both are the same answer and
      // neither is an error.
      await card(ctx, [`### ${league.label}`, "-# Nothing on today."]);
      return;
    }

    const live = events.filter((one) => one.status?.type?.state === "in").length;
    await paginate(
      ctx,
      pagesOf(
        `${league.label} — ${events.length} game${events.length === 1 ? "" : "s"}`,
        events.map(lineFor),
        8,
        live ? `${live} in progress` : "none in progress",
      ),
      null,
    );
  };
}

export function registerSports(): void {
  register({ name: "nba", description: "View current status and score of NBA games", handler: scoreboard("nba") });
  register({ name: "nfl", description: "View current status and score of NFL games", handler: scoreboard("nfl") });
  register({ name: "mlb", description: "View current status and score of MLB games", handler: scoreboard("mlb") });
  register({ name: "nhl", aliases: ["hockey"], description: "View current status and score of hockey games", handler: scoreboard("nhl") });
  register({ name: "soccer", description: "View current status and score of soccer games", handler: scoreboard("soccer") });
  register({ name: "futbol", description: "View current status and score of football games", handler: scoreboard("soccer") });
}
