/**
 * The Last.fm transport: signing, calling, and the auth handshake.
 *
 * Signed calls need an md5 of every parameter sorted by name, concatenated as
 * name+value with no separators, followed by the shared secret. Getting the
 * ordering or the secret placement wrong yields a generic "Invalid method
 * signature" with no hint as to which, so the signing lives in one place.
 */

import { createHash } from "node:crypto";
import { optional, required } from "../../../core/env.js";

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const AUTH_ROOT = "https://www.last.fm/api/auth/";

export const apiKey = () => required("LASTFM_API_KEY");
export const apiSecret = () => required("LASTFM_API_SECRET");

/** Public base of the callback, e.g. https://trap.rocks */
export const callbackBase = () => optional("LASTFM_CALLBACK_BASE", "https://trap.rocks");

/** md5(sorted name+value pairs ... + secret) — Last.fm's api_sig. */
export function signature(params: Record<string, string>, secret = apiSecret()): string {
  const joined = Object.keys(params)
    .sort()
    .map((name) => `${name}${params[name]}`)
    .join("");
  return createHash("md5").update(joined + secret, "utf8").digest("hex");
}

/** The URL a user visits to authorise the bot against their account. */
export function authorizeUrl(state: string): string {
  const cb = `${callbackBase().replace(/\/+$/, "")}/lastfm/callback/${state}`;
  return `${AUTH_ROOT}?api_key=${encodeURIComponent(apiKey())}&cb=${encodeURIComponent(cb)}`;
}

export class LastfmError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "LastfmError";
  }
}

interface CallOptions {
  signed?: boolean;
  method?: "GET" | "POST";
  timeoutMs?: number;
}

/** Calls an API method and returns the parsed JSON, raising on Last.fm errors. */
export async function call<T>(
  apiMethod: string,
  params: Record<string, string> = {},
  { signed = false, method = "GET", timeoutMs = 10_000 }: CallOptions = {},
): Promise<T> {
  const merged: Record<string, string> = {
    ...params,
    method: apiMethod,
    api_key: apiKey(),
  };

  // The signature is computed before `format` is added — it is not signed.
  if (signed) merged.api_sig = signature(merged);
  merged.format = "json";

  const body = new URLSearchParams(merged);
  const url = method === "GET" ? `${API_ROOT}?${body}` : API_ROOT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body: method === "POST" ? body : undefined,
      headers: { "User-Agent": "trap-bot/1.x (+https://trap.rocks)" },
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LastfmError(`Last.fm returned non-JSON (HTTP ${res.status})`);
    }

    const err = parsed as { error?: number; message?: string };
    if (err.error) throw new LastfmError(err.message ?? "Last.fm error", err.error);
    if (!res.ok) throw new LastfmError(`Last.fm HTTP ${res.status}`);

    return parsed as T;
  } catch (err) {
    if (err instanceof LastfmError) throw err;
    if ((err as Error).name === "AbortError") throw new LastfmError("Last.fm timed out");
    throw new LastfmError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export interface Session {
  name: string;
  key: string;
}

/** Exchanges the one-time token from the callback for a lasting session. */
export async function getSession(token: string): Promise<Session> {
  const data = await call<{ session?: Session }>("auth.getSession", { token }, { signed: true });
  if (!data.session?.name || !data.session.key) {
    throw new LastfmError("Last.fm did not return a session");
  }
  return { name: data.session.name, key: data.session.key };
}
