import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Whether a hostname resolves anywhere this box should not be asked to fetch.
 *
 * This box runs a database, a web server and a metrics endpoint on private
 * addresses, and several commands fetch whatever address they are handed. A
 * name that will not resolve is treated as private too: failing closed is the
 * only safe direction for a check like this.
 */
export async function reachesPrivate(host: string): Promise<boolean> {
  let found: { address: string }[];
  try {
    found = await dnsLookup(host, { all: true });
  } catch {
    return true;
  }
  return found.some(({ address }) => {
    if (address.includes(":")) {
      const low = address.toLowerCase();
      return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
    }
    const parts = address.split(".").map(Number);
    const [a, b] = parts as [number, number];
    return (
      a === 127 || a === 0 || a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  });
}

/**
 * A parsed http(s) url, or null. Anything handed to a downloader or a browser
 * goes through here first.
 */
export async function publicUrl(said: string): Promise<URL | null> {
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(said) ? said : `https://${said}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (await reachesPrivate(parsed.hostname)) return null;
  return parsed;
}
