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
  form?: Record<string, string>;
  timeoutMs?: number;
}

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
