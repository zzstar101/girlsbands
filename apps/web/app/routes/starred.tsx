import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { ItemAvailability } from "@girlsbands/contracts/site";
import { SITE } from "@girlsbands/industry/site";
import { Presence } from "../components/ui/Presence";
import { edgeTtl } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { exportBundle, importBundle, removeStar, toggleFollow, useFollows, useStarred, type ImportReport } from "../lib/local-state";
import { subjectOfId } from "../features/feed/bands";
import { fullDateTime } from "../lib/format";
import { IconBookmark, IconDownload, IconClose } from "../components/icons";
import { readSnapshot, restoreAnchor, useSaveOnLeave } from "../lib/restore";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "收藏" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: "我的收藏", description: `保存在这台设备上的 ${SITE.name} 收藏与关注。`, path: "/starred", noindex: true });
}

function reportText(r: ImportReport): string {
  const parts = [`新增收藏 ${r.starredAdded} 条`, `已读记录 ${r.readAdded} 条`];
  if (r.followsAdded) parts.push(`新增关注 ${r.followsAdded} 个`);
  if (r.starredSkipped || r.readSkipped || r.followsSkipped) parts.push(`超出上限或格式不对而跳过 ${r.starredSkipped + r.readSkipped + r.followsSkipped} 条`);
  if (r.themeApplied) parts.push("已沿用导入的主题");
  if (r.readFailed) parts.push("已读记录没能保存（浏览器存储已满或不可用）");
  if (r.followsFailed) parts.push("关注没能保存（浏览器存储已满或不可用）");
  return parts.join("，");
}

