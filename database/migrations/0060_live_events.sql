-- 一场 Live 的身份。在此之前 facts 只挂 story_id，而 story 的身份会合并、会 308 跳转
-- （publication/stories.ts 的 resolveStory），dev 库里 stories.frame 全是 null、story_aliases 是空表 ——
-- 所以「这场 Live 现在走到哪一步」没有地方可以算，几十条一手情报只能各自成篇。
-- live_events 给一场演出一个不随聚簇结果漂移的地址，facts.live_event_id 把事实挂上去。
--
-- live_event_id 可空，而且是回填式的：推不出主体或日期的 fact 不建实体（宁缺勿错），
-- 已在库里的老数据由 scripts/backfill-live-events.ts 按同一套推导补挂（走
-- packages/backend/src/lives/link.ts，与实时链路同一份代码）。
--
-- 列：
--   subject_entity  主体，industry/taxonomy.ts 的 ENTITIES id；没有主体的不成实体
--   venue           会场。照抄原文写法，经 industry/glossary-venues.ts 的会场词表归一（恰好命中一条才认，
--                   多会场或认不出就是 null，宁缺勿错）。null 不参与唯一键比较，见下面的 COALESCE
--   timezone        公告那一地的钟，与 sources.config.timezone 同一口径（W7），不换算不推算
--   starts_on       开演那天，按公告自己的日历
--   starts_time     开演时刻 HH:mm，公告只写日期时为 null
--   ends_on         多日活动的最后一天，单日场为 null
--   status          公告说的状态（scheduled | cancelled | postponed），不是读取时现场推出的阶段
--   story_id        首次建立时所属的 story，只为跳转方便；story 合并后它可能过期，读取时以 facts 为准
--   first_seen_at   第一次见到这场演出；updated_at 最后一次写入
--
-- 唯一键写成表达式索引：venue 与 starts_time 都可以是 null，而 Postgres 的唯一索引认为 null 彼此不同，
-- 直接写 (subject_entity, venue, starts_on, starts_time) 会让同一场演出在每次链接时新建一行。
CREATE TABLE live_events (
  id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  title text NOT NULL,
  subject_entity text NOT NULL,
  venue text,
  timezone text NOT NULL DEFAULT 'Asia/Tokyo' CHECK (timezone IN ('Asia/Tokyo', 'Asia/Shanghai')),
  starts_on date NOT NULL,
  ends_on date,
  starts_time text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'postponed')),
  story_id bigint REFERENCES stories (id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX live_events_identity
  ON live_events (subject_entity, COALESCE(venue, ''), starts_on, COALESCE(starts_time, ''));

-- 主体页与日历都是一段日期区间里的一次查找。
CREATE INDEX live_events_starts ON live_events (starts_on, subject_entity);

ALTER TABLE facts ADD COLUMN live_event_id bigint REFERENCES live_events (id) ON DELETE SET NULL;
CREATE INDEX facts_live_event ON facts (live_event_id);
