import { SITE } from "@girlsbands/industry/site";
import { useState } from "react";
import { Form, useSearchParams } from "react-router";
import type { Route } from "./+types/feedback";
import type { AdminFeedback, AdminFeedbackRow, AdminFeedbackTargets } from "@girlsbands/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { FEEDBACK_STATUS } from "../../features/admin/labels";
import { fieldLabel, targetHref, targetLabel } from "../../features/feedback/labels";
import { AdminPage, Badge, Button, ButtonLink, Card, Empty, FilterChips, Input, Pager, ReasonDialog, Select, Textarea, Time } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // 两个视图读两条不同的查询：按时间（老样子）与按目标聚合（W18 加的那条）。
  if (url.searchParams.get("view") === "targets") {
    return { view: "targets" as const, targets: await adminGet<AdminFeedbackTargets>(request, "/api/admin/feedback/targets") };
  }
  return { view: "list" as const, list: await adminGet<AdminFeedback>(request, `/api/admin/feedback${url.search}`) };
}

export const meta: Route.MetaFunction = () => [{ title: `反馈 · ${SITE.name} 后台` }];

const TONE: Record<string, "accent" | "warn" | "ok" | "muted"> = { new: "accent", triaged: "warn", replied: "ok", resolved: "ok", spam: "muted" };

