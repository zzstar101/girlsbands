// 纠错目标与问题类型的中文名（W18）：读者弹层、后台「按目标聚合」视图共用一份，免得两处各写各的。
// 值与后端 packages/backend/src/operations/feedback.ts 的 FEEDBACK_TARGET_KINDS/FIELDS 一一对应。
export type TargetKind = "article" | "story" | "topic" | "release" | "live" | "venue" | "source";

export const TARGET_KIND_LABEL: Record<TargetKind, string> = {
  article: "条目",
  story: "事件",
  topic: "主题",
  release: "发售",
  live: "演出",
  venue: "场馆",
  source: "投稿",
};

export const TARGET_FIELD_LABEL: Record<string, string> = {
  title: "标题或名称",
  date: "日期或时间",
  venue: "场馆",
  price: "票价或费用",
  translation: "中文翻译",
  category: "分类或标签",
  duplicate: "重复收录",
  other: "其他",
};

/** 弹层下拉的顺序（也是后台的显示顺序）。 */
export const TARGET_FIELDS = Object.keys(TARGET_FIELD_LABEL);

/** 后台「跳到该条目」：只有站上有页面的种类跳得过去（W15 决定不做场馆页）。 */
export function targetHref(kind: string, id: string | null): string | null {
  if (!id) return null;
  const slug = encodeURIComponent(id);
  if (kind === "article") return `/items/${slug}`;
  if (kind === "story") return `/story/${slug}`;
  if (kind === "topic") return `/topics/${slug}`;
  if (kind === "release") return `/release/${slug}`;
  if (kind === "live") return `/live/${slug}`;
  return null;
}

export function targetLabel(kind: string): string {
  return TARGET_KIND_LABEL[kind as TargetKind] ?? kind;
}

export function fieldLabel(field: string | null): string | null {
  return field ? (TARGET_FIELD_LABEL[field] ?? field) : null;
}
