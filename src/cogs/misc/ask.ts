import { getGuild, isBoosting } from "../../core/discord.js";
import { paginate } from "../../core/pager.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card } from "./shared.js";
import { pagesOf } from "./pages.js";

// A model on this box rather than somebody's paid API: no key, no per-question
// bill, and nothing anybody asks leaves the machine. Loopback only, because an
// unauthenticated model open to the internet is somebody else's free compute.
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

// Roughly ten seconds of generation on this hardware, which is as long as a
// chat command can take before it feels broken.
const MOST_TOKENS = 400;

const THINK_MS = 150_000;

const MOST_QUESTION = 1_000;

const SYSTEM = [
  "You are a helpful assistant answering inside a Discord chat.",
  "Answer in at most 150 words unless asked for more.",
  "Use plain prose. No markdown headings, no bullet lists unless asked.",
  "If you do not know, say so rather than inventing an answer.",
].join(" ");

interface Answer {
  response?: string;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  error?: string;
}

/**
 * Boosters, and the person who owns the server.
 *
 * The spec asked for a donor tier this bot has no equivalent of, and boosting is
 * the closest honest match. The owner is allowed too because otherwise a server
 * where nobody currently carries `premium_since` has nobody at all who can use
 * it — including the person who turned the bot on. That is not hypothetical:
 * Discord counts boosts against the guild, so a server can show boosts while no
 * member is flagged as boosting.
 */
async function mayAsk(guildId: string, userId: string): Promise<boolean> {
  if (await isBoosting(guildId, userId)) return true;
  const guild = await getGuild(guildId);
  return guild?.owner_id === userId;
}

async function ask(ctx: PrefixContext): Promise<void> {
  if (!ctx.guildId) {
    await card(ctx, ["That one only works in a server."]);
    return;
  }

  const question = ctx.argument.trim();
  if (!question) {
    await card(ctx, [
      "What do you want to ask?",
      "",
      "-# `ask why is the sky blue`",
      `-# Answered by **${plain(MODEL)}**, running on this box.`,
    ]);
    return;
  }
  if (question.length > MOST_QUESTION) {
    await card(ctx, [`That question is over ${MOST_QUESTION} characters.`]);
    return;
  }

  if (!(await mayAsk(ctx.guildId, ctx.authorId))) {
    await card(ctx, [
      "### Boosters only",
      "-# This one is for people boosting the server, and for its owner.",
      "-# It ties up the box for a few seconds per question, which is why.",
    ]);
    return;
  }

  await card(ctx, ["Thinking…", `-# ${plain(MODEL)} · a few seconds`]);

  let body: Answer | null = null;
  try {
    const answer = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      signal: AbortSignal.timeout(THINK_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: question,
        system: SYSTEM,
        stream: false,
        options: {
          num_predict: MOST_TOKENS,
          // The box has 32 cores but is not only doing this; leaving some free
          // keeps the bot itself responsive while a question is being answered.
          num_thread: 24,
          temperature: 0.7,
        },
      }),
    });
    body = (await answer.json()) as Answer;
  } catch {
    body = null;
  }

  if (!body || body.error || !body.response?.trim()) {
    await card(ctx, [
      "That could not be answered.",
      ...(body?.error ? ["", `-# ${plain(String(body.error), 200)}`] : []),
      "",
      "-# The model runs on this box, so this usually means it is not running.",
    ]);
    return;
  }

  const said = body.response.trim();
  const speed =
    body.eval_count && body.eval_duration
      ? `${(body.eval_count / (body.eval_duration / 1e9)).toFixed(0)} tok/s`
      : null;
  const took = body.total_duration ? `${(body.total_duration / 1e9).toFixed(1)}s` : null;

  // Long answers page rather than being cut, and the question is echoed so the
  // card still makes sense once other people have posted underneath it.
  const paragraphs = said.split(/\n{2,}/).filter(Boolean);
  const lines = paragraphs.flatMap((one) => {
    const cleaned = plain(one.replace(/\n/g, " ").trim(), 1_000);
    return cleaned ? [cleaned] : [];
  });

  await paginate(
    ctx,
    pagesOf(
      plain(question, 200),
      lines,
      3,
      [plain(MODEL), took, speed].filter(Boolean).join(" · "),
    ),
    null,
  );
}

export function registerAsk(): void {
  register({
    name: "ask",
    aliases: ["chatgpt", "ai", "gpt"],
    description: "Ask a question and get an answer from the model on this box",
    handler: ask,
  });
}
