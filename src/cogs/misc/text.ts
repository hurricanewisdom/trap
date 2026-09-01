import { gallery, container, text as textNode, IS_COMPONENTS_V2 } from "../../helpers/components.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, words } from "./shared.js";

const MOST = 1_500;

const FACES = ["(・`ω´・)", ";;w;;", "OwO", "UwU", ">w<", "^w^", "(⑅˘꒳˘)", "( ˘ω˘ )"];

// Deterministic per call site, not per character: a face every so often reads as
// speech, one after every word reads as noise.
function uwuify(said: string): string {
  return said
    .replace(/(?:r|l)/g, "w")
    .replace(/(?:R|L)/g, "W")
    .replace(/n([aeiou])/g, "ny$1")
    .replace(/N([aeiou])/g, "Ny$1")
    .replace(/N([AEIOU])/g, "NY$1")
    .replace(/ove/g, "uv")
    .replace(/\b(\w)(\w*)\b/g, (whole, first: string, rest: string) =>
      Math.random() < 0.1 ? `${first}-${first}${rest}` : whole,
    )
    .replace(/[.!?]+(\s|$)/g, (mark, tail: string) =>
      Math.random() < 0.5 ? `${mark.trim()} ${FACES[Math.floor(Math.random() * FACES.length)]}${tail}` : mark,
    );
}

// The joke is the cadence, not a dictionary: a stretched vowel, a stutter and a
// trailing sigh land it without needing a word list nobody agrees on.
function freakify(said: string): string {
  const tail = ["😈", "😩", "💦", "🫦", "😳"];
  return (
    said
      .split(/\s+/)
      .map((word) => {
        if (word.length < 4) return word;
        const roll = Math.random();
        if (roll < 0.15) return `${word[0]}-${word}`;
        if (roll < 0.3) return word.replace(/([aeiou])/i, "$1$1$1");
        return word;
      })
      .join(" ") + ` ${tail[Math.floor(Math.random() * tail.length)]}`
  );
}

function transform(name: "uwu" | "freaky") {
  return async (ctx: PrefixContext): Promise<void> => {
    const said = ctx.argument.trim();
    if (!said) {
      await card(ctx, [`What should be ${name === "uwu" ? "uwuified" : "freakified"}?`, "", `-# \`${name} <text>\``]);
      return;
    }
    if (said.length > MOST) {
      await card(ctx, [`That is over ${MOST} characters.`]);
      return;
    }
    // plain() first: the output is echoed back, so somebody else's markdown and
    // mentions must not survive the trip.
    await card(ctx, [name === "uwu" ? uwuify(plain(said)) : freakify(plain(said))]);
  };
}

async function randomhex(ctx: PrefixContext): Promise<void> {
  const hex = Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .padStart(6, "0");
  await swatch(ctx, hex);
}

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

// Named colours are what people actually type, and the six they always try are
// cheaper to answer than to refuse.
const NAMED: Record<string, string> = {
  red: "ff0000",
  green: "00ff00",
  blue: "0000ff",
  black: "000000",
  white: "ffffff",
  yellow: "ffff00",
  orange: "ffa500",
  purple: "800080",
  pink: "ffc0cb",
  cyan: "00ffff",
};

async function colour(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim().toLowerCase();
  if (!said) {
    await card(ctx, ["Which colour?", "", "-# `color #1db954` · `color red` · `randomhex`"]);
    return;
  }

  const named = NAMED[said];
  const found = named ?? HEX.exec(said)?.[1];
  if (!found) {
    await card(ctx, ["That is not a hex code.", "", "-# `color #1db954`"]);
    return;
  }
  // Three-digit hex doubles each character, which is what a browser does with it.
  await swatch(ctx, found.length === 3 ? found.replace(/./g, (one) => one + one) : found);
}

async function swatch(ctx: PrefixContext, hex: string): Promise<void> {
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;

  await ctx.reply({
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components: [
      container(
        value,
        textNode(
          [
            `### #${hex}`,
            `-# rgb(${r}, ${g}, ${b})`,
            `-# hsl from ${hsl(r, g, b)}`,
            `-# int ${value}`,
          ].join("\n"),
        ),
        gallery({ url: `https://singlecolorimage.com/get/${hex}/400x100` }),
      ),
    ],
  });
}

function hsl(r: number, g: number, b: number): string {
  const [rd, gd, bd] = [r / 255, g / 255, b / 255] as [number, number, number];
  const max = Math.max(rd, gd, bd);
  const min = Math.min(rd, gd, bd);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return `hsl(0, 0%, ${Math.round(l * 100)}%)`;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rd) h = ((gd - bd) / d + (gd < bd ? 6 : 0)) / 6;
  else if (max === gd) h = ((bd - rd) / d + 2) / 6;
  else h = ((rd - gd) / d + 4) / 6;

  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

const MOST_CHARS = 20;

async function charinfo(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, ["Which characters?", "", "-# `charinfo あ` · `charinfo 🤔`"]);
    return;
  }

  // Spread, not split(""), so an emoji made of several code points is one
  // character here rather than a row of broken halves.
  const chars = [...said].slice(0, MOST_CHARS);
  const lines = chars.map((one) => {
    const point = one.codePointAt(0) ?? 0;
    const hex = point.toString(16).toUpperCase().padStart(4, "0");
    // Anything past the basic plane needs the braced form: `\u1F914` is not a
    // valid escape, it reads as `\u1F91` followed by a 4.
    const escape = point > 0xffff ? `\\u{${hex}}` : `\\u${hex}`;
    return `\`${escape}\` — ${one} — [U+${hex}](https://www.compart.com/en/unicode/U+${hex})`;
  });

  await card(ctx, [
    `### ${chars.length} character${chars.length === 1 ? "" : "s"}`,
    ...lines,
    ...([...said].length > MOST_CHARS ? [`-# first ${MOST_CHARS} of ${[...said].length}`] : []),
  ]);
}

export function registerText(): void {
  register({ name: "uwu", aliases: ["uwuify"], description: "Uwuify text", handler: transform("uwu") });
  register({ name: "freaky", description: "Freakify text", handler: transform("freaky") });
  register({ name: "randomhex", aliases: ["randomcolor"], description: "Generate a random hex (color)", handler: randomhex });
  register({ name: "color", aliases: ["colour", "hexcolor"], description: "Show a hex code's colour", handler: colour });
  register({ name: "charinfo", description: "Get information about a character or symbol", handler: charinfo });
}

export { words };
