import {
  groupUnder,
  lookupIn,
  register,
  type PrefixContext,
  type PrefixHandler,
} from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { linkedDiscord, linkedRoblox, steamExtra } from "./services.js";
import { card, stamp, words } from "./shared.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const READ_MS = 12_000;

// Every one of these talks to somebody else's service, so none of them are
// allowed to throw: a site being down is an answer, not a crash.
async function json<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const answer = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(READ_MS),
      headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!answer.ok) return null;
    return (await answer.json()) as T;
  } catch {
    return null;
  }
}

async function page(url: string): Promise<string | null> {
  try {
    const answer = await fetch(url, {
      signal: AbortSignal.timeout(READ_MS),
      redirect: "follow",
      headers: { "user-agent": UA },
    });
    if (!answer.ok) return null;
    return (await answer.text()).slice(0, 300_000);
  } catch {
    return null;
  }
}

function metaOf(html: string, name: string): string | null {
  const found = html.match(
    new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]*)"`, "i"),
  );
  return found?.[1] ? found[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"') : null;
}

async function define(ctx: PrefixContext): Promise<void> {
  const word = ctx.argument.trim();
  if (!word) {
    await card(ctx, ["Which word?", "", "-# `define serendipity`"]);
    return;
  }

  const found = await json<
    { word: string; phonetic?: string; meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[] }[]
  >(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);

  if (!found || found.length === 0) {
    await card(ctx, [`Nothing found for **${plain(word)}**.`]);
    return;
  }

  const one = found[0] as NonNullable<(typeof found)[0]>;
  const lines: string[] = [`### ${plain(one.word)}`];
  if (one.phonetic) lines.push(`-# ${plain(one.phonetic)}`);

  for (const meaning of one.meanings.slice(0, 3)) {
    lines.push("", `**${plain(meaning.partOfSpeech)}**`);
    for (const sense of meaning.definitions.slice(0, 2)) {
      lines.push(`-# ${plain(sense.definition.slice(0, 200))}`);
      if (sense.example) lines.push(`-# *${plain(sense.example.slice(0, 150))}*`);
    }
  }
  await card(ctx, lines);
}

async function urban(ctx: PrefixContext): Promise<void> {
  const word = ctx.argument.trim();
  if (!word) {
    await card(ctx, ["Which word?", "", "-# `urbandictionary yeet`"]);
    return;
  }

  const found = await json<{ list: { word: string; definition: string; example: string; thumbs_up: number; permalink: string }[] }>(
    `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`,
  );
  const one = found?.list?.[0];
  if (!one) {
    await card(ctx, [`Nothing found for **${plain(word)}**.`]);
    return;
  }

  const tidy = (text: string) => plain(text.replace(/\[|\]/g, "")).slice(0, 700);
  await card(ctx, [
    `### ${plain(one.word)}`,
    tidy(one.definition),
    ...(one.example ? ["", `-# ${tidy(one.example).slice(0, 300)}`] : []),
    "",
    `-# 👍 ${one.thumbs_up} · [urban dictionary](${one.permalink})`,
  ]);
}

async function minecraft(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim();
  if (!name) {
    await card(ctx, ["Which username?", "", "-# `minecraft Notch`"]);
    return;
  }

  const found = await json<{ id: string; name: string }>(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
  );
  if (!found?.id) {
    await card(ctx, [`No Minecraft account called **${plain(name)}**.`]);
    return;
  }

  const dashed = found.id.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );
  await card(ctx, [
    `### ${plain(found.name)}`,
    `https://crafatar.com/renders/body/${found.id}?overlay`,
    `-# uuid: ${dashed}`,
    `-# [namemc](https://namemc.com/profile/${found.id})`,
  ]);
}

