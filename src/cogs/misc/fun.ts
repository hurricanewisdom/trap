import { addReaction, sendMessage } from "../../core/discord.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card, messageLink, words } from "./shared.js";

const THROWS = ["rock", "paper", "scissors"] as const;

const BEATS: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };

const SHORT: Record<string, string> = { r: "rock", p: "paper", s: "scissors" };

async function rps(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim().toLowerCase();
  const yours = SHORT[said] ?? (THROWS as readonly string[]).find((one) => one === said);
  if (!yours) {
    await card(ctx, ["Rock, paper or scissors?", "", "-# `rps rock`"]);
    return;
  }

  const mine = THROWS[Math.floor(Math.random() * THROWS.length)] as string;
  const outcome =
    mine === yours ? "A draw." : BEATS[yours] === mine ? "You win." : "I win.";

  await card(ctx, [
    `### ${outcome}`,
    `-# you threw **${yours}**, I threw **${mine}**`,
  ]);
}

async function choose(ctx: PrefixContext): Promise<void> {
  // Commas first, because "pizza, pasta or rice" is how people write a list;
  // falling back to spaces keeps `choose a b c` working.
  const said = ctx.argument.trim();
  const parts = (said.includes(",") ? said.split(",") : said.split(/\s+/))
    .map((one) => one.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    await card(ctx, ["Give me at least two things.", "", "-# `choose pizza, pasta, rice`"]);
    return;
  }

  const picked = parts[Math.floor(Math.random() * parts.length)] as string;
  await card(ctx, [
    `### ${plain(picked.slice(0, 200))}`,
    `-# out of ${parts.length}`,
  ]);
}

const RATHER: [string, string][] = [
  ["never use the internet again", "never leave your country again"],
  ["always be ten minutes late", "always be twenty minutes early"],
  ["have unlimited money", "have unlimited time"],
  ["fight one horse-sized duck", "fight a hundred duck-sized horses"],
  ["know when you will die", "know how you will die"],
  ["be able to fly", "be able to turn invisible"],
  ["lose all your photos", "lose all your messages"],
  ["never listen to music again", "never watch a film again"],
  ["live without heating", "live without air conditioning"],
  ["speak every language", "play every instrument"],
  ["only whisper", "only shout"],
  ["have no sense of taste", "have no sense of smell"],
  ["be famous and disliked", "be unknown and liked"],
  ["work a job you love for little", "work a job you hate for a lot"],
  ["always say what you think", "never speak again"],
  ["restart your life", "erase one year of it"],
];

async function wouldYouRather(ctx: PrefixContext): Promise<void> {
  const [one, two] = RATHER[Math.floor(Math.random() * RATHER.length)] as [string, string];

  const sent = await sendMessage(ctx.channelId, {
    content: `**Would you rather...**\n\n🅰️ ${one}\n🅱️ ${two}`,
    allowed_mentions: { parse: [] },
  });
  if (!sent.ok) {
    await card(ctx, ["That could not be posted."]);
    return;
  }
  await addReaction(ctx.channelId, sent.data.id, "🅰️");
  await addReaction(ctx.channelId, sent.data.id, "🅱️");
}

async function quickpoll(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  // A link points the arrows at somebody else's message; no argument points them
  // at the one that ran the command, which is the common case.
  const link = messageLink(words(said)[0]);
  const channelId = link?.channelId ?? ctx.channelId;
  const messageId = link?.messageId ?? ctx.messageId;

  if (link && link.guildId !== ctx.guildId) {
    await card(ctx, ["That message is in another server."]);
    return;
  }

  const up = await addReaction(channelId, messageId, "⬆️");
  if (!up.ok) {
    await card(ctx, ["Those could not be added.", "", `-# ${plain(up.message.slice(0, 120))}`]);
    return;
  }
  await addReaction(channelId, messageId, "⬇️");
}

const HOURS = /^(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;

// Discord takes a poll duration in whole hours, so anything shorter than one is
// rounded up rather than silently becoming zero and expiring instantly.
function durationHours(token: string | undefined): number | null {
  if (!token) return null;
  const found = HOURS.exec(token.trim());
  if (!found) return null;

  const size = Number(found[1]);
  const unit = (found[2] ?? "").toLowerCase();
  const hours = unit.startsWith("d") ? size * 24 : unit.startsWith("h") ? size : Math.ceil(size / 60);
  if (hours < 1 || hours > 768) return null;
  return hours;
}

async function poll(ctx: PrefixContext): Promise<void> {
  const parts = words(ctx.argument);
  const hours = durationHours(parts[0]);
  const question = hours === null ? ctx.argument.trim() : parts.slice(1).join(" ").trim();

  if (!question) {
    await card(ctx, [
      "What is the question?",
      "",
      "-# `poll 2h should we play something else`",
      "-# The time is optional and defaults to a day.",
    ]);
    return;
  }

  // Discord's own poll object, so the tally, the voting and the expiry are all
  // its problem rather than a reaction count this bot would have to guard.
  const sent = await sendMessage(ctx.channelId, {
    allowed_mentions: { parse: [] },
    ...({
      poll: {
        question: { text: question.slice(0, 300) },
        answers: [
          { poll_media: { text: "Yes", emoji: { name: "✅" } } },
          { poll_media: { text: "No", emoji: { name: "❌" } } },
        ],
        duration: hours ?? 24,
        allow_multiselect: false,
      },
    } as Record<string, unknown>),
  });

  if (!sent.ok) {
    await card(ctx, ["That poll could not be posted.", "", `-# ${plain(sent.message.slice(0, 140))}`]);
  }
}

export function registerFun(): void {
  register({ name: "rps", description: "Play Rock-paper-scissors with me", handler: rps });
  register({ name: "choose", aliases: ["pick"], description: "Give me choices and I will pick for you", handler: choose });
  register({ name: "wouldyourather", aliases: ["wyr"], description: "Would you rather?", handler: wouldYouRather });
  register({ name: "quickpoll", description: "Add up and down arrows to a message", handler: quickpoll });
  register({ name: "poll", description: "Create a short poll", handler: poll });
}
