// 回填碟的发售日、把同一张碟的重复行并起来（releases/derive.ts 的「同名并行」规则之前落下的）。
//   1. 发售日还空着的行：把它们背后的公告重新投影一次（publishArticle 幂等），让新的
//      「リリース前日 X → X+1」与同名并行规则补上日期。
//   2. 同一乐队、同一个作品名（releaseNameKey）、类型相容、日期不冲突的多行：留有日期、最早的那行，
//      别的行的版本/特典/序列号挪过去（撞了唯一键就丢掉重复的那条），然后删掉。
// 可重复跑。
//   bun scripts/backfill-releases.ts [--dry]
import { closeDb, sql } from "@girlsbands/backend/db";
import { publishArticle } from "@girlsbands/backend/publication/publish";
import { releaseNameKey } from "@girlsbands/backend/releases/derive";

const dry = process.argv.includes("--dry");

const dateless = await sql<{ article_id: string }[]>`
  SELECT DISTINCT p.article_id
  FROM releases r
  JOIN fact_articles fa ON fa.fact_id = r.first_fact_id
  JOIN publications p ON p.article_id = fa.article_id
  WHERE r.release_on IS NULL AND p.visibility <> 'withdrawn'
  UNION
  SELECT r.first_article_id FROM releases r WHERE r.release_on IS NULL AND r.first_article_id IS NOT NULL`;
console.log(`republish: ${dateless.length} articles behind dateless releases`);
if (!dry) {
  let n = 0;
  for (const { article_id } of dateless) {
    try {
      await publishArticle(article_id);
    } catch (error) {
      console.warn(`  ${article_id}: ${(error as Error).message}`);
    }
    if (++n % 50 === 0) console.log(`  ${n}/${dateless.length}`);
  }
}

const compatible = (a: string, b: string) =>
  a === b || a === "other" || b === "other" || (["single", "digital"].includes(a) && ["single", "digital"].includes(b));

const rows = await sql<{ id: string; subject_entity: string; title: string; kind: string; release_on: string | null }[]>`
  SELECT id, subject_entity, title, kind, release_on FROM releases
  ORDER BY subject_entity, (release_on IS NOT NULL) DESC, id`;
const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const key = `${r.subject_entity}\u0000${releaseNameKey(r.title)}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}

let merged = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  const keep: typeof rows = [];
  for (const r of group) {
    const into = keep.find((k) => compatible(k.kind, r.kind) && (!k.release_on || !r.release_on || k.release_on === r.release_on));
    if (!into) {
      keep.push(r);
      continue;
    }
    console.log(`merge ${r.id} 「${r.title}」(${r.kind}, ${r.release_on ?? "—"}) → ${into.id} 「${into.title}」`);
    merged += 1;
    if (dry) continue;
    await sql.begin(async (tx) => {
      await tx`UPDATE releases k SET
          release_on = COALESCE(k.release_on, r.release_on),
          kind = CASE WHEN k.kind = 'other' THEN r.kind ELSE k.kind END,
          announced_on = LEAST(k.announced_on, r.announced_on),
          story_id = COALESCE(k.story_id, r.story_id),
          first_fact_id = COALESCE(k.first_fact_id, r.first_fact_id),
          quote = COALESCE(k.quote, r.quote),
          updated_at = now()
        FROM releases r WHERE k.id = ${into.id} AND r.id = ${r.id}`;
      // 版本按名字对上；对不上的挪过去。特典/序列号同理，撞唯一键的就是重复，留在原行随删除一起走。
      await tx`UPDATE release_bonuses b SET edition_id = ke.id
        FROM release_editions re JOIN release_editions ke ON ke.release_id = ${into.id} AND ke.name = re.name
        WHERE b.release_id = ${r.id} AND b.edition_id = re.id`;
      await tx`UPDATE release_editions e SET release_id = ${into.id}
        WHERE e.release_id = ${r.id} AND NOT EXISTS (SELECT 1 FROM release_editions k WHERE k.release_id = ${into.id} AND k.name = e.name)`;
      await tx`UPDATE release_bonuses b SET release_id = ${into.id}
        WHERE b.release_id = ${r.id} AND NOT EXISTS (
          SELECT 1 FROM release_bonuses k WHERE k.release_id = ${into.id}
            AND COALESCE(k.edition_id, 0) = COALESCE(b.edition_id, 0) AND k.retailer = b.retailer AND k.bonus = b.bonus)`;
      await tx`UPDATE release_serials s SET release_id = ${into.id}
        WHERE s.release_id = ${r.id} AND NOT EXISTS (
          SELECT 1 FROM release_serials k WHERE k.release_id = ${into.id} AND k.kind = s.kind
            AND COALESCE(k.live_event_id, 0) = COALESCE(s.live_event_id, 0) AND COALESCE(k.live_title, '') = COALESCE(s.live_title, ''))`;
      await tx`DELETE FROM releases WHERE id = ${r.id}`;
    });
    if (!into.release_on && r.release_on) into.release_on = r.release_on;
  }
}
console.log(`${dry ? "would merge" : "merged"}: ${merged}`);
await closeDb();
