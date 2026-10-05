-- 演出结束以后留下的曲目单（W16）。live_events 从 W8 起回答「这场演出现在走到哪一步」，可是演出结束之后
-- 读者想问的是另一件事：那天唱了什么。这份信息从来不在演出的身份里 —— 名字、会场、日期都没有它，而报告
-- 正文里写着的曲目单原先没有地方落，页面上也就看不见。
--
-- 两个来源，同一张表：
--   article  从这场演出自己的报告正文里抽出来的，每一行都要能在原文里指到出处（quote），article_id 指向
--            那一篇公告；公告被下架时这一行跟着消失（读取层按报告的可见性过滤，与报告清单同一道门）。
--   reader   读者通过 /feedback 补充、由后台采纳的。没有公告可指，quote 就是读者写下的那一行原文；
--            它不随任何一篇公告的上下架变化。
-- 两类分开存是因为规则不同：重扫只替换 article 那几行，reader 补的一行不动。
--
-- position 只是显示顺序，不是曲目序号：原文没写编号时它就是读到的先后。is_encore / is_cover 是原文自己
-- 说的（アンコール 那一段、写明了是别人唱的曲子），不是按位置猜的。
--
-- live_events.setlist_scanned_at 记「找过了」。曲目单不是每场都有，页面要能区分「还没找过」与「找过，
-- 原文里确实没有」；没有这个时间戳，每读一次页面、每扫一次都要重问一遍模型，既费钱也说不出「确实没有」。
--
-- 列：
--   live_event_id 属于哪一场演出（随演出删除）
--   source        article 抽自公告 / reader 读者补充
--   position      显示顺序，同一次来源内从 1 起
--   title         曲名，照原文写法，不译、不改大小写
--   is_encore     原文把它放在アンコール那一段
--   is_cover      原文写明是别人唱的曲子
--   quote         原文里写出这一行的那句话（reader 行就是读者写的那一行）
--   article_id    抽自哪一篇公告；读者补的为 null
ALTER TABLE live_events ADD COLUMN setlist_scanned_at timestamptz;

CREATE TABLE setlist_entries (
  id bigserial PRIMARY KEY,
  live_event_id bigint NOT NULL REFERENCES live_events (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('article', 'reader')),
  position int NOT NULL CHECK (position >= 1),
  title text NOT NULL,
  is_encore boolean NOT NULL DEFAULT false,
  is_cover boolean NOT NULL DEFAULT false,
  quote text NOT NULL,
  article_id text REFERENCES articles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 同一次来源里的同一个位置只留一行：重扫先删 article 行再写回，reader 行按自己的序号排，两边不撞键。
CREATE UNIQUE INDEX setlist_entries_identity ON setlist_entries (live_event_id, source, position);
