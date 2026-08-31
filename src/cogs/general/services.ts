import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, stamp } from "./shared.js";

const READ_MS = 15_000;

const UA = "trap-bot/1.x";

// An unset key and an empty one mean the same thing, and a command whose key is
// missing should say so rather than fail as though the service were down.
function keyOf(name: string): string | null {
  const held = (process.env[name] ?? "").trim();
  return held || null;
}

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<
  { ok: true; body: T } | { ok: false; status: number; body: unknown }
> {
  try {
    const answer = await fetch(url, {
      signal: AbortSignal.timeout(READ_MS),
      headers: { "user-agent": UA, accept: "application/json", ...headers },
    });
    const body = await answer.json().catch(() => null);
    return answer.ok ? { ok: true, body: body as T } : { ok: false, status: answer.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const ARROWS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

async function weather(ctx: PrefixContext): Promise<void> {
  const key = keyOf("OPENWEATHER_API_KEY");
  if (!key) {
    await card(ctx, ["No OpenWeatherMap key is set.", "", "-# `OPENWEATHER_API_KEY` in .env."]);
    return;
  }

  const where = ctx.argument.trim();
  if (!where) {
    await card(ctx, ["Which city?", "", "-# `weather London`"]);
    return;
  }

  const got = await json<{
    name: string;
    sys: { country?: string; sunrise?: number; sunset?: number };
    main: { temp: number; feels_like: number; humidity: number };
    weather: { description: string; icon: string }[];
    wind: { speed: number; deg: number };
  }>(
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(where)}&appid=${key}&units=metric`,
  );

  if (!got.ok) {
    // A brand new key is refused for a while, which looks exactly like a wrong
    // one unless it is spelled out.
    if (got.status === 401) {
      await card(ctx, [
        "OpenWeatherMap refused the key.",
        "",
        "-# A newly made key takes up to a couple of hours to start working.",
      ]);
      return;
    }
    await card(ctx, [got.status === 404 ? `No city called **${plain(where)}**.` : "OpenWeatherMap could not be reached."]);
    return;
  }

  const one = got.body;
  const wind = ARROWS[Math.round(((one.wind?.deg ?? 0) % 360) / 45) % 8];
  await card(ctx, [
    `### ${plain(one.name)}${one.sys?.country ? ", " + plain(one.sys.country) : ""}`,
    `**${Math.round(one.main.temp)}°C** — ${plain(one.weather?.[0]?.description ?? "")}`,
    `-# feels like ${Math.round(one.main.feels_like)}°C · humidity ${one.main.humidity}%`,
    `-# wind ${Math.round(one.wind?.speed ?? 0)} m/s ${wind}`,
    ...(one.sys?.sunrise ? [`-# sunrise ${stamp(one.sys.sunrise * 1000, "t")} · sunset ${stamp((one.sys.sunset ?? 0) * 1000, "t")}`] : []),
  ]);
}

async function valorant(ctx: PrefixContext): Promise<void> {
  const key = keyOf("HENRIK_API_KEY");
  if (!key) {
    await card(ctx, ["No HenrikDev key is set.", "", "-# `HENRIK_API_KEY` in .env."]);
    return;
  }

  const said = ctx.argument.trim();
  const at = said.lastIndexOf("#");
  if (at < 1) {
    await card(ctx, ["Which player?", "", "-# `valorant TenZ#tenz` — the tag is part of it"]);
    return;
  }

  const name = said.slice(0, at).trim();
  const tag = said.slice(at + 1).trim();
  const got = await json<{
    data: {
      puuid: string;
      region: string;
      account_level: number;
      name: string;
      tag: string;
      card?: { small?: string; wide?: string };
      last_update?: string;
    };
  }>(
    `https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    { Authorization: key },
  );

  if (!got.ok) {
    const code = (got.body as { errors?: { code?: number; message?: string }[] } | null)?.errors?.[0];
    // Riot only exposes an account through its match history, so somebody who
    // has not played recently cannot be looked up at all. That is worth saying.
    if (code?.code === 24) {
      await card(ctx, [
        `**${plain(name)}#${plain(tag)}** cannot be read right now.`,
        "",
        "-# Riot only exposes an account through recent match data, so one that",
        "-# has not played in a while returns nothing. It is not the name.",
      ]);
      return;
    }
    await card(ctx, [
      code?.code === 22
        ? `No Valorant account called **${plain(name)}#${plain(tag)}**.`
        : "Valorant could not be reached.",
    ]);
    return;
  }

  const one = got.body.data;
  await card(ctx, [
    `### ${plain(one.name)}#${plain(one.tag)}`,
    ...(one.card?.wide ? [one.card.wide] : []),
    `-# level ${one.account_level} · region ${plain(one.region?.toUpperCase() ?? "?")}`,
    ...(one.last_update ? [`-# seen ${plain(one.last_update)}`] : []),
  ]);
}

