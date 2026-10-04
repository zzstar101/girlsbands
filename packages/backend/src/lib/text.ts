export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function truncate(s: string, max: number, ellipsis = "…"): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, Math.max(0, max - ellipsis.length)).join("").trimEnd() + ellipsis;
}

export function stripTags(html: string): string {
  return collapseWhitespace(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'"),
  );
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Share of CJK characters among letters; used to decide whether a title needs translation. */
export function cjkRatio(s: string): number {
  const letters = s.match(/[\p{L}]/gu) ?? [];
  if (letters.length === 0) return 0;
  const cjk = s.match(/[㐀-鿿豈-﫿]/g) ?? [];
  return cjk.length / letters.length;
}

export function guessLanguage(s: string): "zh" | "en" | "other" {
  const ratio = cjkRatio(s);
  if (ratio > 0.3) return "zh";
  if (/[a-z]/i.test(s)) return "en";
  return "other";
}

/** Hiragana and katakana, including the katakana phonetic extensions. */
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/;
/** Hangul syllables: a Korean line that borrows Hanja is not Chinese either. */
const HANGUL = /[\uac00-\ud7af]/;

/**
 * Whether text already reads as Chinese, so a Chinese translation of it would repeat itself.
 *
 * Han characters without kana are Chinese; Han characters with kana are Japanese. This site collects
 * Japanese sources, so a plain Han test would read every Japanese headline as Chinese and skip its
 * translation. `guessLanguage` cannot answer this: its ratio counts kana as non-CJK letters, so a
 * Japanese sentence written mostly in kanji still comes back as "zh".
 *
 * This is the single implementation of that rule: the analysis (`editorial/analyze.ts`,
 * `editorial/writing.ts`), the translator (`editorial/translate.ts`) and the read layer
 * (`publication/items.ts`, `publication/publish.ts`) all ask it, so they cannot drift apart.
 */
export function looksChinese(s: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(s) && !KANA.test(s) && !HANGUL.test(s);
}
