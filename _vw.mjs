const { loadCogs } = await import("/root/trap/dist/core/cog.js");
const { cogs } = await import("/root/trap/dist/cogs/index.js");
const R = await import("/root/trap/dist/cogs/help/render.js");
const M = await import("/root/trap/dist/cogs/help/model.js");
const noop = () => {};
await loadCogs(cogs, { prefix: ",", version: { bot: "1", library: "21" },
  gateway: { latency: () => "1ms", shards: () => 1 }, web: { get: noop, post: noop, route: noop },
  messages: { delete: async () => {} } });

const OWNER = "1533576021834469549";
const views = [{ kind: "home" }, { kind: "cogs", page: 0 }];
for (const c of M.cogSummaries()) {
  views.push({ kind: "cog", cog: c.name, page: 0 });
  for (let p = 0; p < R.pageCount({ kind: "all", cog: c.name, page: 0 }); p++)
    views.push({ kind: "all", cog: c.name, page: p });
  for (const s of M.sectionsOf(c.name))
    for (let p = 0; p < R.pageCount({ kind: "section", slug: s.category.slug, page: 0 }); p++)
      views.push({ kind: "section", slug: s.category.slug, page: p });
}
for (const e of M.entries()) {
  if (M.hasSubcommands(e))
    for (let p = 0; p < R.pageCount({ kind: "group", owner: M.pathOf(e), page: 0 }); p++)
      views.push({ kind: "group", owner: M.pathOf(e), page: p });
  else views.push({ kind: "command", name: e.command.name });
}

const bad = [];
const flat = (ns, out = []) => { for (const c of ns ?? []) { out.push(c); flat(c.components, out); } return out; };
for (const v of views) {
  const label = R.encodeKey(v) + "#" + (v.page ?? 0);
  let r; try { r = R.renderView(v, OWNER, ","); } catch (e) { bad.push([label, "THREW " + e.message]); continue; }
  const all = flat(r.components);
  const ids = all.filter(c => c.custom_id).map(c => c.custom_id);
  const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dupIds.length) bad.push([label, "dup custom_id " + dupIds[0]]);
  for (const id of ids) if (id.length > 100) bad.push([label, "custom_id " + id.length + " chars"]);
  const chars = all.filter(c => c.type === 10).reduce((n, c) => n + c.content.length, 0);
  if (chars > 4000) bad.push([label, "text " + chars + " chars"]);
  for (const sel of all.filter(c => c.type === 3)) {
    const vals = sel.options.map(o => o.value);
    const dv = vals.filter((x, i) => vals.indexOf(x) !== i);
    if (dv.length) bad.push([label, "select " + sel.custom_id.split("|")[2] + " duplicate value " + JSON.stringify(dv[0]) + " (" + dv.length + " dupes)"]);
    if (sel.options.length > 25) bad.push([label, "select " + sel.options.length + " options"]);
    for (const o of sel.options) {
      if (o.value.length > 100) bad.push([label, "option value " + o.value.length]);
      if (!o.label.length) bad.push([label, "empty option label"]);
    }
  }
  const rows = r.components[0].components.filter(c => c.type === 1);
  if (rows.length > 5) bad.push([label, rows.length + " action rows"]);
}
console.log("views rendered:", views.length, "| broken:", new Set(bad.map(b => b[0])).size);
const seen = new Set();
for (const [l, why] of bad) { const k = l + "|" + why.split(" ").slice(0, 4).join(" "); if (seen.has(k)) continue; seen.add(k); console.log("  ", l.padEnd(34), why); }
process.exit(0);
