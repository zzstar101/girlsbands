// 谁被哪篇文章提到过：发布时算一次，写进 member_mentions（0063_member_mentions.sql）；
// 角色页（publication/members.ts）与所有出口只读那张表。
//
// 匹配规则与翻译词表共用一套（industry/glossary.ts 的 fold / contains / usable），所以「这篇原文里
// 认得出哪些名字」在提示词词块与角色页之间不会有两套说法：全半角、空白、撇号先归一，纯拉丁的写法
// （`YOSHI`、`MIYU`）要贴词边界，过短的写法（两字以下的假名，`usable` 的规则）不参与匹配。
//
// 一处例外：罗马字名字是两个词（`Nina Iseri`），而 fold 会把空白抹掉，抹掉之后 "Nina Iseri announces"
// 里的 "ninaiseri" 后面紧跟着字母，贴边界反而判成不命中。所以多词的拉丁写法按词序匹配（词之间允许
// 空白），单字与含汉字的写法仍然走 contains —— `Rina` 还是不会命中 `Marina`。
//
// 一个成员页认得的所有写法：本名、假名、罗马字，加上并进这一页的别名（Ave Mujica 的五个舞台代号、
// Hello, Happy World! 的米歇尔）—— 别名提到的报道算这个角色的报道（站主 2026-10-05 拍板）。
import { contains, fold, usable } from "@girlsbands/industry/glossary";
import { MEMBER_ENTITIES } from "@girlsbands/industry/members";
import { type Db } from "../db.ts";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 一个写法：单字/含汉字的用词表规则，多词的拉丁写法自带一条按词序匹配的规则。 */
interface Matcher {
  form: string;
  pattern: RegExp | null;
}

const matchersFor = (forms: readonly string[]): Matcher[] =>
  forms.filter(usable).map((form) => {
    const parts = form.trim().split(/[\s\u3000]+/).filter(Boolean);
    if (parts.length < 2 || !/^[\x00-\x7f]+$/.test(fold(form))) return { form, pattern: null };
    const body = parts.map((part) => escapeRegExp(part.toLowerCase())).join("[\\s\\u3000]*");
    return { form, pattern: new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i") };
  });

const MATCHERS: ReadonlyArray<{ id: string; forms: readonly Matcher[] }> = MEMBER_ENTITIES.map((m) => ({
  id: m.id,
  // 声优名也算这个角色的报道（站主 2026-10-05 拍板）：一个声优配两个角色时两边都会认下来，这是对的。
  forms: matchersFor([...m.forms, ...m.aliases.flat(), ...m.actor.forms]),
}));

/** 一篇报道里会被匹配的文本。正文只在 body_mode='full' 时给，与 pool_search 的规则一致。 */
export interface MemberText {
  title?: string | null;
  originalTitle?: string | null;
  summary?: string | null;
  body?: string | null;
}

/** 这段文本提到的成员 id，按 MEMBER_ENTITIES 的顺序（稳定，便于比对与测试）。 */
export function mentionedMembers(text: MemberText): string[] {
  const raw = [text.title, text.originalTitle, text.summary, text.body]
    .filter((s): s is string => !!s)
    .join("\n")
    .normalize("NFKC");
  const hay = fold(raw);
  if (!hay) return [];
  return MATCHERS.filter((m) => m.forms.some((f) => (f.pattern ? f.pattern.test(raw) : contains(hay, f.form)))).map((m) => m.id);
}

/**
 * 把这篇报道的成员提及写成当前的样子：公开收录（eligible）时整篇重写，否则删掉。
 * 与 pool_search 同一事务、同一条「收录才留」的规则，重复发布不会留下重复行。
 */
export async function deriveMemberMentions(db: Db, articleId: string, eligible: boolean, text: MemberText): Promise<string[]> {
  const ids = eligible ? mentionedMembers(text) : [];
  await db`DELETE FROM member_mentions WHERE article_id = ${articleId}`;
  if (ids.length > 0) {
    await db`INSERT INTO member_mentions (member_id, article_id)
             SELECT member, ${articleId} FROM unnest(${ids}::text[]) AS member
             ON CONFLICT DO NOTHING`;
  }
  return ids;
}
