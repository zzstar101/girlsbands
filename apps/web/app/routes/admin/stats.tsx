// 数据统计看板：访问（自建计数 + EdgeOne）、内容产出、信源健康、模型调用、订阅与邮件、反馈，一页看完。
import { Link } from "react-router";
import type { Route } from "./+types/stats";
import type { AdminStatsResponse, EdgeTop } from "@girlsbands/contracts/admin-stats";
import { SITE } from "@girlsbands/industry/site";
import { adminGet } from "../../lib/admin.server";
import { LineChart, ShareBars, StackedBars } from "../../features/admin/charts";
import { money, num } from "../../features/admin/format";
import { AdminPage, Card, DataTable, Empty, FilterChips, Stat } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const days = new URL(request.url).searchParams.get("days") || "30";
  return adminGet<AdminStatsResponse>(request, `/api/admin/stats?days=${encodeURIComponent(days)}`);
}

export const meta: Route.MetaFunction = () => [{ title: `数据统计 · ${SITE.name} 后台` }];

const C = { accent: "var(--accent)", ink: "var(--ink-3)", ok: "var(--ok)", hot: "var(--hot)", tape: "var(--tape, #e6c800)", soft: "var(--ink-4)" };
const PROJECT = { "bang-dream": "BanG Dream!", "girls-band-cry": "GIRLS BAND CRY", "bocchi-the-rock": "ぼっち・ざ・ろっく！" } as Record<string, string>;
const DEVICE = { mobile: "手机", desktop: "电脑", tablet: "平板", Mobile: "手机", Desktop: "电脑", Tablet: "平板", Other: "其他（含爬虫）" } as Record<string, string>;

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
const short = (day: string) => day.slice(5).replace("-", "/");
const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

/** One label per day of the window, so series with missing days still line up. */
function daysOf(...lists: Array<Array<{ day: string }>>): string[] {
  const all = new Set<string>();
  for (const l of lists) for (const r of l) all.add(r.day);
  return [...all].sort();
}
function series<T extends { day: string }>(labels: string[], rows: T[], pick: (r: T) => number): number[] {
  const by = new Map(rows.map((r) => [r.day, Number(pick(r)) || 0]));
  return labels.map((d) => by.get(d) ?? 0);
}

