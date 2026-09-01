import { paginate } from "../../core/pager.js";
import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card } from "./shared.js";
import { pagesOf } from "./pages.js";

// A Piston of our own, on loopback. The public one at emkc.org became whitelist
// only in February 2026, and this runs somebody else's code, so it must not be
// reachable from outside the box either way.
const PISTON = process.env.PISTON_URL ?? "http://127.0.0.1:2000/api/v2";

const READ_MS = 45_000;

const MOST_CODE = 8_000;

const MOST_OUTPUT = 1_800;

interface Runtime {
  language: string;
  version: string;
  aliases?: string[];
}

// Piston registers javascript with aliases node-js and node-javascript, but not
// plain `node` or `js`, which are the two things people actually type.
const SYNONYMS: Record<string, string> = {
  node: "javascript",
  js: "javascript",
  nodejs: "javascript",
  python2: "python",
  golang: "go",
  "c#": "csharp",
};

let runtimes: Runtime[] = [];
let fetchedAt = 0;

const RUNTIME_TTL = 300_000;

// The language somebody types is rarely the language Piston registered. `node`
// is `javascript`, `py` is `python`, `cpp` is `c++`. The alias table is the
// answer and it comes from the server rather than a guess kept here.
async function runtimeFor(said: string): Promise<Runtime | null> {
  if (runtimes.length === 0 || Date.now() - fetchedAt > RUNTIME_TTL) {
    try {
      const answer = await fetch(`${PISTON}/runtimes`, { signal: AbortSignal.timeout(READ_MS) });
      if (answer.ok) {
        runtimes = (await answer.json()) as Runtime[];
        fetchedAt = Date.now();
      }
    } catch {
      // Keep whatever is cached; an empty list would refuse every language.
    }
  }

  const wanted = SYNONYMS[said.toLowerCase()] ?? said.toLowerCase();
  return (
    runtimes.find((one) => one.language.toLowerCase() === wanted) ??
    runtimes.find((one) => (one.aliases ?? []).some((alias) => alias.toLowerCase() === wanted)) ??
    null
  );
}

// ```py\ncode\n``` is how people paste code, and a bare `,run py print(1)` is
// how they paste one line. Both have to work.
const FENCED = /^\s*```(\w+)?\s*\n([\s\S]*?)```\s*$/;

function readCode(argument: string): { language: string; code: string } | null {
  const fenced = FENCED.exec(argument);
  if (fenced) {
    const language = fenced[1] ?? "";
    const code = fenced[2] ?? "";
    if (!language) return null;
    return { language, code };
  }

  const at = argument.search(/\s/);
  if (at < 1) return null;
  return { language: argument.slice(0, at).trim(), code: argument.slice(at + 1) };
}

interface Outcome {
  run?: { stdout?: string; stderr?: string; code?: number | null; signal?: string | null; message?: string | null; cpu_time?: number; wall_time?: number };
  compile?: { stdout?: string; stderr?: string; code?: number | null };
  message?: string;
}

async function run(ctx: PrefixContext): Promise<void> {
  const said = ctx.argument.trim();
  if (!said) {
    await card(ctx, [
      "### Run code",
      "-# ```` ,run ```py ````",
      "-# ```` print(6 * 7) ````",
      "-# ```` ``` ````",
      "",
      "-# Or on one line: `run py print(6*7)`",
      "-# `run languages` lists what is installed.",
    ]);
    return;
  }

  if (/^languages?$/i.test(said)) {
    await runtimeFor("python");
    const lines = [...runtimes]
      .sort((a, b) => a.language.localeCompare(b.language))
      .map(
        (one) =>
          `\`${plain(one.language)}\` ${one.version}` +
          ((one.aliases ?? []).length ? ` · ${(one.aliases ?? []).map((a) => `\`${plain(a)}\``).join(" ")}` : ""),
      );
    await paginate(ctx, pagesOf(`${runtimes.length} languages`, lines, 10), null);
    return;
  }

  const parsed = readCode(said);
  if (!parsed || !parsed.code.trim()) {
    await card(ctx, ["Which language, and what code?", "", "-# `run py print(6*7)` · `run languages`"]);
    return;
  }
  if (parsed.code.length > MOST_CODE) {
    await card(ctx, [`That is over ${MOST_CODE} characters.`]);
    return;
  }

  const runtime = await runtimeFor(parsed.language);
  if (!runtime) {
    await card(ctx, [
      `\`${plain(parsed.language.slice(0, 20))}\` is not installed.`,
      "",
      "-# `run languages` lists what is.",
    ]);
    return;
  }

  let outcome: Outcome | null = null;
  try {
    const answer = await fetch(`${PISTON}/execute`, {
      method: "POST",
      signal: AbortSignal.timeout(READ_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ content: parsed.code }],
        // These must not exceed the server's own configured ceiling, or Piston
        // refuses the whole request rather than clamping -- which reads as the
        // runner being down. The container is configured to allow these.
        run_timeout: 8_000,
        compile_timeout: 15_000,
      }),
    });
    outcome = (await answer.json()) as Outcome;
  } catch {
    outcome = null;
  }

  if (!outcome || (!outcome.run && !outcome.compile)) {
    await card(ctx, [
      "The runner did not answer.",
      ...(outcome?.message ? ["", `-# ${plain(String(outcome.message).slice(0, 160))}`] : []),
    ]);
    return;
  }

  const compileFailed = outcome.compile && outcome.compile.code !== 0;
  const stage = compileFailed ? outcome.compile : outcome.run;
  const printed = `${stage?.stdout ?? ""}${stage?.stderr ?? ""}`
    // Carriage returns and stray NULs both survive a program's output and
    // both break a code block when it is posted back.
    .replace(/\r/g, "")
    .replace(/\u0000/g, "");
  const trimmed = printed.slice(0, MOST_OUTPUT);

  // A killed run prints nothing, so the reason has to come from the message.
  const note =
    outcome.run?.signal === "SIGKILL"
      ? outcome.run.message ?? "killed"
      : compileFailed
        ? "did not compile"
        : null;

  await card(ctx, [
    `### ${plain(runtime.language)} ${plain(runtime.version)}`,
    printed.trim()
      ? // Inside a fence, markdown is not interpreted, so escaping it would only
        // put backslashes through somebody's program output. The one thing that
        // matters is that the output cannot end the fence early.
        "```\n" + trimmed.replace(/`/g, "ˋ") + (printed.length > MOST_OUTPUT ? "\n… cut" : "") + "\n```"
      : "-# no output",
    ...(note ? [`-# ${plain(String(note))}`] : []),
    `-# exit ${stage?.code ?? "?"}` +
      (outcome.run?.cpu_time !== undefined ? ` · ${outcome.run.cpu_time}ms cpu` : ""),
  ]);
}

export function registerRun(): void {
  register({ name: "run", aliases: ["exec", "eval"], description: "Run code in a containerized environment", handler: run });
}
