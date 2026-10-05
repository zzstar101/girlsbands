import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { SITE } from "@girlsbands/industry/site";
import type { SubscribeResponse } from "@girlsbands/contracts/site";
import { IconBell, IconCheck, IconClock, IconTicket } from "../components/icons";
import { RingMark } from "../components/Logo";
import { AsideCard, ReadingLayout } from "../components/ui/Page";
import { PhoneBar } from "../components/shell/PhoneBar";
import { BandPicker, FIELD, LABEL, SubscribeShell, Toggle } from "../features/subscribe/ui";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { useFollows } from "../lib/local-state";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "邮件订阅" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({
    title: "邮件订阅",
    description: `订阅 ${SITE.name} 的邮件：抽选与先行受理截止、一般发售开卖前提醒，以及每天一封的精选摘要。`,
    path: "/subscribe",
  });
}

function SubscribeAside() {
  return (
    <>
      <AsideCard title="会收到什么">
        <ul className="space-y-3 text-[13px] leading-[1.7] text-ink-3">
          <li className="flex gap-2.5">
            <IconClock size={15} className="mt-0.5 shrink-0 text-hot" />
            抽选、先行受理的截止日，一般发售开卖日 —— 到期前 48 小时提醒一次。
          </li>
          <li className="flex gap-2.5">
            <IconTicket size={15} className="mt-0.5 shrink-0 text-accent" />
            你追的乐队有新 Live、新作、新周边时，挑值得知道的写进摘要。
          </li>
          <li className="flex gap-2.5">
            <IconBell size={15} className="mt-0.5 shrink-0 text-ink-3" />
            没有要紧事的那几天，就不发。宁可不打扰，也不发空邮件。
          </li>
        </ul>
      </AsideCard>
      <AsideCard title="关于你的地址">
        <p className="text-[13px] leading-[1.75] text-ink-3">
          地址只用来发这几封信，不外传、不用于别处。每封信底部都有退订入口，点一下就好，不用给理由。
        </p>
      </AsideCard>
    </>
  );
}

export default function SubscribePage() {
  const [email, setEmail] = useState("");
  const [bands, setBands] = useState<string[]>([]);
  const [wantsDeadlines, setWantsDeadlines] = useState(true);
  const [wantsDigest, setWantsDigest] = useState(true);
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; message?: string }>({ kind: "idle" });
  // 关注过的乐队先勾上，一次就好：订阅成功也不回写浏览器的关注列表（预填是单向的）。
  const follows = useFollows();
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !follows.length) return;
    prefilled.current = true;
    setBands(follows);
  }, [follows]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setState({ kind: "error", message: "请填写邮箱。" });
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/site/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, bands, wantsDeadlines, wantsDigest }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<SubscribeResponse> & { detail?: string };
      if (!res.ok || body.ok !== true) return setState({ kind: "error", message: body.detail ?? "订阅没有成功，请稍后再试。" });
      setState({ kind: "sent" });
    } catch {
      setState({ kind: "error", message: "网络不太顺，稍后再试一次。" });
    }
  };

  if (state.kind === "sent") {
    return (
      <>
        <PhoneBar back={{ to: "/more", label: "我的" }} title="邮件订阅" />
        <ReadingLayout>
          <div className="card px-6 py-14 text-center">
            <div className="anim-pop-in mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-accent-contrast">
              <IconCheck size={26} />
            </div>
            <h1 data-page-title="" className="mt-6 text-[22px] font-semibold text-ink">
              去邮箱点一下确认
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
              我们给 <span className="font-medium text-ink-2">{email.trim()}</span> 发了一封确认信。点信里的确认按钮才会开始发；在那之前，一条都不会发。
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-4">
              如果你本来就订阅过，这封信可能不会再来 —— 那说明已经生效了。收不到可以看一眼垃圾邮件。
            </p>
            <Link to="/" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">
              回到精选
            </Link>
          </div>
        </ReadingLayout>
      </>
    );
  }

  const sending = state.kind === "sending";
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title="邮件订阅" />
      <ReadingLayout aside={<SubscribeAside />}>
        <SubscribeShell title="订阅情报" lead={<>订阅 {SITE.name}：抽选什么时候截止、什么时候开卖、今天有哪些值得看的 —— 一封邮件，别错过下一场 Live。</>}>
          <form onSubmit={submit} className="card mt-6 overflow-hidden">
            <div className="space-y-6 p-5 sm:p-6">
              <div>
                <label htmlFor="sub-email" className={LABEL}>
                  邮箱
                </label>
                <input
                  id="sub-email"
                  type="email"
                  required
                  autoComplete="email"
                  disabled={sending}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`${FIELD} h-11 px-4 text-[14.5px]`}
                />
              </div>

              <div>
                <span className={LABEL}>追哪些乐队</span>
                <p className="mb-3 text-[12.5px] leading-relaxed text-ink-4">
                  {follows.length ? "已按你在本机关注的乐队预选，可以随时改。" : "不选就是全部。只收你关心的那几支也可以，之后随时能改。"}
                </p>
                <BandPicker value={bands} onChange={setBands} disabled={sending} />
              </div>

              <div className="divide-y divide-line-soft border-t border-line-soft">
                <Toggle checked={wantsDeadlines} onChange={setWantsDeadlines} disabled={sending} title="截止提醒" hint="抽选与先行受理的截止日、一般发售开卖日，到期前 48 小时提醒你一次。" />
                <Toggle checked={wantsDigest} onChange={setWantsDigest} disabled={sending} title="精选摘要" hint="每天一封，把当天值得看的几条挑出来。" />
              </div>

              {state.kind === "error" && (
                <p role="alert" className="rounded-tile bg-hot-soft px-3.5 py-2.5 text-[13px] text-hot">
                  {state.message}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-4 border-t border-line-soft bg-bg-sunk/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:bg-bg-muted/30">
              <p className="text-[12px] leading-relaxed text-ink-4 sm:max-w-[400px]">
                提交即表示你同意我们按
                <Link viewTransition to="/privacy" className="text-accent hover:underline">
                  隐私说明
                </Link>
                使用这个地址发信。
              </p>
              <button
                type="submit"
                disabled={sending}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-[background-color,opacity] hover:bg-accent-ink disabled:bg-line-strong disabled:text-ink-4 sm:self-auto"
              >
                {sending && <RingMark className="size-4" spinning />}
                订阅
              </button>
            </div>
          </form>
        </SubscribeShell>
      </ReadingLayout>
    </>
  );
}
