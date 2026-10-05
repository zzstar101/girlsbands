-- 一场演出的每一次受理。live_events 给了一场演出一个地址，但一场演出会被受理很多次：
-- FC 先行 → 官方先行 → 一般贩售 → 追加席 / 当日券，每一次都有自己的开始、截止、当落发表与缴款期限。
-- 这些日期原先只能散在各自的公告里（analyses.output.fact.deadlines），读者要在几十条情报里自己拼。
--
-- 票务日期的真源是这张表，不是公告抽出来的日期：雷达（publication/deadlines.ts）、企划日历与 .ics
-- 都从这里读，而且当一场演出有轮次时，公告里抽出的 lottery_* / sale_* / result 会让位（同一个截止
-- 日不能出现两次）。日期以文本存放，形状与 analyses 里的 at 一致（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm），
-- 于是 splitDeadlineAt / deadlineInstant 与公告日期走同一条路径，不做第二套解析。
--
-- 状态不存：真值是 ticket_round_events 这条 append-only 的时间线，页面上的状态是读取时按日期与
-- 事件算出来的投影（W9 的拍板：便于 W14 变更 Diff 与 W10 行动中心读同一条时间线，不存副本）。
-- 站里没有读者账号，所以「你中没中、付没付」不是这里的问题 —— 只记公告自己写出的当落发表日与缴款期限。
--
-- 列：
--   live_event_id     属于哪一场演出
--   kind              受理方式（industry 侧提示词给出，词表在 packages/contracts/src/site.ts）
--   platform          原文写的票务平台。经 industry/glossary.ts 的平台词表归一到规范写法（恰好命中一条
--                     才归一，否则留原文），显示时照原样，不另起中文名
--   timezone          公告那一地的钟（W7），不换算不推算
--   apply_start_at    受理开始 / 开卖时刻；apply_end_at 受理截止
--   result_on         当落发表日；payment_due_on 缴款截止日
--   first_fact_id     第一次说出这条轮次的事实；first_article_id 是那篇公告，雷达与演出页上的
--                     「这条日期从哪来」就指向它（公告被下架时这条日期也就不再出现在公开出口）
--   quote             原文里写这次受理的那句话，必须能在正文里指到出处（与 deadlines 的引文同一规则）
CREATE TABLE ticket_rounds (
  id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  live_event_id bigint NOT NULL REFERENCES live_events (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fc', 'official', 'cd_serial', 'playguide', 'general', 'additional_seat', 'day_of', 'resale', 'streaming')),
  platform text,
  timezone text NOT NULL DEFAULT 'Asia/Tokyo' CHECK (timezone IN ('Asia/Tokyo', 'Asia/Shanghai')),
  apply_start_at text,
  apply_end_at text,
  result_on text,
  payment_due_on text,
  first_fact_id bigint REFERENCES facts (id) ON DELETE SET NULL,
  first_article_id text REFERENCES articles (id) ON DELETE SET NULL,
  quote text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 同一种受理方式只留一条：按「哪一天开始」区分（FC 先行一轮、二轮是不同的轮次）。开始日可以是 null
-- （原文只给了截止日），而唯一索引认为 null 彼此不同，所以写成表达式索引；键取日期那一段而不是整个
-- 时刻，先拿到日期的公告与后来写明时刻的公告才会归成同一条轮次。
CREATE UNIQUE INDEX ticket_rounds_identity
  ON ticket_rounds (live_event_id, kind, COALESCE(substring(apply_start_at FROM 1 FOR 10), ''));

-- 演出页与雷达都是「一场演出的轮次，按日期排」。
CREATE INDEX ticket_rounds_live ON ticket_rounds (live_event_id, apply_start_at);

-- 轮次的时间线：每出现一个新的节点追加一行，不改不删。同一轮次的同一种节点只记第一次见到的
-- （唯一索引），所以同一条公告重跑两次不会写第二行。
CREATE TABLE ticket_round_events (
  id bigserial PRIMARY KEY,
  ticket_round_id bigint NOT NULL REFERENCES ticket_rounds (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('opened', 'closed', 'result', 'payment_due')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  fact_id bigint REFERENCES facts (id) ON DELETE SET NULL,
  quote text
);

CREATE UNIQUE INDEX ticket_round_events_once ON ticket_round_events (ticket_round_id, kind);
