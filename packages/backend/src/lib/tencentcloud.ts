import { createHash, createHmac } from "node:crypto";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();

/** Tencent Cloud API v3 TC3-HMAC-SHA256 headers; exported for deterministic tests. */
export function signTC3(opts: { secretId: string; secretKey: string; service: string; host: string; action: string; version: string; payload: string; now?: Date }): Record<string, string> {
  const now = opts.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders = `content-type:${contentType}\nhost:${opts.host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(opts.payload)}`;
  const scope = `${date}/${opts.service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${opts.secretKey}`, date);
  const secretService = hmac(secretDate, opts.service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return {
    "Content-Type": contentType,
    Host: opts.host,
    "X-TC-Action": opts.action,
    "X-TC-Version": opts.version,
    "X-TC-Timestamp": String(timestamp),
    Authorization: `TC3-HMAC-SHA256 Credential=${opts.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export async function callTencent<T>(action: string, params: unknown, credentials: { secretId: string; secretKey: string }, now?: Date): Promise<T> {
  const host = "teo.tencentcloudapi.com";
  const payload = JSON.stringify(params);
  const response = await fetch(`https://${host}`, { method: "POST", headers: signTC3({ ...credentials, host, service: "teo", action, version: "2022-09-01", payload, ...(now ? { now } : {}) }), body: payload, signal: AbortSignal.timeout(20_000) });
  const result = await response.json() as { Response?: T & { Error?: { Code: string; Message: string } } };
  if (!response.ok || result.Response?.Error) throw new Error(`Tencent ${action}: ${result.Response?.Error?.Code ?? response.status} ${result.Response?.Error?.Message ?? response.statusText}`);
  if (!result.Response) throw new Error(`Tencent ${action}: missing Response`);
  return result.Response;
}

export const tc3Sha256 = sha256;
