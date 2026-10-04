import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { SubscriptionState } from "@girlsbands/contracts/site";
import { SITE } from "@girlsbands/industry/site";
import { IconCheck } from "../components/icons";
import { RingMark } from "../components/Logo";
import { ReadingLayout } from "../components/ui/Page";
import { PhoneBar } from "../components/shell/PhoneBar";
import { BandPicker, LABEL, SubscribeShell, Toggle } from "../features/subscribe/ui";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "订阅设置" };

export function headers() {
  return edgeTtl(60);
}

export function meta() {
  return pageMeta({ title: "订阅设置", description: "修改或退订邮件订阅。", path: "/subscribe/manage", noindex: true });
}

type Phase = "loading" | "ready" | "missing" | "saved" | "unsubscribed" | "error";

export default function SubscribeManagePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const wantsUnsub = params.get("action") === "unsubscribe";

  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [bands, setBands] = useState<string[]>([]);
  const [wantsDeadlines, setWantsDeadlines] = useState(true);
  const [wantsDigest, setWantsDigest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmingUnsub, setConfirmingUnsub] = useState(wantsUnsub);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setPhase("missing");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/site/subscribe/state?token=${encodeURIComponent(token)}`);
        if (!alive) return;
        if (res.status === 404) return setPhase("missing");
        if (!res.ok) return setPhase("error");
        const state = (await res.json()) as SubscriptionState;
        if (!alive) return;
        setEmail(state.email);
        setBands(state.bands);
        setWantsDeadlines(state.wantsDeadlines);
        setWantsDigest(state.wantsDigest);
        setPhase("ready");
      } catch {
        if (alive) setPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const save = async (unsubscribe = false) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/site/subscribe/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, bands, wantsDeadlines, wantsDigest, unsubscribe }),
      });
      if (res.status === 404) return setPhase("missing");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(body.detail ?? "没有保存成功，稍后再试。");
        return;
      }
      setPhase(unsubscribe ? "unsubscribed" : "saved");
    } catch {
      setError("网络不太顺，稍后再试。");
    } finally {
      setBusy(false);
    }
  };

  const done = phase === "saved" || phase === "unsubscribed";
  return (
    <>
      <PhoneBar back={{ to: "/", label: "首页" }} title="订阅设置" />
      <ReadingLayout>
        {phase === "loading" && (
          <div className="card grid place-items-center px-6 py-16">
            <RingMark className="size-6 text-accent" spinning />
            <p className="mt-4 text-[13px] text-ink-4">正在读取你的订阅…</p>
          </div>
        )}

        {(phase === "missing" || phase === "error") && (
          <div className="card px-6 py-14 text-center">
            <h1 data-page-title="" className="text-[22px] font-semibold text-ink">
              {phase === "missing" ? "这个链接不对或已失效" : "暂时读不到订阅"}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
              {phase === "missing" ? "请用最新一封邮件底部的链接进来。如果那封也失效了，重新订阅一次即可。" : "稍后再点一次邮件里的链接。"}
            </p>
            <Link to="/subscribe" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">
              重新订阅
            </Link>
          </div>
        )}

        {done && (
          <div className="card px-6 py-14 text-center">
            <div className="anim-pop-in mx-auto flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok">
              <IconCheck size={26} />
            </div>
            <h1 data-page-title="" className="mt-6 text-[22px] font-semibold text-ink">
              {phase === "unsubscribed" ? "已经退订" : "已保存"}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
              {phase === "unsubscribed" ? `不会再往 ${email} 发订阅邮件了。想回来，随时重新订阅。` : "下次起就按新的设置发信。"}
            </p>
            <Link to="/" className="mt-8 inline-flex h-10 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">
              回到精选
            </Link>
          </div>
        )}

        {phase === "ready" && (
          <SubscribeShell title="订阅设置" lead={<>这封信发到 <span className="font-medium text-ink-2">{email}</span>。改完点保存就生效。</>}>
            <div className="mt-6 space-y-6">
              <div className="card p-5 sm:p-6">
                <span className={LABEL}>追哪些乐队</span>
                <p className="mb-3 text-[12.5px] leading-relaxed text-ink-4">不选就是全部。</p>
                <BandPicker value={bands} onChange={setBands} disabled={busy} />

                <div className="mt-5 divide-y divide-line-soft border-t border-line-soft">
                  <Toggle checked={wantsDeadlines} onChange={setWantsDeadlines} disabled={busy} title="截止提醒" hint="到期前 48 小时提醒一次。" />
                  <Toggle checked={wantsDigest} onChange={setWantsDigest} disabled={busy} title="精选摘要" hint="每天一封，挑几条值得看的。" />
                </div>

                {error && (
                  <p role="alert" className="mt-4 rounded-tile bg-hot-soft px-3.5 py-2.5 text-[13px] text-hot">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(false)}
                  className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-medium text-accent-contrast transition-[background-color,opacity] hover:bg-accent-ink disabled:bg-line-strong disabled:text-ink-4"
                >
                  {busy && <RingMark className="size-4" spinning />}
                  保存
                </button>
              </div>

              <div className="card p-5 sm:p-6">
                <h2 className="text-[14px] font-semibold text-ink">不再收信</h2>
                {confirmingUnsub ? (
                  <>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-3">退订之后不会再收到 {SITE.name} 的任何订阅邮件。想回来随时重新订阅。</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => save(true)}
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-hot px-6 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {busy && <RingMark className="size-4" spinning />}
                        确认退订
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirmingUnsub(false)} className="inline-flex h-10 items-center rounded-full px-6 text-[14px] font-medium text-ink-3 ring-1 ring-inset ring-line-soft transition-colors hover:text-ink">
                        再想想
                      </button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmingUnsub(true)} className="mt-3 text-[13.5px] font-medium text-ink-3 underline decoration-line-strong underline-offset-4 transition-colors hover:text-hot">
                    我要退订
                  </button>
                )}
              </div>
            </div>
          </SubscribeShell>
        )}
      </ReadingLayout>
    </>
  );
}
