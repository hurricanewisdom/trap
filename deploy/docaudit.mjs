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
const { CATEGORIES, DOCS } = await import(dist("cogs/help/catalog.js"));

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

// Two catalog entries sharing a slug put the same value in a select menu twice,
// and Discord refuses the whole message -- so the section menu on both cogs stops
// working. Counting views never caught it because nothing was rendered.
function duplicateSlugs() {
  const seen = new Map();
  for (const category of CATEGORIES) {
    seen.set(category.slug, (seen.get(category.slug) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([slug]) => slug);
}

function optionsIn(node, found = []) {
  for (const one of node ?? []) {
    if (Array.isArray(one.options)) found.push(one.options.map((option) => option.value));
    if (one.components) optionsIn(one.components, found);
  }
  return found;
}

// Every menu on every view, checked for the thing Discord rejects.
async function menusWithRepeats() {
  const broken = [];
  const views = [{ kind: "home" }, { kind: "cogs", page: 0 }];
  for (const cog of model.cogSummaries()) {
    views.push({ kind: "cog", cog: cog.name, page: 0 });
    views.push({ kind: "all", cog: cog.name, page: 0 });
    for (const section of model.sectionsOf(cog.name)) {
      views.push({ kind: "section", slug: section.category.slug, page: 0 });
    }
  }

  for (const view of views) {
    let rendered;
    try {
      rendered = await render.renderView(view, "1", ",");
    } catch (err) {
      broken.push(`${view.kind} ${view.cog ?? view.slug ?? ""} threw: ${err.message}`);
      continue;
    }
    for (const values of optionsIn(rendered?.components)) {
      const seen = new Set();
      const repeats = [...new Set(values.filter((one) => seen.has(one) || (seen.add(one), false)))];
      if (repeats.length) {
        broken.push(`${view.kind} ${view.cog ?? view.slug ?? ""} repeats ${repeats.join(", ")}`);
      }
    }
  }
  return broken;
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

console.log("\nevery event, named in the README and nowhere else:");
{
  for (const event of EVENTS) {
    checked += 1;
    if (!readme.includes(`\`${event.name}\``)) say(false, `${event.name} is never named`);
  }

  // And the other way round. Checking only that every real event is documented
  // lets a removed one linger in the prose forever: taking the reposter out left
  // it listed as an event and nothing noticed.
  const known = new Set(EVENTS.map((event) => event.name));
  const listed = /\*\*An event is something the bot does that nobody typed\*\*:([^.]+)\./s.exec(readme);
  checked += 1;
  if (!listed) {
    say(false, "the README no longer lists the events");
  } else {
    const named = [...listed[1].matchAll(/`(\w+)`/g)].map((hit) => hit[1]);
    const gone = named.filter((name) => !known.has(name));
    if (gone.length) say(false, `README lists events that no longer exist: ${gone.join(", ")}`);
  }
}
console.log(`  ${EVENTS.length} events checked, both directions`);

console.log("\nevery permission gate named in ARCHITECTURE:");
{
  const source = await fs.readFile(path.join(ROOT, "src/core/permissions.ts"), "utf8");
  const gates = [...source.matchAll(/export async function (require\w+)/g)].map((hit) => hit[1]);
  for (const gate of gates) {
    checked += 1;
    if (!arch.includes(gate)) say(false, gate + " is not mentioned");
  }
  console.log("  " + gates.length + " gates checked");
}

// Each cog's README section states its own size, and those numbers drift every
// time a cog gains a command -- three of them were wrong at once before this
// check existed. The totals above never caught it: they count the whole bot.
// The env table drifts every time a command gains a knob, and the sentence under
// it is the sort nobody re-counts. Thirteen were missing before this existed.
// plain() and label() cut at 180 characters. Slicing to anything longer before
// calling one of them does nothing, and the cut is invisible at the call site --
// which is how a suggestion body asking for 1800 characters arrived at 180, and
// how an Urban Dictionary definition ended mid-sentence. Nineteen call sites had
// it before anything looked.
console.log("\nno call site asks for more than the escapers give:");
{
  const CAP = 180;
  const inner = /(?:plain|label)\(\s*([^()]*?)\.slice\(0,\s*(\d+)\s*\)\s*\)/g;
  const outer = /(?:plain|label)\([^;]*?\)\s*\.slice\(0,\s*(\d+)\s*\)/g;

  const walk = async (dir) => {
    const found = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(full)));
      else if (entry.name.endsWith(".ts")) found.push(full);
    }
    return found;
  };

  const offenders = [];
  for (const file of await walk(path.join(ROOT, "src"))) {
    const body = await fs.readFile(file, "utf8");
    const where = path.relative(ROOT, file).replace(/\\/g, "/");
    for (const hit of body.matchAll(inner)) {
      if (Number(hit[2]) > CAP) offenders.push(`${where} asks for ${hit[2]}`);
    }
    for (const hit of body.matchAll(outer)) {
      if (Number(hit[1]) > CAP) offenders.push(`${where} slices to ${hit[1]} after escaping`);
    }
  }

  checked += 1;
  if (offenders.length) {
    say(false, `truncated silently: ${offenders.slice(0, 5).join("; ")}`);
  }
  console.log(`  every plain() and label() call checked`);
}

