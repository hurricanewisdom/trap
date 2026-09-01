import { register, type PrefixContext } from "../../core/prefix.js";
import { plain } from "../../helpers/markdown.js";
import { card } from "./shared.js";

const READ_MS = 20_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36";

async function page(url: string): Promise<string | null> {
  try {
    const answer = await fetch(url, {
      signal: AbortSignal.timeout(READ_MS),
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
    });
    if (!answer.ok) return null;
    return await answer.text();
  } catch {
    return null;
  }
}

// Attribute order is not fixed: some of their pages write content before the
// property and some after, so both have to be tried. Matching only one way round
// silently returns nothing and every article ends up titled "wikiHow".
function meta(html: string, property: string): string | null {
  const after = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  ).exec(html);
  if (after?.[1]) return decode(after[1]);

  const before = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  ).exec(html);
  return before?.[1] ? decode(before[1]) : null;
}

function titleTag(html: string): string | null {
  const found = /<title[^>]*>([^<]+)</i.exec(html);
  return found?.[1] ? decode(found[1]).trim() : null;
}

function decode(said: string): string {
  return said
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// wikiHow titles *are* their urls: "Tie a Tie" lives at /Tie-a-Tie. That is the
// only route left, because every api.php action -- opensearch, query/search --
// now answers with their block page instead of json, and the search page itself
// comes back as a stub with no results in the html.
//
// Small words stay lowercase in their titles, which is why this is a list rather
// than a blanket capitalise.
const SMALL = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for",
  "with", "from", "by", "as", "into", "your", "when",
]);

function titleCandidates(query: string): string[] {
  const parts = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  const theirWay = parts
    .map((word, at) =>
      at > 0 && SMALL.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("-");

  // If the small-word rule guesses wrong, capitalising everything is the other
  // thing they do, so both are worth one request.
  const allCaps = parts.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("-");

  // "how to tie a tie" is what people type; the article is not called that.
  const withoutHowTo = parts[0] === "how" && parts[1] === "to" ? parts.slice(2) : null;

  const found = [theirWay, allCaps];
  if (withoutHowTo?.length) {
    found.unshift(
      withoutHowTo
        .map((word, at) =>
          at > 0 && SMALL.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join("-"),
    );
  }
  return [...new Set(found)];
}

const NOT_ARTICLE = /client challenge|just a moment|does not exist|page not found|access denied/i;

function isNotAnArticle(html: string): boolean {
  const name = meta(html, "og:title") ?? titleTag(html) ?? "";
  return NOT_ARTICLE.test(name) || name.trim() === "";
}

async function wikihow(ctx: PrefixContext): Promise<void> {
  const query = ctx.argument.trim();

  let article: string | null = null;
  let link = "";

  if (!query) {
    // No question is a request for something to read, which their randomiser
    // answers directly.
    link = "https://www.wikihow.com/Special:Randomizer";
    article = await page(link);
  } else {
    for (const candidate of titleCandidates(query)) {
      link = `https://www.wikihow.com/${candidate}`;
      article = await page(link);
      // A miss is not a 404 here. A title that does not exist serves a bot
      // challenge page with a 200, so the page has to be identified by what it
      // calls itself rather than by its status code.
      if (article && !isNotAnArticle(article)) break;
      article = null;
    }
  }

  if (!article) {
    await card(ctx, [
      `Nothing on wikiHow for **${plain(query)}**.`,
      "",
      "-# Their search API is gone, so this guesses the article from the words —",
      "-# try phrasing it the way the title would read, like `wikihow tie a tie`.",
    ]);
    return;
  }

  const title = (meta(article, "og:title") ?? titleTag(article) ?? "wikiHow").replace(
    /\s*-\s*wikiHow$/,
    "",
  );
  const description = meta(article, "og:description") ?? "";
  const image = meta(article, "og:image");

  await card(ctx, [
    `### ${plain(title)}`,
    ...(image ? [image] : []),
    ...(description ? [`-# ${plain(description.slice(0, 300))}`] : []),
    `-# ${meta(article, "og:url") ?? link}`,
  ]);
}

export function registerWikihow(): void {
  register({ name: "wikihow", description: "How to...?", handler: wikihow });
}
