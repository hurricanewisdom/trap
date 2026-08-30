/**
 * Rewriting the prefix syntax that is written all over the copy.
 *
 * Several hundred strings — help pages, error messages, catalog usage lines —
 * tell people to type `,lf link` or `,topartists`. That syntax no longer
 * exists: the bot is slash-only. Editing every one of those strings by hand
 * would be a large, error-prone sweep that the next new string could undo, so
 * the translation happens once, on the way out, where every reply passes.
 *
 * Deliberately conservative. Only a backtick-quoted run that actually looks
 * like a command invocation is touched, so a code sample or a template that
 * happens to contain a comma is left alone.
 */

/** Commands that keep a top-level slash command of their own. */
const TOP_LEVEL = new Map<string, string>([
  ["fm", "fm"],
  ["nowplaying", "fm"],
  ["np", "fm"],
  ["fmnp", "fm"],
  ["help", "help"],
  ["h", "help"],
  ["commands", "help"],
  ["cmds", "help"],
  ["ping", "ping"],
  ["botinfo", "botinfo"],
  ["about", "botinfo"],
  ["bi", "botinfo"],
]);

/**
 * `\`,name rest\`` — a backtick-quoted invocation. The name must be a bare
 * word, which keeps this away from prose and from the card templates.
 */
const INVOCATION = /`,([a-z][a-z0-9]*)((?:[^`\n]*)?)`/g;

/** Placeholders that named the person, and now belong in the user field. */
const USER_TOKEN = /^(\[member\|username\]|\[member\]|\[user\]|<user>|<member>|@user)$/i;

/** Placeholders that named a time range, and now belong in the period field. */
const PERIOD_TOKEN = /^(\[period\]|<period>)$/i;

/**
 * How an argument reads once it is a field rather than trailing text.
 *
 * The placeholders the old usage lines used are recognised so that
 * "[member] [period]" becomes two real fields rather than one query string
 * that no command would parse.
 */
function fields(rest: string): string {
  const trimmed = rest.trim();
  if (!trimmed) return "";

  const words = trimmed.split(/\s+/);
  const kept: string[] = [];
  let user = "";
  let period = "";

  for (const word of words) {
    if (!user && USER_TOKEN.test(word)) user = " user:<user>";
    else if (!period && PERIOD_TOKEN.test(word)) period = " period:<period>";
    else kept.push(word);
  }

  const query = kept.length > 0 ? ` query:${kept.join(" ")}` : "";
  return `${user}${query}${period}`;
}

/**
 * Rewrites prefix invocations in one string.
 *
 * `,lf link` becomes `/lastfm command:lastfm query:link`; `,fm` becomes `/fm`.
 */
export function slashify(text: string): string {
  return text.replace(INVOCATION, (whole, name: string, rest: string) => {
    const bare = TOP_LEVEL.get(name);
    if (bare) return `\`/${bare}${fields(rest)}\``;
    return `\`/lastfm command:${name}${fields(rest)}\``;
  });
}

/**
 * Applies `slashify` to every piece of text in a reply.
 *
 * Walks the component tree because Components V2 carries its copy in nested
 * `content` fields rather than in one body.
 */
export function slashifyPayload<T>(payload: T): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return slashify(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        // Only prose is rewritten. A url or a custom_id that happened to match
        // would be corrupted by it.
        out[key] = key === "content" || key === "label" || key === "description"
          ? walk(value)
          : key === "components" || key === "options" || key === "items"
            ? walk(value)
            : value;
      }
      return out;
    }
    return node;
  };
  return walk(payload) as T;
}
