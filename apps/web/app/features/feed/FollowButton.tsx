// 关注: the band and project pages carry the button, and the list of follows lives in this browser alone
// (no account, nothing sent anywhere). Following a project follows its whole series, the same scope its
// topic page already collects.
import { toggleFollow, useIsFollowed } from "../../lib/local-state";
import { IconHeart } from "../../components/icons";
import type { Subject } from "./bands";

/** 关注 / 已关注, in this browser only. */
export function FollowButton({ subject, size = 15, className = "" }: { subject: Subject; size?: number; className?: string }) {
  const followed = useIsFollowed(subject.id);
  return (
    <button
      type="button"
      aria-pressed={followed}
      aria-label={followed ? `取消关注 ${subject.label}` : `关注 ${subject.label}`}
      title={followed ? "取消关注（只记在这台设备上）" : "关注（只记在这台设备上）"}
      onClick={() => toggleFollow(subject.id)}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control px-3 text-[13px] font-medium transition-colors ${followed ? "bg-accent-soft text-accent" : "border border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink"} ${className}`}
    >
      <IconHeart size={size} />
      {followed ? "已关注" : "关注"}
    </button>
  );
}
