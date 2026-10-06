import { usableImageUrl } from "../content/extract.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { stripTags } from "../lib/text.ts";
import type { MediaItem } from "../content/materials.ts";

export type DetailAdapter = "bilibili-show" | "allcpp-event";
export interface DetailMaterial { bodyHtml: string; bodyText: string; bodyStatus: "ok"; media: MediaItem[]; title?: string }
const imageMedia = (urls: Array<string | null | undefined>, base: string, includeLogo = false): MediaItem[] => {
  const seen = new Set<string>();
  return urls.flatMap((value) => {
    if (!value) return [];
    const absolute = value.startsWith("//") ? `https:${value}` : value;
    const url = includeLogo
      ? (() => { try { const parsed = new URL(absolute, base); return /^https?:$/.test(parsed.protocol) && !/favicon|\.svg(?:$|[?#])|no[_-]?image|default/i.test(parsed.href) ? parsed.href : null; } catch { return null; } })()
      : usableImageUrl(absolute, base);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ kind: "image" as const, url, width: null, height: null }];
  });
};
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (v: unknown) => v === null || v === undefined ? "" : String(v).trim();
const dateTimeText = (value: unknown) => {
  const raw = text(value);
  if (!/^\d{10}(?:\d{3})?$/.test(raw)) return raw;
  const date = new Date(Number(raw) * (raw.length === 10 ? 1000 : 1));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : raw;
};

export function parseBilibiliShowDetail(payload: unknown, base = "https://show.bilibili.com/"): DetailMaterial | null {
  const d = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!d) return null;
  const desc = d.performance_desc as { list?: Array<{ module?: string; details?: unknown }> } | undefined;
  const modules = desc?.list ?? [];
  const info = modules.find((m) => m.module === "base_info")?.details;
  const rows = Array.isArray(info) ? info : [];
  const lines = rows.flatMap((row) => {
    const item = row as { title?: unknown; content?: unknown };
    const title = text(item.title), content = text(item.content);
    return title && content ? [`<p><b>${escapeHtml(title)}</b>：${escapeHtml(content)}</p>`] : [];
  });
  const low = Number(d.price_low), high = Number(d.price_high);
  if (Number.isFinite(low) && Number.isFinite(high)) lines.push(`<p><b>票价</b>：¥${(low / 100).toFixed(low % 100 ? 2 : 0)}–¥${(high / 100).toFixed(high % 100 ? 2 : 0)}</p>`);
  const sale = [dateTimeText(d.sale_begin) && `开售时间：${dateTimeText(d.sale_begin)}`, dateTimeText(d.sale_end) && `停售时间：${dateTimeText(d.sale_end)}`].filter(Boolean);
  if (sale.length) lines.push(`<p>${escapeHtml(sale.join("；"))}</p>`);
  const activity = modules.filter((m) => m.module === "activity_content").map((m) => text(m.details)).join("");
  const cover = text(d.cover);
  const rawHtml = `${lines.join("")}${activity}`;
  const bodyHtml = sanitizeBody(rawHtml, base);
  const bodyText = stripTags(bodyHtml);
  return bodyText ? { bodyHtml, bodyText, bodyStatus: "ok", title: text(d.name) || undefined, media: imageMedia([cover, ...[...activity.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1])], base) } : null;
}

export function parseAllcppEventDetail(payload: unknown, base = "https://www.allcpp.cn/"): DetailMaterial | null {
  const d = (payload as { result?: Record<string, unknown> } | null)?.result;
  if (!d) return null;
  const sections = [text(d.enterTime) && `<p><b>活动时间</b>：${escapeHtml(text(d.enterTime))}</p>`, text(d.enterAddress) && `<p><b>活动地点</b>：${escapeHtml(text(d.enterAddress))}</p>`].filter(Boolean);
  const rawHtml = `${sections.join("")}${[text(d.rule), text(d.description)].filter(Boolean).join("")}`;
  const bodyHtml = sanitizeBody(rawHtml, base);
  const bodyText = stripTags(bodyHtml);
  return bodyText ? { bodyHtml, bodyText, bodyStatus: "ok", title: text(d.name) || undefined, media: imageMedia([text(d.logoPicUrl), ...[...rawHtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1])], base, true) } : null;
}

export function parseDetail(adapter: DetailAdapter, payload: unknown, base?: string): DetailMaterial | null {
  return adapter === "bilibili-show" ? parseBilibiliShowDetail(payload, base) : parseAllcppEventDetail(payload, base);
}

export function detailRequest(adapter: DetailAdapter, id: string): { url: string; method: string; headers: Record<string, string>; body?: string } {
  if (adapter === "bilibili-show") return { url: `https://show.bilibili.com/api/ticket/project/getV2?version=134&id=${encodeURIComponent(id)}`, method: "GET", headers: { accept: "application/json", referer: "https://show.bilibili.com/" } };
  return { url: "https://www.allcpp.cn/api/event/geteventdetail2.do", method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", referer: "https://www.allcpp.cn/", "x-requested-with": "XMLHttpRequest", "user-agent": "Mozilla/5.0" }, body: new URLSearchParams({ eventid: id, _plat: "web" }).toString() };
}

export async function fetchTicketDetail(adapter: DetailAdapter, id: string, options: { url?: string; fetcher?: typeof guardedFetch } = {}): Promise<DetailMaterial | null> {
  const request = detailRequest(adapter, id);
  const response = await (options.fetcher ?? guardedFetch)(options.url ?? request.url, {
    method: request.method, headers: request.headers, body: request.body, timeoutMs: 15_000,
  });
  if (response.status !== 200) return null;
  try { return parseDetail(adapter, JSON.parse(response.text()) as unknown, response.url); } catch { return null; }
}

export async function enrichCandidate(candidate: import("./types.ts").Candidate, adapter: DetailAdapter, id: string, options: { url?: string; fetcher?: typeof guardedFetch } = {}) {
  try {
    const detail = await fetchTicketDetail(adapter, id, options);
    return detail ? withDetail(candidate, detail) : candidate;
  } catch { return candidate; }
}

export function detailUrl(template: string | undefined, adapter: DetailAdapter, id: string): string {
  return template ? template.replace("{id}", encodeURIComponent(id)) : detailRequest(adapter, id).url;
}

export function withDetail(candidate: import("./types.ts").Candidate, detail: DetailMaterial): import("./types.ts").Candidate {
  const media = [...(candidate.media ?? []), ...detail.media];
  const seen = new Set<string>();
  return { ...candidate, title: detail.title || candidate.title, bodyHtml: detail.bodyHtml, bodyText: detail.bodyText, bodyStatus: "ok", media: media.filter((item) => !seen.has(item.url) && !!seen.add(item.url)) };
}

export { stripTags };
