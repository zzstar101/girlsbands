import type { CSSProperties } from "react";
import { Link } from "react-router";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { inkOn } from "@girlsbands/industry/colors";
import { BandTip, bandLogo } from "../../components/ui/BandTip";
import { subjectOfId } from "./bands";

export function BandEqualizer({ counts }: { counts: Record<string, number> }) {
  const bands = Object.entries(ENTITIES).filter(([, e]) => e.kind === 'band');
  const max = Math.max(1, ...Object.values(counts));
  return <><nav className="equalizer" aria-label="乐队近七天消息数">
    {bands.map(([id, e], i) => <Link key={id} to={`/topics/${id}`} aria-label={`${e.name}，近七天 ${counts[id] ?? 0} 条消息`} style={{ '--c': e.accent, '--on': inkOn(e.accent ?? '#ff2d78', '#141216'), '--height': `${Math.max(14, (counts[id] ?? 0) / max * 100)}%`, '--duration': `${.55 + i % 7 * .1}s`, '--delay': `${-i * .13}s` } as CSSProperties}>
      <span className="eq-column"><span className="eq-count display">{counts[id] ?? 0}</span></span><span className="eq-name">{e.displayTag ?? e.name}</span><EqLogo id={id} /><BandTip subject={subjectOfId(id)!} edge={i < 3 ? 'l' : i >= bands.length - 3 ? 'r' : ''} />
    </Link>)}
  </nav><p className="oshi-legend meta">柱高为近 7 天的消息数</p></>;
}

// The band's logo lies across the foot of its bar on a small paper label, so a wordmark in the band's own
// colours never sits straight on a bar of that colour. It is a sibling of the column, so the bar's wave
// animation doesn't squash it. On a phone the bars widen and the row scrolls sideways to make room.
// トゲナシトゲアリ's wordmark is half white, which vanishes on a paper label at this size.
const DARK_PLATE = new Set(["togenashi-togeari"]);

function EqLogo({ id }: { id: string }) {
  const logo = bandLogo(id);
  if (!logo) return null;
  return <span className={`eq-logo ${logo.onDark || DARK_PLATE.has(id) ? "dark-logo" : ""}`} aria-hidden="true">
    <img src={logo.src} width={logo.width} height={logo.height} alt="" loading="lazy" />
  </span>;
}
