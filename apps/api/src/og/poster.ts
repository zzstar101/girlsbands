// Share posters (1080×1440 PNG) for articles, made for phones: saved from the page or long-pressed in
// chat apps. Same flyer look as the site: black wall, cream paper card with a pink offset shadow, a
// yellow tape strip, the band's official logo on a paper label in its support colour, Anton for Latin
// display type, and the QR code on a ticket stub with punched notches. Same font pipeline as the share
// cards (render.ts); the QR code opens the article on the site.
import { createHash } from "node:crypto";
import { renderSVG } from "uqr";
import { SITE } from "@girlsbands/industry/site";
import { BRAND_FAMILY, clamp, h, LATIN_DISPLAY_FAMILY, renderPng, SITE_HOST, type Node, type OgImage } from "./render.ts";

export const POSTER_TEMPLATE_VERSION = "poster-2026-10-08.2";
const WIDTH = 1080;
const HEIGHT = 1440;
/** The picture's box inside the paper card: the picture is fitted inside it, never cropped. */
const IMAGE_WIDTH = 856;
const IMAGE_HEIGHT = 400;
/** The box itself, for callers that fetch the bytes. */
export const POSTER_IMAGE = { width: IMAGE_WIDTH, height: IMAGE_HEIGHT } as const;
/** The band logo's box on its paper label. */
export const POSTER_LOGO = { width: 250, height: 70 } as const;

export interface PosterBand {
  name: string;
  /** Support colour, #rrggbb. */
  accent: string;
  /** Official logo as a data URL, already fitted into POSTER_LOGO. */
  logo?: { data: string; width: number; height: number } | null;
  /** Light logo ink: the label goes dark instead of paper. */
  darkPlate?: boolean;
}

export interface Poster {
  url: string;
  kicker: string;
  title: string;
  summary: string | null;
  source: string;
  date: string;
  /** True when the item is in 精选. */
  selected: boolean;
  band?: PosterBand | null;
  /** The announcement's own picture, inline as a data URL (see og/cover.ts). */
  image?: OgImage | null;
}

const WALL = "#0b0a0d";
const PAPER = "#f3efe6";
const PAPER_INK = "#141216";
const PINK = "#ff2d78";
const TAPE = "#f2ec1c";
const MUTED = "#6b6570";