async function github(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim();
  if (!name) {
    await card(ctx, ["Which user?", "", "-# `github torvalds`"]);
    return;
  }

  const found = await json<{
    login: string; name?: string | null; bio?: string | null; avatar_url: string;
    public_repos: number; followers: number; following: number; created_at: string;
    location?: string | null; html_url: string;
  }>(`https://api.github.com/users/${encodeURIComponent(name)}`);

  if (!found) {
    await card(ctx, [
      `No GitHub user called **${plain(name)}**.`,
      "-# Or this address has run out of anonymous requests for the hour.",
    ]);
    return;
  }

  await card(ctx, [
    `### ${plain(found.name || found.login)}`,
    found.avatar_url,
    ...(found.bio ? [`-# ${plain(found.bio.slice(0, 200))}`] : []),
    `-# ${found.public_repos} repos · ${found.followers} followers · ${found.following} following`,
    ...(found.location ? [`-# ${plain(found.location)}`] : []),
    `-# joined ${stamp(found.created_at, "D")}`,
    `-# ${found.html_url}`,
  ]);
}

async function steam(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Which profile?", "", "-# `steam gabelogannewell`"]);
    return;
  }

  // The XML view of a profile needs no key, which is the whole reason this one
  // works without you signing up for anything.
  const which = /^\d{17}$/.test(said) ? "profiles" : "id";
  const html = await page(`https://steamcommunity.com/${which}/${encodeURIComponent(said)}?xml=1`);
  if (!html || !html.includes("<steamID>")) {
    await card(ctx, [`No Steam profile called **${plain(said)}**.`]);
    return;
  }

  const pick = (tag: string): string | null => {
    const found = html.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"));
    return found?.[1]?.trim() || null;
  };

  const state = pick("stateMessage");
  const id64 = pick("steamID64");
  const extra = id64 ? await steamExtra(id64) : { level: null, games: null, realName: null };
  await card(ctx, [
    `### ${plain(pick("steamID") ?? said)}`,
    ...(pick("avatarFull") ? [pick("avatarFull") as string] : []),
    ...(extra.realName ? [`-# ${plain(extra.realName)}`] : []),
    `-# id64: ${id64 ?? "unknown"}`,
    ...(extra.level !== null ? [`-# level ${extra.level}`] : []),
    ...(extra.games !== null ? [`-# ${extra.games} games`] : []),
    ...(state ? [`-# ${plain(state.replace(/<[^>]+>/g, " ").slice(0, 120))}`] : []),
    ...(pick("memberSince") ? [`-# member since ${plain(pick("memberSince") as string)}`] : []),
    ...(pick("location") ? [`-# ${plain(pick("location") as string)}`] : []),
  ]);
}

async function telegram(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim().replace(/^@/, "");
  if (!name) {
    await card(ctx, ["Which username?", "", "-# `telegram durov`"]);
    return;
  }

  const html = await page(`https://t.me/${encodeURIComponent(name)}`);
  if (!html) {
    await card(ctx, ["Telegram could not be reached."]);
    return;
  }

  const title = metaOf(html, "og:title");
  const about = metaOf(html, "og:description");
  const image = metaOf(html, "og:image");
  if (!title || /Telegram: Contact/i.test(title) === false && !about) {
    await card(ctx, [`Nothing public for **${plain(name)}**.`]);
    return;
  }

  await card(ctx, [
    `### ${plain((title ?? name).replace(/^Telegram:\s*/i, ""))}`,
    ...(image ? [image] : []),
    ...(about ? [`-# ${plain(about.slice(0, 250))}`] : []),
    `-# t.me/${plain(name)}`,
  ]);
}

