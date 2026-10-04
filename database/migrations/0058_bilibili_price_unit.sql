-- B 站会员购的票价字段单位是“分”（price_low: 6800 就是 ¥68）。原模板把它直接印进条目正文，读者看到
-- 的是“票价：7000 分起”。采集器现在有 {money:path} 占位符负责换算（packages/backend/src/sources/json-list.ts
-- 的 moneyText：6800 → ¥68），industry/sources.json 的模板也改成“票价：{money:price_low} 起”。
--
-- 同样因为 scripts/seed.ts 只插不更新（ON CONFLICT (id) DO NOTHING），已经装好的实例要在这里改
-- config；全新安装读 JSON。已经入库的那几条不会自己变（同一条活动的 identity_key 不变，不会再抓一次），
-- 要修就得按新模板重算正文再重跑一次分析——做法与核验见 docs/refit-plan.md 的 W6 章节。
UPDATE sources
SET config = jsonb_set(
  config,
  '{summaryTemplate}',
  to_jsonb('活动时间：{date:start_time}｜城市：{city}｜区县：{district_name}｜场馆：{venue_name}｜票务状态：{sale_flag}｜开票：{date:sale_start_time}｜票价：{money:price_low} 起｜想去：{wish} 人'::text)
)
WHERE id = 'json-bilibili-show';
