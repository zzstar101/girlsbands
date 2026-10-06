// An X item's post as X itself shows it: who posted (avatar, name, @handle), who retweeted it, the text,
// its pictures as a grid that opens large, the quoted post as a card inside, and the time and a way to
// the original underneath. The site's own touch is the band colour on the avatar ring and the card's edge.
import type { CSSProperties, ReactNode } from "react";
import type { XPostView } from "@girlsbands/contracts/site";
import { SourceAvatar } from "../../components/ui/SourceAvatar";
import { fullDateTime } from "../../lib/format";
import { ArticleBody } from "./ArticleBody";
import { MediaGallery } from "./MediaGallery";

type Person = { authorName?: string | null; handle?: string | null; avatarUrl?: string | null; avatarSrcSet?: string };
type XBase = Omit<XPostView, "text" | "translation"> & { text?: string; translation?: string | null };
type XView = XBase & {
  retweetedBy?: { authorName?: string | null; handle: string } | null;
  replyTo?: string | null;
  quoted: (NonNullable<XPostView["quoted"]> & Person & { media?: XPostView["media"] }) | null;
};

export function XLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function RetweetIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
    </svg>
  );
}

const profile = (handle: string) => `https://x.com/${encodeURIComponent(handle)}`;

function Name({ name, handle, size = "md" }: { name: string; handle: string; size?: "md" | "sm" }) {
  return (
    <a href={profile(handle)} target="_blank" rel="noopener noreferrer" className="group/name flex min-w-0 flex-col leading-tight">
      <span className={`truncate font-bold text-ink group-hover/name:underline ${size === "md" ? "text-[16px]" : "text-[14px]"}`}>{name}</span>
      <span className={`truncate text-ink-4 ${size === "md" ? "mt-0.5 text-[14px]" : "text-[13px]"}`}>@{handle}</span>
    </a>
  );
}

export function XPostCard({
  x,
  html,
  original,
  postUrl,
  publishedIso,
  accent,
  head,
}: {
  x: XBase;
  /** The post's text as sanitised HTML (translated or original); its pictures are dropped, they are x.media. */
  html: string | null;
  original: boolean;
  postUrl: string;
  publishedIso: string;
  accent?: string | null;
  /** Above the text, inside the card: the 正文 label and language tabs. */
  head?: ReactNode;
}) {
  const post = x as XView;
  const quoted = post.quoted?.text ? post.quoted : null;
  const quotedText = quoted ? (original ? quoted.text : quoted.translation ?? quoted.text) : null;
  const style = { "--x-accent": accent ?? "var(--accent)" } as CSSProperties;
  return (
    <figure className="x-card" style={style}>
      {post.retweetedBy && (
        <div className="mb-2 flex items-center gap-1.5 pl-[18px] text-[13px] font-semibold text-ink-4">
          <RetweetIcon />
          <a href={profile(post.retweetedBy.handle)} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {post.retweetedBy.authorName || `@${post.retweetedBy.handle}`}
          </a>
          <span>转发了</span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <a href={profile(x.handle)} target="_blank" rel="noopener noreferrer" className="x-avatar shrink-0" aria-label={`@${x.handle}`}>
          <SourceAvatar name={x.authorName || x.handle} avatarUrl={x.avatarUrl} avatarSrcSet={x.avatarSrcSet} size={48} />
        </a>
        <div className="min-w-0 flex-1 pt-0.5">
          <Name name={x.authorName || `@${x.handle}`} handle={x.handle} />
        </div>
        <a href={postUrl} target="_blank" rel="noopener noreferrer" aria-label="在 X 打开" className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-bg-sunk hover:text-ink">
          <XLogo size={18} />
        </a>
      </div>

      {post.replyTo && <div className="mt-3 text-[14px] text-ink-4">回复 <span className="text-accent">@{post.replyTo}</span></div>}

      {head && <div className="mt-4">{head}</div>}

      {html ? (
        <ArticleBody html={html} dropImages gallery={false} className="prose x-text mt-3" />
      ) : (
        x.text && <p className="x-text mt-3 whitespace-pre-line">{original ? x.text : x.translation ?? x.text}</p>
      )}

      {x.media.length > 0 && <MediaGallery media={x.media} postUrl={postUrl} />}

      {quoted && (
        <a href={quoted.url || postUrl} target="_blank" rel="noopener noreferrer" className="x-quote mt-4 block">
          <div className="flex items-center gap-2 text-[14px]">
            <SourceAvatar name={quoted.authorName || quoted.handle} avatarUrl={quoted.avatarUrl} avatarSrcSet={quoted.avatarSrcSet} size={22} />
            <span className="truncate font-bold text-ink">{quoted.authorName || `@${quoted.handle}`}</span>
            {quoted.authorName && <span className="truncate text-ink-4">@{quoted.handle}</span>}
          </div>
          <p className="mt-1.5 whitespace-pre-line text-[15px] leading-[1.7] text-ink-2">{quotedText}</p>
          {!original && quoted.translation && <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13px] leading-[1.6] text-ink-4">{quoted.text}</p>}
          {quoted.media && quoted.media.length > 0 && (
            <div className="mt-2.5 grid grid-cols-2 gap-1.5 overflow-hidden rounded-tile">
              {quoted.media.slice(0, 4).map((m) => (
                <img key={m.url} src={m.poster ?? m.url} srcSet={m.srcSet} sizes="240px" alt={m.alt ?? ""} loading="lazy" decoding="async" className={`block w-full bg-bg-sunk object-cover ${quoted.media!.length === 1 ? "col-span-2 max-h-[280px]" : "aspect-[16/10]"}`} />
              ))}
            </div>
          )}
        </a>
      )}

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-soft pt-3 text-[13.5px] text-ink-4">
        <a href={postUrl} target="_blank" rel="noopener noreferrer" className="mono hover:underline">
          <time dateTime={publishedIso}>{fullDateTime(publishedIso)}</time>
        </a>
        <span aria-hidden="true">·</span>
        <span>X</span>
        <a href={postUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-ink-2 transition-colors hover:text-accent">
          在 X 查看 <XLogo size={12} />
        </a>
      </figcaption>
    </figure>
  );
}