type Line = { key: string; label: string; color: string; values: number[]; dashed?: boolean };
/** A line needs a few days to mean anything; with one or two days the same numbers read better as bars. */
function Trend({ labels, series: lines }: { labels: string[]; series: Line[] }) {
  if (labels.length >= 3) return <LineChart labels={labels} series={lines} />;
  return (
    <div className="grid gap-2 text-[13px]">
      <p className="text-[12px] text-ink-4">数据还不到 3 天，先按天列出，攒够了再画趋势线。</p>
      {labels.map((d, i) => (
        <div key={d} className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-line/70 pt-2">
          <span className="num w-12 text-ink-3">{d}</span>
          {lines.map((l) => (
            <span key={l.key} className="inline-flex items-baseline gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
              <span className="text-ink-3">{l.label}</span>
              <span className="num text-ink">{num(l.values[i] ?? 0)}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TopList({ rows, label }: { rows: EdgeTop | Array<{ key: string; value: number }>; label?: (k: string) => string }) {
  if (!rows.length) return <Empty>暂无数据</Empty>;
  return <ShareBars rows={rows.slice(0, 8).map((r) => ({ label: label ? label(r.key) : r.key, value: r.value }))} />;
}

export default function StatsAdmin({ loaderData: s }: Route.ComponentProps) {
  const t = s.traffic;
  const trafficDays = daysOf(t.daily, t.edge?.daily ?? []);
  const pv = sum(t.daily, (d) => d.pv);
  const uvAvg = t.daily.length ? Math.round(sum(t.daily, (d) => d.uv) / t.daily.length) : 0;
  const edgeReq = sum(t.edge?.daily ?? [], (d) => d.requests);
  const edgeFlux = sum(t.edge?.daily ?? [], (d) => d.fluxBytes);

  const contentDays = daysOf(s.content.daily);
  const modelDays = daysOf(s.models.daily);
  const calls = sum(s.models.daily, (d) => d.calls);
  const failed = sum(s.models.daily, (d) => d.failed);
  const limited = sum(s.models.daily, (d) => d.rateLimited);
  const cost = sum(s.models.daily, (d) => d.cost);
  const subDays = daysOf(s.subscriptions.daily, s.subscriptions.emails.daily);
  const fbDays = daysOf(s.feedback.daily);

  return (
    <AdminPage
      title="数据统计"
      subtitle="访客数来自本站自己的计数（不存 IP、不用 Cookie，按天轮换的哈希去重）；CDN 请求数来自 EdgeOne，含爬虫与静态资源以外的接口请求。日期按北京时间。"
      actions={<FilterChips param="days" options={[{ value: "7", label: "7 天" }, { value: "", label: "30 天" }, { value: "90", label: "90 天" }]} />}
    >
      <div className="grid gap-6">
        {/* 1 访问流量 */}
        <section className="grid gap-4">
          <h2 className="text-[15px] font-semibold text-ink">访问流量</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="页面浏览（PV）" value={num(pv)} hint={`${trafficDays.length} 天合计`} />
            <Stat label="日均访客（UV）" value={num(uvAvg)} hint="每天去重后的访客，按天平均" />
            <Stat label="CDN 请求" value={t.edge ? num(edgeReq) : "—"} hint={t.edge ? "EdgeOne，girlsbands.com" : "未配置腾讯云密钥"} />
            <Stat label="CDN 流量" value={t.edge ? bytes(edgeFlux) : "—"} hint="EdgeOne 出流量" />
          </div>
          <Card title="每天的访问">
            {trafficDays.length ? (
              <Trend
                labels={trafficDays.map(short)}
                series={[
                  { key: "pv", label: "PV", color: C.accent, values: series(trafficDays, t.daily, (d) => d.pv) },
                  { key: "uv", label: "UV", color: C.ok, values: series(trafficDays, t.daily, (d) => d.uv) },
                  ...(t.edge ? [{ key: "edge", label: "CDN 请求", color: C.soft, dashed: true, values: series(trafficDays, t.edge.daily, (d) => d.requests) }] : []),
                ]}
              />
            ) : (
              <Empty>还没有访问记录（计数上线后开始累积）</Empty>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="热门条目" pad={false} className="lg:col-span-2">
              <DataTable
                dense
                rows={t.topItems.slice(0, 12)}
                rowKey={(r) => r.itemId}
                empty="暂无"
                columns={[
                  { key: "t", label: "条目", render: (r) => <Link to={`/items/${r.itemId}`} target="_blank" className="line-clamp-1 hover:text-accent">{r.title || r.itemId}</Link> },
                  { key: "pv", label: "PV", align: "right", render: (r) => num(r.pv) },
                ]}
              />
            </Card>
            <Card title="设备">
              <TopList rows={t.devices.map((d) => ({ key: d.device, value: d.pv }))} label={(k) => DEVICE[k] ?? k} />
            </Card>
            <Card title="热门页面">
              <TopList rows={t.topPaths.map((d) => ({ key: d.path, value: d.pv }))} />
            </Card>
            <Card title="来源网站">
              <TopList rows={t.referrers.map((d) => ({ key: d.host, value: d.pv }))} />
            </Card>
            <Card title="CDN：国家/地区">
              <TopList rows={t.edge?.top.countries ?? []} />
            </Card>
            {t.edge && (
              <>
                <Card title="CDN：请求最多的路径" className="lg:col-span-2">
                  <TopList rows={t.edge.top.urls} />
                </Card>
                <Card title="CDN：设备">
                  <TopList rows={t.edge.top.devices} label={(k) => DEVICE[k] ?? k} />
                </Card>
              </>
            )}
          </div>
        </section>

        {/* 2 内容产出 */}
        <section className="grid gap-4">
          <h2 className="text-[15px] font-semibold text-ink">内容产出</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="采集" value={num(sum(s.content.daily, (d) => d.collected))} hint="新收录的文章" />
            <Stat label="发布" value={num(sum(s.content.daily, (d) => d.published))} />
            <Stat label="精选" value={num(sum(s.content.daily, (d) => d.selected))} />
            <Stat label="待处理队列" value={num(s.content.queue.waiting)} tone={s.content.queue.waiting > 300 ? "warn" : undefined} hint={`失败 ${num(s.content.queue.failed)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="每天的产出" className="lg:col-span-2">
              {contentDays.length ? (
                <Trend
                  labels={contentDays.map(short)}
                  series={[
                    { key: "c", label: "采集", color: C.soft, values: series(contentDays, s.content.daily, (d) => d.collected) },
                    { key: "p", label: "发布", color: C.ok, values: series(contentDays, s.content.daily, (d) => d.published) },
                    { key: "s", label: "精选", color: C.accent, values: series(contentDays, s.content.daily, (d) => d.selected) },
                    { key: "b", label: "拦下", color: C.hot, dashed: true, values: series(contentDays, s.content.daily, (d) => d.blocked) },
                  ]}
                />
              ) : (
                <Empty>暂无</Empty>
              )}
            </Card>
            <Card title="按企划">
              <TopList rows={s.content.byProject.map((p) => ({ key: p.entity, value: p.count }))} label={(k) => PROJECT[k] ?? k} />
            </Card>
          </div>
        </section>

        {/* 3 信源健康 */}
        <section className="grid gap-4">
          <h2 className="text-[15px] font-semibold text-ink">信源健康</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="信源" value={num(s.sources.total)} hint={`启用 ${num(s.sources.enabled)}`} />
            <Stat label="失败" value={num(s.sources.failing.length)} tone={s.sources.failing.length ? "bad" : "ok"} />
            <Stat label="48 小时没成功" value={num(s.sources.staleCount)} tone={s.sources.staleCount ? "warn" : "ok"} />
          </div>
          {s.sources.failing.length > 0 && (
            <Card title="失败的信源" pad={false}>
              <DataTable
                dense
                rows={s.sources.failing}
                rowKey={(r) => r.id}
                columns={[
                  { key: "n", label: "信源", render: (r) => <Link to={`/admin/sources/${r.id}`} className="hover:text-accent">{r.name}</Link> },
                  { key: "e", label: "最近错误", render: (r) => <span className="line-clamp-1 font-mono text-[11.5px] text-ink-3">{r.lastError ?? "—"}</span> },
                  { key: "ok", label: "上次成功", align: "right", render: (r) => <span className="whitespace-nowrap text-ink-3">{r.lastSuccessAt ? short(r.lastSuccessAt.slice(0, 10)) : "从未"}</span> },
                ]}
              />
            </Card>
          )}
        </section>

        {/* 4 模型调用 */}
        <section className="grid gap-4">
          <h2 className="text-[15px] font-semibold text-ink">模型调用</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="调用" value={num(calls)} hint={`失败 ${num(failed)}`} tone={calls && failed / calls > 0.05 ? "warn" : undefined} />
            <Stat label="被限流（429）" value={num(limited)} tone={limited ? "warn" : "ok"} />
            <Stat label="每分钟峰值" value={num(s.models.perMinutePeak)} hint={`限速 ${num(s.models.budget.perMinute)} / 分钟`} tone={s.models.perMinutePeak > s.models.budget.perMinute ? "warn" : undefined} />
            <Stat label="费用" value={money(cost)} hint={`输入 ${num(sum(s.models.daily, (d) => d.tokensIn))} / 输出 ${num(sum(s.models.daily, (d) => d.tokensOut))} tokens`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="每天的调用" className="lg:col-span-2">
              {modelDays.length ? (
                <StackedBars
                  labels={modelDays.map(short)}
                  series={[
                    { key: "ok", label: "成功", color: C.ok, values: series(modelDays, s.models.daily, (d) => d.calls - d.failed) },
                    { key: "f", label: "失败", color: C.hot, values: series(modelDays, s.models.daily, (d) => d.failed) },
                  ]}
                />
              ) : (
                <Empty>暂无</Empty>
              )}
            </Card>
            <Card title="按用途">
              {s.models.byPurpose.length ? (
                <ul className="grid gap-1.5 text-[12.5px]">
                  {[...s.models.byPurpose].sort((a, b) => b.calls - a.calls).slice(0, 12).map((r) => (
                    <li key={r.purpose} className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{r.purpose}</span>
                      <span className="num text-ink">{num(r.calls)}</span>
                      <span className="num w-14 text-right text-ink-4">{(r.avgLatencyMs / 1000).toFixed(1)} s</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>暂无</Empty>
              )}
            </Card>
          </div>
        </section>

        {/* 5 订阅与邮件 */}
        <section className="grid gap-4">
          <h2 className="text-[15px] font-semibold text-ink">订阅与邮件</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="订阅者" value={num(s.subscriptions.subscribers)} hint={`已确认 ${num(s.subscriptions.confirmed)}`} />
            <Stat label="新订阅" value={num(sum(s.subscriptions.daily, (d) => d.newSubs))} hint={`退订 ${num(sum(s.subscriptions.daily, (d) => d.unsubs))}`} />
            <Stat label="发出邮件" value={num(sum(s.subscriptions.emails.daily, (d) => d.sent))} />
            <Stat label="发送失败" value={num(sum(s.subscriptions.emails.daily, (d) => d.failed))} tone={sum(s.subscriptions.emails.daily, (d) => d.failed) ? "bad" : "ok"} />
          </div>
          <Card title="每天的订阅与邮件">
            {subDays.length ? (
              <Trend
                labels={subDays.map(short)}
                series={[
                  { key: "n", label: "新订阅", color: C.accent, values: series(subDays, s.subscriptions.daily, (d) => d.newSubs) },
                  { key: "u", label: "退订", color: C.hot, dashed: true, values: series(subDays, s.subscriptions.daily, (d) => d.unsubs) },
                  { key: "s", label: "发出邮件", color: C.ok, values: series(subDays, s.subscriptions.emails.daily, (d) => d.sent) },
                ]}
              />
            ) : (
              <Empty>还没有订阅或邮件</Empty>
            )}
          </Card>
        </section>

        {/* 6 反馈 */}
        <section className="grid gap-4">
          <h2 className="text-[15px] font-semibold text-ink">反馈</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="待处理" value={num(s.feedback.open)} tone={s.feedback.open ? "warn" : "ok"} />
            <Stat label="期间收到" value={num(s.feedback.total)} />
          </div>
          {fbDays.length > 0 && (
            <Card title="每天的反馈" right={<Link to="/admin/feedback" className="text-[12.5px] text-accent">去处理 →</Link>}>
              <StackedBars labels={fbDays.map(short)} series={[{ key: "f", label: "反馈", color: C.accent, values: series(fbDays, s.feedback.daily, (d) => d.count) }]} />
            </Card>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
