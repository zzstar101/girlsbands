-- 成员（声优）个人账号的纯日常：站主 2026-10-07 拍板收进来，但单独一栏（industry/taxonomy.ts 的 daily 类别）。
-- 预筛判 DAILY 的分析写 relevance = 'daily'：不进公共池（rules.ts isPoolEligible 只认 pass）、不分组、不精选，
-- 只在 /all?category=daily 与乐队页的入口里列出（publication/scope.ts dailyCondition）。
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_relevance_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_relevance_check CHECK (relevance IN ('pass', 'block', 'unknown', 'daily'));

-- 日常一栏按时间倒序翻页，只读这一类。
CREATE INDEX IF NOT EXISTS publications_daily_timeline_idx ON publications (timeline_at DESC, article_id DESC)
  WHERE category = 'daily' AND visibility = 'public';
