-- 海外公演的钟。日本来源公告香港、台北公演时，时刻写的是「現地時間」，而 live_events / ticket_rounds
-- 原先只认日本与北京两个钟，香港 12:00 的抽选只能存成日本时间 12:00 —— 页面上就差了一个小时。
--
-- 值域放宽到 packages/contracts/src/site.ts 的 TIMEZONES（都是 1991 年以来没有夏令时、也没改过偏移的
-- 固定偏移地区）。releases 一起放宽：同一份值域，不该有一张表落在后面。
--
-- 已有的行不在这里改：哪一场演出在海外由会场词表与 live 步骤推出来（packages/backend/src/lives/link.ts），
-- 回填用 scripts/backfill-live-timezones.ts。
ALTER TABLE live_events DROP CONSTRAINT IF EXISTS live_events_timezone_check;
ALTER TABLE live_events ADD CONSTRAINT live_events_timezone_check CHECK (timezone IN (
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Seoul',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila'
));

ALTER TABLE ticket_rounds DROP CONSTRAINT IF EXISTS ticket_rounds_timezone_check;
ALTER TABLE ticket_rounds ADD CONSTRAINT ticket_rounds_timezone_check CHECK (timezone IN (
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Seoul',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila'
));

ALTER TABLE releases DROP CONSTRAINT IF EXISTS releases_timezone_check;
ALTER TABLE releases ADD CONSTRAINT releases_timezone_check CHECK (timezone IN (
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Seoul',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila'
));
