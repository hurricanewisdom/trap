// Checks the numbers written in README.md and ARCHITECTURE.md against the live
// command registry.
//
//     npm run build && node --env-file=.env deploy/docaudit.mjs
//
// The env file is needed because loading the cogs reaches core/redis.ts, which
// asks for REDIS_PASSWORD at import time. Nothing here connects to it.
//
// It reads the numbers OUT of the docs rather than being told what to expect.
// A test that hard-codes the expected value passes while the docs are still
// wrong, which is how "240 subcommands" survived two audits: updating the test
// and updating the prose are separate acts, and only one of them happened.
//
// Each pattern is anchored to the phrasing that means the whole bot, so a
// group's own count ("35 commands in all" is the filter group) and a historical
// note ("killed 18 views at once") are not mistaken for a stale total.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = (file) => path.join(ROOT, "dist", file);

const { loadCogs } = await import(dist("core/cog.js"));
const { cogs } = await import(dist("cogs/index.js"));
const { allCommands } = await import(dist("core/prefix.js"));
const model = await import(dist("cogs/help/model.js"));
const render = await import(dist("cogs/help/render.js"));
const { EVENTS } = await import(dist("core/availability.js"));

const noop = () => {};
await loadCogs(cogs, {
  prefix: ",",
  version: { bot: "1", library: "21" },
  gateway: { latency: () => "1ms", shards: () => 1 },
  web: { get: noop, post: noop, route: noop },
  messages: { delete: async () => {} },
});

const readme = await fs.readFile(path.join(ROOT, "README.md"), "utf8");
const arch = await fs.readFile(path.join(ROOT, "ARCHITECTURE.md"), "utf8");
const docs = [
  ["README", readme],
  ["ARCHITECTURE", arch],
];

const all = allCommands();

let views = 2;
for (const cog of model.cogSummaries()) {
  views += 1 + render.pageCount({ kind: "all", cog: cog.name, page: 0 });
  for (const section of model.sectionsOf(cog.name)) {
    views += render.pageCount({ kind: "section", slug: section.category.slug, page: 0 });
  }
}
for (const entry of model.entries()) {
  views += model.hasSubcommands(entry)
    ? render.pageCount({ kind: "group", owner: model.pathOf(entry), page: 0 })
    : 1;
}

async function sourceFiles(dir = path.join(ROOT, "src")) {
  let found = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found += await sourceFiles(path.join(dir, entry.name));
    else if (entry.name.endsWith(".ts")) found += 1;
  }
  return found;
}

const totals = [
  ["commands", all.length, /(\d[\d,]*) commands across/g],
  ["subcommands", all.filter((command) => command.groupedUnder).length, /with (\d[\d,]*) subcommands/gi],
  ["views", views, /\*\*all (\d[\d,]*) views\*\*/g],
  ["source files", await sourceFiles(), /(\d[\d,]*) source files/g],
];

const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

let wrong = 0;
let checked = 0;

const say = (ok, line) => {
  if (!ok) wrong += 1;
  console.log((ok ? "  ok    " : "  WRONG ") + line);
};

for (const [noun, actual, pattern] of totals) {
  let seen = 0;
  for (const [name, body] of docs) {
    for (const hit of body.matchAll(pattern)) {
      checked += 1;
      seen += 1;
      const claimed = Number(String(hit[1]).replace(/,/g, ""));
      if (claimed === actual) {
        say(true, `${name.padEnd(14)}${claimed} ${noun}`);
      } else {
        const around = body.slice(Math.max(0, hit.index - 50), hit.index + 50).replace(/\n/g, " ");
        say(false, `${name}: ${claimed} ${noun}, actual ${actual}\n        ...${around.trim()}...`);
      }
    }
  }
  if (seen === 0) {
    checked += 1;
    say(false, `neither doc states a ${noun} total any more`);
  }
}

for (const [name, body] of docs) {
  for (const hit of body.matchAll(/across (one|two|three|four|five|six|seven|eight|nine|ten) cogs/g)) {
    checked += 1;
    say(hit[1] === WORDS[cogs.length - 1], `${name.padEnd(14)}across ${hit[1]} cogs`);
  }
}

console.log("\nevery event named in the README:");
for (const event of EVENTS) {
  checked += 1;
  if (!readme.includes(`\`${event.name}\``)) say(false, `${event.name} is never named`);
}
console.log(`  ${EVENTS.length} events checked`);

console.log("\nevery folder and core file in the layout:");
for (const dir of await fs.readdir(path.join(ROOT, "src/cogs"), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const sub of await fs.readdir(path.join(ROOT, "src/cogs", dir.name), { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    checked += 1;
    if (!arch.includes(`${sub.name}/`)) say(false, `${dir.name}/${sub.name} unlisted`);
  }
}
for (const area of ["core", "helpers"]) {
  for (const file of await fs.readdir(path.join(ROOT, "src", area))) {
    if (!file.endsWith(".ts")) continue;
    checked += 1;
    if (!arch.includes(file)) say(false, `${area}/${file} unlisted`);
  }
}
console.log("  done");

console.log(`\nchecked ${checked} | wrong ${wrong}`);
process.exit(wrong === 0 ? 0 : 1);