export default function StarredPage() {
  const starred = useStarred();
  const follows = useFollows();
  const [mounted, setMounted] = useState(false);
  const [availability, setAvailability] = useState<Record<string, ItemAvailability>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setMounted(true), []);

  const starredIds = starred.map((s) => s.id).join(",");
  useEffect(() => {
    if (!mounted || !starredIds) return;
    const controller = new AbortController();
    // Batches of 100: a request line with all 500 ids is longer than the front servers accept.
    const ids = starredIds.split(",");
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
    Promise.all(
      batches.map((batch) =>
        fetch(`/api/site/items/availability?ids=${encodeURIComponent(batch.join(","))}`, { signal: controller.signal })
          .then((r) => (r.ok ? (r.json() as Promise<Record<string, ItemAvailability>>) : {}))
          .catch(() => ({})),
      ),
    ).then((parts) => {
      if (!controller.signal.aborted) setAvailability(Object.assign({}, ...parts));
    });
    return () => controller.abort();
  }, [mounted, starredIds]);

  // Back from an item: the list renders only after mounting (it lives in this browser), so the
  // position comes back once it is there, by the same card anchor the other lists use.
  const historyKey = useLocation().key;
  useLayoutEffect(() => {
    if (!mounted || starred.length === 0) return;
    const snap = readSnapshot<null>(historyKey);
    if (snap) restoreAnchor(snap.anchor, snap.scrollY);
  }, [mounted, historyKey]);
  useSaveOnLeave(historyKey, () => null);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportBundle(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${SITE.mcpPrefix}-local-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const report = importBundle(await file.text());
      setNotice({ kind: report.readFailed || report.followsFailed ? "error" : "ok", text: `导入完成：${reportText(report)}` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "导入失败" });
    }
  };

  const action = "text-[12.5px] text-ink-3 transition-colors hover:text-accent";
  return (
    <div className="pb-12">
      <PhoneBar back={{ to: "/more", label: "我的" }} title="收藏" />
      <header className="flex flex-col gap-2 pb-4 pt-3 sm:flex-row sm:items-start sm:justify-between lg:pt-1">
        <div>
          <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">收藏</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">本机收藏的 {SITE.name} 内容，以及关注的乐队；适合稍后阅读和回看。</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:pt-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} className={action}>
            导入文件
          </button>
          {mounted && (starred.length > 0 || follows.length > 0) && (
            <button type="button" onClick={doExport} className={`${action} inline-flex items-center gap-1`}>
              <IconDownload size={13} /> 导出
            </button>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => doImport(e.target.files?.[0])} />
        </div>
      </header>
      {/* 关注: the same browser-local list the 只看关注 switch filters by; each chip opens the band, the × drops it. */}
      {mounted && (
        <section aria-label="关注的乐队" className="mb-3 rounded-card border border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-ink-2">
              关注的乐队 <span className="num text-ink-4">{follows.length}</span>
            </h2>
            {follows.length > 0 && (
              <Link to={`/?subjects=${[...follows].sort().join(",")}`} className="text-[12.5px] text-ink-3 transition-colors hover:text-accent">
                只看它们的内容 →
              </Link>
            )}
          </div>
          {follows.length === 0 ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
              还没关注任何乐队。去<Link to="/#bands" className="text-accent hover:underline">首页的乐队列表</Link>或企划页点「关注」，关注过的会列在这里，首页与全部动态也能只看它们。
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {follows.map((id) => {
                const subject = subjectOfId(id);
                if (!subject) return null;
                return (
                  <li key={id} className="inline-flex items-center rounded-control bg-bg-sunk pr-1 dark:bg-bg-muted/60">
                    <Link to={`/topics/${id}`} className="py-1.5 pl-3 text-[13px] font-medium text-ink transition-opacity hover:opacity-70">
                      {subject.label}
                    </Link>
                    <button type="button" aria-label={`取消关注 ${subject.label}`} title="取消关注" onClick={() => toggleFollow(id)} className="grid size-7 place-items-center rounded-control text-ink-4 transition-colors hover:bg-surface hover:text-ink">
                      <IconClose size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      <p className="rounded-tile border border-line bg-surface px-4 py-2.5 text-[12.5px] text-ink-3">收藏与关注只保存在当前浏览器；清除浏览器数据或换设备后不会同步。</p>
      <Presence show={!!notice} enter="anim-notice-in" exit="anim-fade-out" duration={160}>
        <div
          role="status"
          className={`mt-3 flex items-start justify-between gap-3 rounded-tile px-4 py-2.5 text-[13px] ${notice?.kind === "ok" ? "bg-accent-soft text-accent-ink dark:text-accent" : "bg-hot-soft text-hot"}`}
        >
          {notice?.text}
          <button type="button" aria-label="关闭" onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <IconClose size={14} />
          </button>
        </div>
      </Presence>
      {!mounted ? null : starred.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
          <IconBookmark size={20} className="text-ink-4" />
          <p className="mt-3 text-[13px] text-ink-3">还没有收藏内容。点开任意一条内容，在详情页点击收藏即可添加。</p>
          <Link to="/" className="mt-4 text-[12.5px] font-medium text-accent hover:text-accent-ink">
            去看精选 →
          </Link>
        </div>
      ) : (
        <ul className="mt-3 lg:space-y-3">
          {starred.map((s) => {
            const current = availability[s.id];
            const status = current?.status;
            const unavailable = status === "unavailable";
            return (
              <li key={s.id} data-card-key={s.id} className={`relative border-b border-line-soft py-4 lg:card lg:px-[18px] lg:py-[15px] ${unavailable ? "opacity-70" : "lg:card-hover"}`}>
                <div className="flex items-center gap-2 text-[12.5px] text-ink-4">
                  <span className="min-w-0 truncate text-ink-3">{current?.sourceName ?? s.sourceName}</span>
                  {s.publishedAt && <span className="num shrink-0">· {fullDateTime(s.publishedAt)}</span>}
                  <span className="ml-auto hidden shrink-0 sm:inline">
                    收藏于 <span className="num">{fullDateTime(s.savedAt)}</span>
                  </span>
                  <button type="button" aria-label="取消收藏" title="取消收藏" onClick={() => removeStar(s.id)} className="relative z-10 -my-1 ml-auto grid size-7 shrink-0 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink sm:ml-0">
                    <IconClose size={14} />
                  </button>
                </div>
                <h2 className="mt-1.5 text-[16px] font-[650] leading-[1.55] text-ink">
                  {unavailable ? (
                    s.title
                  ) : (
                    <Link viewTransition to={`/items/${s.id}`} className="transition-colors after:absolute after:inset-0 after:content-[''] hover:text-accent">
                      {s.title}
                    </Link>
                  )}
                </h2>
                {s.summary && <p className="mt-1.5 line-clamp-2 text-[14px] leading-[1.75] text-ink-3">{s.summary}</p>}
                {unavailable && <p className="mt-2 text-[12.5px] text-hot">这条内容已不再公开，收藏会保留直到你手动移除。</p>}
                {status === "summary-only" && <p className="mt-2 text-[12.5px] text-amber-ink">应来源方要求，这条内容现在只提供摘要。</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
