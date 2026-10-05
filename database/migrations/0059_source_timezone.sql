-- 中国的活动日期是北京时间，日本的信源是日本时间。在此之前，一个带时刻的日期按 `+09:00` 硬解
-- （publication/deadlines.ts 原来的 jstInstant），北京时间 21:00 之后开演的场次会被算成次日。时区是
-- 来源的属性，不是要从正文里读出来的东西（读错会静默地把一个截止日挪走），所以放在 source.config 里：
-- 新增受控键 `timezone`（packages/backend/src/sources/config-keys.ts 的 COLLECTED 与 VALUES，值域只有
-- Asia/Tokyo / Asia/Shanghai），未配置的来源一律按日本时间，也就是所有既有来源。
--
-- 与 0055/0056/0057/0058 同理：scripts/seed.ts 只插不更新（ON CONFLICT (id) DO NOTHING），已经装好的
-- 实例必须靠迁移把这三个国内源的时区补上；全新安装直接读 industry/sources.json。存量条目的日期不用回填
-- ——`analyses.output.fact.deadlines[].at` 存的是公告写的墙钟时刻，读取层现在按来源时区解释它。
UPDATE sources SET config = jsonb_set(config, '{timezone}', to_jsonb('Asia/Shanghai'::text))
WHERE id IN ('json-cpp-only-events', 'json-bilibili-show', 'web-showstart-events');
