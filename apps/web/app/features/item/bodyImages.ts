// Pictures come out of the body text and are shown together after it, as a gallery that opens each one
// large. Inline they broke the reading (long ticket info images, a row of posters between two lines).
// Works on the sanitised server HTML as a string, so server rendering and hydration produce the same markup.
import type { MediaView } from "@girlsbands/contracts/site";

const ATTR = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Wrappers left holding nothing once their picture is gone (a linked image, a figure, a paragraph of breaks). */
const EMPTY = /<(p|a|figure|picture|div|span|strong|b|em|center)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>|<source\b[^>]*>|<figcaption\b[^>]*>\s*<\/figcaption>)*<\/\1>/gi;

export function splitBodyImages(html: string): { html: string; images: MediaView[] } {
  const images: MediaView[] = [];
  const seen = new Set<string>();
  let text = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = ATTR(tag, "src");
    if (!src) return "";
    const url = decode(src);
    if (seen.has(url)) return "";
    seen.add(url);
    const width = Number(ATTR(tag, "width")) || null;
    const height = Number(ATTR(tag, "height")) || null;
    // Tiny pictures are icons and emoji in the text: they stay where they are.
    if ((width && width < 48) || (height && height < 48)) return tag;
    const alt = ATTR(tag, "alt");
    images.push({ kind: "image", url, width, height, alt: alt ? decode(alt) : null, poster: null });
    return "";
  });
  // Figure captions stay as text only when there is something to read.
  for (let i = 0; i < 4; i++) {
    const next = text.replace(EMPTY, "");
    if (next === text) break;
    text = next;
  }
  // Leading/trailing breaks the removal leaves at block edges.
  text = text.replace(/(<p\b[^>]*>)(?:\s|<br\s*\/?>)+/gi, "$1").replace(/(?:\s|<br\s*\/?>)+(<\/p>)/gi, "$1");
  return { html: text, images };
}
