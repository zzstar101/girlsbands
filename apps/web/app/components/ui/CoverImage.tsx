import { useState } from "react";
import type { CoverView } from "@girlsbands/contracts/site";

/**
 * 一张公告图：走站内图片代理（签名 URL + 多尺寸）。详情页的主视觉与列表里的小缩略图都用它，
 * 尺寸与圆角由调用方的 `className` 给（这里只留底色，免得两套 class 打架）。
 *
 * 没有图、或者图最终加载不出来，就什么都不画 —— 页面保持纯文字，不占位、不留灰框。
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
      className={`bg-bg-sunk ${className}`}
    />
  );
}