function snapchatCommand(stories: boolean): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const name = ctx.argument.trim().replace(/^@/, "");
    if (!name) {
      await card(ctx, ["Which username?", "", `-# \`snapchat${stories ? "story" : ""} team.snapchat\``]);
      return;
    }

    const html = await page(`https://www.snapchat.com/add/${encodeURIComponent(name)}`);
    if (!html) {
      await card(ctx, ["Snapchat could not be reached."]);
      return;
    }

    const title = metaOf(html, "og:title");
    if (!title) {
      await card(ctx, [`No Snapchat account called **${plain(name)}**.`]);
      return;
    }

    if (!stories) {
      await card(ctx, [
        `### ${plain(title.replace(/ on Snapchat$/i, ""))}`,
        ...(metaOf(html, "og:image") ? [metaOf(html, "og:image") as string] : []),
        ...(metaOf(html, "og:description") ? [`-# ${plain((metaOf(html, "og:description") as string).slice(0, 200))}`] : []),
        `-# snapchat.com/add/${plain(name)}`,
      ]);
      return;
    }

    // Public stories are embedded in the page as a JSON blob rather than served
    // by any API, so this reads what the page itself was given.
    const found = [...html.matchAll(/"snapUrls?":\s*\{[^}]*"mediaUrl":"([^"]+)"/g)].map((one) => one[1]);
    const urls = [...new Set(found)].slice(0, 5);
    await card(ctx, [
      `### ${plain(title.replace(/ on Snapchat$/i, ""))}`,
      ...(urls.length === 0
        ? ["-# No public stories right now."]
        : urls.map((one, at) => `-# ${at + 1}. ${String(one).replace(/\\u0026/g, "&")}`)),
    ]);
  };
}

async function cashapp(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim().replace(/^\$/, "");
  if (!name) {
    await card(ctx, ["Which cashtag?", "", "-# `cashapp jack`"]);
    return;
  }

  const html = await page(`https://cash.app/$${encodeURIComponent(name)}`);
  if (!html) {
    await card(ctx, [`No CashApp profile for **$${plain(name)}**.`]);
    return;
  }

  const title = metaOf(html, "og:title");
  await card(ctx, [
    `### $${plain(name)}`,
    ...(metaOf(html, "og:image") ? [metaOf(html, "og:image") as string] : []),
    ...(title ? [`-# ${plain(title.slice(0, 150))}`] : []),
    `-# cash.app/$${plain(name)}`,
  ]);
}

async function robloxIdOf(name: string): Promise<{ id: number; name: string } | null> {
  const found = await json<{ data: { id: number; name: string }[] }>(
    "https://users.roblox.com/v1/usernames/users",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }),
    },
  );
  const one = found?.data?.[0];
  return one ? { id: one.id, name: one.name } : null;
}

async function roblox(ctx: PrefixContext): Promise<void> {
  const name = ctx.argument.trim();
  if (!name) {
    await card(ctx, ["Which username?", "", "-# `roblox builderman`"]);
    return;
  }

  const who = await robloxIdOf(name);
  if (!who) {
    await card(ctx, [`No Roblox user called **${plain(name)}**.`]);
    return;
  }

  const [profile, avatar, friends] = await Promise.all([
    json<{ description?: string; created: string; isBanned: boolean; displayName: string }>(
      `https://users.roblox.com/v1/users/${who.id}`,
    ),
    json<{ data: { imageUrl: string }[] }>(
      `https://thumbnails.roblox.com/v1/users/avatar?userIds=${who.id}&size=420x420&format=Png&isCircular=false`,
    ),
    json<{ count: number }>(`https://friends.roblox.com/v1/users/${who.id}/friends/count`),
  ]);

  await card(ctx, [
    `### ${plain(profile?.displayName ?? who.name)} (@${plain(who.name)})`,
    ...(avatar?.data?.[0]?.imageUrl ? [avatar.data[0].imageUrl] : []),
    ...(profile?.description ? [`-# ${plain(profile.description.slice(0, 200))}`] : []),
    `-# id: ${who.id}`,
    ...(profile?.created ? [`-# joined ${stamp(profile.created, "D")}`] : []),
    ...(friends ? [`-# ${friends.count} friends`] : []),
    ...(profile?.isBanned ? ["-# this account is banned"] : []),
    `-# roblox.com/users/${who.id}/profile`,
  ]);
}

