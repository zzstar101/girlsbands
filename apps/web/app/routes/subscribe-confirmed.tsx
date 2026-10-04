import { Link, useSearchParams } from "react-router";
import { IconCheck, IconClock, IconClose } from "../components/icons";
import { ReadingLayout } from "../components/ui/Page";
import { PhoneBar } from "../components/shell/PhoneBar";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "订阅确认" };

export function headers() {
  return edgeTtl(60);
}

export function meta() {
  return pageMeta({ title: "订阅确认", description: "确认邮件订阅的结果。", path: "/subscribe/confirmed", noindex: true });
}

const COPY = {
  ok: { icon: "check" as const, tone: "bg-ok-soft text-ok", title: "订阅已生效", body: "以后有值得动手的日子和新情报，我们会发到这个邮箱。想改乐队或退订，用每封信底部的链接就行。" },
  expired: { icon: "clock" as const, tone: "bg-amber-soft text-amber", title: "确认链接过期了", body: "确认链接 48 小时内有效。重新提交一次订阅，我们会再发一封。" },
  invalid: { icon: "close" as const, tone: "bg-hot-soft text-hot", title: "这个链接用过了或不对", body: "确认链接只能点一次。如果你已经确认过，那就不用再点；否则重新提交一次订阅。" },
  error: { icon: "close" as const, tone: "bg-hot-soft text-hot", title: "确认没有成功", body: "可能是网络问题，也可能链接已经失效。重新提交一次订阅即可。" },
};

export default function SubscribeConfirmedPage() {
  const [params] = useSearchParams();
  const key = params.get("state") ?? "invalid";
  const copy = COPY[key as keyof typeof COPY] ?? COPY.invalid;
  const Icon = copy.icon === "check" ? IconCheck : copy.icon === "clock" ? IconClock : IconClose;

  return (
    <>
      <PhoneBar back={{ to: "/", label: "首页" }} title="订阅确认" />
      <ReadingLayout>
        <div className="card px-6 py-14 text-center">
          <div className={`anim-pop-in mx-auto flex size-14 items-center justify-center rounded-full ${copy.tone}`}>
            <Icon size={26} />
          </div>
          <h1 data-page-title="" className="mt-6 text-[22px] font-semibold text-ink">
            {copy.title}
          </h1>
          <p className="mx-auto mt-3 max-w-[420px] text-[14px] leading-relaxed text-ink-3">{copy.body}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/subscribe" className="inline-flex h-10 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">
              重新订阅
            </Link>
            <Link to="/" className="inline-flex h-10 items-center rounded-full px-6 text-[14px] font-medium text-ink-3 ring-1 ring-inset ring-line-soft transition-colors hover:text-ink">
              回到精选
            </Link>
          </div>
        </div>
      </ReadingLayout>
    </>
  );
}
