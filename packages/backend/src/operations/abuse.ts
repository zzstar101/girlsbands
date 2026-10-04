// 公开写入接口（反馈）共用的限流与来源指纹。
//
// 来源标识是不可读的：客户端 IP + 浏览器家族 的 HMAC，库里和内存里都不出现原始 IP。
import { createHmac } from "node:crypto";
import { credential } from "../config.ts";

/** 公开接口可以抛的、带 HTTP 语义的错误；路由层按 status/code 转成 problem+json。 */
export class Rejected extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function sourceFingerprint(ip: string, userAgent: string): string {
  const secret = credential("auth", "SESSION_SECRET") ?? "dev-feedback-secret";
  const uaFamily = (userAgent.match(/(Chrome|Safari|Firefox|Edg|MicroMessenger|Mobile|Android|iPhone|iPad|Mac OS X|Windows)/g) ?? []).slice(0, 4).join("/");
  return createHmac("sha256", secret).update(`${ip}|${uaFamily}`).digest("base64url").slice(0, 24);
}

const recent = new Map<string, number[]>();

/**
 * 进程内滑动窗口。单实例够用：本站只有一个 API 进程，配了 TRUST_PROXY 时前面也没有共享计数的需求。
 * 超过上限抛 429，retryAfter 60 秒。
 */
export function rateLimit(source: string, perMinute = 5, message = "提交太频繁，请稍后再试。"): void {
  const now = Date.now();
  const list = (recent.get(source) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= perMinute) throw new Rejected(429, "rate_limited", message, 60);
  list.push(now);
  recent.set(source, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (v.every((t) => now - t > 60_000)) recent.delete(k);
}