function robloxSimple(
  which: "outfits" | "inventory" | "check" | "item" | "template" | "devex" | "fromdiscord" | "todiscord",
): PrefixHandler {
  return async (ctx: PrefixContext) => {
    const said = ctx.argument.trim();

    if (which === "devex") {
      const robux = Number(said.replace(/[^\d]/g, ""));
      if (!robux) {
        await card(ctx, ["How many Robux?", "", "-# `roblox devex 100000`"]);
        return;
      }
      // Roblox's published developer exchange rate.
      await card(ctx, [
        `### ${robux.toLocaleString()} Robux`,
        `-# $${(robux * 0.0035).toFixed(2)} at the developer exchange rate`,
        "-# 0.0035 USD per Robux, and 30,000 is the minimum they will exchange",
      ]);
      return;
    }

    if (which === "fromdiscord" || which === "todiscord") {
      if (!ctx.guildId) {
        await card(ctx, ["That one only works in a server."]);
        return;
      }
      const asked = said.replace(/[<@!>]/g, "").trim();
      if (!asked) {
        await card(ctx, [
          "Which account?",
          "",
          "-# `roblox " + which + (which === "fromdiscord" ? " @member`" : " <username>`"),
        ]);
        return;
      }

      if (which === "fromdiscord") {
        const found = await linkedRoblox(ctx.guildId, asked);
        if (!found.robloxId) {
          await card(ctx, [found.why ?? "Nothing linked."]);
          return;
        }
        const who = await json<{ name: string }>(
          "https://users.roblox.com/v1/users/" + found.robloxId,
        );
        await card(ctx, [
          "<@" + asked + "> is **" + plain(who?.name ?? found.robloxId) + "** on Roblox.",
          "-# id: " + found.robloxId,
        ]);
        return;
      }

      const who = await robloxIdOf(asked);
      if (!who) {
        await card(ctx, ["No Roblox user called **" + plain(asked) + "**."]);
        return;
      }
      const found = await linkedDiscord(ctx.guildId, String(who.id), ctx.authorId);
      await card(ctx, [
        found.robloxId
          ? "**" + plain(who.name) + "** is <@" + found.robloxId + "> here."
          : (found.why ?? "Nothing linked."),
      ]);
      return;
    }

    if (which === "item") {
      if (!said) {
        await card(ctx, ["Which item?", "", "-# `roblox item dominus`"]);
        return;
      }
      const found = await json<{ data: { id: number; name: string; itemType: string }[] }>(
        `https://catalog.roblox.com/v1/search/items?category=Collectibles&keyword=${encodeURIComponent(said)}&limit=10`,
      );
      const items = found?.data ?? [];
      await card(ctx, [
        `### ${items.length} match${items.length === 1 ? "" : "es"} for ${plain(said)}`,
        ...(items.length === 0
          ? ["-# nothing found"]
          : items.slice(0, 8).map((one) => `-# ${plain(one.name)} — ${one.id}`)),
      ]);
      return;
    }

    if (which === "template") {
      const id = Number(said.replace(/[^\d]/g, ""));
      if (!id) {
        await card(ctx, ["Which asset?", "", "-# `roblox template 1818`"]);
        return;
      }
      await card(ctx, [
        `### Asset ${id}`,
        `https://assetdelivery.roblox.com/v1/asset?id=${id}`,
        "-# Roblox serves the file itself at that address.",
      ]);
      return;
    }

    const parts = words(said);
    const who = await robloxIdOf(parts[0] ?? "");
    if (!who) {
      await card(ctx, ["Which Roblox user?", "", `-# \`roblox ${which} <username>\``]);
      return;
    }

    if (which === "outfits") {
      const found = await json<{ data: { id: number; name: string }[] }>(
        `https://avatar.roblox.com/v1/users/${who.id}/outfits?page=1&itemsPerPage=25`,
      );
      const outfits = found?.data ?? [];
      await card(ctx, [
        `### ${plain(who.name)} — ${outfits.length} outfits`,
        ...(outfits.length === 0
          ? ["-# none public"]
          : outfits.slice(0, 15).map((one) => `-# ${plain(one.name)}`)),
      ]);
      return;
    }

    if (which === "inventory") {
      const found = await json<{ data: { assetName: string }[] }>(
        `https://inventory.roblox.com/v2/users/${who.id}/inventory/8?limit=25&sortOrder=Asc`,
      );
      const items = found?.data ?? [];
      await card(ctx, [
        `### ${plain(who.name)}'s hats`,
        ...(items.length === 0
          ? ["-# nothing public — most inventories are private"]
          : items.slice(0, 15).map((one) => `-# ${plain(one.assetName)}`)),
      ]);
      return;
    }

    const asset = Number((parts[1] ?? "").replace(/[^\d]/g, ""));
    if (!asset) {
      await card(ctx, ["Which asset id?", "", "-# `roblox check <username> <asset id>`"]);
      return;
    }
    const owns = await json<{ data: { id: number }[] }>(
      `https://inventory.roblox.com/v1/users/${who.id}/items/Asset/${asset}`,
    );
    await card(ctx, [
      owns && owns.data.length > 0
        ? `**${plain(who.name)}** owns asset ${asset}.`
        : `**${plain(who.name)}** does not own asset ${asset}, or their inventory is private.`,
    ]);
  };
}

