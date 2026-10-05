import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { inkOn } from "@girlsbands/industry/colors";
import { BandTip } from "../../components/ui/BandTip";
import { subjectOfId } from "./bands";

export function BandEqualizer({ counts }: { counts: Record<string, number> }) {
  const bands = Object.entries(ENTITIES).filter(([, e]) => e.kind === 'band');
  const max = Math.max(1, ...Object.values(counts));
  return <><nav className="equalizer" aria-label="乐队近七天消息数">
    {bands.map(([id, e], i) => <Link key={id} to={`/topics/${id}`} aria-label={`${e.name}，近七天 ${counts[id] ?? 0} 条消息`} style={{ '--c': e.accent, '--on': inkOn(e.accent ?? '#ff2d78', '#141216'), '--height': `${Math.max(14, (counts[id] ?? 0) / max * 100)}%`, '--duration': `${.55 + i % 7 * .1}s`, '--delay': `${-i * .13}s` } as CSSProperties}>
      <span className="eq-column"><span className="eq-count display">{counts[id] ?? 0}</span></span><span className="eq-name">{e.displayTag ?? e.name}</span><BandTip subject={subjectOfId(id)!} edge={i < 3 ? 'l' : i >= bands.length - 3 ? 'r' : ''} />
    </Link>)}
  </nav><p className="oshi-legend meta">柱高为近 7 天的消息数</p></>;
}
