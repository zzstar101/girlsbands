// 主题页「角色」那一段的静态数据：谁属于哪支乐队、在哪个企划下面。
//
// 成员不是抓取主体，名字与担当写在 industry/members.ts，只是页面上的静态名录（和乐队字标一样，
// web 允许直接读 industry/，报道数才走后端 HTTP）。
import { MEMBER_ENTITIES, type MemberEntity } from "@girlsbands/industry/members";
import { ENTITIES, seriesOf } from "@girlsbands/industry/taxonomy";

export interface SubjectMember {
  id: string;
  name: string;
  role: string | null;
  /** 声优名；VTuber 乐队里角色名与本人同名，这里就是同一个名字 */
  actor: string | null;
}

export interface SubjectBand {
  id: string;
  name: string;
  accent: string | null;
  members: SubjectMember[];
}

/** 一支乐队的成员，顺序就是 `MEMBER_ENTITIES` 的书写顺序。 */
function bandMembers(band: string): SubjectMember[] {
  return MEMBER_ENTITIES.filter((m: MemberEntity) => m.band === band).map((m) => ({
    id: m.id,
    name: m.forms[0] ?? m.id,
    role: m.role ?? null,
    actor: m.actor.forms[0] ?? null,
  }));
}

/**
 * 这个主题主体的角色名录：乐队页就是它自己；企划页是系列里有成员的每支乐队（企划自己没有成员，
 * 会被跳过）。顺序跟着 `seriesOf`，也就是 taxonomy 的系列顺序。方向页与不认识的 id 返回空数组。
 */
export function membersOfSubject(subject: string): SubjectBand[] {
  const bands: SubjectBand[] = [];
  for (const id of seriesOf(subject)) {
    const entity = ENTITIES[id];
    if (!entity) continue;
    const members = bandMembers(id);
    if (members.length === 0) continue;
    bands.push({ id, name: entity.name, accent: entity.accent ?? null, members });
  }
  return bands;
}

/** 角色页地址。 */
export function memberPath(id: string): string {
  return `/member/${id}`;
}
