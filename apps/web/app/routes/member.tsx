// /member/<id>：一个角色的页面。名字、担当、声优与别名来自 industry/members.ts（经 /api/site/members/<id>），
// 报道列表来自 member_mentions 的投影。报道还没有的角色页照常能打开，只是空列表 + noindex。
import type { CSSProperties } from "react";
import type { MemberPage } from "@girlsbands/contracts/site";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/member";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { pageMeta, titled } from "../lib/seo";
import { DayList, Pagination } from "../features/feed/DayList";
import { subjectOfId } from "../features/feed/bands";
import { memberPath } from "../features/topic/member";
import { EmptyState } from "../components/ui/Page";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { IconArrowLeft } from "../components/icons";

export const handle: Screen = { home: "feed", name: "角色" };

/** 报道列表跟着 api 的一分钟走（与主题页同一档）。 */
export function headers() {
  return edgeTtl(60);
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
  // 非正整数、非整数（含 "1.5"、""）都当不存在的页；api 那边超过页数也返回 404。
  if (!Number.isInteger(page) || page < 1) throw new Response("Not found", { status: 404 });
  const data = await loadOr404<MemberPage>(`/api/site/members/${encodeURIComponent(params.id)}?page=${page}`, { signal: request.signal });
  return { data };
}

/** 搜索摘要：谁、在哪个乐队、什么担当和声优，最近被报道的是什么。 */
function description(data: MemberPage): string {
  const { member } = data;
  const facts = [member.role, member.actor?.name ? `声优 ${member.actor.name}` : ""].filter(Boolean).join("，");
  const head = `${member.bandName}的${member.name}${facts ? `（${facts}）` : ""}`;
  const news = member.latest ? `最近：${member.latest.title.replace(/[。.]$/u, "")}。` : "";
  const counts = member.total > 0 ? `本站已收录 ${member.total} 条相关消息。` : "";
  const text = `${head}。${news}${counts}`;
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("角色不存在") }, { name: "robots", content: "noindex" }];
  const { data } = loaderData;
  const { member, page } = data;
  return pageMeta({
    title: `${member.name} 最新动态${page > 1 ? ` · 第 ${page} 页` : ""}`,
    description: description(data),
    path: page > 1 ? `${memberPath(member.id)}?page=${page}` : memberPath(member.id),
    image: `/og/members/${member.id}.png`,
    // 报道不足 5 篇的页、以及第 2 页起都留在索引外；页面本身照常能打开。
    noindex: !member.indexable || page > 1,
  });
}

export default function MemberRoute() {
  const { data } = useLoaderData<typeof loader>();
  const { member, bandmates, items, page, pageCount } = data;
  // 角色页用所属乐队的 accent（和主题页一样，只上规则与链接，不铺整页）。
  const band = subjectOfId(member.band);
  const style = band?.accent ? ({ "--band-accent": band.accent, "--accent": band.accent, "--pink": band.accent } as CSSProperties) : undefined;
  const others = member.forms.slice(1);
  const first = (page - 1) * data.pageSize + 1;
  const last = first + items.length - 1;
  return (
    <div className="pb-6" style={style}>
      <PhoneBar back={{ to: "/members", label: "角色" }} title={member.name} />
      <Link to="/members" className="hidden items-center gap-1.5 py-2 text-[13px] text-ink-3 transition-colors hover:text-accent lg:inline-flex">
        <IconArrowLeft size={14} /> 全部角色
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-3 lg:pt-1">
        <div className="min-w-0 max-w-[760px]">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-band">
            <span aria-hidden="true" className="h-[2px] w-6 flex-none rounded-full bg-band" />
            {member.bandName}
          </p>
          <h1 data-page-title="" className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">
            {member.name}
          </h1>
          {others.length > 0 && <p className="mt-1 text-[13px] text-ink-3">{others.join(" · ")}</p>}
          {member.aliases.length > 0 && (
            <p className="mt-1 text-[12.5px] text-ink-4">
              <span className="meta mr-1.5">别名</span>
              {member.aliases.join(" · ")}
            </p>
          )}
          <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-4">
            {member.role && (
              <span>
                担当 <span className="font-semibold text-ink-2">{member.role}</span>
              </span>
            )}
            {member.actor && (
              <span>
                声优 <span className="font-semibold text-ink-2">{member.actor.name}</span>
              </span>
            )}
            <span>
              <span className="num font-semibold text-ink-2">{member.total.toLocaleString("zh-CN")}</span> 条报道
            </span>
            {member.recent > 0 && (
              <span>
                近 30 天 <span className="num font-semibold text-ink-2">{member.recent.toLocaleString("zh-CN")}</span> 条
              </span>
            )}
          </p>
        </div>
        <Link viewTransition to={`/topics/${member.band}`} className="text-[12.5px] font-semibold text-accent hover:text-accent-ink">
          {member.bandName} 主题页 →
        </Link>
      </header>

      {bandmates.length > 0 && (
        <nav aria-label="同队成员" className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-y border-line py-2.5 text-[13px]">
          <span className="meta text-ink-4">同队</span>
          {bandmates.map((m) => (
            <Link key={m.id} viewTransition to={memberPath(m.id)} prefetch="intent" className="text-ink-2 transition-colors hover:text-accent">
              {m.name}
            </Link>
          ))}
        </nav>
      )}

      <h2 className="mb-3 text-[16px] font-[650] text-ink">相关报道</h2>
      {items.length === 0 ? (
        <div className="lg:card">
          <EmptyState
            title="还没有报道提到这个角色"
            action={
              <Link viewTransition to={`/topics/${member.band}`} className="text-[13px] font-semibold text-accent hover:text-accent-ink">
                {member.bandName} 的动态 →
              </Link>
            }
          >
            等有报道提到这个名字时，这里会自动列出来。
          </EmptyState>
        </div>
      ) : (
        <DayList items={items} headerAside={<span className="num whitespace-nowrap">第 {first}–{last} 条 · 共 {member.total.toLocaleString("zh-CN")} 条</span>} />
      )}
      <Pagination page={page} pageCount={pageCount} href={(p) => (p <= 1 ? memberPath(member.id) : `${memberPath(member.id)}?page=${p}`)} />
    </div>
  );
}
