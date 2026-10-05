// 情报投稿（W18）：读者把「这个账号/这个站值得收」丢过来。跟意见反馈共用同一条后端管线（同一张表、同一套
// 限流与封禁），唯一的区别是 target_kind 固定为 source —— 它不指向站上任何一个对象，所以后台单独列出来人工看。
// 这里只收链接：**读者给的地址永远不会被自动抓取**，人工确认之后才可能进 industry/sources.json。
import { useState } from "react";
import { Link } from "react-router";
import { SITE } from "@girlsbands/industry/site";
import { Presence } from "../components/ui/Presence";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { IconCheck } from "../components/icons";
import { RingMark } from "../components/Logo";
import { AsideCard, ReadingLayout } from "../components/ui/Page";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "投稿" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({
    title: "情报投稿",
    description: `把你看到的官方账号、公告页或情报站告诉 ${SITE.name}：只收链接，人工确认之后才会收录。`,
    path: "/submit",
    image: "/og/pages/feedback.png",
    noindex: true,
  });
}

const MAX_TEXT = 2000;

const TIPS = [
  "这个账号或网站的主页地址",
  "它是什么：官方号、成员本人、店铺、情报站",
  "为什么值得收：比现在更快、更全，或者现在没有",
];

const HINTS = [
  "我们会先人工打开看一眼：是不是一手、是不是长期在更、有没有版权风险。",
  "通过之后才会进信源列表，之后按它的更新频率定时去看。",
  "没通过也会留着 —— 以后条件变了，可能就合适了。",
];

function SubmitAside() {
  return (
    <>
      <AsideCard title="写清楚这几点，处理更快">
        <ol className="space-y-2.5">
          {TIPS.map((t, i) => (
            <li key={t} className="flex gap-2.5 text-[13px] leading-[1.6] text-ink-3">
              <span className="mono mt-px text-[11px] font-bold text-accent">{String(i + 1).padStart(2, "0")}</span>
              {t}
            </li>
          ))}
        </ol>
      </AsideCard>
      <AsideCard title="投稿之后">
        <ul className="space-y-2.5">
          {HINTS.map((t) => (
            <li key={t} className="text-[13px] leading-[1.75] text-ink-3">{t}</li>
          ))}
        </ul>
      </AsideCard>
      <AsideCard title="投稿和纠错不一样">
        <p className="text-[13px] leading-[1.75] text-ink-3">
          这一页是「加一个信源」。站上某条内容的日期、场馆或翻译写错了，请到那一页用
          <Link viewTransition to="/feedback" className="mx-0.5 text-band hover:underline">意见反馈</Link>
          告诉我们是哪一条。
        </p>
      </AsideCard>
    </>
  );
}

export default function SubmitPage() {
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; message?: string; id?: number }>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim().length < 2) return setState({ kind: "error", message: "请写下要投稿的账号或网站。" });
    setState({ kind: "sending" });
    try {
      const form = new FormData();
      form.set("content", content);
      form.set("email", email);
      // 这一页本身就是页面地址，没有别的意义；链接写在正文里，方便人工看也方便一起删。
      form.set("pageUrl", "");
      form.set("targetKind", "source");
      const res = await fetch("/api/site/feedback", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ kind: "error", message: body.detail ?? "提交失败，请稍后再试。" });
      setState({ kind: "done", id: body.id });
      setContent("");
      setEmail("");
    } catch {
      setState({ kind: "error", message: "网络不太顺，稍后再提交一次。" });
    }
  };

  if (state.kind === "done") {
    return (
      <>
        <PhoneBar back={{ to: "/more", label: "我的" }} title="情报投稿" />
        <ReadingLayout>
          <div className="card px-6 py-14 text-center">
            <div className="anim-pop-in mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-accent-contrast">
              <IconCheck size={26} />
            </div>
            <h1 className="mt-6 text-[22px] font-semibold text-ink">收到了，谢谢你</h1>
            <p className="mt-2 text-[14px] text-ink-3">
              投稿编号 <span className="mono font-semibold text-ink">#{state.id}</span>。人工看过之后，合适的会进信源列表。
            </p>
            <Link to="/" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">
              回到精选
            </Link>
          </div>
        </ReadingLayout>
      </>
    );
  }

  const field = "w-full rounded-card bg-bg-sunk text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface";
  const label = "mb-2 block text-[13px] font-semibold text-ink";
  const canSend = content.trim().length >= 2 && state.kind !== "sending";
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title="情报投稿" />
      <ReadingLayout aside={<SubmitAside />}>
        <header>
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">投稿一个信源</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-3">
            发现我们还没收的官方账号、公告页或情报站？把地址丢过来 —— 只收链接，本站不会自动去抓你给的地址。
          </p>
        </header>

        <form onSubmit={submit} className="card mt-6 overflow-hidden">
          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <label htmlFor="sb-content" className={label}>
                要投稿的账号或网站
              </label>
              <div className="relative">
                <textarea
                  id="sb-content"
                  required
                  rows={7}
                  maxLength={MAX_TEXT}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="例如：https://x.com/xxx —— 乐队成员的本人号，只发演出与周边消息，比官网快半天。"
                  className={`${field} block resize-y px-4 pb-8 pt-3.5 text-[14.5px] leading-relaxed`}
                />
                <span className="mono pointer-events-none absolute bottom-3 right-4 text-[11px] text-ink-4">
                  {content.length} / {MAX_TEXT}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-4">一行一个也行，写清楚是什么、为什么值得收就够了。</p>
            </div>

            <div>
              <label htmlFor="sb-email" className={label}>
                邮箱 <span className="font-normal text-ink-4">（选填，需要回信时留）</span>
              </label>
              <input id="sb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="留下邮箱，有结果我可以回信告诉你" className={`${field} h-11 px-4 text-[14.5px]`} />
            </div>

            <Presence show={state.kind === "error"} enter="anim-notice-in" exit="anim-fade-out" duration={160}>
              <p role="alert" className="rounded-tile bg-hot-soft px-3.5 py-2.5 text-[13px] text-hot">
                {state.kind === "error" ? state.message : ""}
              </p>
            </Presence>
          </div>

          <div className="flex flex-col-reverse gap-4 border-t border-line-soft bg-bg-sunk/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:bg-bg-muted/30">
            <p className="text-[12px] leading-relaxed text-ink-4 sm:max-w-[420px]">
              请勿提交密钥、身份证件或与投稿无关的敏感信息。提交即表示你知悉投稿内容、选填邮箱将按
              <Link viewTransition to="/privacy" className="text-accent hover:underline">
                隐私说明
              </Link>
              处理。
            </p>
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-[background-color,opacity] hover:bg-accent-ink disabled:bg-line-strong disabled:text-ink-4 sm:self-auto"
            >
              {state.kind === "sending" && <RingMark className="size-4" spinning />}
              提交投稿
            </button>
          </div>
        </form>
      </ReadingLayout>
    </>
  );
}
