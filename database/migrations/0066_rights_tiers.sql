-- 权利层级（W17）。站上展示的每一条正文都来自别人的作品，而「这是谁的内容、按什么规矩展示」原先只缩在
-- sources.site_fulltext 一个布尔里：它只说得出「能不能整篇展示」，说不出「这是官方公告还是媒体的报道」，
-- 于是来源方来问时后台答不出一句整话，将来要收紧也没处记。
--
-- 这一版**只加标注，不改公开读数**：迁移跑完，publications、RSS、v1 API、页面一字不变（body_mode 仍然
-- 只看 site_fulltext，见 packages/backend/src/publication/rules.ts 的 bodyModeOf）。标出层级是为了三件
-- 事：来源方来问时能立刻说清这一类内容怎么展示；后台一处看清某个来源属于哪一层；真要按层收紧时，只改
-- bodyModeOf 一处再走 republish 回填（不能只 UPDATE，见 0056 的教训）。
--
-- 四个层级（站主 2026-10-05 拍板）：
--   official    官方一手与官方账号：企划、乐队、唱片公司的官网与官方 X，含成员个人账号。
--               判据：tier ∈ {T1, T1_5} 且 owner_entity_id 非空。T1_5 是官方账号的镜像，内容和 T1 同源。
--   media       第三方媒体的报道。收紧后只留标题 + 中文摘要 + 原文链接。**默认值**：没标的按最保守算。
--   licensed    明确表示可以转载、或按许可协议发布的内容（今天没有这类来源，先留位置）。
--   event_data  票务与展会页面上的活动信息（时间、场馆、票价）：是事实条目，不是别人的正文，照旧展示。
--
-- rights_note 是给人看的备注：许可原话、来源方的要求、或者「已来信要求改成摘要」这类事实。留着它是因为
-- 层级是判断，判断的理由得和判断放在一起，否则半年后没人说得清当年为什么这么标。
ALTER TABLE sources ADD COLUMN IF NOT EXISTS rights_tier text NOT NULL DEFAULT 'media'
  CHECK (rights_tier IN ('official', 'media', 'licensed', 'event_data'));
ALTER TABLE sources ADD COLUMN IF NOT EXISTS rights_note text;

-- 先按判据把现有来源标一遍。不标的话全部挂着默认的 media —— 那等于把官方公告也算成第三方媒体，
-- 后台第一眼就是错的。
UPDATE sources SET rights_tier = CASE
  WHEN tier = 'T2_EVENT' THEN 'event_data'
  WHEN tier IN ('T1', 'T1_5') AND owner_entity_id IS NOT NULL THEN 'official'
  ELSE 'media'
END;
