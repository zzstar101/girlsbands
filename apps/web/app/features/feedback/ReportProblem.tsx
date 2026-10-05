// 「报告问题」（W18）：条目页、故事页、演出页、主题页、发售页共用同一枚入口。点开是一个小弹层，读者只需要
// 选一类问题、写一句说明 —— 剩下的（限流、封禁、飞书转发、后台处理）全部沿用 /feedback 那条老路，所以这里
// 没有新接口，只是往同一个 multipart 表单里多塞四个字段。
import { useState } from "react";
import { Link } from "react-router";
import { Sheet } from "../../components/ui/Sheet";
import { Select } from "../../components/ui/Controls";
import { RingMark } from "../../components/Logo";
import { IconCheck } from "../../components/icons";
import { TARGET_FIELDS, TARGET_FIELD_LABEL, TARGET_KIND_LABEL, type TargetKind } from "./labels";

const MAX_TEXT = 2000;

export function ReportProblem({ kind, id, what, className = "" }: {
  kind: TargetKind;
  /** 站内对象 id（条目页 URL 里的那个），后台靠它跳到这条内容。 */
  id: string;
  /** 给人看的对象名，显示在弹层里，避免读者点错页面时自己也不知道在报哪一条。 */
  what?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`text-[12.5px] text-ink-4 transition-colors hover:text-accent ${className}`}>
        发现错误？报告问题
      </button>
      <ReportSheet open={open} onClose={() => setOpen(false)} kind={kind} id={id} what={what} />
    </>
  );
}

const field = "w-full rounded-card bg-bg-sunk text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface";
const label = "mb-2 block text-[13px] font-semibold text-ink";

function ReportSheet({ open, onClose, kind, id, what }: { open: boolean; onClose: () => void; kind: TargetKind; id: string; what?: string }) {
  const [part, setPart] = useState("");
  const [expected, setExpected] = useState("");
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; message?: string; number?: number }>({ kind: "idle" });

  const close = () => {
    onClose();
    // 关掉就忘掉：下次点开是干净的表单，免得上一页的内容留在这一页。
    if (state.kind === "done") {
      setPart("");
      setExpected("");
      setContent("");
      setEmail("");
      setState({ kind: "idle" });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!part) return setState({ kind: "error", message: "请先选一类问题。" });
    if (content.trim().length < 2) return setState({ kind: "error", message: "请用一两句话说明哪里不对。" });
    setState({ kind: "sending" });
    try {
      const form = new FormData();
      form.set("content", content);
      form.set("email", email);
      form.set("pageUrl", typeof location === "undefined" ? "" : location.href);
      form.set("targetKind", kind);
      form.set("targetId", id);
      form.set("targetField", part);
      form.set("expected", expected);
      const res = await fetch("/api/site/feedback", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ kind: "error", message: body.detail ?? "提交失败，请稍后再试。" });
      setState({ kind: "done", number: body.id });
    } catch {
      setState({ kind: "error", message: "网络不太顺，稍后再提交一次。" });
    }
  };

  const canSend = part !== "" && content.trim().length >= 2 && state.kind !== "sending";
  return (
    <Sheet open={open} onClose={close} centered title="报告问题" label="报告问题">
      {state.kind === "done" ? (
        <div className="px-5 pb-7 pt-2 text-center sm:px-6">
          <div className="anim-pop-in mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-contrast">
            <IconCheck size={22} />
          </div>
          <p className="mt-4 text-[15px] font-semibold text-ink">收到了，谢谢你</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
            纠错编号 <span className="mono font-semibold text-ink">#{state.number}</span>。同一条内容上的多条纠错会并在一起处理。
          </p>
          <button type="button" onClick={close} className="mt-5 inline-flex h-10 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-bg">
            关闭
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5 px-5 pb-6 sm:px-6">
          <p className="rounded-card bg-bg-sunk px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-3">
            正在报告：<span className="font-medium text-ink-2">{TARGET_KIND_LABEL[kind]}</span>
            {what ? <span className="text-ink-2"> · {what}</span> : null}
          </p>

          <div>
            <label htmlFor="rp-part" className={label}>哪一类问题？</label>
            <Select id="rp-part" className="w-full" value={part} onChange={(e) => setPart(e.target.value)}>
              <option value="">请选择</option>
              {TARGET_FIELDS.map((f) => (
                <option key={f} value={f}>{TARGET_FIELD_LABEL[f]}</option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="rp-expected" className={label}>
              应该是怎样？ <span className="font-normal text-ink-4">（选填）</span>
            </label>
            <input
              id="rp-expected"
              value={expected}
              maxLength={200}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="例如：日期应是 2026-11-03"
              className={`${field} h-11 px-4 text-[14.5px]`}
            />
          </div>

          <div>
            <label htmlFor="rp-content" className={label}>说明</label>
            <textarea
              id="rp-content"
              required
              rows={4}
              maxLength={MAX_TEXT}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="你看到的是什么，为什么觉得不对？"
              className={`${field} block resize-y px-4 py-3 text-[14.5px] leading-relaxed`}
            />
          </div>

          <div>
            <label htmlFor="rp-email" className={label}>
              邮箱 <span className="font-normal text-ink-4">（选填，需要回信时留）</span>
            </label>
            <input id="rp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="留邮箱，我可以回信联系你" className={`${field} h-11 px-4 text-[14.5px]`} />
          </div>

          {state.kind === "error" && (
            <p role="alert" className="rounded-tile bg-hot-soft px-3.5 py-2.5 text-[13px] text-hot">{state.message}</p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-relaxed text-ink-4">
              会记下你指的是哪一条内容、哪一类问题，按
              <Link viewTransition to="/privacy" className="text-accent hover:underline">隐私说明</Link>
              处理。
            </p>
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-[background-color,opacity] hover:bg-accent-ink disabled:bg-line-strong disabled:text-ink-4 sm:self-auto"
            >
              {state.kind === "sending" && <RingMark className="size-4" spinning />}
              提交纠错
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
