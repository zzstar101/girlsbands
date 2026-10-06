// S3-compatible object storage, shared by the database backups (Tencent COS) and the image cache
// (Cloudflare R2): AWS Signature V4 and the object calls the cache needs. The helpers here address
// objects path-style (${endpoint}/${bucket}/${key}).
import { createHash, createHmac } from "node:crypto";

export interface S3Target {
  /** Endpoint without the bucket, e.g. https://<accountid>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const EMPTY_BODY_HASH = hex("");

/** AWS Signature V4 headers for one request (exported for the test vector check). */
export function signV4(opts: {
  method: string; url: URL; region: string; service?: string; accessKey: string; secretKey: string; payloadHash: string; headers?: Record<string, string>; now?: Date;
}): Record<string, string> {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const service = opts.service ?? "s3";
  const headers: Record<string, string> = { ...(opts.headers ?? {}), host: opts.url.host, "x-amz-content-sha256": opts.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalQuery = [...opts.url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonicalPath = opts.url.pathname.split("/").map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
  const canonical = [opts.method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), opts.payloadHash].join("\n");
  const scope = `${day}/${opts.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${opts.secretKey}`, day), opts.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

// One budget for connect, upload and body: a stuck object store must not hold a request open.
const REQUEST_TIMEOUT_MS = 20_000;

function objectUrl(target: S3Target, key: string): URL {
  return new URL(`${target.endpoint.replace(/\/+$/, "")}/${target.bucket}/${key}`);
}

function signed(target: S3Target, method: string, url: URL, payloadHash: string, headers?: Record<string, string>): Record<string, string> {
  return signV4({ method, url, region: target.region, accessKey: target.accessKey, secretKey: target.secretKey, payloadHash, headers });
}

/** Uploads one object; the store keeps `type` as the object's Content-Type. */
export async function putObject(target: S3Target, key: string, body: Buffer, type: string): Promise<void> {
  const url = objectUrl(target, key);
  const headers = signed(target, "PUT", url, hex(body), { "content-length": String(body.length), "content-type": type });
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`putObject ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/** Reads one object with its Content-Type; a 404 is a miss, every other failure is an upstream error. */
export async function getObject(target: S3Target, key: string): Promise<{ body: Buffer; type: string } | null> {
  const url = objectUrl(target, key);
  const res = await fetch(url, { headers: signed(target, "GET", url, EMPTY_BODY_HASH), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getObject ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "application/octet-stream" };
}

/** Whether an object exists; a 404 answers no. */
export async function headObject(target: S3Target, key: string): Promise<boolean> {
  const url = objectUrl(target, key);
  const res = await fetch(url, { method: "HEAD", headers: signed(target, "HEAD", url, EMPTY_BODY_HASH), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`headObject ${key}: HTTP ${res.status}`);
  return true;
}
