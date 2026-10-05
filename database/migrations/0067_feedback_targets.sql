-- 读者纠错与情报投稿（W18）。反馈通道原先只有一个空白框：读者想说的是「这条的日期错了」「这个场馆名不对」
-- 「这场 Live 我在别处也看到过」，而落库的只有一段自由文本，于是后台没法把「同一条内容的 3 条纠错」并排看，
-- 也没法一眼看出是不是一个人刷的。
--
-- 这一版**只加列，不建表**：纠错与投稿都还是 feedback 行，只是多了「指的是哪一条内容、哪一类问题、期望的
-- 正确答案」。四个列全部可空 ⇒ 老反馈行与新入口共存，飞书转发、限流、封禁、截图一行代码不改。
--
-- target_kind 是站内对象的种类，target_id 是那个对象的 id（条目页 URL 里的那个 id，后台内容页用的是同一个，
-- 所以后台能直接跳过去）。投稿（`/submit`）用 target_kind = 'source'、不带 target_id：读者递进来的是一个
-- 站外链接，**绝不自动抓取**，人工确认后才按 AGENTS.md 的手工流程进 industry/sources.json。
--
-- expected 是读者写的「应该是这样」：没有它，后台只能看到「错了」，看不出该改成什么。
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS target_kind text
  CHECK (target_kind IN ('article', 'story', 'topic', 'release', 'live', 'venue', 'source'));
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS target_id text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS target_field text
  CHECK (target_field IN ('title', 'date', 'venue', 'price', 'translation', 'category', 'duplicate', 'other'));
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS expected text;

-- 后台的「按目标聚合」视图按 (target_kind, target_id) 分组、按不同来源数排序，这条索引喂它。
CREATE INDEX IF NOT EXISTS feedback_target_idx ON feedback (target_kind, target_id, created_at DESC);
