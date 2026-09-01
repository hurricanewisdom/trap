import { container, text, IS_COMPONENTS_V2 } from "../../helpers/components.js";
import type { PrefixContext } from "../../core/prefix.js";

export async function card(ctx: PrefixContext, lines: string[]): Promise<void> {
  await ctx.reply({
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [container(null, text(lines.join("\n")))],
  });
}

export function words(argument: string): string[] {
  return argument.trim().split(/\s+/).filter(Boolean);
}

const USER = /^<@!?(\d{15,25})>$/;

export function userId(token: string | undefined): string | null {
  if (!token) return null;
  const mention = USER.exec(token);
  if (mention?.[1]) return mention[1];
  return /^\d{15,25}$/.test(token) ? token : null;
}

// Snowflakes carry their own creation time, which is what makes `timediff` and
// the id-based ages elsewhere free of any request.
export function madeAt(id: string): number {
  return Number(BigInt(id) >> 22n) + 1_420_070_400_000;
}

export function stamp(value: string | number | null | undefined, style = "R"): string {
  if (value === null || value === undefined) return "unknown";
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : "unknown";
}

// A message link is three ids: guild, channel, message. Anything that takes one
// has to accept the canary and ptb hosts too, because people paste those.
const LINK = /discord(?:app)?\.com\/channels\/(\d{15,25}|@me)\/(\d{15,25})\/(\d{15,25})/;

export function messageLink(
  token: string | undefined,
): { guildId: string; channelId: string; messageId: string } | null {
  if (!token) return null;
  const found = LINK.exec(token);
  if (!found) return null;
  return {
    guildId: found[1] as string,
    channelId: found[2] as string,
    messageId: found[3] as string,
  };
}
