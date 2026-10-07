// 本地预览分享海报：从线上取条目数据和封面，画到 /tmp/poster/<id>.png。
//   node scripts/og/preview-poster.ts <itemId> [...]
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { CATEGORY_LABELS } from "@girlsbands/contracts/taxonomy";
import { beijingDate } from "@girlsbands/contracts/time";
import { ENTITIES } from "@girlsbands/industry/taxonomy";
import { POSTER_IMAGE, POSTER_LOGO, renderPoster } from "../../apps/api/src/og/poster.ts";
import { bandLogoData } from "../../apps/api/src/og/hero.ts";

const SITE = "https://girlsbands.com";
for (const id of process.argv.slice(2)) {
  const d = await (await fetch(`${SITE}/api/site/items/${id}`)).json() as any;
  let image = null;
  if (d.cover?.url) {
    const buf = Buffer.from(await (await fetch(SITE + d.cover.url)).arrayBuffer());
    const meta = await sharp(buf).metadata();
    const scale = Math.min(POSTER_IMAGE.width / meta.width!, POSTER_IMAGE.height / meta.height!, 1);
    const w = Math.round(meta.width! * scale), hgt = Math.round(meta.height! * scale);
    const png = await sharp(buf).resize(w, hgt).jpeg({ quality: 85 }).toBuffer();
    image = { data: `data:image/jpeg;base64,${png.toString("base64")}`, width: w, height: hgt };
  }
  const ids = (d.subjects ?? []).filter((t: string) => ENTITIES[t]);
  const bands = ids.filter((t: string) => ENTITIES[t]!.kind === "band");
  const bid = bands.length === 1 ? bands[0] : (ids.find((t: string) => ENTITIES[t]!.kind === "project") ?? bands[0]);
  const logo = bid ? await bandLogoData(bid, POSTER_LOGO.width, POSTER_LOGO.height) : null;
  const { png } = await renderPoster({
    url: `${SITE}/items/${id}`, kicker: d.category ? CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] : "动态",
    title: d.title, summary: d.summary, source: d.source.name, date: beijingDate(d.timelineAt), selected: d.selected,
    band: bid ? { name: ENTITIES[bid]!.name, accent: ENTITIES[bid]!.accent ?? "#ff2d78", logo, darkPlate: bid === "togenashi-togeari" } : null,
    image: process.argv.includes("--noimg") ? null : image,
  });
  await writeFile(`/tmp/poster/${id}.png`, png);
  console.log(`/tmp/poster/${id}.png`);
}
process.exit(0);