async function status(ctx: PrefixContext): Promise<void> {
  await card(ctx, [
    "### Status",
    "-# https://trap.rocks/status",
    "-# `,ping` reports the gateway latency this shard is seeing right now.",
  ]);
}

async function donate(ctx: PrefixContext): Promise<void> {
  await card(ctx, [
    "### Donate",
    "The bot runs on a rented box, and hosting is the whole cost.",
    "",
    "-# Ask the owner for the current link — nothing is set up here yet.",
  ]);
}

export function registerLookups(): void {
  register({ name: "define", aliases: ["dictionary"], description: "Get the definition of a word", handler: define });
  register({ name: "urbandictionary", aliases: ["ud", "urban"], description: "Definition from Urban Dictionary", handler: urban });
  register({ name: "minecraft", description: "Gets Minecraft profile information", handler: minecraft });
  register({ name: "github", aliases: ["gh"], description: "Profile information for a GitHub user", handler: github });
  register({ name: "steam", description: "Information about a Steam profile", handler: steam });
  register({ name: "telegram", description: "Profile information for a Telegram user or group", handler: telegram });
  register({ name: "snapchat", description: "Bitmoji and QR code for a Snapchat user", handler: snapchatCommand(false) });
  register({ name: "snapchatstory", description: "Current stories for a Snapchat user", handler: snapchatCommand(true) });
  register({ name: "cashapp", description: "CashApp profile information", handler: cashapp });
  register({ name: "status", description: "Get a link to the status page", handler: status });
  register({ name: "donate", description: "Donate to the bot's hosting expenses", handler: donate });

  register({
    name: "roblox",
    aliases: ["rblx"],
    description: "Profile information for a Roblox user",
    handler: async (ctx) => {
      const sub = words(ctx.argument)[0]?.toLowerCase() ?? "";
      const found = sub ? lookupIn("roblox", sub) : undefined;
      if (found) {
        await found.handler({ ...ctx, argument: ctx.argument.replace(/^\s*\S+\s*/, "") });
        return;
      }
      await roblox(ctx);
    },
  });

  groupUnder("roblox", () => {
    register({ name: "outfits", description: "View all outfits for a user", handler: robloxSimple("outfits") });
    register({ name: "inventory", description: "View the inventory of a Roblox user", handler: robloxSimple("inventory") });
    register({ name: "check", description: "Check if an asset is in a user's inventory", handler: robloxSimple("check") });
    register({ name: "item", description: "Search for a Roblox limited item", handler: robloxSimple("item") });
    register({ name: "template", description: "Download the asset for an item", handler: robloxSimple("template") });
    register({ name: "devex", description: "Convert Robux to USD", handler: robloxSimple("devex") });
    register({ name: "fromdiscord", description: "Get a Roblox account from a Discord account", handler: robloxSimple("fromdiscord") });
    register({ name: "todiscord", description: "Get a Discord account from a Roblox account", handler: robloxSimple("todiscord") });
  });
}
