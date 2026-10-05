import { Link } from "react-router";
import { DEADLINE_LABELS, type DeadlinesResponse } from "@girlsbands/contracts/site";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { ArtistLine } from "../../components/ui/ArtistBadge";
import { subjectOfId, type Subject } from "./bands";
import { Countdown, daysAway } from "./Ticket";
import { clockText, md } from "./deadlines";

export function DeadlineRadar({ data }: { data: DeadlinesResponse }) {
  const items = data.days.flatMap((d) => d.items).filter((d) => d.kind === 'lottery_end' || d.kind === 'stream_end').slice(0, 5);
  return <section><SectionHeader title="截止雷达" kicker="RADAR" aside={<Link to="/deadlines">全部</Link>} />
    {items.length ? <ol className="radar">{items.map((d, i) => <li key={`${d.itemId}-${d.at}-${i}`} className={d.soon ? 'soon' : ''}>
      <div className="dn"><b>{daysAway(d.day, data.from)}</b><span>{md(d.day)}</span></div><div>
        <div className="k act">{DEADLINE_LABELS[d.kind].label}<i>{clockText(d.localTime, d.timezone)}</i></div>
        <Countdown at={d.at} timezone={d.timezone} from={data.from} /><Link className="tt block" to={`/items/${d.itemId}`}>{d.title}</Link>
        <ArtistLine subjects={d.subjects.map(subjectOfId).filter((s): s is Subject => !!s)} className="mt-2" />
      </div>
    </li>)}</ol> : <p className="py-4 text-[13px] text-ink-3">未来 30 天暂无已收录的截止。</p>}
  </section>;
}

export function SubscribeBlock() {
  return <section className="sub"><span className="big" aria-hidden="true">MAIL</span><h3>截止提醒邮件</h3><p>抽选和发售截止前 48 小时提醒，只包含你选择的乐队。也可以订阅每日精选。</p><div className="row relative"><Link to="/subscribe">订阅</Link><a href="/calendar.ics">日历订阅</a></div></section>;
}
