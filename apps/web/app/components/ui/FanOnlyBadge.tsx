import { FAN_EVENT_LABEL, isFanEvent, type OrganizerKind } from "@girlsbands/contracts/site";

/**
 * 同人 Only：这场活动是粉丝、同人社团或同人站自己办的，乐队不会到场。只标会让读者认错的那一边 ——
 * 官方演出（含第三方对盘与 Fes，乐队真的会来）什么都不加，标记才不会变成人人身上都有的噪声。
 *
 * 形状沿用分类印章的线框语言，但用虚线框跟 `LIVE`／`TICKET` 那种实底印章分开：文字始终在，颜色不单独
 * 承担意义（docs/design.md §9）。
 */
export function FanOnlyBadge({ organizer, className = "" }: { organizer: OrganizerKind | null | undefined; className?: string }) {
  if (!isFanEvent(organizer)) return null;
  return (
    <span className={`fanonly ${className}`} title="同人团体主办的活动，乐队不会到场">
      {FAN_EVENT_LABEL}
    </span>
  );
}
