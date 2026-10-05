-- 谁被哪篇文章提到过。角色页（/member/<id>）回答的是「这个角色最近有什么报道」，而这件事在
-- 现有的数据里读不出来：`publications.tags` 只记 22 个抓取主体（企划与乐队），成员名从来没进过
-- 那套标记；成员名只散在标题、原文标题、摘要与正文里（`facts.subject` 里虽然写过 `理名（トゲナシ
-- トゲアリ Vo）`，那是模型抽取的说法，不是一份可枚举的清单）。industry/members.ts 是唯一一份人工
-- 整理过的角色↔声优↔乐队关系，所以这张表就是它的倒排索引。
--
-- 粒度：一行 = 一个成员被一篇报道提到一次。成员本身不进数据库（跟代码一起发布，改了名字就是一次
-- 代码改动），这里只记 id。
--
-- 匹配发生在 publish.ts 的同一个事务里，用 industry/glossary.ts 的 fold/contains（与翻译词表、
-- 提示词词块同一套规则：全半角、空白、撇号都归一，纯拉丁写法贴词边界），匹配 title /
-- original_title / summary 与正文（正文只看 body_mode='full' 的报道，与 pool_search 同一批文本）。
-- 文章不公开收录（eligible 为假）时它的成员行一起删掉 —— 与 pool_search 同一条规则：页面读的是
-- 「现在还列得出来的报道」，下架或撤收录的文章不该继续让人找到角色页。
--
-- 不记来源（计划里原本有 source CHECK (title|body|x_post)）：没有任何出口读它，而
-- tests/architecture.test.ts 要求每张表的每一列都被生产代码用到。真源始终是文章本身，
-- 这张表随时可以重建（scripts/backfill-member-mentions.ts）。
--
-- 列：
--   member_id   角色/声优的 id，即 industry/members.ts 的 MEMBER_ENTITIES[].id（如 nina-iseri）
--   article_id  提到它的那篇报道；文章删了，行跟着删（CASCADE）
CREATE TABLE member_mentions (
  member_id  text NOT NULL,
  article_id text NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, article_id)
);

-- 重新发布或下架时要整篇重写（DELETE ... WHERE article_id = ...），所以这一侧也要索引；
-- 另一侧（按成员读他的报道）由主键覆盖。
CREATE INDEX member_mentions_article_idx ON member_mentions (article_id);
