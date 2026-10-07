// 邮件头图第二版（宣传图）：1200×450，显示 600×225。地址与口号见 industry/email/promo.ts。
// 白纸主题的淡粉底 + 粉点阵、左上网站 logo、右上 ISSUE 日期章、口号（小字引子 + 胶带黄大字牌）、
// 底下一条企划名胶带。不画任何乐队：这是网站自己的门面。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "@girlsbands/backend/config";
import { PROMO_CANVAS, PROMO_LINES } from "@girlsbands/industry/email/promo";
import type { TitleKind } from "@girlsbands/industry/email/title";
import { ENTITIES, FRANCHISES } from "@girlsbands/industry/taxonomy";
import { h, LATIN_DISPLAY_FAMILY, renderPng, type Node } from "./render.ts";

export const PROMO_TEMPLATE_VERSION = "promo-2026-10-08.2";

const INK = "#141216";
const PINK = "#e6005f";
const TAPE = "#ffe600";
const PAPER = "#ffffff";

let lockup: Promise<{ data: string; ratio: number }> | null = null;
/** 网站顶栏同一张 logo（白纸主题那版：墨色方块 + 墨色字）。 */
export function siteLockup(variant: "light" | "dark" = "light"): Promise<{ data: string; ratio: number }> {
  const load = async () => {
    const svg = await readFile(path.join(REPO_ROOT, `industry/brand/a1-lockup-${variant}.svg`), "utf8");
    const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const ratio = m ? Number(m[1]) / Number(m[2]) : 356 / 112;
    return { data: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, ratio };
  };
  if (variant === "dark") return load();
  return (lockup ??= load());
}

/** 底下那条胶带：全部企划名。 */
function projectNames(): string {
  return FRANCHISES.map((id) => ENTITIES[id]!.name).join("  /  ");
}

async function tree(kind: TitleKind, date: string): Promise<Node> {
  const logo = await siteLockup("light");
  const line = PROMO_LINES[kind];
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  const issue = m ? `${m[1]}.${m[2]}` : "";
  const logoH = 76;
  return h("div", {
    width: PROMO_CANVAS.width, height: PROMO_CANVAS.height, display: "flex", flexDirection: "column", position: "relative",
    padding: "40px 56px 0", fontFamily: "Noto Sans SC", color: INK, overflow: "hidden",
    backgroundColor: "#ffe4ee",
    backgroundImage: "radial-gradient(circle, rgba(230,0,95,0.16) 2px, rgba(255,228,238,0) 3px)",
    backgroundSize: "26px 26px",
  }, [
    // 右边一个巨号日期做鬼影。
    issue ? h("div", { position: "absolute", right: 36, top: 96, display: "flex", fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 230, lineHeight: 1, color: "rgba(230,0,95,0.13)", letterSpacing: -4 }, issue) : null,
    h("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
      h("img", { width: Math.round(logoH * logo.ratio), height: logoH }, undefined, { src: logo.data, width: Math.round(logoH * logo.ratio), height: logoH }),
      issue
        ? h("div", { display: "flex", padding: "4px 18px 2px", border: `4px solid ${INK}`, backgroundColor: PAPER, fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 38, letterSpacing: 1 }, `ISSUE ${issue}`)
        : h("div", { display: "flex", fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 30, color: PINK, letterSpacing: 3 }, "GIRLSBANDS.COM"),
    ].filter(Boolean)),
    h("div", { display: "flex", marginTop: 26, fontSize: 52, fontWeight: 700, lineHeight: 1 }, line.kicker),
    h("div", { display: "flex", marginTop: 18, alignSelf: "flex-start", position: "relative" }, [
      h("div", { position: "absolute", left: 14, top: 14, right: -14, bottom: -14, backgroundColor: PINK, transform: "rotate(-2deg)" }),
      h("div", { display: "flex", padding: "6px 30px 14px", backgroundColor: TAPE, transform: "rotate(-2deg)", fontSize: 128, fontWeight: 700, lineHeight: 1.05, letterSpacing: 4 }, line.big),
    ]),
    h("div", {
      position: "absolute", left: -20, right: -20, bottom: 26, height: 50, display: "flex", alignItems: "center", paddingLeft: 76,
      backgroundColor: INK, color: PAPER, transform: "rotate(-1deg)", fontSize: 24, fontWeight: 700, letterSpacing: 1,
    }, [
      h("div", { display: "flex", fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 28, color: TAPE, marginRight: 22, letterSpacing: 2 }, "LIVE · TICKET · RELEASE"),
      h("div", { display: "flex" }, projectNames()),
    ]),
  ].filter(Boolean));
}

export function promoEtag(kind: TitleKind, date: string): string {
  return createHash("sha256").update(PROMO_TEMPLATE_VERSION).update(`${kind}|${date}|${projectNames()}`).digest("hex").slice(0, 24);
}

export async function renderPromo(kind: TitleKind, date: string): Promise<{ png: Buffer; etag: string }> {
  const etag = promoEtag(kind, date);
  return { png: await renderPng(`promo-${etag}`, PROMO_CANVAS, () => tree(kind, date)), etag };
}
