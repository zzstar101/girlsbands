const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Posts collected before the X card existed carry their quoted post inside the body: a
 * "Name (@handle)" line, the quoted text, then a "— https://x.com/…/status/…" link. With the quote
 * shown as its own card that echo is a duplicate, so it is cut: the blockquote if there is one, the
 * status-link line, and everything from the "Name (@handle)" line to the end of its paragraph.
 */
export function stripQuoteEcho(html: string, quoted: { authorName?: string | null; handle: string } | null): string {
  if (!quoted) return html;
  let out = html.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");
  out = out.replace(/<p>\s*(?:—|&mdash;)\s*<a [^>]*href="[^"]*\/status\/\d+[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/p>/gi, "");
  const marks = [quoted.authorName ? `${quoted.authorName} (@${quoted.handle})` : null, `(@${quoted.handle})`].filter(Boolean) as string[];
  for (const mark of marks) {
    for (const m of [mark, escapeHtml(mark)]) {
      const at = out.indexOf(m);
      if (at < 0) continue;
      const lineStart = Math.max(out.lastIndexOf("<br>", at), out.lastIndexOf("<p>", at));
      const end = out.indexOf("</p>", at);
      if (lineStart < 0) continue;
      const isBr = out.startsWith("<br>", lineStart);
      out = out.slice(0, lineStart) + (isBr ? "" : "<p>") + (end < 0 ? "" : out.slice(end));
      return out.replace(/<p>\s*<\/p>/g, "");
    }
  }
  return out.replace(/<p>\s*<\/p>/g, "");
}