function FeedbackCard({ f }: { f: AdminFeedbackRow }) {
  const { run, pending } = useAdminAction();
  const [note, setNote] = useState(f.note ?? "");
  const [answer, setAnswer] = useState("");
  const [dialog, setDialog] = useState<null | "ban" | "erase">(null);
  const base = `/api/admin/feedback/${f.id}`;
  const version = new Date(f.updated_at).toISOString();
  return (
    <article className="rounded-panel bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <span className="num font-medium text-ink-2">#{f.id}</span>
        <Badge tone={TONE[f.status] ?? "muted"}>{FEEDBACK_STATUS[f.status] ?? f.status}</Badge>
        {f.target_kind === "source" && <Badge tone="info">投稿信源</Badge>}
        <Time at={f.created_at} />
        {f.email && <a className="text-accent" href={`mailto:${f.email}`}>{f.email}</a>}
        {f.page_url && <a className="max-w-[320px] truncate hover:text-accent" href={f.page_url} target="_blank" rel="noreferrer">{f.page_url}</a>}
        {f.from_source > 1 && <Badge tone="info" title="同一来源（IP 与浏览器家族的不可逆标识）">同来源 {f.from_source} 条</Badge>}
        {f.banned && <Badge tone="bad">来源已封禁</Badge>}
        {!f.forwarded_at && f.status === "new" && (
          <Badge tone="warn" title={f.forward_error && f.forward_error !== "pending" ? `还没有转发到站主邮箱或飞书：${f.forward_error}` : "还没有转发到站主邮箱或飞书"}>未转发</Badge>
        )}
      </div>
      {/* 读者说的是哪一条内容的哪一处（W18）：后台据此跳转与聚合，历史反馈没有这一段。 */}
      {f.target_kind && f.target_kind !== "source" && (
        <p className="mt-1.5 text-[12px] text-ink-4">
          针对 {targetLabel(f.target_kind)}
          {f.target_id ? <span className="mono"> {f.target_id}</span> : null}
          {fieldLabel(f.target_field) ? ` · ${fieldLabel(f.target_field)}` : ""}
          {f.expected ? ` → ${f.expected}` : ""}
        </p>
      )}
      <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{f.content}</p>
      {f.screenshot === "local" && (
        <a href={`${base}/screenshot`} target="_blank" rel="noreferrer" className="mt-2 inline-block">
          <img src={`${base}/screenshot`} alt="反馈截图" loading="lazy" className="max-h-48 rounded-control ring-1 ring-line" />
        </a>
      )}
      {f.screenshot === "feishu" && <p className="mt-2 text-[12.5px] text-ink-4">截图已随反馈转到内部飞书群。</p>}
      {f.screenshot === "gone" && <p className="mt-2 text-[12.5px] text-ink-4">截图未能转到飞书，已删除。</p>}
      {f.replies.length > 0 && (
        <ul className="mt-3 space-y-2">
          {f.replies.map((r) => (
            <li key={r.id} className="rounded-control bg-bg-sunk/60 px-3 py-2 ring-1 ring-line-soft">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-4">
                <span>已回复</span>
                <Badge tone={r.status === "sent" ? "ok" : "bad"}>{r.status === "sent" ? "已发出" : "发送失败"}</Badge>
                <span>{r.actor}</span>
                <Time at={r.created_at} />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      {f.email && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Textarea
            rows={3}
            placeholder={`回复 ${f.email}（用网站邮箱发出，信里会附上对方原来写的内容）`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="md"
            tone="primary"
            disabled={!answer.trim() || !!pending}
            busy={pending === "reply"}
            onClick={async () => {
              if ((await run("POST", `${base}/reply`, { body: answer }, { label: "reply", success: "回复已发出" })) !== null) setAnswer("");
            }}
          >
            发送回复
          </Button>
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-start">
        <Select
          aria-label="处理状态"
          value={f.status}
          disabled={!!pending}
          onChange={(e) => run("PATCH", base, { status: e.target.value, version }, { label: "status", success: "状态已更新" })}
        >
          {Object.entries(FEEDBACK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Textarea rows={1} className="!min-h-[38px]" placeholder="处理备注（仅内部可见）" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-1.5">
          <Button size="md" disabled={note === (f.note ?? "")} busy={pending === "note"} onClick={() => run("PATCH", base, { note: note || null, version }, { label: "note", success: "备注已保存" })}>
            保存备注
          </Button>
          {/* 读者从演出页或事件页补的「一行一首」：采纳之后进那场演出的曲目单，正文照抄，不改一个字。 */}
          {f.page_url && /\/(?:live|story)\//.test(f.page_url) && (
            <Button
              tone="ghost"
              disabled={!!pending}
              busy={pending === "setlist"}
              title="把这条反馈里的「一行一首」采纳成那场演出的曲目单"
              onClick={() => run("POST", `${base}/setlist`, undefined, { label: "setlist", success: "已采纳为曲目单" })}
            >
              采纳为曲目单
            </Button>
          )}
          <Button tone="ghost" onClick={() => setDialog(f.banned ? null : "ban")} disabled={f.banned} title="拒绝这个来源的后续反馈">封禁来源</Button>
          <Button tone="ghost" onClick={() => setDialog("erase")} title="按隐私说明删除提交者的资料">删除资料</Button>
        </div>
      </div>
      <ReasonDialog
        open={dialog === "ban"}
        title="封禁这个反馈来源"
        description="同一来源之后提交反馈会被拒绝。来源标识不可还原成 IP。"
        danger
        confirmLabel="封禁"
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => (await run("POST", "/api/admin/feedback-bans", { sourceHash: f.source_hash, reason }, { label: "ban", success: "已封禁" })) !== null}
      />
      <ReasonDialog
        open={dialog === "erase"}
        title="删除提交者资料"
        description="删除正文、邮箱、页面地址和截图，只保留处理记录。不可恢复。"
        danger
        confirmLabel="删除"
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => (await run("POST", `${base}/erase`, { reason }, { label: "erase", success: "资料已删除" })) !== null}
      />
    </article>
  );
}

/** 按时间：一条一条处理（老视图）。 */
function TimeView({ data }: { data: AdminFeedback }) {
  const [sp] = useSearchParams();
  const { run } = useAdminAction();
  const { rows, counts, bans, page } = data;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterChips
          param="status"
          options={[{ value: "", label: "全部", count: total }, ...Object.entries(FEEDBACK_STATUS).map(([k, v]) => ({ value: k, label: v, count: counts[k] ?? 0 }))]}
        />
        <Form method="get" className="w-full max-w-xs">
          {sp.get("status") && <input type="hidden" name="status" value={sp.get("status")!} />}
          <Input name="q" defaultValue={sp.get("q") ?? ""} placeholder="搜索内容、邮箱、页面" aria-label="搜索反馈" />
        </Form>
      </div>
      <div className="space-y-3">
        {rows.length ? rows.map((f) => <FeedbackCard key={`${f.id}-${f.updated_at}`} f={f} />) : <Card><Empty>没有符合条件的反馈</Empty></Card>}
      </div>
      <Pager page={page} hasMore={rows.length === 50} />
      {bans.length > 0 && (
        <Card className="mt-8" title="已封禁的来源">
          <ul className="space-y-2 text-[13px]">
            {bans.map((b) => (
              <li key={b.source_hash} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-mono text-[12px] text-ink-3">{b.source_hash}</span> · {b.reason} · {b.created_by} · {bj(b.created_at, true)}
                </span>
                <Button size="sm" tone="ghost" onClick={() => run("DELETE", `/api/admin/feedback-bans/${encodeURIComponent(b.source_hash)}`, undefined, { label: `unban-${b.source_hash}`, success: "已解除封禁" })}>
                  解除
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** 按目标聚合：同一个对象上的纠错并排看，改一次就够；投稿单独列，每条都是线索。 */
function TargetView({ data }: { data: AdminFeedbackTargets }) {
  return (
    <div className="space-y-6">
      {data.groups.length ? (
        data.groups.map((g) => {
          const href = targetHref(g.target_kind, g.target_id);
          return (
            <section key={`${g.target_kind}-${g.target_id ?? ""}`} className="rounded-panel bg-bg-sunk/50 p-3 ring-1 ring-line-soft">
              <header className="flex flex-wrap items-center gap-2 px-1 text-[13.5px]">
                <span className="font-semibold text-ink">{targetLabel(g.target_kind)}</span>
                {g.target_id && <span className="mono text-[12px] text-ink-3">{g.target_id}</span>}
                <Badge tone="info" title="不同来源（IP 与浏览器家族的不可逆标识）">{g.sources} 个来源</Badge>
                <Badge tone="muted">{g.n} 条</Badge>
                <Time at={g.latest} />
                {href && <ButtonLink to={href} size="sm">跳到该条目</ButtonLink>}
              </header>
              <div className="mt-3 space-y-3">
                {g.rows.map((f) => <FeedbackCard key={`${f.id}-${f.updated_at}`} f={f} />)}
              </div>
            </section>
          );
        })
      ) : (
        <Card><Empty>还没有针对具体内容的纠错</Empty></Card>
      )}

      <Card title="投稿的信源" right={`${data.submissions.length} 条`}>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-4">
          读者给的地址不会被自动抓取 —— 看中了就照着往 <span className="mono">industry/sources.json</span> 加一条，人工确认过才进信源列表。
        </p>
        <div className="space-y-3">
          {data.submissions.length ? data.submissions.map((f) => <FeedbackCard key={`${f.id}-${f.updated_at}`} f={f} />) : <Empty>还没有投稿</Empty>}
        </div>
      </Card>
    </div>
  );
}

export default function FeedbackAdmin({ loaderData }: Route.ComponentProps) {
  const [sp] = useSearchParams();
  const targets = sp.get("view") === "targets";
  return (
    <AdminPage
      title="反馈"
      subtitle={targets
        ? "按目标聚合：同一个对象上的纠错并排看，改一次就够；投稿信源在最后，人工确认后才收录。"
        : `回复前确认收件人、主题、正文；“已修复上线”要有生产证据。签名统一 ${SITE.name}。`}
    >
      <div className="mb-4">
        <FilterChips param="view" options={[{ value: "", label: "按时间" }, { value: "targets", label: "按目标聚合" }]} />
      </div>
      {loaderData.view === "targets" ? <TargetView data={loaderData.targets} /> : <TimeView data={loaderData.list} />}
    </AdminPage>
  );
}
