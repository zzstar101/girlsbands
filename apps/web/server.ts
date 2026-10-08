// Production web server: built client assets, the shared redirect table and SSR. Api-owned paths are
// proxied to the api process, so one port serves the whole site; a reverse proxy in front may also send
// them to the api directly.
import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler } from "react-router";
import { isApiOwned, resolveRedirect } from "@girlsbands/contracts/http-policy";
import { API_BASE_URL } from "./app/lib/api.server.ts";

const PORT = Number(process.env.WEB_PORT || 3000);
const HOST = process.env.WEB_HOST || "127.0.0.1";
const API = new URL(API_BASE_URL);
/** Only a trusted reverse proxy may supply the visitor address used for API rate limits. */
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const CLIENT_DIR = path.resolve(import.meta.dirname, "build/client");
/** Browsers keep a page at most this long, so a withdrawal reaches them within minutes. */
const BROWSER_MAX_SECONDS = 300;

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

// A file URL, not a path: on Windows import() reads "C:\\..." as a URL with the scheme "c:".
const build = await import(pathToFileURL(path.resolve(import.meta.dirname, "build/server/index.js")).href);
const ssr = createRequestHandler(build, "production");

class BadRequest extends Error {}

/** Hashed build assets are immutable; anything else from the client build gets a short cache. */
async function serveStatic(pathname: string, req: Request): Promise<Response | null> {
  if (pathname.includes("..") || pathname.endsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new BadRequest("malformed percent-encoding");
  }
  const file = path.join(CLIENT_DIR, decoded);
  if (!file.startsWith(CLIENT_DIR)) return null;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const immutable = pathname.startsWith("/assets/");
  const asset = Bun.file(file);
  // Bun applies Range to files (even file streams); the original server always returned the full file.
  const body = req.method === "HEAD" ? null : req.headers.has("Range") ? await asset.arrayBuffer() : asset;
  return new Response(body, { headers: {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": String(info.size),
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    // The asset host may be another origin; one answer for every caller needs no Vary.
    "Access-Control-Allow-Origin": "*",
  } });
}

/** Connection options belong to each transport, never to the next proxy hop. */
function proxyHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of (headers.get("connection") ?? "").split(",")) {
    if (name.trim()) headers.delete(name.trim());
  }
  for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) headers.delete(name);
  return headers;
}

/** The one writer of page cache headers, after all loaders and the final status are known. */
function pageCache(response: Response, publicRead: boolean): Response {
  const headers = new Headers(response.headers);
  const cc = headers.get("Cache-Control") ?? "";
  if (!publicRead || response.status !== 200 || headers.has("Set-Cookie") || !cc || /(?:private|no-store)/i.test(cc)) {
    headers.delete("Expires");
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Accel-Expires", "0");
  } else {
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const sharedSeconds = Number(cc.match(/(?:^|,)\s*s-maxage=(\d+)/i)?.[1] ?? 0);
    const expires = headers.get("X-Accel-Expires") ?? `@${nowSeconds + sharedSeconds}`;
    // A sibling loader may have delayed this response after the selected loader set its TTL.
    const seconds = /(?:^|,)\s*no-cache(?:,|$)/i.test(cc) || expires === "0" ? 0
      : Math.max(0, Math.min(sharedSeconds, Number(expires.slice(1)) - nowSeconds));
    headers.set("Date", now.toUTCString());
    headers.set("X-Accel-Expires", seconds > 0 ? expires : "0");
    // Browser prefetch reuse must never outlive the shared-cache deadline, even on an error.
    headers.set("Cache-Control", seconds > 0
      ? `public, max-age=${Math.min(seconds, BROWSER_MAX_SECONDS)}, s-maxage=${seconds}, must-revalidate`
      : "no-cache");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(req: Request, clientAddress: string): Promise<Response> {
  const url = new URL(req.url);
  const { pathname, search } = url;
  const decision = resolveRedirect(pathname, search);
  if (decision) {
    const headers = new Headers(decision.headers);
    if (decision.location) headers.set("Location", decision.location);
    return new Response(decision.location ? null : decision.status === 410 ? "Gone" : "Not found", { status: decision.status, headers });
  }

  if (isApiOwned(pathname)) {
    // Both headers carry only the trusted proxy's last entry, or this connection's address.
    const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const client = TRUST_PROXY && forwarded.length ? forwarded[forwarded.length - 1]! : clientAddress;
    const headers = proxyHeaders(req.headers);
    headers.set("x-forwarded-for", client);
    headers.set("x-real-ip", client);
    try {
      const upstream = await fetch(`${API.origin}${pathname}${search}`, {
        method: req.method, headers, body: req.body, redirect: "manual", signal: req.signal,
        // Keep the upstream bytes and Content-Encoding together rather than silently decompressing.
        decompress: false,
      });
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: proxyHeaders(upstream.headers) });
    } catch {
      return new Response("api unavailable", { status: 502 });
    }
  }

  if ((req.method === "GET" || req.method === "HEAD") && pathname.includes(".")) {
    const asset = await serveStatic(pathname, req);
    if (asset) return asset;
  }
  const pagePath = decodeURIComponent(pathname).replace(/\.data$/, "");
  const publicRead = (req.method === "GET" || req.method === "HEAD") && !/^\/admin(?:\/|$)/i.test(pagePath);
  // Public navigation returns all matched loaders, so `_routes` never changes a cached answer.
  if (publicRead && pathname.endsWith(".data")) {
    url.searchParams.delete("_routes");
    req = new Request(url, req);
  }
  return pageCache(await ssr(req), publicRead);
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 65,
  async fetch(req, server) {
    try {
      return await handle(req, server.requestIP(req)?.address ?? "");
    } catch (error) {
      const bad = error instanceof BadRequest || error instanceof URIError;
      if (!bad) console.error(JSON.stringify({ level: "error", msg: "web request failed", path: new URL(req.url).pathname.slice(0, 200), error: String(error).slice(0, 500) }));
      return new Response(bad ? "Bad request" : "Internal error", { status: bad ? 400 : 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
  },
});

process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ level: "error", msg: "unhandled rejection", error: String(reason).slice(0, 500) }));
});
console.log(JSON.stringify({ level: "info", msg: "web started", port: server.port, pid: process.pid }));
const shutdown = () => { void server.stop().then(() => process.exit(0)); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
