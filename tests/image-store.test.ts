// The image cache can live in an S3-compatible object store (production R2): one object per
// rendition, the type as its Content-Type, the prepared marker as a sibling object. With
// IMAGE_STORE_* unset the cache stays on disk (tests/media-performance.test.ts covers that path).
import "./setup.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import sharp from "sharp";

const dir = await mkdtemp(path.join(tmpdir(), "girlsbands-image-store-test-"));
process.env.GIRLSBANDS_DATA_DIR = dir;
process.env.ALLOW_PRIVATE_NETWORK_FETCH = "true";
process.env.MODEL_CALLS_ENABLED = "false";

// A local stand-in for the object store: objects keyed by the request path, remembering the
// Content-Type they were written with. While `failing` is set it answers like a store outage.
const objects = new Map<string, { body: Buffer; type: string }>();
const requests: Array<{ method: string; path: string; authorization: string }> = [];
let failing = false;
const store = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const key = new URL(req.url!, "http://127.0.0.1").pathname.replace(/^\//, "");
    requests.push({ method: req.method!, path: `/${key}`, authorization: req.headers.authorization ?? "" });
    if (req.method === "PUT") {
      objects.set(key, { body: Buffer.concat(chunks), type: req.headers["content-type"] ?? "" });
      return void res.writeHead(200).end();
    }
    if (failing) return void res.writeHead(500, { "content-type": "application/xml" }).end("<Error><Code>InternalError</Code></Error>");
    const object = objects.get(key);
    if (!object) return void res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>");
    if (req.method === "HEAD") return void res.writeHead(200, { "content-type": object.type }).end();
    res.writeHead(200, { "content-type": object.type }).end(object.body);
  });
});
await new Promise<void>((resolve) => store.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(store.address() as { port: number }).port}`;

// The upstream image the cache would fetch; the object store stands between it and the cache.
const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#176b75" } }).png().toBuffer();
let upstreamHits = 0;
let upstreamDown = false;
const upstream = createServer((req, res) => {
  upstreamHits++;
  if (upstreamDown) return void res.writeHead(502).end("bad gateway");
  if (req.url === "/blocked.png") return void res.writeHead(200, { "content-type": "text/html" }).end("<html>are you a robot?</html>");
  res.writeHead(200, { "content-type": "image/png" }).end(png);
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;

Object.assign(process.env, {
  IMAGE_STORE_ACCESS_KEY_ID: "test-image-key", IMAGE_STORE_SECRET_ACCESS_KEY: "test-image-secret",
  IMAGE_STORE_BUCKET: "images", IMAGE_STORE_ENDPOINT: base, IMAGE_STORE_REGION: "auto",
});
const { putObject, getObject, headObject } = await import("@girlsbands/backend/lib/s3");
const { produceImage, convertAnimated, keepOriginal } = await import("@girlsbands/backend/media/images");
const { prepareAvatars } = await import("@girlsbands/backend/media/prepare");
const target = { endpoint: base, bucket: "images", region: "auto", accessKey: "test-image-key", secretKey: "test-image-secret" };
const objectKey = (key: string) => `images/imgcache/${key.slice(0, 2)}/${key}`;
const cacheKey = (url: string, mode: string) => createHash("sha256").update(`${mode}|${url}`).digest("hex");

after(async () => {
  store.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([new Promise<void>((resolve) => store.close(() => resolve())), new Promise<void>((resolve) => upstream.close(() => resolve()))]);
  for (const key of Object.keys(process.env)) if (key.startsWith("IMAGE_STORE_")) delete process.env[key];
  await rm(dir, { recursive: true, force: true });
});

test("objects round-trip through the S3 helpers and a 404 is a miss", async () => {
  await putObject(target, "imgcache/ab/one", Buffer.from("first-bytes"), "image/webp");
  assert.deepEqual(await getObject(target, "imgcache/ab/one"), { body: Buffer.from("first-bytes"), type: "image/webp" });
  assert.equal(await getObject(target, "imgcache/ab/missing"), null);
  assert.equal(await headObject(target, "imgcache/ab/one"), true);
  assert.equal(await headObject(target, "imgcache/ab/missing"), false);
  // Path-style requests against the endpoint, each signed with the configured region.
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), ["PUT /images/imgcache/ab/one", "GET /images/imgcache/ab/one", "GET /images/imgcache/ab/missing", "HEAD /images/imgcache/ab/one", "HEAD /images/imgcache/ab/missing"]);
  for (const r of requests) assert.match(r.authorization, /^AWS4-HMAC-SHA256 Credential=test-image-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*x-amz-date, Signature=[0-9a-f]{64}$/);
});

test("a cached rendition is read from the object store without touching the upstream", async () => {
  const url = `${origin}/cached.png`;
  objects.set(objectKey(cacheKey(url, "thumb")), { body: Buffer.from("cached-rendition"), type: "image/webp" });
  assert.deepEqual(await produceImage(url, "thumb"), { body: Buffer.from("cached-rendition"), type: "image/webp" });
  assert.equal(upstreamHits, 0);
});

test("a new rendition is written to the object store, not the data directory", async () => {
  const url = `${origin}/fresh.png`;
  const image = await produceImage(url, "thumb");
  assert.equal(image.type, "image/webp");
  assert.equal(upstreamHits, 1);
  assert.deepEqual(objects.get(objectKey(cacheKey(url, "thumb"))), { body: image.body, type: "image/webp" });
  await assert.rejects(readdir(path.join(dir, "imgcache")), /ENOENT/);
});

test("an object store error is an error, never a silent fall back to the disk", async () => {
  const hits = upstreamHits;
  failing = true;
  try {
    await assert.rejects(produceImage(`${origin}/boom.png`, "thumb"), /getObject .*: HTTP 500/);
  } finally {
    failing = false;
  }
  assert.equal(upstreamHits, hits, "a store outage must not be answered by fetching and caching to disk");
  await assert.rejects(readdir(path.join(dir, "imgcache")), /ENOENT/);
});

test("the prepared marker is a sibling object and short-circuits a converted GIF", async () => {
  const hits = upstreamHits;
  const url = `${origin}/loop.gif`;
  const key = cacheKey(url, "full");
  objects.set(objectKey(key), { body: Buffer.from("gif-bytes"), type: "image/gif" });
  objects.set(`${objectKey(key)}.prepared`, { body: Buffer.from("original"), type: "text/plain" });
  assert.equal(await convertAnimated(url, "full"), 0);
  assert.equal(upstreamHits, hits);
  assert.equal(objects.get(objectKey(key))!.body.toString(), "gif-bytes");
});

// 站主 2026-10-11：X 镜像挂了图就全挂 →「为什么不直接把图存下来」「头像那些也要缓存」。
test("the source picture is kept, so later renditions no longer need the source", async () => {
  const url = `${origin}/kept.png`;
  assert.equal(await keepOriginal(url), "stored");
  assert.deepEqual(objects.get(objectKey(cacheKey(url, "original"))), { body: png, type: "image/png" });
  assert.equal(await keepOriginal(url), "kept");
  // A copy kept earlier (another process, the backfill) serves a new size while the source is down.
  const earlier = `${origin}/kept-earlier.png`;
  objects.set(objectKey(cacheKey(earlier, "original")), { body: png, type: "image/png" });
  upstreamDown = true;
  try {
    const hits = upstreamHits;
    const image = await produceImage(earlier, "image-336");
    assert.equal(image.type, "image/webp");
    assert.equal(upstreamHits, hits, "made from the kept copy");
  } finally {
    upstreamDown = false;
  }
});

test("a 200 that is not a picture (a bot-check page) is not kept as the original", async () => {
  const url = `${origin}/blocked.png`;
  await assert.rejects(keepOriginal(url));
  assert.equal(objects.has(objectKey(cacheKey(url, "original"))), false);
});

test("avatars are kept with every size a card asks for", async () => {
  const url = `${origin}/avatar.png`;
  const result = await prepareAvatars([url, url]);
  assert.deepEqual({ originals: result.originals, renditions: result.renditions, made: result.made, failed: result.failed }, { originals: 1, renditions: 3, made: 3, failed: 0 });
  for (const mode of ["avatar", "avatar-48", "avatar-96"]) assert.ok(objects.has(objectKey(cacheKey(url, mode))), mode);
  const again = await prepareAvatars([url]);
  assert.deepEqual({ originals: again.originals, made: again.made }, { originals: 0, made: 0 });
});
