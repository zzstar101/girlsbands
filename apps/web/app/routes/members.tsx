// /members：角色目录。按企划分组，每组里按乐队列出成员，点进 /member/<id>。
// 名录本身是静态的（industry/members.ts），报道计数由 /api/site/members 一次给全。
import type { MemberSummary, MembersResponse } from "@girlsbands/contracts/site";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/members";
import { edgeTtl, loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { SectionHeader } from "../components/ui/SectionHeader";
import { memberPath } from "../features/topic/member";

export const handle: Screen = { home: "feed", name: "角色" };

/** 目录只跟 api 那份五分钟的名单一起变。 */
export function headers() {
  return edgeTtl(300);
}

export async function loader({ request }: Route.LoaderArgs) {
  const data = await loadOr404<MembersResponse>("/api/site/members", { signal: request.signal });
  return { data };
}

export function meta() {
  return pageMeta({
    title: "角色",
    description: "按企划与乐队整理的角色名录：担当、声优与被报道的次数，点开看每个人出现在哪些消息里。",
    path: "/members",
  });
}

/** 一个角色：名字与担当一行，声优与报道数一行；整块可点，不另做卡片。 */
function MemberLink({ member }: { member: MemberSummary }) {
  return (
    <Link viewTransition to={memberPath(member.id)} prefetch="intent" className="flex min-w-0 flex-col gap-0.5 px-1.5 py-1.5 transition-colors hover:bg-bg-sunk">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-[14.5px] font-[650] text-ink">{member.name}</span>
        {member.role && <span className="shrink-0 text-[11.5px] text-ink-4">{member.role}</span>}
      </span>
      <span className="flex min-w-0 items-baseline justify-between gap-2 text-[12px] text-ink-4">
        <span className="min-w-0 truncate">{member.actor?.name}</span>
        <span className="num shrink-0 text-ink-3">{member.total} 条</span>
      </span>
    </Link>
  );
}

/** 一支乐队：名牌一行（accent 小方块 + 队名 + 人数），下面一排角色。 */
function BandBlock({ band }: { band: MembersResponse["groups"][number]["bands"][number] }) {
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {/* 乐队 accent 做小标记：色块只在这里，不铺到整块面板 */}
        <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: band.accent ?? "var(--ink-4)" }} />
        <Link viewTransition to={`/topics/${band.id}`} prefetch="intent" className="min-w-0 truncate text-[15px] font-[650] text-ink transition-colors hover:text-accent">
          {band.name}
        </Link>
        <span className="num ml-auto shrink-0 text-[12px] text-ink-4">{band.members.length} 人</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-2 gap-y-1 p-3 sm:grid-cols-3 lg:grid-cols-4">
        {band.members.map((m) => (
          <li key={m.id} className="min-w-0">
            <MemberLink member={m} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MembersRoute() {
  const { data } = useLoaderData<typeof loader>();
  const total = data.groups.reduce((n, g) => n + g.bands.reduce((k, b) => k + b.members.length, 0), 0);
  return (
    <div className="pb-8">
      <PhoneBar title="角色" large />
      <header className="pb-4 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">角色</h1>
        <p className="mt-1.5 max-w-[760px] text-pretty text-[13.5px] leading-relaxed text-ink-3">
          收录的 {total} 个角色，按企划与乐队分组。点开看每个人出现在哪些报道里。
        </p>
      </header>
      {data.groups.map((group) => (
        <section key={group.project}>
          <SectionHeader
            title={group.projectName}
            count={`${group.bands.reduce((n, b) => n + b.members.length, 0)} 人`}
            aside={<Link viewTransition to={`/topics/${group.project}`}>企划页</Link>}
          />
          {group.bands.map((band) => (
            <BandBlock key={band.id} band={band} />
          ))}
        </section>
      ))}
    </div>
  );
}
