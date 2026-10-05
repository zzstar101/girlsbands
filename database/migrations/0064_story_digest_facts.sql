-- 情报变更（W14）：事件页首屏与时间线卡片的 ⚠️ 角标要说清「这件事跟上一版报道比变了什么」。
-- 变化是算出来的，不是存下来的：每次重写综述（events/digest.ts 的 composeStoryDigest）都顺手记一份
-- 「当时每篇报道自己怎么说」的快照（facts）与它的指纹（facts_hash），再与上一版比出这次的变化清单
-- （changes / change_kinds）。比完就留在这一版行上，读者只看到「上一版 → 当前」这一次。
--
-- 为什么单独存快照，而不是读现成的：`facts.subject/action/object` 是编辑器可以改的投影（同一句
-- 注释也写在 events/digest.ts 里），拿它做 diff 永远为空；而且没有上一版的原始材料，就无从比较。
-- 快照只取抽取结果里受控的那些字段（每篇报道的 conditions、deadlines、live 的开演状态/会场/时刻、
-- release 的发售日与价格），与输入指纹 inputs_hash 无关 —— 所以「只改了日期」这类不进 inputs_hash
-- 的改动也会多写一版，但不会多花一次模型调用（receipt_id 与 digest 都沿用上一版）。
--
-- 存量行：facts/facts_hash 为 null。下一次 composeStoryDigest 会把它当成「和这一版不同」而多写一版
-- （正好把第一份快照补上），但因为上一版没有快照，这次算出的 changes 是空的 —— 不会拿存量文章
-- 误报一次「全变了」。没有回填脚本，也不需要。
--
-- 读取侧：
--   publication/story-text.ts / publication/stories.ts  事件页首屏的「上次更新」变化块
--   publication/timeline.ts                             时间线卡片 7 天内的 ⚠️ 角标（只认醒目四类）
--   publication/deadlines.ts                            取消的演出不再出现在截止雷达与 .ics 上；
--                                                       延期或改期的演出只按最新一次公告的日期算
--
-- 列：
--   facts        这一版的抽取快照（每篇报道一条；形状见 events/change-diff.ts 的 SnapshotEntrySchema）
--   facts_hash   快照指纹。与上一版相同且 inputs_hash 也相同时，这一版不重写、不收费
--   changes      与上一版比出来的变化清单 [{kind, text, itemId}]
--   change_kinds changes 里出现过的类别（cancelled / postponed / venue / time / rounds / release / text）
ALTER TABLE story_digests
  ADD COLUMN facts jsonb,
  ADD COLUMN facts_hash text,
  ADD COLUMN changes jsonb,
  ADD COLUMN change_kinds text[];
