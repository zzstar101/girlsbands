// 声优日常里的一条帖子，照 X 的样子画：头像在左，名字、@、时间一行，然后是帖子正文、图片、
// 引用的帖子，最后是「在 X 上看」。没有 AI 导读：外语帖默认显示中文译文，正文上方一行
// 「由 少女乐队's 翻译 · 显示原文」可以切回原文（X 上是「由 Grok 翻译」）。整张卡点进站内
// 详情页；头像和名字留在这一页，只看这一个人。
import { useState, type CSSProperties, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { SeiyuuPost } from "@girlsbands/contracts/site";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { SourceAvatar } from "../../components/ui/SourceAvatar";
import { fullDateTime, relativeTime } from "../../lib/format";
import { MediaGallery } from "../item/MediaGallery";
import { XLogo } from "../item/XPostCard";
import { InlineWordmark } from "../../components/Logo";

/** 信源名里给编辑看的「X」后缀（「朱李 X」）在时间线上是多余的。 */
export function personName(name: string): string {
  return name.replace(/\s*[XＸ]$/, "") || name;
}

/** 只看这一个账号的地址。 */
export function accountHref(id: string): string {
  return `/seiyuu?account=${encodeURIComponent(id)}`;
}

function RetweetIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
    </svg>
  );
}

/** 「由 少女乐队's 翻译 · 显示原文」：译文和原文之间来回切。 */
function TranslatedBy({ original, onToggle }: { original: boolean; onToggle: () => void }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-4">
      <span>由</span>
      <InlineWordmark height={15} className="translate-y-px" />
      <span>翻译</span>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onToggle} aria-pressed={original} className="font-semibold text-accent transition-colors hover:text-accent-ink hover:underline">
        {original ? "显示译文" : "显示原文"}
      </button>
    </div>
  );
}

export function SeiyuuPostCard({ post }: { post: SeiyuuPost }) {
  const navigate = useNavigate();
  // 一张卡一个开关：正文和引用帖一起在译文、原文之间切。
  const [original, setOriginal] = useState(false);
  const x = post.x;
  const name = x?.authorName || personName(post.account.name);
  const handle = x?.handle || post.account.handle;
  const avatar = x?.avatarUrl ?? post.account.avatarUrl;
  // 发版那一分钟里，缓存着的旧接口响应还没有 postedAt：退回旧的取法，别让整页 500。
  const at = (post.postedAt as string | undefined) ?? post.publishedAt ?? post.timelineAt;
  const band = ENTITIES[post.band];
  const style = { "--x-accent": band?.accent ?? "var(--accent)" } as CSSProperties;
  const detail = `/items/${post.id}`;
  const quoted = x?.quoted?.text ? x.quoted : null;

  // 整张卡可点：点在空白和正文上进详情页，点在链接、按钮和图片上各做各的事；选中文字时不跳。
  const open = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(detail, "_blank");
    else navigate(detail, { viewTransition: true });
  };

  return (
    <article style={style} onClick={open} className="sy-post group/post relative flex cursor-pointer gap-2.5 border-b border-line-soft px-3 py-3 transition-colors last:border-b-0 hover:bg-bg-sunk/60 sm:px-4">
      <Link to={accountHref(post.account.id)} viewTransition className="x-avatar mt-0.5 h-fit shrink-0" aria-label={`只看 ${name}`}>
        {/* .x-avatar 把直接子元素设成 block，首字母占位要再包一层才能居中 */}
        <span className="flex rounded-full">
          <SourceAvatar name={name} avatarUrl={avatar} avatarSrcSet={x?.avatarSrcSet} size={40} />
        </span>
      </Link>

      <div className="min-w-0 flex-1">
        {x?.retweetedBy && (
          <div className="mb-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-4">
            <RetweetIcon />
            <span className="truncate">{x.retweetedBy.authorName || `@${x.retweetedBy.handle}`} 转发了</span>
          </div>
        )}
        <div className="flex min-w-0 items-baseline gap-1.5 text-[14.5px] leading-snug">
          <Link to={accountHref(post.account.id)} viewTransition className="min-w-0 truncate font-bold text-ink hover:underline">
            {name}
          </Link>
          {handle && <span className="min-w-0 truncate text-ink-4">@{handle}</span>}
          <span aria-hidden="true" className="shrink-0 text-ink-4">·</span>
          <time dateTime={at} title={fullDateTime(at)} className="shrink-0 text-ink-4">
            {relativeTime(at)}
          </time>
          {band && <span className="ml-auto hidden shrink-0 pl-2 text-[11.5px] font-semibold text-ink-4 sm:inline">{band.displayTag ?? band.name}</span>}
        </div>
        {x?.replyTo && <div className="mt-0.5 text-[13px] text-ink-4">回复 <span className="text-accent">@{x.replyTo}</span></div>}

        {x?.text ? (
          <>
            {x.translation && <TranslatedBy original={original} onToggle={() => setOriginal((v) => !v)} />}
            <p lang={x.translation && !original ? "zh-CN" : "ja"} className="mt-1 whitespace-pre-line break-words text-[15.5px] leading-[1.65] text-ink">
              {x.translation && !original ? x.translation : x.text}
            </p>
          </>
        ) : (
          // 没有原帖正文的旧数据（全文没授权或镜像没抓到）：只能放站里的中文摘要。
          post.summary && <p className="mt-1 whitespace-pre-line break-words text-[15.5px] leading-[1.65] text-ink">{post.summary}</p>
        )}

        {x && x.media.length > 0 && (
          <div className="-mt-2">
            <MediaGallery media={x.media.slice(0, 4)} postUrl={post.url} />
          </div>
        )}

        {quoted && (
          <a href={quoted.url || post.url} target="_blank" rel="noopener noreferrer" className="x-quote mt-3 block rounded-tile">
            <div className="flex items-center gap-2 text-[13.5px]">
              <SourceAvatar name={quoted.authorName || quoted.handle} avatarUrl={quoted.avatarUrl} avatarSrcSet={quoted.avatarSrcSet} size={20} />
              <span className="truncate font-bold text-ink">{quoted.authorName || `@${quoted.handle}`}</span>
              {quoted.authorName && <span className="truncate text-ink-4">@{quoted.handle}</span>}
            </div>
            <p className="mt-1 line-clamp-4 whitespace-pre-line text-[14px] leading-[1.6] text-ink-2">{quoted.translation && !original ? quoted.translation : quoted.text}</p>
          </a>
        )}

        <div className="mt-2.5 flex items-center gap-4 text-[12.5px] text-ink-4">
          <Link to={detail} viewTransition className="font-semibold transition-colors hover:text-accent">详情</Link>
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold transition-colors hover:text-ink">
            在 X 上看 <XLogo size={11} />
          </a>
        </div>
      </div>
    </article>
  );
}
