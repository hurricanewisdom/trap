/**
 * The bits of `fetch` every outbound call in this bot repeats.
 *
 * Each integration talks to somebody else's server, so each one needs a
 * timeout, a user agent and a JSON parse that fails with something readable.
 * Doing that per call site is how one forgotten `signal` turns a slow third
 * party into a hung command, so it is done once here.
 */

/** Raised for any non-2xx response, carrying the status for callers that care. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body = "",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Raised when a request runs past its deadline. */
export class TimeoutError extends Error {
  constructor(readonly url: string) {
    super("the request timed out");
    this.name = "TimeoutError";
  }
}

export const USER_AGENT = "trap-bot/1.x (+https://trap.rocks)";

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Sent form-encoded; sets the content type. */
  form?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Performs one request and returns the raw response plus its body text.
 *
 * The body is read here rather than handed back as a stream: it has to be
 * consumed to report a useful error, and reading it twice is not allowed.
 */
export async function request(
  url: string,
  { method = "GET", headers = {}, form, timeoutMs = 10_000 }: RequestOptions = {},
): Promise<{ status: number; headers: Headers; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "User-Agent": USER_AGENT,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...headers,
      },
      body: form ? new URLSearchParams(form) : undefined,
      signal: controller.signal,
    });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new TimeoutError(url);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Requests a URL and parses the body as JSON, raising on any non-2xx. */
export async function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { status, text } = await request(url, options);
  if (status < 200 || status >= 300) {
    throw new HttpError(`HTTP ${status}`, status, text.slice(0, 400));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`expected JSON, got ${text.slice(0, 60)}`, status, text.slice(0, 400));
  }
}
