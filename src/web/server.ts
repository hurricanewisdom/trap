/**
 * The bot's small HTTP surface.
 *
 * Cogs register their own routes, so this file knows nothing about any
 * feature. nginx terminates TLS for the public hostname and proxies here.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { optional, optionalInt } from "../core/env.js";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Capture groups from the route pattern. */
  params: string[];
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

export interface WebRouter {
  get: (pattern: RegExp, handler: RouteHandler) => void;
}

const routes: Route[] = [];

export const router: WebRouter = {
  get(pattern, handler) {
    routes.push({ method: "GET", pattern, handler });
  },
};

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

/** A self-contained status page — no external requests, renders in any theme. */
export function page(title: string, message: string, ok: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Trap</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0b0c; color:#e7e7ea;
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif }
  .card { max-width:28rem; padding:2rem; border:1px solid #24242a; border-radius:14px;
          background:#141417; text-align:center }
  .mark { width:44px; height:44px; border-radius:50%; display:grid; place-items:center;
          margin:0 auto 1rem; font-size:22px;
          background:${ok ? "#1d3a24" : "#3a1d1d"}; color:${ok ? "#7ee08a" : "#e08a7e"} }
  h1 { margin:0 0 .5rem; font-size:1.25rem }
  p  { margin:0; color:#a1a1aa }
</style></head>
<body><div class="card">
  <div class="mark">${ok ? "&#10003;" : "!"}</div>
  <h1>${title}</h1><p>${message}</p>
</div></body></html>`;
}

export function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(html);
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  for (const entry of routes) {
    if (entry.method !== req.method) continue;
    const match = entry.pattern.exec(url.pathname);
    if (!match) continue;
    await entry.handler({ req, res, url, params: match.slice(1).map((v) => v ?? "") });
    return;
  }

  send(res, 404, page("Not found", "Nothing lives at this address.", false));
}

export function startWebServer(): void {
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    route(req, res).catch((err) => {
      console.error("web:", err);
      if (!res.headersSent) send(res, 500, page("Error", "Something went wrong.", false));
    });
  };

  const port = optionalInt("HTTP_PORT", 8730);
  /**
   * Loopback for local checks, plus the docker bridge so the nginx container
   * can reach us. Deliberately never 0.0.0.0 — this host accepts all inbound
   * TCP, so a wildcard bind would publish these routes to the internet.
   */
  const binds = optional("HTTP_BIND", "127.0.0.1,172.17.0.1")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  for (const address of binds) listenWithRetry(handler, address, port);
}

/**
 * The docker bridge only exists once docker is up, so a boot-time race can
 * make that address briefly unavailable. Retry rather than dying: the bot
 * itself does not depend on this listener.
 */
function listenWithRetry(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  address: string,
  port: number,
  attempt = 1,
): void {
  const server = createServer(handler);

  server.once("error", (err: NodeJS.ErrnoException) => {
    const retriable = err.code === "EADDRNOTAVAIL" || err.code === "EADDRINUSE";
    if (retriable && attempt <= 12) {
      console.warn(`web: ${address}:${port} ${err.code}, retry ${attempt} in 10s`);
      setTimeout(() => listenWithRetry(handler, address, port, attempt + 1), 10_000).unref();
      return;
    }
    console.error(`web: giving up on ${address}:${port}: ${err.message}`);
  });

  server.listen(port, address, () => console.log(`web: listening on ${address}:${port}`));
}