/** "2026-10-07" → "10.07" for the stamp. */
function issue(date: string) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1]}.${m[2]}` : date;
}

function bandLabel(band: PosterBand): Node {
  const logo = band.logo ?? null;
  return h("div", {
    display: "flex", alignItems: "center", justifyContent: "center", height: 96, padding: logo ? "0 22px" : "0 26px", transform: "rotate(1.5deg)",
    backgroundColor: logo ? (band.darkPlate ? PAPER_INK : "#ffffff") : band.accent,
    borderLeft: `12px solid ${band.accent}`, boxShadow: `5px 5px 0 ${PAPER_INK}`,
  }, logo
    ? h("img", { width: logo.width, height: logo.height }, undefined, { src: logo.data, width: logo.width, height: logo.height })
    : h("div", { display: "flex", fontSize: 32, fontWeight: 700, color: "#ffffff" }, clamp(band.name, 16)));
}

async function tree(p: Poster): Promise<Node> {
  // A tiny picture (a ticket site's logo, a link-card thumbnail) reads worse than none at all.
  const image = p.image && (p.image.width >= 360 || p.image.height >= 300) ? p.image : null;
  const band = p.band ?? null;
  const title = clamp(p.title, image ? 44 : 80);
  const len = [...title].length;
  const titleSize = image ? (len > 30 ? 46 : 54) : len > 52 ? 58 : len > 32 ? 66 : 78;
  const summary = p.summary ? clamp(p.summary, image ? (len > 30 ? 72 : 96) : len > 52 ? 150 : 200) : null;
  const qr = `data:image/svg+xml;base64,${Buffer.from(renderSVG(p.url, { border: 0, ecc: "M", blackColor: PAPER_INK, whiteColor: "#ffffff" })).toString("base64")}`;

  const header = h("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
    h("div", { display: "flex", alignItems: "center" }, [
      h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 74, height: 74, backgroundColor: PAPER, marginRight: 20 },
        h("div", { display: "flex", fontFamily: BRAND_FAMILY, fontSize: 26, lineHeight: 1, color: PAPER_INK, width: 56, flexWrap: "wrap", textAlign: "center" }, SITE.name.slice(0, 4))),
      h("div", { display: "flex", flexDirection: "column" }, [
        h("div", { display: "flex", fontFamily: BRAND_FAMILY, fontSize: 46, color: PAPER, lineHeight: 1.1 }, SITE.name),
        h("div", { display: "flex", fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 18, letterSpacing: 6, color: "#8a8490", marginTop: 4 }, "GIRLSBANDS"),
      ]),
    ]),
    h("div", { display: "flex", flexDirection: "column", alignItems: "flex-end" }, [
      h("div", { display: "flex", alignItems: "center", padding: "6px 20px 4px", border: `4px solid ${PAPER}`, fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 40, color: PAPER, letterSpacing: 1 }, `ISSUE ${issue(p.date)}`),
      h("div", { display: "flex", marginTop: 10, fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 24, color: PINK, letterSpacing: 2 }, SITE_HOST.toUpperCase()),
    ]),
  ]);

  // The tape strip: category, and 精选 in pink when the item is selected.
  const tape = h("div", { display: "flex", alignItems: "center", marginLeft: -88, paddingLeft: 88, paddingRight: 36, height: 72, backgroundColor: TAPE, transform: "rotate(-1.5deg)" }, [
    h("div", { display: "flex", fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 40, color: PAPER_INK, marginRight: 22, letterSpacing: 1 }, "NEWS"),
    h("div", { width: 14, height: 14, borderRadius: 999, backgroundColor: PINK, marginRight: 22 }),
    h("div", { display: "flex", fontSize: 34, fontWeight: 700, color: PAPER_INK }, clamp(p.kicker, 12)),
    p.selected ? h("div", { display: "flex", marginLeft: 22, padding: "2px 14px", backgroundColor: PINK, color: "#ffffff", fontSize: 28, fontWeight: 700 }, "精选") : null,
  ].filter(Boolean));

  const card = h("div", {
    display: "flex", flexDirection: "column", position: "relative", marginTop: 36, flex: 1,
    padding: image ? "26px 26px 30px" : "52px 44px 40px", backgroundColor: PAPER, color: PAPER_INK,
    boxShadow: `14px 14px 0 ${PINK}`, transform: "rotate(-0.6deg)", overflow: "hidden",
  }, [
    image
      ? h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: IMAGE_WIDTH, height: IMAGE_HEIGHT, backgroundColor: PAPER_INK },
          h("img", { width: image.width, height: image.height, objectFit: "contain" }, undefined, { src: image.data, width: image.width, height: image.height }))
      : null,
    h("div", { display: "flex", flexDirection: "column", padding: image ? "24px 10px 0" : "0" }, [
      h("div", { display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.28, color: PAPER_INK }, title),
      summary ? h("div", { display: "flex", marginTop: image ? 16 : 30, fontSize: image ? 29 : 34, lineHeight: 1.6, color: "#47414c" }, summary) : null,
    ].filter(Boolean)),
  ].filter(Boolean));

  // The tape holding the card to the wall.
  const tapePiece = h("div", { position: "absolute", top: 0, left: 380, width: 220, height: 50, backgroundColor: "rgba(242,236,28,0.82)", transform: "rotate(-4deg)" });

  // The ticket: main part on paper, a dashed perforation with two punched notches, the QR on a yellow stub.
  const notch = (side: "top" | "bottom") =>
    h("div", { position: "absolute", left: 620 - 22, [side]: -22, width: 44, height: 44, borderRadius: 999, backgroundColor: WALL });
  const ticket = h("div", { display: "flex", position: "relative", marginTop: 40, height: 236, transform: "rotate(0.4deg)" }, [
    h("div", { display: "flex", flexDirection: "column", justifyContent: "center", width: 620, padding: "0 40px", backgroundColor: PAPER, color: PAPER_INK, borderRight: `4px dashed rgba(20,18,22,0.35)` }, [
      h("div", { display: "flex", alignItems: "center" }, [
        h("div", { display: "flex", flexShrink: 0, padding: "2px 12px", backgroundColor: PAPER_INK, color: PAPER, fontFamily: LATIN_DISPLAY_FAMILY, fontSize: 24, letterSpacing: 2, whiteSpace: "nowrap" }, "ADMIT ONE"),
        h("div", { display: "flex", marginLeft: 16, fontSize: 24, color: MUTED }, clamp(`来源：${p.source}`, 18)),
      ]),
      h("div", { display: "flex", marginTop: 18, fontSize: 44, fontWeight: 700 }, "长按识别二维码"),
      h("div", { display: "flex", marginTop: 6, fontSize: 24, color: MUTED }, "看全文、中文译文与原文链接"),
    ]),
    h("div", { display: "flex", alignItems: "center", justifyContent: "center", flex: 1, backgroundColor: TAPE },
      h("div", { display: "flex", padding: 14, backgroundColor: "#ffffff" },
        h("img", { width: 168, height: 168 }, undefined, { src: qr, width: 168, height: 168 }))),
    notch("top"),
    notch("bottom"),
  ]);

  return h("div", {
    width: WIDTH, height: HEIGHT, display: "flex", flexDirection: "column", position: "relative",
    padding: "60px 88px 64px", fontFamily: "Noto Sans SC", color: PAPER, backgroundColor: WALL,
    backgroundImage: "radial-gradient(circle at 92% 6%, rgba(255,45,120,0.22), rgba(11,10,13,0) 42%), radial-gradient(circle at 0% 100%, rgba(242,236,28,0.10), rgba(11,10,13,0) 40%)",
  }, [
    header,
    h("div", { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 36, height: 96 }, [tape, band ? bandLabel(band) : null].filter(Boolean)),
    h("div", { display: "flex", flexDirection: "column", position: "relative", flex: 1 }, [card, tapePiece]),
    ticket,
  ]);
}

export function posterEtag(p: Poster): string {
  // Same rule as the cards: the pictures' digests stand in for their hundreds of KB of base64.
  const digest = (s: string | undefined) => (s ? createHash("sha256").update(s).digest("hex") : null);
  const band = p.band ? { ...p.band, logo: digest(p.band.logo?.data) } : null;
  return createHash("sha256").update(POSTER_TEMPLATE_VERSION).update(SITE.name).update(SITE_HOST)
    .update(JSON.stringify({ ...p, image: digest(p.image?.data), band })).digest("hex").slice(0, 24);
}

/** PNG bytes for a poster, from the disk cache when this exact poster was rendered before. */
export async function renderPoster(p: Poster): Promise<{ png: Buffer; etag: string }> {
  const etag = posterEtag(p);
  return { png: await renderPng(`poster-${etag}`, { width: WIDTH, height: HEIGHT }, () => tree(p)), etag };
}
