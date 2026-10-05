import { useState } from "react";
import type { CoverView } from "@girlsbands/contracts/site";

/**
 * 详情页的主视觉：公告自己带的那张图，走站内图片代理（签名 URL + hero 的多尺寸）。
 *
 * 没有图、或者图最终加载不出来，就什么都不画 —— 页面保持纯文字头，不占位、不留灰框。
 */
export function CoverImage({
  cover,
  sizes = "(min-width: 1024px) 760px, calc(100vw - 32px)",
  className = "",
  priority = false,
}: {
  cover: CoverView | null;
  sizes?: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (cover === null || failed) return null;
  return (
    <img
      src={cover.url}
      srcSet={cover.srcSet}
      sizes={cover.srcSet ? sizes : undefined}
      alt=""
      width={cover.width ?? undefined}
      height={cover.height ?? undefined}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      onError={() => setFailed(true)}
      className={`h-auto w-full rounded-lg bg-bg-sunk ${className}`}
    />
  );
}
