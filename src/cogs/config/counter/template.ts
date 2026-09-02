import { api, getGuild, guildRoles } from "../../../core/discord.js";
import { joinsToday } from "./store.js";
import type { Reading } from "./sources.js";

export interface Variable {
  token: string;
  describes: string;
}

/** The server ones, available to every counter whatever it tracks. */
export const VARIABLES: Variable[] = [
  { token: "{members}", describes: "everybody in the server" },
  { token: "{boosts}", describes: "how many boosts the server has" },
  { token: "{level}", describes: "the boost level" },
  { token: "{channels}", describes: "how many channels there are" },
  { token: "{roles}", describes: "how many roles there are" },
  { token: "{joins_today}", describes: "members who joined since midnight" },
  { token: "{name}", describes: "the server's name" },
];

/** `{n|human}` gives 1.2K, `{n|comma}` gives 1,234. */
export const FILTERS = ["human", "comma"];

export function human(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (size >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (size >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function comma(value: number): string {
  return value.toLocaleString("en-US");
}

export async function serverValues(guildId: string): Promise<Reading> {
  const [guild, roles, joins, channels] = await Promise.all([
    getGuild(guildId),
    guildRoles(guildId),
    joinsToday(guildId),
    api<{ id: string }[]>(`/guilds/${guildId}/channels`),
  ]);

  // There is deliberately no {humans} or {bots}: Discord's member count does
  // not split them, and the only way to is to walk every member, which is far
  // too much work to repeat on a timer. A wrong number in a channel name is
  // worse than no variable, because nobody ever checks a counter.
  return {
    members: guild?.approximate_member_count ?? 0,
    boosts: guild?.premium_subscription_count ?? 0,
    level: guild?.premium_tier ?? 0,
    channels: (channels ?? []).length,
    roles: roles.length,
    joins_today: joins,
    name: guild?.name ?? "this server",
  };
}

/**
 * `{if: condition && when true && when false}`.
 *
 * Scanned rather than matched with a regex: the condition is itself a token, so
 * `{if: {live} && ...}` has a closing brace in the middle and `[^}]*` stops
 * there. Depth counting is the only way to find the brace that ends it.
 */
function conditionals(template: string, values: Reading): string {
  let out = "";
  let at = 0;

  while (at < template.length) {
    const start = template.toLowerCase().indexOf("{if:", at);
    if (start < 0) {
      out += template.slice(at);
      break;
    }

    out += template.slice(at, start);

    let depth = 0;
    let end = -1;
    for (let scan = start; scan < template.length; scan += 1) {
      if (template[scan] === "{") depth += 1;
      else if (template[scan] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = scan;
          break;
        }
      }
    }

    // An unclosed {if: is left exactly as typed rather than eating the rest.
    if (end < 0) {
      out += template.slice(start);
      break;
    }

    const inner = template.slice(start + 4, end);
    const [test = "", whenTrue = "", whenFalse = ""] = inner.split("&&").map((part) => part.trim());

    const resolved = fill(test, values).trim().toLowerCase();
    const truthy = resolved !== "" && resolved !== "0" && resolved !== "false";
    out += fill(truthy ? whenTrue : whenFalse, values);
    at = end + 1;
  }

  return out;
}

function fill(text: string, values: Reading): string {
  return text.replace(/\{([a-z_]+)(?:\|([a-z]+))?\}/gi, (whole, name: string, filter?: string) => {
    const held = values[String(name).toLowerCase()];
    if (held === undefined) return whole;

    if (typeof held === "number") {
      if (filter?.toLowerCase() === "human") return human(held);
      if (filter?.toLowerCase() === "comma") return comma(held);
      return String(held);
    }
    // A false boolean renders as nothing, so {if: {live} && ...} reads as false.
    if (typeof held === "boolean") return held ? "true" : "";
    return String(held);
  });
}

/** Discord's own ceiling for a channel name. */
export const NAME_LIMIT = 100;

export function apply(template: string, values: Reading): string {
  // Conditionals first, then the plain tokens: a conditional fills its own
  // branch, and everything outside one still has to be filled.
  return fill(conditionals(template, values), values)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_LIMIT);
}

/** Tokens the template uses that nothing will fill in. */
export function unknownTokens(template: string, known: string[]): string[] {
  const found = template.replace(/\{if:[^}]*\}/gi, " ").match(/\{[a-z_]+(?:\|[a-z]+)?\}/gi) ?? [];
  const names = new Set(known.map((one) => one.toLowerCase()));
  return [
    ...new Set(
      found
        .map((token) => `{${token.slice(1, -1).split("|")[0]}}`.toLowerCase())
        .filter((token) => !names.has(token)),
    ),
  ];
}
