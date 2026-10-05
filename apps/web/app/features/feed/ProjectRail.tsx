import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { HomeResponse } from "@girlsbands/contracts/site";
import { FRANCHISES, seriesOf, ENTITIES } from "@girlsbands/industry/taxonomy";
import { BandLogo } from "../../components/ui/BandTip";
import { subjectOfId } from "./bands";

export function ProjectRail({ className = "", projects }: { className?: string; projects?: HomeResponse['projects'] }) {
  return <nav aria-label="企划入口" className={`posters ${className}`}>{FRANCHISES.map((id, i) => {
    const subject = subjectOfId(id)!;
    const bands = seriesOf(id).filter((member) => ENTITIES[member]?.kind === 'band');
    const info = projects?.[id];
    return <Link key={id} to={`/topics/${id}`} className="poster" style={{ '--c': subject.accent } as CSSProperties}>
      <span className="p-top"><span className="meta">PROJECT 0{i + 1}</span><span className="meta">{bands.length} 支乐队</span></span>
      <span className="logo"><BandLogo id={id} /></span><span className="sr-only">{subject.label}</span>
      <span className="latest">{info?.latest?.title ?? '暂无近 7 天消息，查看企划归档'}</span>
      <span className="chips" aria-hidden="true">{bands.map((band) => <i key={band} style={{ '--k': ENTITIES[band]?.accent } as CSSProperties} />)}</span>
      {info && <span className="p-foot"><span><b>{info.today}</b> 今天</span><span><b>{info.deadlines}</b> 30 天内截止</span></span>}
    </Link>;
  })}</nav>;
}