// playerdb needs no key at all, which is why this one survived the account that
// would not let you sign up.
async function xbox(ctx: PrefixContext): Promise<void> {
  const tag = ctx.argument.trim();
  if (!tag) {
    await card(ctx, ["Which gamertag?", "", "-# `xbox Major Nelson`"]);
    return;
  }

  const got = await json<{
    data: {
      player: {
        id: string;
        username: string;
        avatar?: string;
        meta?: {
          gamerscore?: string;
          accounttier?: string;
          bio?: string;
          location?: string;
          tenurelevel?: string;
        };
      };
    };
  }>(`https://playerdb.co/api/player/xbox/${encodeURIComponent(tag)}`);

  if (!got.ok) {
    await card(ctx, [
      got.status === 429
        ? "Xbox Live is rate limiting this address. Try again shortly."
        : `No gamertag called **${plain(tag)}**.`,
    ]);
    return;
  }

  const one = got.body.data.player;
  const meta = one.meta ?? {};
  await card(ctx, [
    `### ${plain(one.username)}`,
    ...(one.avatar ? [one.avatar] : []),
    `-# xuid: ${one.id}`,
    ...(meta.gamerscore ? [`-# gamerscore: ${Number(meta.gamerscore).toLocaleString()}`] : []),
    ...(meta.accounttier ? [`-# tier: ${plain(meta.accounttier)}`] : []),
    ...(meta.tenurelevel ? [`-# ${plain(meta.tenurelevel)} years on Xbox Live`] : []),
    ...(meta.location ? [`-# ${plain(meta.location)}`] : []),
    ...(meta.bio ? [`-# ${plain(meta.bio.slice(0, 160))}`] : []),
  ]);
}

const NO_BLOXLINK = "This server does not use Bloxlink, so it has nothing to look in.";

export interface Linked {
  robloxId: string | null;
  why: string | null;
}

// Bloxlink's public route is scoped to a guild, so it can only answer for a
// server that actually uses Bloxlink. Saying that beats "not found".
export async function linkedRoblox(guildId: string, discordId: string): Promise<Linked> {
  const key = keyOf("BLOXLINK_API_KEY");
  if (!key) return { robloxId: null, why: "No Bloxlink key is set." };

  const got = await json<{ robloxID?: string }>(
    `https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${discordId}`,
    { Authorization: key },
  );

  if (!got.ok) {
    const said = (got.body as { error?: string } | null)?.error ?? "";
    if (/unknown guild/i.test(said)) return { robloxId: null, why: NO_BLOXLINK };
    return { robloxId: null, why: "Bloxlink has no link for them." };
  }
  return { robloxId: got.body.robloxID ?? null, why: null };
}

// The two directions report the same problem differently: discord-to-roblox says
// "Unknown Guild" where roblox-to-discord only says "User not found". Taking the
// second at face value would tell somebody their account is unlinked when really
// the server has no Bloxlink at all.
//
// The probe has to use a real account: Bloxlink checks the user before the guild,
// so a made-up id comes back "User not found" and never reveals whether the guild
// is known. The person who ran the command is one that certainly exists.
async function knowsGuild(guildId: string, key: string, realUserId: string): Promise<boolean> {
  const got = await json<unknown>(
    `https://api.blox.link/v4/public/guilds/${guildId}/discord-to-roblox/${realUserId}`,
    { Authorization: key },
  );
  if (got.ok) return true;
  return !/unknown guild/i.test((got.body as { error?: string } | null)?.error ?? "");
}

export async function linkedDiscord(
  guildId: string,
  robloxId: string,
  askedBy: string,
): Promise<Linked> {
  const key = keyOf("BLOXLINK_API_KEY");
  if (!key) return { robloxId: null, why: "No Bloxlink key is set." };

  const got = await json<{ discordIDs?: string[] }>(
    `https://api.blox.link/v4/public/guilds/${guildId}/roblox-to-discord/${robloxId}`,
    { Authorization: key },
  );

  if (!got.ok) {
    const said = (got.body as { error?: string } | null)?.error ?? "";
    if (/unknown guild/i.test(said)) return { robloxId: null, why: NO_BLOXLINK };
    // Only on the failure path, and only once: worth a request to avoid a
    // confidently wrong answer.
    if (!(await knowsGuild(guildId, key, askedBy))) return { robloxId: null, why: NO_BLOXLINK };
    return { robloxId: null, why: "Bloxlink has no link for them." };
  }
  return { robloxId: got.body.discordIDs?.[0] ?? null, why: null };
}

// Only reached when a key is present; the keyless XML profile stays the fallback.
export async function steamExtra(
  id64: string,
): Promise<{ level: number | null; games: number | null; realName: string | null }> {
  const key = keyOf("STEAM_API_KEY");
  if (!key) return { level: null, games: null, realName: null };

  const [summary, level, games] = await Promise.all([
    json<{ response: { players: { realname?: string }[] } }>(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${id64}`,
    ),
    json<{ response: { player_level?: number } }>(
      `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${key}&steamid=${id64}`,
    ),
    json<{ response: { game_count?: number } }>(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${id64}`,
    ),
  ]);

  return {
    level: level.ok ? (level.body.response?.player_level ?? null) : null,
    games: games.ok ? (games.body.response?.game_count ?? null) : null,
    realName: summary.ok ? (summary.body.response?.players?.[0]?.realname ?? null) : null,
  };
}

export async function resolveVanity(vanity: string): Promise<string | null> {
  const key = keyOf("STEAM_API_KEY");
  if (!key) return null;

  const got = await json<{ response: { steamid?: string; success: number } }>(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(vanity)}`,
  );
  return got.ok && got.body.response?.success === 1 ? (got.body.response.steamid ?? null) : null;
}

export function registerServices(): void {
  register({ name: "weather", description: "Gets simple weather from OpenWeatherMap", handler: weather });
  register({ name: "valorant", aliases: ["val"], description: "Get Valorant player information", handler: valorant });
  register({ name: "xbox", aliases: ["gamertag"], description: "Profile information for an Xbox gamertag", handler: xbox });
}