console.log("\nevery setting in .env.example is documented:");
{
  const example = await fs.readFile(path.join(ROOT, ".env.example"), "utf8");
  const names = [...example.matchAll(/^([A-Z][A-Z_0-9]*)=/gm)].map((hit) => hit[1]);

  checked += 1;
  const claimed = /`\.env\.example` carries all \*\*(\d+)\*\*/.exec(readme);
  if (!claimed) say(false, "the README no longer says how many settings there are");
  else if (Number(claimed[1]) !== names.length) {
    say(false, `README says ${claimed[1]} settings, .env.example has ${names.length}`);
  }

  // And each one has to appear in the table, or it is undocumented in practice.
  const missing = names.filter((name) => !readme.includes(`\`${name}\``));
  checked += 1;
  if (missing.length) say(false, `not in the README table: ${missing.join(", ")}`);
  console.log(`  ${names.length} settings checked`);
}

console.log("\nevery cog's own count, as its section states it:");
{
  const claims = [
    ["moderation", /\*\*(\d+) commands\*\* across punishments/],
    ["lastfm", /one of the (\d+) Last\.fm commands/],
  ];

  for (const [cog, pattern] of claims) {
    checked += 1;
    const actual = all.filter((command) => (command.cog ?? "") === cog).length;
    const found = pattern.exec(readme);
    if (!found) say(false, `README does not state ${cog}'s count`);
    else if (Number(found[1]) !== actual) {
      say(false, `README says ${cog} has ${found[1]}, actual ${actual}`);
    }
  }

  // The antiraid is a group inside a cog, like the antinuke below it.
  checked += 1;
  const antiraid = all.filter(
    (command) => command.name === "antiraid" || (command.groupedUnder ?? "").startsWith("antiraid"),
  ).length;
  const claim = /\*\*(\d+) commands\*\* watching the door/.exec(readme);
  if (!claim) say(false, "README does not state the antiraid's count");
  else if (Number(claim[1]) !== antiraid) {
    say(false, `README says antiraid has ${claim[1]}, actual ${antiraid}`);
  }

  // The antinuke is a group inside a cog rather than a cog of its own.
  checked += 1;
  const antinuke = all.filter(
    (command) => command.name === "antinuke" || (command.groupedUnder ?? "").startsWith("antinuke"),
  ).length;
  const said = /\*\*(\d+) commands\*\* watching for a server/.exec(readme);
  if (!said) say(false, "README does not state the antinuke's count");
  else if (Number(said[1]) !== antinuke) {
    say(false, `README says antinuke has ${said[1]}, actual ${antinuke}`);
  }
  console.log("  4 cog counts checked");
}

console.log("\nevery help section slug is its own:");
{
  const repeats = duplicateSlugs();
  checked += 1;
  if (repeats.length) say(false, `catalog slug used twice: ${repeats.join(", ")}`);
  else console.log(`  ${CATEGORIES.length} slugs checked`);
}

console.log("\nevery doc entry still has a command, and every category an entry:");
{
  const live = new Set();
  for (const command of all) {
    live.add(command.name);
    for (const alias of command.aliases ?? []) live.add(alias);
  }

  // A doc whose command was renamed does not go quiet: `documented()` matches
  // docs to commands by name, so the orphan attaches itself to whatever else
  // answers to that name. Renaming `filter` to `automod` handed the word
  // filter's documentation to `,boosterrole filter`.
  for (const doc of DOCS) {
    checked += 1;
    if (!live.has(doc.name)) say(false, `catalog documents \`${doc.name}\`, which no command answers to`);
  }

  const filed = new Set(model.entries().map((entry) => entry.section));
  for (const category of CATEGORIES) {
    checked += 1;
    if (!filed.has(category.slug)) say(false, `catalog section "${category.label}" has nothing in it`);
  }
  console.log(`  ${DOCS.length} docs and ${CATEGORIES.length} sections checked`);
}

console.log("\nevery select menu on every help view:");
{
  const broken = await menusWithRepeats();
  checked += 1;
  for (const one of broken) say(false, one);
  if (!broken.length) console.log("  rendered, no repeated option values");
}

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
