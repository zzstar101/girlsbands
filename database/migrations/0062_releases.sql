-- 一张碟。少女乐队企划最值钱的一条链是「CD → 抽选券 → Live」：初回限定盘里塞一张序列号，
-- 拿序列号去应募某场演出的先行抽选。分类与标签已经把这些字记下来了（新作发售 / 初回限定盘 /
-- 店铺特典 / 序列号 / 受注生产 / 场贩），但它们彼此不相连 —— 一张碟有几个版本、哪个版本带序列号、
-- 序列号能换哪场演出、哪家店送什么，在任何出口都读不出来。这几张表就是那条链。
--
-- 粒度（站主 2026-10-05 拍板）：一张碟一行 releases，版本是它的 edition 行。所以「通常盤 + 初回
-- 限定盤 A + 初回限定盤 B」是一个页面一个地址，发售日与抽选对所有版本共用；版本之间只差名字、
-- 是否带 BD、是否带序列号、价格与品番。
--
-- 日期不在这里存：能出现在雷达、企划日历、.ics 与提醒信里的日期只有一份真源 —— 公告抽出来的
-- deadlines（publication/deadlines.ts 读它，受注截止与配信期限也在其中）。releases.release_on 是
-- 「这张碟哪天发售」这一个属性（供页面显示与排序），不是第二个截止日列表；序列号那一行也不存
-- 应募期间，页面上的应募日期来自它指向的那场演出的轮次（ticket_rounds）或那篇公告自己的日期。
-- 这样 W9 定下的「同一个截止日不能出现两次」不需要在这里再判一次。
--
-- 信息只来自公告（站主 2026-10-05 拍板）：不开人工维护的 industry/releases/{slug}.json。公告只写
-- 「対象店舗」时，页面上就只显示这几个字 —— 宁可少写，不手抄店铺页。
--
-- 列：
--   public_id         页面地址（/release/<public_id>）
--   subject_entity    归属于哪个主体（ENTITIES 里的企划或乐队），与 live_events 同一套写法
--   title             碟名（中文优先，取分析的 title_zh；没有就留原文）
--   kind              single / album / ep / bluray / dvd / digital / merch / other
--   release_on        发售日（原文那一地的日历，YYYY-MM-DD）；只有确实写了才填
--   announced_on      公布日，用于「先公布后发售」的排序
--   timezone          公告那一地的钟（W7），不换算不推算
--   story_id          这条发售所属的故事（相关公告的入口）
--   first_fact_id     第一次说出这张碟的事实；first_article_id 是那篇公告 —— 公告下架时，这个
--                     页面与它对应的公开出口一起消失（与 live_events 同一条规则）
--   quote             原文里写这张碟的那句话，必须能在正文里指到出处
CREATE TABLE releases (
  id bigserial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  subject_entity text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('single', 'album', 'ep', 'bluray', 'dvd', 'digital', 'merch', 'other')),
  release_on text,
  announced_on text,
  timezone text NOT NULL DEFAULT 'Asia/Tokyo' CHECK (timezone IN ('Asia/Tokyo', 'Asia/Shanghai')),
  story_id bigint REFERENCES stories (id) ON DELETE SET NULL,
  first_fact_id bigint REFERENCES facts (id) ON DELETE SET NULL,
  first_article_id text REFERENCES articles (id) ON DELETE SET NULL,
  quote text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 同一个主体的同一张碟只留一行。发售日可以是 null（公告常常只写「今冬发售」），唯一索引认为 null
-- 彼此不同，所以写成表达式索引：没有发售日的重名碟仍然会归成同一行。
CREATE UNIQUE INDEX releases_identity ON releases (subject_entity, title, COALESCE(release_on, ''));

-- 企划页与成员页读的是「某个主体最近发售了什么」，按发售日倒序。
CREATE INDEX releases_subject ON releases (subject_entity, release_on DESC);

-- 版本。name 是原文写的版本名（初回限定盤 A / 通常盤 / アニメ盤），不另起规范名。
CREATE TABLE release_editions (
  id bigserial PRIMARY KEY,
  release_id bigint NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('regular', 'limited', 'first_press', 'other')),
  includes_bluray boolean NOT NULL DEFAULT false,
  includes_serial boolean NOT NULL DEFAULT false,
  price_yen integer,
  sku text,
  quote text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX release_editions_identity ON release_editions (release_id, name);

-- 店铺特典：哪家店、送什么、是不是初回先着。edition_id 为 null 表示公告没说是哪个版本（整张碟通用）。
CREATE TABLE release_bonuses (
  id bigserial PRIMARY KEY,
  release_id bigint NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  edition_id bigint REFERENCES release_editions (id) ON DELETE CASCADE,
  retailer text NOT NULL,
  bonus text NOT NULL,
  first_press boolean NOT NULL DEFAULT false,
  url text,
  quote text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX release_bonuses_identity
  ON release_bonuses (release_id, COALESCE(edition_id, 0), retailer, bonus);

-- 序列号 / 抽选：这张碟里的券能做什么。live_event_id 指到 W8 的演出（拿得到那场演出的轮次与页面），
-- live_title 是公告写了演出名但没能归一成一场演出时的兜底（页面上仍然读得懂）。
-- 应募期间不在这里：它属于那场演出的轮次（ticket_rounds，kind 'cd_serial'）或那篇公告自己的日期。
CREATE TABLE release_serials (
  id bigserial PRIMARY KEY,
  release_id bigint NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  edition_id bigint REFERENCES release_editions (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('lottery', 'preorder', 'streaming', 'other')),
  live_event_id bigint REFERENCES live_events (id) ON DELETE SET NULL,
  live_title text,
  url text,
  quote text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 同一张碟的同一种序列号指向同一场演出时只留一行。
CREATE UNIQUE INDEX release_serials_identity
  ON release_serials (release_id, kind, COALESCE(live_event_id, 0), COALESCE(live_title, ''));
