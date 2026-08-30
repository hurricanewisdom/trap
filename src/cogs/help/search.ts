import { categoryOf, cogOf, entries, summaryOf, type Entry } from "./model.js";

export const SEARCH_LIMIT = 25;

const SCORE = {
  exactName: 1000,
  exactAlias: 900,
  namePrefix: 800,
  aliasPrefix: 700,
  nameContains: 600,
  groupExact: 550,
  summaryWord: 400,
  summaryContains: 250,
  groupContains: 200,
  subsequence: 120,
} as const;

export function normalise(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .replace(/^[,/]/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
}

function startsAWord(haystack: string, term: string): boolean {
  if (haystack.startsWith(term)) return true;
  return haystack.includes(` ${term}`);
}

function termScore(entry: Entry, term: string): number {
  const name = entry.command.name;
  const aliases = entry.command.aliases ?? [];

  if (name === term) return SCORE.exactName;
  if (aliases.includes(term)) return SCORE.exactAlias;
  if (name.startsWith(term)) return SCORE.namePrefix;
  if (aliases.some((alias) => alias.startsWith(term))) return SCORE.aliasPrefix;
  if (name.includes(term)) return SCORE.nameContains;

  const cog = cogOf(entry.cog)?.label.toLowerCase() ?? entry.cog;
  const section = categoryOf(entry.section)?.label.toLowerCase() ?? entry.section;
  if (cog === term || section === term) return SCORE.groupExact;

  const summary = summaryOf(entry).toLowerCase();
  if (startsAWord(summary, term)) return SCORE.summaryWord;
  if (summary.includes(term)) return SCORE.summaryContains;
  if (cog.includes(term) || section.includes(term)) return SCORE.groupContains;

  if (term.length >= 3 && isSubsequence(term, name)) return SCORE.subsequence;
  return 0;
}

function score(entry: Entry, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    const hit = termScore(entry, term);
    if (hit === 0) return 0;
    total += hit;
  }
  return total;
}

export function search(query: string, limit = SEARCH_LIMIT): Entry[] {
  const terms = normalise(query);
  if (terms.length === 0) return [];

  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of entries()) {
    const value = score(entry, terms);
    if (value > 0) scored.push({ entry, score: value });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.command.name.length - b.entry.command.name.length ||
      a.entry.command.name.localeCompare(b.entry.command.name),
  );

  return scored.slice(0, limit).map((hit) => hit.entry);
}

export function searchCount(query: string): number {
  const terms = normalise(query);
  if (terms.length === 0) return 0;
  return entries().reduce((total, entry) => total + (score(entry, terms) > 0 ? 1 : 0), 0);
}

export function suggest(query: string, limit = SEARCH_LIMIT): Entry[] {
  const terms = normalise(query);
  if (terms.length === 0) return entries().slice(0, limit);
  return search(query, limit);
}
