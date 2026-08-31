import { lookup } from "node:dns/promises";

// Discord's own ceiling for a member avatar is higher, but nothing sensible is
// this big and the bytes have to be held in memory to be encoded.
const MOST_BYTES = 8 * 1024 * 1024;

const FETCH_MS = 15_000;

const KINDS = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

export type Fetched = { uri: string } | { error: string };

// The bot fetches whatever address it is handed, from a box that also runs a
// database and a web server on private addresses. Without this, "set my avatar to
// http://127.0.0.1:8730/..." turns the bot into a way to read them.
async function reachesPrivate(host: string): Promise<boolean> {
  let found: { address: string }[];
  try {
    found = await lookup(host, { all: true });
  } catch {
    return true;
  }

  return found.some(({ address }) => {
    if (address.includes(":")) {
      const low = address.toLowerCase();
      return (
        low === "::1" ||
        low.startsWith("fc") ||
        low.startsWith("fd") ||
        low.startsWith("fe80") ||
        low.startsWith("::ffff:127.") ||
        low.startsWith("::ffff:10.") ||
        low.startsWith("::ffff:192.168.")
      );
    }

    const parts = address.split(".").map(Number);
    const [a, b] = parts as [number, number];
    return (
      a === 127 ||
      a === 0 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  });
}

export async function asDataUri(link: string): Promise<Fetched> {
  let parsed: URL;
  try {
    parsed = new URL(link.trim());
  } catch {
    return { error: "That is not a link." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http and https links work." };
  }
  if (await reachesPrivate(parsed.hostname)) {
    return { error: "That address is not reachable from here." };
  }

  let answer: Response;
  try {
    answer = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_MS),
      // A redirect could land somewhere the check above already rejected, and
      // re-checking each hop is more machinery than a direct image link needs.
      redirect: "error",
      headers: { "user-agent": "Mozilla/5.0 (compatible; Trap/1.0)" },
    });
  } catch {
    return { error: "That link could not be fetched. A direct image link works best." };
  }
  if (!answer.ok) return { error: `That link answered ${answer.status}.` };

  const kind = (answer.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!KINDS.has(kind)) return { error: `That is ${kind || "not an image"}, not a png, jpg, gif or webp.` };

  const raw = new Uint8Array(await answer.arrayBuffer());
  if (raw.length === 0) return { error: "That image is empty." };
  if (raw.length > MOST_BYTES) {
    return { error: `That image is ${Math.round(raw.length / (1024 * 1024))}MB; 8MB is the limit.` };
  }

  const settled = kind === "image/jpg" ? "image/jpeg" : kind;
  return { uri: `data:${settled};base64,${Buffer.from(raw).toString("base64")}` };
}
