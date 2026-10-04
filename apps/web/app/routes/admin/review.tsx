import { SITE } from "@girlsbands/industry/site";
import { REVIEW_CHARS, type AdminReview } from "@girlsbands/contracts/admin";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/review";
import { adminGet } from "../../lib/admin.server";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, Stat } from "../../features/admin/ui";


export async function loader({ request }: Route.LoaderArgs) {
  const seed = new URL(request.url).searchParams.get("seed");
  return adminGet<AdminReview>(request, `/api/admin/review${seed ? `?seed=${encodeURIComponent(seed)}` : ""}`);
}

export const meta: Route.MetaFunction = () => [{ title: `中文抽检 · ${SITE.name} 后台` }];

/** Both sides get the same height and scroll on their own, so a long press release does not push the next item off the page. */
function Side({ label, tone, title, body }: { label: string; tone?: "accent"; title: string; body: string | null }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2">
        <Badge tone={tone ?? "muted"}>{label}</Badge>
      </div>
      <div className="text-[14px] font-semibold leading-snug text-ink">{title}</div>
      <div className="mt-2 max-h-[30rem] overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg-sunk p-3 text-[13px] leading-[1.75] text-ink-2 ring-1 ring-line">
        {body || <span className="text-ink-4">（空）</span>}
      </div>
    </div>
  );
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const { seed, week, total, rows } = loaderData;
  const navigate = useNavigate();
  return (
    <AdminPage
      title="中文抽检"
      subtitle={`每周抽 ${rows.length || 20} 条已经上站的内容，原文和中文摆在一起，逐条核对专名、日期和价格。同一批一整个星期都不变，看到问题可以隔几天回来看；想立刻换一批就点右边的按钮。每条两边都只看开头 ${num(REVIEW_CHARS)} 字，要读全的点「原文」或内容诊断。`}
      actions={
        <Button onClick={() => navigate(`/admin/review?seed=${encodeURIComponent(`${seed}+${Date.now().toString(36)}`)}`)}>换一批</Button>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="这一批" value={`${rows.length} 条`} hint={week ? `本周（${week.start} ~ ${week.end}）` : `临时批次 ${seed}`} />
        <Stat label="可以抽的" value={`${num(total)} 条`} hint="公开、全文、模型翻译过的" />
        <Stat label="抽检批次" value={<span className="text-[15px]">{seed}</span>} hint="按条目 id 与批次的哈希排序，和排序时间无关" />
      </div>

      {rows.length ? (
        <div className="space-y-4">
          {rows.map((r) => (
            <Card
              key={r.article_id}
              title={<Link to={`/admin/content/${r.article_id}`} className="hover:text-accent">{r.article_id}</Link>}
              right={
                <>
                  {r.selected && <Badge tone="accent">精选</Badge>}
                  {!r.complete && <Badge tone="warn">译文不全</Badge>}
                  {r.cut && <Badge tone="warn">已截断</Badge>}
                  <span>{r.source}</span>
                  <span>·</span>
                  <span>{bj(r.published_at ?? r.discovered_at, true)}</span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-accent">原文 ↗</a>
                </>
              }
            >
              {r.names.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
                  <span className="text-[12.5px] text-ink-3">原文提到的专名（中文侧应照这组写法）：</span>
                  {r.names.map((n) => <Badge key={n} tone="info">{n}</Badge>)}
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <Side label={r.language ?? "原文"} title={r.title} body={r.body} />
                <Side label="中文" tone="accent" title={r.title_zh || "（没有中文标题）"} body={r.body_zh} />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><Empty>还没有可以抽检的内容：要有公开的全文条目、并且已经翻成中文。</Empty></Card>
      )}
    </AdminPage>
  );
}
